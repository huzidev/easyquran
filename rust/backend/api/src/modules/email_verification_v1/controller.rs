use std::collections::HashMap;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use axum_macros::debug_handler;
use sea_orm::prelude::DateTimeWithTimeZone;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use serde_json::json;
use tracing::{error, info, instrument, warn};

use crate::{
    db::sea_models::{email_verification, user},
    error::{ErrorCode, ErrorResponse},
    extractors::ValidatedJson,
    services::{
        abuse_limiter,
        auth::AuthSession,
        mail::{mail_error_kind, mail_error_to_response, send_email_verification_code},
    },
    AppState,
};

use super::validator::{
    V1AdminEmailVerificationListPayload, V1AdminEmailVerificationUserPayload, V1VerifyPayload,
};

const ADMIN_PER_PAGE: u64 = 20;

const ABUSE_LIMITER_CONFIG: abuse_limiter::AbuseLimiterConfig = abuse_limiter::AbuseLimiterConfig {
    temp_block_attempts: 3,
    temp_block_range: 360,
    temp_block_duration: 3600,
    block_retry_limit: 5,
    block_range: 900,
    block_duration: 86400,
};

#[debug_handler]
#[instrument(skip(state, auth, payload), fields(user_id = auth.user.as_ref().map(|u| u.id)))]
pub async fn verify(
    state: State<AppState>,
    auth: AuthSession,
    payload: ValidatedJson<V1VerifyPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user = auth.user_required()?;
    let user_id = user.id;

    // Fail-closed: a store error must reject, not fall through — otherwise code-guessing is unbounded.
    let key_prefix = format!("email_verify:{}", user_id);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    let code = payload.0.code;
    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &code);

    let verification_result = email_verification::Entity::find_by_user_id_or_code(
        &state.sea_db,
        Some(user_id),
        Some(code_hash),
    )
    .await;

    match verification_result {
        Ok(verification) => {
            if verification.is_expired() {
                warn!(user_id, "Email verification code expired");
                return Err(ErrorResponse::new(ErrorCode::InvalidInput)
                    .with_message("The verification code has expired"));
            }
        }
        Err(err) => {
            warn!(user_id, "Invalid email verification code");
            return Err(err);
        }
    }

    match user::Entity::verify(&state.sea_db, user_id).await {
        Ok(_) => {
            if let Err(err) = email_verification::Entity::consume(&state.sea_db, user_id).await {
                warn!(user_id, "Failed to consume verification code: {}", err);
            }
            info!(user_id, "Email verified successfully");
            Ok((
                StatusCode::OK,
                Json(json!({
                    "message": "Email verified successfully",
                })),
            ))
        }
        Err(err) => {
            error!(
                user_id,
                "Failed to update user verification status: {}", err
            );
            Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Failed to update user verification status")
                .with_details(err.to_string()))
        }
    }
}

#[debug_handler]
#[instrument(skip(state, auth), fields(user_id = auth.user.as_ref().map(|u| u.id)))]
pub async fn resend(
    state: State<AppState>,
    auth: AuthSession,
) -> Result<impl IntoResponse, ErrorResponse> {
    let pool = &state.sea_db;
    let user = auth.user_required()?;
    let user_id = user.id;

    match email_verification::Entity::find_by_user_id_or_code(pool, Some(user_id), None).await {
        Ok(verification) => {
            if verification.is_in_delay() {
                warn!(user_id, "Email verification resend in delay period");
                return Err(ErrorResponse::new(ErrorCode::TooManyAttempts)
                    .with_message("Please wait 1 minute before requesting a new verification code")
                    .with_retry_after(60));
            }
        }
        Err(err) => {
            if err.code != ErrorCode::InvalidInput {
                error!(user_id, "Error checking verification delay: {}", err);
                return Err(err);
            }
        }
    }

    let key_prefix = format!("email_verification:{}", user_id);
    match abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await {
        Ok(_) => (),
        Err(err) => {
            warn!(user_id, "Abuse limiter blocked verification resend");
            return Err(err);
        }
    }

    // Store only the keyed hash; plaintext in the DB would expose live codes on leak.
    let code = email_verification::Entity::generate_code();
    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &code);
    email_verification::Entity::regenerate(pool, user_id, code_hash).await?;

    // ── DELIVERY: verification-code hand-off ──────────────────────────────────
    // Same contract as the forgot-password DELIVERY block: this is the single
    // place the plaintext code leaves the request. Change how a code reaches the
    // user (SMTP, log file, test fixture…) by editing ONLY this block.
    // Non-production logs the code AND echoes it in the response body (dev has
    // no SMTP, so the network tab is the retrieval path while testing);
    // production emails it and fails the request on a transport error. NEVER
    // log or echo the code on the production branch.
    if matches!(crate::config::settings::is_production(), Ok(false)) {
        info!(
            user_id,
            verification_code = %code,
            "DEV delivery: email-verification code (non-production build)"
        );
        return Ok((
            StatusCode::OK,
            Json(json!({
                "message": "Verification email sent",
                // DEV ONLY (see DELIVERY comment above): echoed for testing.
                "code": code,
            })),
        ));
    }
    if let Err(err) = send_email_verification_code(&state.mailer, &user.email, &code).await {
        error!(
            user_id,
            error_kind = mail_error_kind(&err),
            "Failed to send verification email"
        );
        return Err(mail_error_to_response(&err));
    }

    info!(user_id, "Verification email sent");
    Ok((
        StatusCode::OK,
        Json(json!({
            "message": "Verification email sent",
        })),
    ))
}

#[derive(Debug, Serialize)]
struct AdminEmailVerificationRecord {
    id: i32,
    user_id: i32,
    user_email: Option<String>,
    has_code: bool,
    created_at: DateTimeWithTimeZone,
    issued_at: DateTimeWithTimeZone,
    expires_at: DateTimeWithTimeZone,
    is_expired: bool,
    is_in_delay: bool,
}

#[debug_handler]
#[instrument(skip(state, _auth, payload))]
pub async fn admin_list(
    state: State<AppState>,
    _auth: AuthSession,
    payload: ValidatedJson<V1AdminEmailVerificationListPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let page = payload.page_no.unwrap_or(1).max(1) as u64;
    let query = payload.0.into_query();

    let result = email_verification::Entity::admin_query(&state.sea_db, &query).await?;
    let total = result.total;
    let records = result.data;

    let user_ids: Vec<i32> = records.iter().map(|r| r.user_id).collect();
    let mut emails: HashMap<i32, String> = HashMap::new();
    if !user_ids.is_empty() {
        let users = user::Entity::find()
            .filter(user::Column::Id.is_in(user_ids))
            .all(&state.sea_db)
            .await?;
        for u in users {
            emails.insert(u.id, u.email);
        }
    }

    let expiry = email_verification::Entity::EXPIRY_TIME;
    let data: Vec<AdminEmailVerificationRecord> = records
        .into_iter()
        .map(|m| AdminEmailVerificationRecord {
            user_email: emails.get(&m.user_id).cloned(),
            has_code: !m.code_hash.is_empty(),
            issued_at: m.updated_at,
            expires_at: m.updated_at + expiry,
            is_expired: m.is_expired(),
            is_in_delay: m.is_in_delay(),
            id: m.id,
            user_id: m.user_id,
            created_at: m.created_at,
        })
        .collect();

    info!(total, page, "Admin listed email-verification records");
    Ok((
        StatusCode::OK,
        Json(json!({
            "data": data,
            "total": total,
            "per_page": ADMIN_PER_PAGE,
            "page": page,
        })),
    ))
}

#[debug_handler]
#[instrument(skip(state, _auth, payload), fields(target_user_id = payload.user_id))]
pub async fn admin_delete(
    state: State<AppState>,
    _auth: AuthSession,
    payload: ValidatedJson<V1AdminEmailVerificationUserPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user_id = payload.0.user_id;

    match email_verification::Entity::consume(&state.sea_db, user_id).await {
        Ok(0) => {
            warn!(
                user_id,
                "Admin tried to delete non-existent verification record"
            );
            Err(ErrorResponse::new(ErrorCode::RecordNotFound)
                .with_message("No verification record exists for this user"))
        }
        Ok(rows) => {
            info!(user_id, rows, "Admin deleted email-verification record");
            Ok((
                StatusCode::OK,
                Json(json!({ "message": "Verification record deleted" })),
            ))
        }
        Err(err) => {
            error!(
                user_id,
                "Admin failed to delete verification record: {}", err
            );
            Err(err)
        }
    }
}

#[debug_handler]
#[instrument(skip(state, _auth, payload), fields(target_user_id = payload.user_id))]
pub async fn admin_issue_code(
    state: State<AppState>,
    _auth: AuthSession,
    payload: ValidatedJson<V1AdminEmailVerificationUserPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user_id = payload.0.user_id;

    let target = user::Entity::get_by_id(&state.sea_db, user_id)
        .await?
        .ok_or_else(|| {
            ErrorResponse::new(ErrorCode::RecordNotFound)
                .with_message("No user with this ID exists")
        })?;

    let code = email_verification::Entity::generate_code();
    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &code);
    email_verification::Entity::regenerate(&state.sea_db, user_id, code_hash).await?;

    if let Err(err) = send_email_verification_code(&state.mailer, &target.email, &code).await {
        error!(
            user_id,
            error_kind = mail_error_kind(&err),
            "Failed to send verification email"
        );
        return Err(mail_error_to_response(&err));
    }

    info!(user_id, "Admin issued a new email-verification code");
    Ok((
        StatusCode::OK,
        Json(json!({ "message": "Verification code issued and emailed" })),
    ))
}

#[cfg(test)]
mod tests {
    // Guards only the handler source — the test's own text must not satisfy the
    // assert, so the pinned strings appear in the handler, not here.
    #[test]
    fn dev_response_code_echo_stays_gated() {
        let src = include_str!("controller.rs");
        let (code, _) = src
            .split_once("#[cfg(test)]")
            .expect("tests module present");
        let delivery = code
            .split("DELIVERY: verification-code hand-off")
            .nth(1)
            .expect("delivery block marker present");
        assert!(
            delivery.contains("is_production()"),
            "the response-body code echo must stay inside the !is_production() DELIVERY branch — production must never return the plaintext code"
        );
    }
}
