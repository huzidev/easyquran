use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use axum_client_ip::ClientIp;
use axum_macros::debug_handler;

use serde_json::json;
use tracing::{error, info, instrument, warn};

use crate::{
    db::sea_models::{forgot_password, user},
    error::{ErrorCode, ErrorResponse},
    extractors::ValidatedJson,
    services::{
        abuse_limiter,
        mail::{mail_error_kind, mail_error_to_response, send_forgot_password_email},
    },
    AppState,
};

use super::validator::{V1GeneratePayload, V1ResetPayload, V1VerifyPayload, V1VerifyResponse};

const ABUSE_LIMITER_CONFIG: abuse_limiter::AbuseLimiterConfig = abuse_limiter::AbuseLimiterConfig {
    temp_block_attempts: 3,
    temp_block_range: 360,
    temp_block_duration: 3600,
    block_retry_limit: 5,
    block_range: 900,
    block_duration: 86400,
};

/// Single-use reset tokens minted by `verify`, consumed by `reset`; backed by an in-memory TTL map (a restart drops outstanding tokens).
mod reset_token {
    use super::*;
    use rand::Rng;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;
    use zeroize::Zeroize;

    const TTL_SECS: u64 = 600;

    type TokenMap = HashMap<String, (i32, Instant)>;

    static TOKENS: OnceLock<Mutex<TokenMap>> = OnceLock::new();

    fn tokens() -> &'static Mutex<TokenMap> {
        TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn reap_stale(map: &mut TokenMap) {
        map.retain(|_, (_, at)| at.elapsed().as_secs() < TTL_SECS);
    }

    fn namespaced_key(token: &str) -> String {
        format!("forgot_password:reset_token:{token}")
    }

    pub async fn mint(user_id: i32) -> Result<String, ErrorResponse> {
        let mut bytes = zeroize::Zeroizing::new([0u8; 32]);
        rand::rng().fill(bytes.as_mut());
        let token = hex::encode(*bytes);
        bytes.zeroize();

        let mut map = tokens().lock().map_err(|e| {
            error!(error = %e, "reset_token map poisoned");
            ErrorResponse::new(ErrorCode::InternalServerError)
        })?;
        reap_stale(&mut map);
        map.insert(namespaced_key(&token), (user_id, Instant::now()));
        Ok(token)
    }

    /// Removal on take is required for single-use semantics — never a read (`get`), or a replayed `reset` could reuse the token.
    pub async fn take(token: &str) -> Result<Option<i32>, ErrorResponse> {
        let mut map = tokens().lock().map_err(|e| {
            error!(error = %e, "reset_token map poisoned");
            ErrorResponse::new(ErrorCode::InternalServerError)
        })?;
        reap_stale(&mut map);
        Ok(map.remove(&namespaced_key(token)).map(|(id, _)| id))
    }
}

/// 2026-08-26 product decision: accurate feedback over the old SC-006
/// anti-enumeration mask. Unknown emails answer with an explicit
/// RecordNotFound; successful sends confirm delivery. The abuse limiter above
/// remains the brute-force brake on the now-honest oracle.
#[debug_handler]
#[instrument(skip(state, payload), fields(client_ip = %secure_ip))]
pub async fn generate(
    state: State<AppState>,
    ClientIp(secure_ip): ClientIp,
    payload: ValidatedJson<V1GeneratePayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    // Run before the existence check so email-probing is throttled too.
    let ip = secure_ip.to_string();
    let key_prefix = format!("forgot_password:{}", ip);
    match abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await {
        Ok(_) => (),
        Err(err) => {
            warn!("Abuse limiter blocked forgot password request");
            return Err(err);
        }
    }

    let pool = &state.sea_db;
    let user = match user::Entity::find_by_email(pool, payload.email.clone()).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            warn!("Forgot password requested for non-existent email");
            return Err(ErrorResponse::new(ErrorCode::RecordNotFound)
                .with_message("No account exists for that email"));
        }
        Err(err) => {
            error!("Database error finding user: {}", err);
            return Err(err);
        }
    };
    let user_id = user.id;

    match forgot_password::Entity::find_query(pool, Some(user_id), None, None).await {
        Ok(verification) => {
            if verification.is_in_delay() {
                // Delay stays enforced (no new code, no email) and the user is told why.
                warn!(user_id, "Forgot password in delay period");
                return Err(ErrorResponse::new(ErrorCode::TooManyAttempts).with_message(
                    "A reset code was already sent. Please wait a minute before requesting another.",
                ));
            }
        }
        Err(err) => {
            if err.code != ErrorCode::InvalidInput {
                error!(user_id, "Error checking forgot password delay: {}", err);
                return Err(err);
            }
        }
    }

    // Store only the keyed hash; the plaintext is emailed but never persisted.
    let code = forgot_password::Entity::generate_code();
    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &code);
    if let Err(err) = forgot_password::Entity::regenerate(pool, user_id, code_hash).await {
        error!(user_id, "Failed to store forgot-password code: {}", err);
        return Err(err);
    }

    // ── DELIVERY: reset-code hand-off ─────────────────────────────────────────
    // This is the single place the plaintext reset code leaves the request. To
    // change how a code reaches the user (SMTP, log file, test-fixture echo…),
    // edit ONLY this block — generation, hashing, and storage above stay as-is.
    //
    // Non-production: there is usually no SMTP server in dev, so the code is
    // written to the API log (`just dev` console) and delivery is treated as
    // done. Production: email it and fail the request on a transport error.
    // NEVER log the code on the production branch.
    if matches!(crate::config::settings::is_production(), Ok(false)) {
        // No email field: PII guard in tests/security_tests.rs forbids logging
        // the recovery address here. user_id identifies the row for lookup.
        info!(
            user_id,
            reset_code = %code,
            "DEV delivery: forgot-password reset code (non-production build)"
        );
    } else if let Err(err) = send_forgot_password_email(&state.mailer, &payload.email, &code).await
    {
        error!(
            user_id,
            error_kind = mail_error_kind(&err),
            "Failed to send forgot password email"
        );
        return Err(mail_error_to_response(&err));
    }

    info!(user_id, "Recovery code issued");
    Ok((
        StatusCode::OK,
        Json(json!({
            "message": "A password reset code has been sent to your email.",
        })),
    ))
}

#[debug_handler]
#[instrument(skip(state, payload), fields(client_ip = %secure_ip))]
pub async fn verify(
    state: State<AppState>,
    ClientIp(secure_ip): ClientIp,
    payload: ValidatedJson<V1VerifyPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let key_prefix = format!("forgot_password_verify:{}", secure_ip);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &payload.code);
    let result = forgot_password::Entity::find_query(
        &state.sea_db,
        None,
        Some(&payload.email),
        Some(&code_hash),
    )
    .await;

    let verification = match result {
        Ok(verification) => {
            if verification.is_expired() {
                warn!("Forgot password code expired");
                return Err(ErrorResponse::new(ErrorCode::InvalidInput)
                    .with_message("The verification code has expired"));
            }
            verification
        }
        Err(err) => {
            warn!("Invalid forgot password code");
            return Err(err);
        }
    };
    let user_id = verification.user_id;

    if let Err(err) = forgot_password::Entity::consume_code(&state.sea_db, user_id).await {
        error!(user_id, "Failed to consume forgot-password code: {}", err);
        return Err(err);
    }

    let reset_token = reset_token::mint(user_id).await?;

    info!(
        user_id,
        "Forgot password code verified and consumed; reset token issued"
    );
    Ok((StatusCode::OK, Json(V1VerifyResponse { reset_token })))
}

#[debug_handler]
#[instrument(skip(state, payload), fields(client_ip = %secure_ip))]
pub async fn reset(
    state: State<AppState>,
    ClientIp(secure_ip): ClientIp,
    payload: ValidatedJson<V1ResetPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    // Intentionally shares the verify bucket — do not rename to a reset-specific key.
    let key_prefix = format!("forgot_password_verify:{}", secure_ip);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    if payload.password != payload.confirm_password {
        warn!("Password mismatch");
        return Err(ErrorResponse::new(ErrorCode::InvalidInput)
            .with_message("Password and confirm password do not match"));
    }

    // Password change requires the single-use reset_token; never add a code+email fallback — that would let an email-interceptor skip /verify.
    let user_id = match reset_token::take(&payload.reset_token).await? {
        Some(id) => id,
        None => {
            warn!("Reset attempted with an unknown or already-used reset token");
            return Err(ErrorResponse::new(ErrorCode::InvalidInput)
                .with_message("Reset token is invalid or has expired"));
        }
    };

    match forgot_password::Entity::reset(&state.sea_db, user_id, payload.password.clone()).await {
        Ok(_) => {
            info!(user_id, "Password reset in database");
            Ok((
                StatusCode::OK,
                Json(json!({
                    "message": "Password reset successfully",
                })),
            ))
        }
        Err(err) => {
            error!(user_id, "Failed to reset password: {}", err);
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Guards only the handler source — each test's own text must not satisfy
    // its asserts, so the strings they pin appear in the asserts only.
    fn handler_src() -> &'static str {
        let src = include_str!("controller.rs");
        let (code, _) = src
            .split_once("#[cfg(test)]")
            .expect("tests module present");
        code
    }

    #[test]
    fn unknown_email_answers_explicit_record_not_found() {
        let code = handler_src();
        assert!(
            code.contains("ErrorCode::RecordNotFound"),
            "the unknown-email branch must answer RecordNotFound (explicit contract, 2026-08-26)"
        );
        assert!(
            code.contains("No account exists for that email"),
            "the not-found message must stay user-readable and stable — the web flow matches on status 404"
        );
    }

    #[test]
    fn dev_reset_code_log_is_gated_off_in_production() {
        let code = handler_src();
        assert!(
            code.contains("is_production()"),
            "the dev-only reset-code log must be gated on !is_production() so production NEVER logs the plaintext code"
        );
        let delivery_block = code
            .split("DELIVERY: reset-code hand-off")
            .nth(1)
            .expect("delivery block marker present");
        assert!(
            delivery_block.contains("is_production()"),
            "the is_production() gate must sit inside the delivery block, not elsewhere in the file"
        );
    }

    #[test]
    fn success_envelope_confirms_the_send() {
        let code = handler_src();
        assert!(
            code.contains("A password reset code has been sent to your email"),
            "success must be affirmative now that existence is explicit — no 'if an account exists' conditional"
        );
        assert!(
            !code.contains("if an account exists"),
            "the old uniform conditional copy must not come back"
        );
    }
}
