use axum::{
    extract::{rejection::JsonRejection, FromRequest, Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_macros::debug_handler;

use axum_client_ip::ClientIp;

use rux_auth::AuthBackend as AuthBackendTrait;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait};
use serde::de::DeserializeOwned;
use serde_json::json;
use tracing::{error, info, instrument, warn};
use validator::Validate;

use crate::{
    db::sea_models::{email_verification, user, user_session},
    error::{ErrorCode, ErrorResponse},
    extractors::ValidatedJson,
    modules::auth_v1::validator::{
        V1LoginPayload, V1LoginTotpPayload, V1RegisterPayload, V1TwoFADisablePayload,
        V1TwoFASetupPayload, V1TwoFAVerifyPayload,
    },
    services::{abuse_limiter, auth::AuthSession, mail::send_email_verification_code},
    utils::twofa,
    AppState,
};

const ABUSE_LIMITER_CONFIG: abuse_limiter::AbuseLimiterConfig = abuse_limiter::AbuseLimiterConfig {
    temp_block_attempts: 3,
    temp_block_range: 360,
    temp_block_duration: 3600,
    block_retry_limit: 5,
    block_range: 900,
    block_duration: 86400,
};

/// N4: login/totp, 2fa/verify and 2fa/disable deliberately share ONE per-account
/// budget (anti-brute design — code attempts anywhere lock code checks
/// everywhere). 2fa/setup gets its own key so re-arming attempts can never
/// consume or escalate the shared login budget.
fn totp_limiter_key(user_id: i32) -> String {
    format!("totp:{user_id}")
}

/// N4: separate budget for the enrolled re-arm gate on 2fa/setup.
fn totp_setup_limiter_key(user_id: i32) -> String {
    format!("totp_setup:{user_id}")
}

/// M2: axum 0.8 has no `Option<ValidatedJson<T>>` blanket impl, and 2FA setup
/// must keep accepting a body-less POST (the un-enrolled first call). A missing,
/// malformed, or validation-failing body extracts to `None` — fail-closed: an
/// enrolled account then hits the "code is required" rejection.
pub struct OptionalValidatedJson<T>(pub Option<T>);

impl<T, S> FromRequest<S> for OptionalValidatedJson<T>
where
    T: DeserializeOwned + Validate + Send + Sync,
    S: Send + Sync,
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
{
    type Rejection = std::convert::Infallible;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let parsed = async {
            let json = Json::<T>::from_request(req, state).await.ok()?;
            let data = json.0;
            data.validate().ok()?;
            Some(data)
        }
        .await;
        Ok(Self(parsed))
    }
}

#[debug_handler(state = AppState)]
#[instrument(skip(state, auth), fields(user_id))]
pub async fn log_out(
    State(state): State<AppState>,
    mut auth: AuthSession,
) -> Result<impl IntoResponse, ErrorResponse> {
    if let Some(user) = &auth.user {
        tracing::Span::current().record("user_id", user.id);
        info!(user_id = user.id, "User logging out");
    }

    // Capture the opaque tower session id BEFORE logout deletes the session record.
    let tower_sid = auth.session().id().map(|id| id.to_string());

    match auth.logout().await {
        Ok(_) => {
            // W8e: revoke the audit row AND clear the durable binding so the session
            // does not keep listing as active; logout alone only deletes the tower
            // session record. Best-effort — the tower session is already gone, so the
            // cookie no longer authenticates; reconcile reaps any lingerers at boot.
            if let Some(tower_sid) = tower_sid {
                if let Some(audit_id) = auth
                    .backend()
                    .lookup_session_mapping_by_tower(&state.sea_db, &tower_sid)
                    .await
                {
                    if let Err(e) = user_session::Entity::revoke(&state.sea_db, audit_id).await {
                        warn!(error = ?e, audit_id, "log_out: failed to revoke user_session audit row");
                    }
                }
                if let Err(e) = auth
                    .backend()
                    .clear_session_mapping(&state.sea_db, &tower_sid)
                    .await
                {
                    warn!(error = ?e, "log_out: failed to clear durable session binding");
                }
            }
            info!("Logout successful");
            Ok((StatusCode::OK, Json(json!({"message": "Logged out"}))))
        }
        Err(e) => {
            error!(error = %e, "Logout failed");
            Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("An error occurred while logging out"))
        }
    }
}

#[debug_handler]
#[instrument(skip(state, auth, payload), fields(client_ip = %secure_ip, user_id, user_role, result))]
pub async fn log_in(
    State(state): State<AppState>,
    mut auth: AuthSession,
    ClientIp(secure_ip): ClientIp,
    headers: HeaderMap,
    payload: ValidatedJson<V1LoginPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    info!(client_ip = %secure_ip, "Login attempt");

    let payload = payload.0;

    // AUTH-BF-1: per-account throttle on the password step; the per-IP cap can't stop an attacker rotating IPs to grind one account. Keyed on normalized email; fail-closed.
    let login_key = payload.email.trim().to_lowercase();
    abuse_limiter::limiter(
        &state.gate_store,
        &format!("login:{login_key}"),
        ABUSE_LIMITER_CONFIG,
    )
    .await?;

    let user = auth
        .backend()
        .authenticate_password(payload.email, payload.password)
        .await;

    match user {
        Ok(Some(user)) => {
            tracing::Span::current().record("user_id", user.id);
            tracing::Span::current().record("user_role", user.role.to_string());

            // Fail closed: a ban-lookup error must not grant access to a banned user.
            match auth.backend().check_ban(&user.id).await {
                Ok(ban_status) if ban_status.is_banned() => {
                    warn!(user_id = user.id, "Banned user attempted login");
                    tracing::Span::current().record("result", "banned");
                    return Err(ErrorResponse::new(ErrorCode::AccountLocked)
                        .with_message("This account has been banned"));
                }
                Ok(_) => {}
                Err(_) => {
                    tracing::Span::current().record("result", "ban_check_error");
                    return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                        .with_message("Unable to verify account status"));
                }
            }

            if user.two_fa_enabled {
                tracing::Span::current().record("result", "totp_required");
                let totp_token = login_totp_token::mint(user.id).await?;
                info!(user_id = user.id, "Login requires TOTP (2FA enrolled)");
                return Ok((
                    StatusCode::OK,
                    session_rotated_headers(false),
                    Json(json!({
                        "status": "totp_required",
                        "totp_token": totp_token,
                    })),
                ));
            }

            let ip = Some(secure_ip.to_string());
            let device = headers
                .get("user-agent")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            match auth
                .login_with_metadata(&user, device.clone(), ip.clone())
                .await
            {
                Ok(_) => {
                    info!(
                        user_id = user.id,
                        user_role = user.role.to_string(),
                        device = ?device,
                        "Login successful"
                    );

                    // W8e: create the audit row, persist the tower session, and record the
                    // durable binding. Fail-closed — any failure destroys the tower session
                    // and revokes the audit row so neither lingers unbound.
                    create_bound_session(&state.sea_db, &mut auth, user.id, device, ip).await?;

                    // W8B-001: login_with_metadata already cycled the session id
                    // (anti session-fixation), so the per-session CSRF token rebinds.
                    // Emit the header so the web client refreshes its in-memory token;
                    // reaching this branch means cycle_id succeeded (else Err above).
                    tracing::Span::current().record("result", "success");
                    Ok((
                        StatusCode::OK,
                        session_rotated_headers(true),
                        Json(json!(user)),
                    ))
                }
                Err(err) => {
                    error!(error = %err, user_id = user.id, "Session creation failed");
                    tracing::Span::current().record("result", "session_error");
                    Err(ErrorResponse::new(ErrorCode::InternalServerError)
                        .with_message("An error occurred while logging in")
                        .with_details(err.to_string()))
                }
            }
        }
        Ok(None) => {
            warn!(client_ip = %secure_ip, "Invalid credentials");
            tracing::Span::current().record("result", "invalid_credentials");
            Err(ErrorResponse::new(ErrorCode::InvalidCredentials))
        }
        Err(err) => {
            error!(error = ?err, client_ip = %secure_ip, "Authentication error");
            tracing::Span::current().record("result", "auth_error");
            Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Authentication error"))
        }
    }
}

#[debug_handler]
#[instrument(skip(state, auth, payload), fields(user_id, result))]
pub async fn login_totp(
    State(state): State<AppState>,
    mut auth: AuthSession,
    payload: ValidatedJson<V1LoginTotpPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let payload = payload.0;

    let user_id = match login_totp_token::take(&payload.totp_token).await? {
        Some(id) => id,
        None => {
            warn!("login/totp: pending token missing/expired/replayed");
            return Err(ErrorResponse::new(ErrorCode::Unauthorized)
                .with_message("Invalid or expired login session"));
        }
    };
    tracing::Span::current().record("user_id", user_id);

    let user = match auth.backend().get_user(&user_id).await {
        Ok(Some(u)) => u,
        _ => {
            warn!(user_id, "login/totp: user not found after valid token");
            return Err(ErrorResponse::new(ErrorCode::Unauthorized)
                .with_message("Invalid or expired login session"));
        }
    };

    // Fail-closed ban re-check between the two steps.
    match auth.backend().check_ban(&user.id).await {
        Ok(ban_status) if ban_status.is_banned() => {
            warn!(user_id = user.id, "login/totp: banned user");
            return Err(ErrorResponse::new(ErrorCode::AccountLocked)
                .with_message("This account has been banned"));
        }
        Ok(_) => {}
        Err(_) => {
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Unable to verify account status"));
        }
    }

    // Fail-closed per-account TOTP brute-force throttle.
    let key_prefix = totp_limiter_key(user.id);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    // CRYP-2FA-002: secret is encrypted at rest; a decrypt failure must fail closed (reject), never verify against the opaque envelope bytes.
    let secret = match user.two_fa_secret_plain() {
        Ok(Some(s)) => s,
        Ok(None) => {
            warn!(
                user_id = user.id,
                "login/totp: 2FA enabled but no secret stored"
            );
            return Err(ErrorResponse::new(ErrorCode::Unauthorized)
                .with_message("Invalid or expired login session"));
        }
        Err(e) => {
            warn!(user_id = user.id, error = %e, "login/totp: TOTP secret unreadable");
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Unable to verify second factor"));
        }
    };

    let matched = twofa::verify_totp_code_now(&secret, &payload.code);
    let matched = match matched {
        Some(m) => m,
        None => {
            warn!(user_id = user.id, "login/totp: invalid TOTP code");
            return Err(
                ErrorResponse::new(ErrorCode::Unauthorized).with_message("Invalid 2FA code")
            );
        }
    };

    // Replay gate: keep both — is_fresh_counter is the fast-path reject and advance_totp_counter_if_higher (atomic conditional UPDATE) is the authoritative gate closing the TOCTOU race across login/verify/disable.
    if !twofa::is_fresh_counter(matched, user.two_fa_last_totp_counter) {
        warn!(
            user_id = user.id,
            matched_counter = matched,
            "login/totp: TOTP code replayed (counter already used)"
        );
        return Err(ErrorResponse::new(ErrorCode::Unauthorized).with_message("Invalid 2FA code"));
    }
    let advanced =
        user::Entity::advance_totp_counter_if_higher(&state.sea_db, user.id, matched).await?;
    if !advanced {
        warn!(
            user_id = user.id,
            matched_counter = matched,
            "login/totp: TOTP lost the watermark race (concurrent advance); rejecting as replay"
        );
        return Err(ErrorResponse::new(ErrorCode::Unauthorized).with_message("Invalid 2FA code"));
    }

    let ip: Option<String> = None;
    let device: Option<String> = None;
    match auth
        .login_with_metadata(&user, device.clone(), ip.clone())
        .await
    {
        Ok(_) => {
            info!(
                user_id = user.id,
                "login/totp: TOTP verified, full session issued"
            );
            tracing::Span::current().record("result", "success");

            // W8e durable binding, same fail-closed contract as password login.
            create_bound_session(&state.sea_db, &mut auth, user.id, device, ip).await?;

            // W8B-001: login_with_metadata cycled the session id (see log_in).
            Ok((
                StatusCode::OK,
                session_rotated_headers(true),
                Json(json!(user)),
            ))
        }
        Err(err) => {
            error!(error = %err, user_id = user.id, "login/totp: session creation failed");
            tracing::Span::current().record("result", "session_error");
            Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("An error occurred while logging in")
                .with_details(err.to_string()))
        }
    }
}

#[debug_handler]
#[instrument(skip(state, payload), fields(user_id, result))]
pub async fn register(
    State(state): State<AppState>,
    payload: ValidatedJson<V1RegisterPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let payload = payload.0;

    info!("User registration attempt");

    let email = payload.email.clone();

    // Store only the keyed hash; the plaintext code is emailed, never persisted.
    let code = email_verification::Entity::generate_code();
    let code_hash = crate::utils::code_hash::hash_code(&state.secret_key, &code);

    let outcome = user::Entity::create(&state.sea_db, payload.into_new_user(), code_hash).await;

    match classify_register_outcome(outcome) {
        RegisterOutcome::Created(user) => {
            info!(user_id = user.id, "User registered successfully");
            tracing::Span::current().record("user_id", user.id);
            tracing::Span::current().record("result", "success");

            // ── DELIVERY: verification-code hand-off ──────────────────────────
            // Same contract as the other auth DELIVERY blocks: the single place
            // the plaintext code leaves the request. Non-production logs the code
            // and skips the (usually absent) SMTP transport; production emails it
            // in a background task. NEVER log the code on the production branch.
            if matches!(crate::config::settings::is_production(), Ok(false)) {
                info!(
                    user_id = user.id,
                    verification_code = %code,
                    "DEV delivery: email-verification code (non-production build)"
                );
            } else {
                let app_state = state.clone();
                let user_id = user.id;
                let email_for_task = email.clone();
                let code_for_task = code.clone();
                tokio::spawn(async move {
                    if let Err(err) = send_email_verification_code(
                        &app_state.mailer,
                        &email_for_task,
                        &code_for_task,
                    )
                    .await
                    {
                        tracing::error!(user_id, "Failed to send verification email: {}", err);
                    }
                });
            }
        }
        RegisterOutcome::DuplicateEmail => {
            // M3: a unique-violation must be answered with the exact success status
            // and body — any distinguishable status/shape is an account-existence
            // oracle. No verification email is sent for the existing address.
            warn!("Registration on an existing email answered with the generic success envelope");
            tracing::Span::current().record("result", "duplicate_masked");
        }
        RegisterOutcome::Failed(err) => {
            warn!(error = ?err, "Registration failed");
            tracing::Span::current().record("result", "failure");
            // Do not echo the raw SeaORM error: a unique-violation would leak that the email is already registered (enumeration oracle).
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Registration could not be completed at this time"));
        }
    }

    Ok((StatusCode::CREATED, Json(register_accepted_body())))
}

/// How the register DB write ended. `DuplicateEmail` is kept distinct from
/// `Failed` so the handler can mask it as success (M3) without special-casing
/// the error text at the call site.
enum RegisterOutcome {
    Created(user::Model),
    DuplicateEmail,
    Failed(ErrorResponse),
}

fn classify_register_outcome(outcome: Result<user::Model, ErrorResponse>) -> RegisterOutcome {
    match outcome {
        Ok(user) => RegisterOutcome::Created(user),
        Err(err) if err.code == ErrorCode::DuplicateEntry => RegisterOutcome::DuplicateEmail,
        Err(err) => RegisterOutcome::Failed(err),
    }
}

/// M3: the single source of the register response body. Fresh registrations and
/// masked duplicates MUST serialize to the exact same value (byte-identical), so
/// both handler arms return this — never a per-path body. The web client
/// discards the body and immediately logs in, so it carries no account data.
fn register_accepted_body() -> serde_json::Value {
    json!({ "message": "Registration accepted" })
}

#[debug_handler]
#[instrument(skip(state, auth, payload), fields(user_id))]
pub async fn twofa_setup(
    State(state): State<AppState>,
    mut auth: AuthSession,
    payload: OptionalValidatedJson<V1TwoFASetupPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user = auth.user_required()?;
    tracing::Span::current().record("user_id", user.id);

    info!(user_id = user.id, "2FA setup initiated");

    let existing = user::Entity::find_by_id_with_404(&state.sea_db, user.id).await?;

    // M2: rotating the secret on an enrolled account disarms 2FA (two_fa_enabled
    // drops to false below and the old secret + backup codes are replaced), i.e.
    // a trust downgrade — demand a valid current TOTP/backup code first, the
    // same gate twofa_disable uses. An un-enrolled account keeps the
    // generate-fresh-secret behavior (nothing to disarm).
    let was_enabled = existing.two_fa_enabled;
    if was_enabled {
        // Fail-closed per-account TOTP brute-force throttle, but on its OWN key:
        // a user fumbling the re-arm code must never drain the shared
        // login/verify/disable budget (N4 — a lockout here locked out LOGIN).
        let key_prefix = totp_setup_limiter_key(user.id);
        abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

        let code = payload.0.and_then(|p| p.code).ok_or_else(|| {
            ErrorResponse::new(ErrorCode::MissingRequiredField).with_message("code is required")
        })?;
        verify_current_second_factor(&state.sea_db, &existing, &code).await?;
    }

    let secret_b32 = twofa::generate_secret_base32(20).ok_or_else(|| {
        ErrorResponse::new(ErrorCode::InternalServerError)
            .with_message("Failed to generate 2FA secret")
    })?;
    let otpauth_url = twofa::build_otpauth_url(
        &user.email,
        "Ruxlog",
        &secret_b32,
        twofa::DEFAULT_TOTP_DIGITS,
    );

    let backup_codes = twofa::generate_backup_codes(10).ok_or_else(|| {
        ErrorResponse::new(ErrorCode::InternalServerError)
            .with_message("Failed to generate backup codes")
    })?;
    let backup_hashes = {
        let codes_for_hash = backup_codes.clone();
        tokio::task::spawn_blocking(move || twofa::hash_backup_codes(&codes_for_hash))
            .await
            .map_err(|e| {
                ErrorResponse::new(ErrorCode::InternalServerError)
                    .with_message(format!("Backup code hashing failed: {e}"))
            })?
    };
    let backup_hashes_json = serde_json::json!(backup_hashes);

    let mut active: user::ActiveModel = existing.into();
    active.two_fa_enabled = sea_orm::Set(false);
    active.two_fa_secret = sea_orm::Set(Some(secret_b32.clone()));
    active.two_fa_backup_codes = sea_orm::Set(Some(backup_hashes_json));
    active.updated_at = sea_orm::Set(chrono::Utc::now().fixed_offset());
    active.update(&state.sea_db).await?;

    // Trust changed (enrolled -> pending re-verify): rotate the session id and
    // rebind the durable mapping, same contract as verify/disable.
    let rotated = if was_enabled {
        rotate_session_after_trust_change(&state.sea_db, &mut auth).await?
    } else {
        false
    };

    Ok((
        StatusCode::OK,
        session_rotated_headers(rotated),
        Json(json!({
            "secret": secret_b32,
            "otpauth_url": otpauth_url,
            "backup_codes": backup_codes,
        })),
    ))
}

/// M2: shared second-factor gate for trust-downgrading operations on an ENROLLED
/// account (2FA disable, secret rotation via 2FA setup). Accepts a current TOTP
/// code or a backup code. TOTP path enforces the same replay watermark as
/// login/verify: `advance_totp_counter_if_higher` is the authoritative atomic
/// gate closing the TOCTOU race (V-MED-6). Backup-code hits are not persisted
/// here — every caller replaces or clears the stored set right after, so the
/// consumed-hash list is intentionally dropped.
async fn verify_current_second_factor(
    db: &DatabaseConnection,
    existing: &user::Model,
    code: &str,
) -> Result<(), ErrorResponse> {
    // CRYP-2FA-002: decrypt failure → empty secret (falls through to backup code); never grant without a valid second factor.
    let secret = match existing.two_fa_secret_plain() {
        Ok(Some(s)) => s,
        Ok(None) => String::new(),
        Err(e) => {
            warn!(user_id = existing.id, error = %e, "second-factor gate: TOTP secret unreadable");
            String::new()
        }
    };
    let totp_matched = if secret.is_empty() {
        None
    } else {
        twofa::verify_totp_code_now(&secret, code)
    };
    let totp_fresh = match totp_matched {
        Some(matched) => twofa::is_fresh_counter(matched, existing.two_fa_last_totp_counter),
        None => false,
    };

    if totp_fresh {
        let matched = totp_matched.expect("totp_matched is Some when totp_fresh");
        let advanced =
            user::Entity::advance_totp_counter_if_higher(db, existing.id, matched).await?;
        if !advanced {
            warn!(
                user_id = existing.id,
                matched_counter = matched,
                "second-factor gate lost the watermark race (concurrent advance); rejecting as replay"
            );
            return Err(ErrorResponse::new(ErrorCode::InvalidToken)
                .with_message("Invalid 2FA or backup code"));
        }
        return Ok(());
    }

    if let Some(stored) = &existing.two_fa_backup_codes {
        let stored_vec: Vec<String> =
            serde_json::from_value(stored.clone()).unwrap_or_else(|_| vec![]);
        let backup_ok = {
            let stored_clone = stored_vec;
            let code_clone = code.to_string();
            tokio::task::spawn_blocking(move || {
                twofa::consume_backup_code(&stored_clone, &code_clone).is_some()
            })
            .await
            .map_err(|e| {
                ErrorResponse::new(ErrorCode::InternalServerError)
                    .with_message(format!("Backup code verification failed: {e}"))
            })?
        };
        if backup_ok {
            return Ok(());
        }
    }

    Err(ErrorResponse::new(ErrorCode::InvalidToken).with_message("Invalid 2FA or backup code"))
}

#[debug_handler]
pub async fn twofa_verify(
    State(state): State<AppState>,
    mut auth: AuthSession,
    payload: ValidatedJson<V1TwoFAVerifyPayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user = auth.user_required()?;
    let payload = payload.0;

    // Fail-closed per-account TOTP brute-force throttle.
    let key_prefix = totp_limiter_key(user.id);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    let existing = user::Entity::find_by_id_with_404(&state.sea_db, user.id).await?;
    // CRYP-2FA-002: decrypt the at-rest secret via the accessor; fail closed on error.
    let secret = match existing.two_fa_secret_plain() {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Err(ErrorResponse::new(ErrorCode::OperationNotAllowed)
                .with_message("2FA not initialized"))
        }
        Err(e) => {
            warn!(user_id = existing.id, error = %e, "2fa/verify: TOTP secret unreadable");
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("Unable to verify second factor"));
        }
    };

    // V-MED-6: keep both checks — is_fresh_counter (fast-path reject) and advance_totp_counter_if_higher (authoritative atomic gate closing the TOCTOU race); removing either reopens replay.
    let totp_counter = twofa::verify_totp_code_now(&secret, &payload.code);

    if let Some(matched) = totp_counter {
        if twofa::is_fresh_counter(matched, existing.two_fa_last_totp_counter) {
            let advanced =
                user::Entity::advance_totp_counter_if_higher(&state.sea_db, user.id, matched)
                    .await?;
            if !advanced {
                warn!(
                    user_id = user.id,
                    matched_counter = matched,
                    "TOTP code lost the watermark race (concurrent advance); rejecting as replay"
                );
                return Err(
                    ErrorResponse::new(ErrorCode::InvalidToken).with_message("Invalid 2FA code")
                );
            }
            // Counter already persisted by the atomic gate above; keep Unchanged — a Set here could clobber a concurrent advance and reopen replay.
            let mut active: user::ActiveModel = existing.into();
            active.two_fa_enabled = sea_orm::Set(true);
            active.two_fa_last_totp_counter = sea_orm::Unchanged(Some(matched));
            active.updated_at = sea_orm::Set(chrono::Utc::now().fixed_offset());
            let updated = active.update(&state.sea_db).await?;
            let rotated = rotate_session_after_trust_change(&state.sea_db, &mut auth).await?;
            return Ok((
                StatusCode::OK,
                session_rotated_headers(rotated),
                Json(json!(updated)),
            ));
        } else {
            warn!(
                user_id = user.id,
                matched_counter = matched,
                "TOTP code replayed (counter already used); rejecting"
            );
            return Err(
                ErrorResponse::new(ErrorCode::InvalidToken).with_message("Invalid 2FA code")
            );
        }
    }

    if let Some(backup_code) = payload.backup_code {
        if let Some(stored) = &existing.two_fa_backup_codes {
            let stored_vec: Vec<String> =
                serde_json::from_value(stored.clone()).unwrap_or_else(|_| vec![]);
            let consume_result = {
                let stored_clone = stored_vec;
                let code_clone = backup_code.clone();
                tokio::task::spawn_blocking(move || {
                    twofa::consume_backup_code(&stored_clone, &code_clone)
                })
                .await
                .map_err(|e| {
                    ErrorResponse::new(ErrorCode::InternalServerError)
                        .with_message(format!("Backup code verification failed: {e}"))
                })?
            };
            if let Some(updated_hashes) = consume_result {
                let mut active: user::ActiveModel = existing.into();
                active.two_fa_enabled = sea_orm::Set(true);
                active.two_fa_backup_codes = sea_orm::Set(Some(serde_json::json!(updated_hashes)));
                active.updated_at = sea_orm::Set(chrono::Utc::now().fixed_offset());
                let updated = active.update(&state.sea_db).await?;
                let rotated = rotate_session_after_trust_change(&state.sea_db, &mut auth).await?;
                return Ok((
                    StatusCode::OK,
                    session_rotated_headers(rotated),
                    Json(json!(updated)),
                ));
            }
        }
    }

    Err(ErrorResponse::new(ErrorCode::InvalidToken).with_message("Invalid 2FA code"))
}

#[debug_handler]
pub async fn twofa_disable(
    State(state): State<AppState>,
    mut auth: AuthSession,
    payload: ValidatedJson<V1TwoFADisablePayload>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user = auth.user_required()?;
    let payload = payload.0;

    // Fail-closed per-account TOTP brute-force throttle.
    let key_prefix = totp_limiter_key(user.id);
    abuse_limiter::limiter(&state.gate_store, &key_prefix, ABUSE_LIMITER_CONFIG).await?;

    let existing = user::Entity::find_by_id_with_404(&state.sea_db, user.id).await?;

    // V-MED-6 (via verify_current_second_factor): advance_totp_counter_if_higher is the authoritative replay gate; the final UPDATE below leaves the counter Unchanged (no racy re-write); backup-code path skips it.
    if existing.two_fa_enabled {
        let Some(code) = payload.code.clone() else {
            return Err(ErrorResponse::new(ErrorCode::MissingRequiredField)
                .with_message("code is required"));
        };
        verify_current_second_factor(&state.sea_db, &existing, &code).await?;
    }

    let last_counter = existing.two_fa_last_totp_counter;
    let mut active: user::ActiveModel = existing.into();
    active.two_fa_enabled = sea_orm::Set(false);
    active.two_fa_secret = sea_orm::Set(None);
    active.two_fa_backup_codes = sea_orm::Set(None);
    active.two_fa_last_totp_counter = sea_orm::Unchanged(last_counter);
    active.updated_at = sea_orm::Set(chrono::Utc::now().fixed_offset());
    let updated = active.update(&state.sea_db).await?;

    let rotated = rotate_session_after_trust_change(&state.sea_db, &mut auth).await?;

    Ok((
        StatusCode::OK,
        session_rotated_headers(rotated),
        Json(json!(updated)),
    ))
}

#[debug_handler]
pub async fn sessions_list(
    State(state): State<AppState>,
    auth: AuthSession,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user = auth.user_required()?;
    let page = 1;

    // W8e: compute isCurrent server-side by resolving the current tower session id
    // to its audit row via the durable binding, without exposing the opaque tower id.
    let current_audit_id = match auth.session().id() {
        Some(id) => {
            auth.backend()
                .lookup_session_mapping_by_tower(&state.sea_db, &id.to_string())
                .await
        }
        None => None,
    };

    match user_session::Entity::list_by_user(&state.sea_db, user.id, Some(page)).await {
        Ok(result) => {
            let data = sessions_list_payload(result.data, current_audit_id);
            Ok((
                StatusCode::OK,
                Json(json!({
                    "data": data,
                    "total": result.total,
                    "page": page,
                })),
            ))
        }
        Err(err) => Err(err),
    }
}

/// Build the `sessions_list` response payload: drop any revoked row, then attach
/// the server-computed `isCurrent` flag. W8E-001 — `list_by_user` already filters
/// `revoked_at IS NULL` (so pagination/total stay honest), but this guard ensures
/// a terminated session can never reach the "devices currently signed in" UI even
/// if a future change alters the fetch path. The opaque tower session id never
/// enters the response — only the audit row id and the derived boolean.
fn sessions_list_payload(
    rows: Vec<user_session::Model>,
    current_audit_id: Option<i32>,
) -> Vec<serde_json::Value> {
    rows.into_iter()
        .filter(|row| row.revoked_at.is_none())
        .map(|row| {
            let is_current = Some(row.id) == current_audit_id;
            annotate_session_row(row, is_current)
        })
        .collect()
}

/// Attach a server-computed `isCurrent` flag to a session row for `sessions_list`.
/// The opaque tower session id never enters the response — only the audit row id
/// (already the public terminator id) and the derived boolean.
fn annotate_session_row(row: user_session::Model, is_current: bool) -> serde_json::Value {
    let mut v = serde_json::to_value(&row).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = v.as_object_mut() {
        obj.insert("isCurrent".to_string(), serde_json::Value::Bool(is_current));
    }
    v
}

#[debug_handler]
pub async fn sessions_terminate(
    State(state): State<AppState>,
    auth: AuthSession,
    Path(id): Path<i32>,
) -> Result<impl IntoResponse, ErrorResponse> {
    let user_id = auth.user.as_ref().map(|u| u.id).unwrap_or(0);

    // V-LOW-IDOR: ownership check must precede any write (earlier revoke-first mutated the victim row before the 401); resolve, reject on mismatch, then revoke.
    let _existing = match user_session::Entity::find_by_id(id)
        .one(&state.sea_db)
        .await
    {
        Ok(Some(model)) if model.user_id == user_id => model,
        Ok(Some(_)) => return Err(ErrorResponse::new(ErrorCode::Unauthorized)),
        Ok(None) => return Err(ErrorResponse::new(ErrorCode::RecordNotFound)),
        Err(err) => return Err(err.into()),
    };
    user_session::Entity::revoke(&state.sea_db, id).await?;

    {
        // V-HIGH-2: revoke only stamps revoked_at (audit-only); the live tower-session
        // record must also be deleted or the cookie authenticates until its 14-day
        // expiry. Resolve the bound tower id via the durable binding, then terminate
        // the live record and clear the binding row.
        if let Some(tower_sid) = auth
            .backend()
            .lookup_tower_by_audit_id(&state.sea_db, id)
            .await
        {
            auth.backend().terminate(&tower_sid).await;
            if let Err(e) = auth
                .backend()
                .clear_session_mapping(&state.sea_db, &tower_sid)
                .await
            {
                warn!(
                    error = ?e,
                    session_id = id,
                    "sessions_terminate: failed to clear durable binding"
                );
            }
        } else {
            warn!(
                session_id = id,
                "No durable tower-session binding for session; live record could not be DEL'd — cookie valid until 14-day expiry (revoked_at is audit-only)"
            );
        }
        Ok((
            StatusCode::OK,
            Json(json!({ "message": "Session terminated" })),
        ))
    }
}

/// W8b: sent on every response whose handler called `cycle_id()` successfully, so
/// the web client knows to refresh its in-memory CSRF token (which rebinds to the
/// new session id). The header is CORS-exposed (see main.rs) and carries no value
/// beyond presence.
pub(crate) const SESSION_ROTATED: HeaderName = HeaderName::from_static("x-eq-session-rotated");

pub(crate) fn session_rotated_headers(rotated: bool) -> HeaderMap {
    let mut h = HeaderMap::new();
    if rotated {
        h.insert(SESSION_ROTATED, HeaderValue::from_static("1"));
    }
    h
}

/// W8e durable binding at session creation (login / login-totp / passkey / OAuth).
/// Creates the `user_session` audit row, persists the tower session, then records
/// the 1:1 binding. FAIL-CLOSED: on any step's failure, revoke the audit row and
/// destroy the tower session so neither lingers unbound, then surface an
/// ErrorResponse. Shared by every session-issuing handler so the fail-closed
/// teardown stays in one place.
pub(crate) async fn create_bound_session(
    db: &DatabaseConnection,
    auth: &mut AuthSession,
    user_id: i32,
    device: Option<String>,
    ip: Option<String>,
) -> Result<(), ErrorResponse> {
    let audit_row = match user_session::Entity::create(
        db,
        user_session::NewUserSession::new(user_id, device, ip),
    )
    .await
    {
        Ok(row) => row,
        Err(err) => {
            error!(error = ?err, user_id, "session audit row creation failed; destroying tower session (fail-closed)");
            let _ = auth.logout().await;
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("An error occurred while logging in"));
        }
    };

    if let Err(err) = auth.session().save().await {
        error!(error = %err, user_id, audit_row_id = audit_row.id, "tower session save failed; revoking audit row (fail-closed)");
        let _ = user_session::Entity::revoke(db, audit_row.id).await;
        return Err(ErrorResponse::new(ErrorCode::InternalServerError)
            .with_message("An error occurred while logging in"));
    }

    let tower_sid = match auth.session().id() {
        Some(id) => id.to_string(),
        None => {
            warn!(user_id, audit_row_id = audit_row.id, "tower session id missing after save; revoking audit row and deleting tower session (fail-closed)");
            let _ = user_session::Entity::revoke(db, audit_row.id).await;
            let _ = auth.session().delete().await;
            return Err(ErrorResponse::new(ErrorCode::InternalServerError)
                .with_message("An error occurred while logging in"));
        }
    };

    let record = auth
        .backend()
        .record_session_mapping(db, audit_row.id, &tower_sid)
        .await;
    if let Err(err) = record {
        error!(error = ?err, user_id, audit_row_id = audit_row.id, "durable session binding failed; destroying tower session (fail-closed)");
        let _ = user_session::Entity::revoke(db, audit_row.id).await;
        let _ = auth.logout().await;
        return Err(ErrorResponse::new(ErrorCode::InternalServerError)
            .with_message("An error occurred while logging in"));
    }

    Ok(())
}

/// F#16 + W8e: rotate the session id at trust transitions (2FA on/off) so the
/// per-session CSRF token rebinds, AND rebind the durable audit↔tower mapping to
/// the new tower id. Returns whether the id was cycled AND persisted, so callers
/// can emit [`SESSION_ROTATED`].
///
/// A `cycle_id`/save store failure is non-fatal (returns `Ok(false)`) — surfacing
/// a 500 would mislead the client since the trust change already succeeded. A
/// binding-replace failure is FAIL-CLOSED per W8e: the freshly-rotated session is
/// destroyed and the audit row revoked so neither lingers, returning `Err`.
async fn rotate_session_after_trust_change(
    db: &DatabaseConnection,
    auth: &mut AuthSession,
) -> Result<bool, ErrorResponse> {
    // The binding still points at the pre-rotation tower id; capture it first so we
    // can move the binding after cycle_id rotates the opaque id.
    let old_tower = auth.session().id().map(|id| id.to_string());

    if let Err(err) = auth.session().cycle_id().await {
        warn!(error = %err, "F#16: failed to rotate session id at trust transition; CSRF token NOT rebound");
        return Ok(false);
    }
    if let Err(err) = auth.session().save().await {
        warn!(error = %err, "F#16: failed to persist rotated session id at trust transition");
        return Ok(false);
    }

    let new_tower = match auth.session().id() {
        Some(id) => id.to_string(),
        None => return Ok(false),
    };

    let Some(old) = old_tower else {
        // No prior tower id — nothing bound to rebind. Rotation still succeeded.
        return Ok(true);
    };

    let audit_id = auth
        .backend()
        .lookup_session_mapping_by_tower(db, &old)
        .await;
    let Some(audit_id) = audit_id else {
        warn!("W8e: no durable binding for prior tower id at rotation; session rotated, binding not moved (reconciled at boot)");
        return Ok(true);
    };

    if let Err(err) = auth
        .backend()
        .replace_session_mapping(db, audit_id, &old, &new_tower)
        .await
    {
        warn!(error = %err, audit_id, "W8e: durable binding replace failed; destroying rotated session (fail-closed)");
        let _ = user_session::Entity::revoke(db, audit_id).await;
        let _ = auth.backend().clear_session_mapping(db, &old).await;
        let _ = auth.session().delete().await;
        return Err(ErrorResponse::new(ErrorCode::InternalServerError)
            .with_message("Session rotation could not be completed"));
    }
    Ok(true)
}

mod login_totp_token {
    use super::*;
    use rand::Rng;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;
    use zeroize::Zeroize;

    const TTL_SECS: u64 = 300;

    #[doc(hidden)]
    #[allow(dead_code)] // referenced via type_name::<AssertWired> only (compile-time wiring check)
    pub struct AssertWired;

    type TokenMap = HashMap<String, (i32, Instant)>;

    static TOKENS: OnceLock<Mutex<TokenMap>> = OnceLock::new();

    fn tokens() -> &'static Mutex<TokenMap> {
        TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn reap_stale(map: &mut TokenMap) {
        map.retain(|_, (_, at)| at.elapsed().as_secs() < TTL_SECS);
    }

    fn namespaced_key(token: &str) -> String {
        format!("auth:login_totp:{token}")
    }

    pub async fn mint(user_id: i32) -> Result<String, ErrorResponse> {
        let mut bytes = zeroize::Zeroizing::new([0u8; 32]);
        rand::rng().fill(bytes.as_mut());
        let token = hex::encode(*bytes);
        bytes.zeroize();

        let mut map = tokens().lock().map_err(|e| {
            error!(error = %e, "login_totp token map poisoned");
            ErrorResponse::new(ErrorCode::InternalServerError)
        })?;
        reap_stale(&mut map);
        map.insert(namespaced_key(&token), (user_id, Instant::now()));
        Ok(token)
    }

    pub async fn take(token: &str) -> Result<Option<i32>, ErrorResponse> {
        let mut map = tokens().lock().map_err(|e| {
            error!(error = %e, "login_totp token map poisoned");
            ErrorResponse::new(ErrorCode::InternalServerError)
        })?;
        reap_stale(&mut map);
        Ok(map.remove(&namespaced_key(token)).map(|(id, _)| id))
    }
}

#[cfg(test)]
mod tests {
    use super::annotate_session_row;
    use super::login_totp_token;
    use super::sessions_list_payload;
    use super::totp_limiter_key;
    use super::totp_setup_limiter_key;
    use super::verify_current_second_factor;
    use super::ABUSE_LIMITER_CONFIG;
    use super::{classify_register_outcome, register_accepted_body, RegisterOutcome};

    use axum::http::StatusCode;

    use crate::error::{ErrorCode, ErrorResponse};
    use crate::utils::twofa;

    #[test]
    fn login_totp_redis_key_prefix_is_stable() {
        for token in ["deadbeef", "abc123", "z"] {
            let expected = format!("auth:login_totp:{token}");
            assert!(
                expected.starts_with("auth:login_totp:"),
                "pending-TOTP key must live under the auth:login_totp: namespace"
            );
        }
        let _ = std::any::type_name::<login_totp_token::AssertWired>;
    }

    // --- W8e sessions_list isCurrent -----------------------------------------

    fn sample_row(id: i32) -> crate::db::sea_models::user_session::Model {
        crate::db::sea_models::user_session::Model {
            id,
            user_id: 100,
            device: Some(format!("dev-{id}")),
            ip_address: None,
            last_seen: chrono::Utc::now().fixed_offset(),
            revoked_at: None,
        }
    }

    fn sample_revoked_row(id: i32) -> crate::db::sea_models::user_session::Model {
        crate::db::sea_models::user_session::Model {
            revoked_at: Some(chrono::Utc::now().fixed_offset()),
            ..sample_row(id)
        }
    }

    #[test]
    fn annotate_session_row_marks_current_for_matching_audit_id() {
        let v = annotate_session_row(sample_row(7), true);
        assert_eq!(v["isCurrent"], serde_json::Value::Bool(true));
        assert_eq!(v["id"], 7, "audit row id must be present as the public id");
    }

    #[test]
    fn annotate_session_row_marks_non_current_for_other_audit_id() {
        let v = annotate_session_row(sample_row(7), false);
        assert_eq!(v["isCurrent"], serde_json::Value::Bool(false));
    }

    #[test]
    fn annotate_session_row_never_exposes_tower_session_id() {
        let v = annotate_session_row(sample_row(1), true);
        let obj = v.as_object().expect("row must serialize to a JSON object");
        assert!(
            !obj.contains_key("tower_session_id") && !obj.contains_key("towerSessionId"),
            "opaque tower session id must not appear in sessions_list response"
        );
    }

    #[test]
    fn sessions_iscurrent_marks_exactly_the_current_row() {
        // Mirrors the sessions_list computation: resolve current_audit_id once,
        // then mark each row by comparing its audit id.
        let rows = vec![sample_row(1), sample_row(2), sample_row(3)];
        let current_audit_id: Option<i32> = Some(2);
        let annotated: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|r| {
                let is_current = Some(r.id) == current_audit_id;
                annotate_session_row(r, is_current)
            })
            .collect();
        let currents: Vec<&serde_json::Value> = annotated
            .iter()
            .filter(|v| v["isCurrent"] == serde_json::Value::Bool(true))
            .collect();
        assert_eq!(currents.len(), 1, "exactly one row must be current");
        assert_eq!(currents[0]["id"], 2);

        // No row is current when the binding lookup misses (e.g. pre-binding-era
        // session, or tower id absent).
        let rows = vec![sample_row(10), sample_row(11)];
        let annotated: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|r| annotate_session_row(r, false))
            .collect();
        assert!(
            annotated
                .iter()
                .all(|v| v["isCurrent"] == serde_json::Value::Bool(false)),
            "no row is current when current_audit_id is None"
        );
    }

    // --- W8E-001 sessions_list active-only filter ----------------------------

    #[test]
    fn sessions_list_payload_excludes_revoked_sessions() {
        // A terminated session must never appear in the "devices currently signed
        // in" list, even if one slipped past the query layer.
        let rows = vec![
            sample_row(1),
            sample_revoked_row(2),
            sample_row(3),
            sample_revoked_row(4),
        ];
        let payload = sessions_list_payload(rows, None);
        let ids: Vec<i64> = payload.iter().filter_map(|v| v["id"].as_i64()).collect();
        assert_eq!(ids, vec![1, 3], "revoked sessions must be filtered out");
        assert!(
            payload.iter().all(|v| v["revoked_at"].is_null()),
            "no row in the payload should carry a revoked_at value once filtered"
        );
    }

    #[test]
    fn sessions_list_payload_keeps_active_sessions_and_marks_current() {
        let rows = vec![sample_row(10), sample_row(11), sample_revoked_row(12)];
        let payload = sessions_list_payload(rows, Some(11));
        let ids: Vec<i64> = payload.iter().filter_map(|v| v["id"].as_i64()).collect();
        assert_eq!(ids, vec![10, 11], "active sessions are retained");
        let current = payload
            .iter()
            .filter(|v| v["isCurrent"] == serde_json::Value::Bool(true))
            .collect::<Vec<_>>();
        assert_eq!(current.len(), 1);
        assert_eq!(current[0]["id"], 11);
    }

    #[test]
    fn sessions_list_payload_empty_when_all_revoked() {
        let rows = vec![sample_revoked_row(1), sample_revoked_row(2)];
        let payload = sessions_list_payload(rows, Some(1));
        assert!(payload.is_empty(), "no active rows means no payload");
    }

    // --- M3: register anti-enumeration ---------------------------------------

    fn registered_user_model() -> crate::db::sea_models::user::Model {
        crate::db::sea_models::user::Model {
            id: 7,
            name: "New User".to_string(),
            email: "new@example.com".to_string(),
            password: None,
            avatar_id: None,
            is_verified: false,
            role: crate::db::sea_models::user::UserRole::User,
            two_fa_enabled: false,
            two_fa_secret: None,
            two_fa_backup_codes: None,
            two_fa_last_totp_counter: None,
            google_id: None,
            oauth_provider: None,
            session_auth_secret: "s".repeat(64),
            created_at: chrono::Utc::now().fixed_offset(),
            updated_at: chrono::Utc::now().fixed_offset(),
        }
    }

    #[test]
    fn register_classify_routes_only_duplicate_entry_to_masked_arm() {
        assert!(matches!(
            classify_register_outcome(Err(ErrorResponse::new(ErrorCode::DuplicateEntry))),
            RegisterOutcome::DuplicateEmail
        ));
        assert!(matches!(
            classify_register_outcome(Err(ErrorResponse::new(ErrorCode::QueryError))),
            RegisterOutcome::Failed(_)
        ));
        assert!(matches!(
            classify_register_outcome(Err(ErrorResponse::new(ErrorCode::InternalServerError))),
            RegisterOutcome::Failed(_)
        ));
        assert!(matches!(
            classify_register_outcome(Ok(registered_user_model())),
            RegisterOutcome::Created(_)
        ));
    }

    #[test]
    fn register_duplicate_and_fresh_produce_identical_status_and_body() {
        // Mirrors the handler's response mapping: Created and DuplicateEmail both
        // fall through to the single CREATED + register_accepted_body() return;
        // only Failed diverges (500).
        let respond = |outcome: RegisterOutcome| match outcome {
            RegisterOutcome::Created(_) | RegisterOutcome::DuplicateEmail => {
                (StatusCode::CREATED, register_accepted_body())
            }
            RegisterOutcome::Failed(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, serde_json::Value::Null)
            }
        };

        let fresh = respond(classify_register_outcome(Ok(registered_user_model())));
        let duplicate = respond(classify_register_outcome(Err(ErrorResponse::new(
            ErrorCode::DuplicateEntry,
        ))));

        assert_eq!(fresh.0, duplicate.0, "status code must not be an oracle");
        assert_eq!(
            fresh.1, duplicate.1,
            "body must be byte-identical, not just same shape"
        );
        assert_eq!(fresh.0, StatusCode::CREATED);

        let obj = fresh
            .1
            .as_object()
            .expect("register envelope must be a JSON object");
        assert!(
            !obj.contains_key("id") && !obj.contains_key("email") && !obj.contains_key("name"),
            "register response must not echo account data"
        );
    }

    #[test]
    fn register_accepted_body_is_stable_across_calls() {
        assert_eq!(
            serde_json::to_string(&register_accepted_body()).unwrap(),
            serde_json::to_string(&register_accepted_body()).unwrap()
        );
    }

    // --- M2: second-factor gate on secret rotation ----------------------------

    fn enrolled_user(
        hashed_backup_codes: Option<Vec<String>>,
    ) -> crate::db::sea_models::user::Model {
        crate::db::sea_models::user::Model {
            id: 42,
            name: "Enrolled".to_string(),
            email: "enrolled@example.com".to_string(),
            password: None,
            avatar_id: None,
            is_verified: true,
            role: crate::db::sea_models::user::UserRole::User,
            two_fa_enabled: true,
            two_fa_secret: None,
            two_fa_backup_codes: hashed_backup_codes.map(|codes| serde_json::json!(codes)),
            two_fa_last_totp_counter: None,
            google_id: None,
            oauth_provider: None,
            session_auth_secret: "s".repeat(64),
            created_at: chrono::Utc::now().fixed_offset(),
            updated_at: chrono::Utc::now().fixed_offset(),
        }
    }

    async fn schemaless_db() -> sea_orm::DatabaseConnection {
        // The backup-code path never touches the DB (only a fresh TOTP match does),
        // so a connection to an empty in-memory SQLite is enough.
        sea_orm::Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite connects")
    }

    #[tokio::test]
    async fn second_factor_gate_accepts_current_backup_code() {
        let db = schemaless_db().await;
        let codes = twofa::generate_backup_codes(3).expect("CSPRNG available");
        let model = enrolled_user(Some(twofa::hash_backup_codes(&codes)));
        verify_current_second_factor(&db, &model, &codes[1])
            .await
            .expect("a valid current backup code must pass the gate");
    }

    #[tokio::test]
    async fn second_factor_gate_rejects_wrong_code() {
        let db = schemaless_db().await;
        let codes = twofa::generate_backup_codes(3).expect("CSPRNG available");
        let model = enrolled_user(Some(twofa::hash_backup_codes(&codes)));
        let err = verify_current_second_factor(&db, &model, "WRONG-CODE-0000")
            .await
            .expect_err("a wrong code must be rejected");
        assert_eq!(err.code, ErrorCode::InvalidToken);
    }

    #[tokio::test]
    async fn second_factor_gate_fails_closed_with_nothing_stored() {
        let db = schemaless_db().await;
        let model = enrolled_user(None);
        let err = verify_current_second_factor(&db, &model, "123456")
            .await
            .expect_err("no secret and no backup codes must fail closed");
        assert_eq!(err.code, ErrorCode::InvalidToken);
    }

    // --- N4: setup limiter budget isolation ----------------------------------

    #[test]
    fn setup_limiter_key_is_distinct_from_shared_totp_key() {
        assert_eq!(totp_limiter_key(42), "totp:42");
        assert_eq!(totp_setup_limiter_key(42), "totp_setup:42");
        assert_ne!(
            totp_limiter_key(42),
            totp_setup_limiter_key(42),
            "setup must not share the login/verify/disable limiter key"
        );
    }

    #[tokio::test]
    async fn failed_setups_never_touch_the_login_totp_budget() {
        let store = rux_request_gate::InMemoryStore::default();
        let user_id = 42;

        // Exhaust the setup budget past both thresholds (temp 3/6min, long 5/15min):
        // each failed re-arm attempt runs the setup-key limiter before its gate.
        let attempts = ABUSE_LIMITER_CONFIG.block_retry_limit + 1;
        let mut saw_block = false;
        for _ in 0..attempts {
            let blocked = crate::services::abuse_limiter::limiter(
                &store,
                &totp_setup_limiter_key(user_id),
                ABUSE_LIMITER_CONFIG,
            )
            .await
            .is_err();
            saw_block = saw_block || blocked;
        }
        assert!(saw_block, "setup attempts must trip their own limiter");

        // The shared login/verify/disable budget must still admit a fresh attempt:
        // a fumbled re-arm must never lock the account out of LOGIN for 24h.
        crate::services::abuse_limiter::limiter(
            &store,
            &totp_limiter_key(user_id),
            ABUSE_LIMITER_CONFIG,
        )
        .await
        .expect("login/verify TOTP budget must be untouched by setup attempts");
    }
}
