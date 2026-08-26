use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::{get, post},
    Router,
};
use tower::ServiceExt;

use ruxlog::middlewares::security_headers::security_headers;
use ruxlog::middlewares::static_csrf::csrf_guard;

async fn ok_handler() -> StatusCode {
    StatusCode::OK
}

fn security_headers_router() -> Router {
    Router::new()
        .route("/test", get(ok_handler))
        .layer(middleware::from_fn(security_headers))
}

#[tokio::test]
async fn security_headers_present_on_response() {
    let app = security_headers_router();
    let response = app
        .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
        .await
        .unwrap();

    let headers = response.headers();
    assert_eq!(
        headers
            .get("x-content-type-options")
            .map(|v| v.to_str().unwrap()),
        Some("nosniff")
    );
    assert_eq!(
        headers.get("x-frame-options").map(|v| v.to_str().unwrap()),
        Some("DENY")
    );
    assert_eq!(
        headers.get("referrer-policy").map(|v| v.to_str().unwrap()),
        Some("strict-origin-when-cross-origin")
    );
    assert_eq!(
        headers
            .get("permissions-policy")
            .map(|v| v.to_str().unwrap()),
        Some("camera=(), microphone=(), geolocation=()")
    );
    assert_eq!(
        headers.get("x-xss-protection").map(|v| v.to_str().unwrap()),
        Some("0")
    );
}

fn ensure_test_cookie_key() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        std::env::set_var("COOKIE_KEY", "test-cookie-key-not-for-production-use-32+");
    });
}

fn csrf_router() -> Router {
    use tower_sessions::{MemoryStore, SessionManagerLayer};
    ensure_test_cookie_key();
    let store = MemoryStore::default();
    Router::new()
        .route("/protected", post(ok_handler))
        .route(
            "/csrf/v1/generate",
            post(ruxlog::modules::csrf_v1::controller::generate),
        )
        .layer(middleware::from_fn(csrf_guard))
        .layer(SessionManagerLayer::new(store))
}

async fn csrf_bootstrap(app: &Router) -> (String, String, String) {
    use axum::body::to_bytes;
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/csrf/v1/generate")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let set_cookie = res
        .headers()
        .get("set-cookie")
        .expect("generate sets a session cookie")
        .to_str()
        .unwrap()
        .to_string();
    let pair = set_cookie.split(';').next().unwrap_or(&set_cookie).trim();
    let name = pair.split('=').next().unwrap_or("").to_string();
    let value = pair.split('=').nth(1).unwrap_or("").to_string();

    let bytes = to_bytes(res.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let token = json["token"].as_str().unwrap().to_string();
    (token, name, value)
}

#[tokio::test]
async fn csrf_rejects_missing_token() {
    let app = csrf_router();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/protected")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn csrf_rejects_invalid_token() {
    let app = csrf_router();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/protected")
                .header("csrf-token", "invalid-token-value")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn csrf_rejects_token_bound_to_a_different_session() {
    let app = csrf_router();
    let (token_a, _name_a, _value_a) = csrf_bootstrap(&app).await;
    let (_token_b, name_b, value_b) = csrf_bootstrap(&app).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/protected")
                .header("csrf-token", &token_a)
                .header("cookie", format!("{name_b}={value_b}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn csrf_accepts_valid_token() {
    let app = csrf_router();
    let (token, name, value) = csrf_bootstrap(&app).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/protected")
                .header("csrf-token", &token)
                .header("cookie", format!("{name}={value}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn csrf_exempt_bootstrap_path_needs_no_token() {
    let app = csrf_router();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/csrf/v1/generate")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn empty_string_not_accepted_as_totp_code() {
    use ruxlog::utils::twofa;

    let secret = twofa::generate_secret_base32(20).expect("CSPRNG available");
    assert!(twofa::verify_totp_code_at(
        &secret,
        "",
        chrono::Utc::now().fixed_offset(),
        twofa::DEFAULT_TOTP_STEP,
        twofa::DEFAULT_TOTP_DIGITS,
        1,
    )
    .is_none());
}

#[test]
fn non_numeric_totp_code_rejected() {
    use ruxlog::utils::twofa;

    let secret = twofa::generate_secret_base32(20).expect("CSPRNG available");
    assert!(twofa::verify_totp_code_at(
        &secret,
        "abcdef",
        chrono::Utc::now().fixed_offset(),
        twofa::DEFAULT_TOTP_STEP,
        twofa::DEFAULT_TOTP_DIGITS,
        1,
    )
    .is_none());
}

#[test]
fn wrong_length_totp_code_rejected() {
    use ruxlog::utils::twofa;

    let secret = twofa::generate_secret_base32(20).expect("CSPRNG available");
    assert!(twofa::verify_totp_code_at(
        &secret,
        "12345",
        chrono::Utc::now().fixed_offset(),
        twofa::DEFAULT_TOTP_STEP,
        twofa::DEFAULT_TOTP_DIGITS,
        1,
    )
    .is_none());
}

#[test]
fn backup_code_constant_time_compare() {
    use ruxlog::utils::twofa;

    let codes = vec!["ABCD-EFGH-JKLM".to_string()];
    let hashes = twofa::hash_backup_codes(&codes);

    assert!(twofa::consume_backup_code(&hashes, "ABCD-EFGH-JKLN").is_none());
    assert!(twofa::consume_backup_code(&hashes, "ABCD-EFGH-JKLM").is_some());
}

#[test]
fn user_json_never_leaks_secret_fields() {
    use ruxlog::db::sea_models::user::{self, UserRole};

    let now = chrono::Utc::now().fixed_offset();
    let model = user::Model {
        id: 1,
        name: "Test".into(),
        email: "test@example.com".into(),
        password: Some("dummy-argon2-hash".into()),
        avatar_id: None,
        is_verified: true,
        role: UserRole::User,
        two_fa_enabled: true,
        two_fa_secret: Some("JBSWY3DPEHPK3PXP".into()),
        two_fa_backup_codes: Some(serde_json::json!(["$argon2id$dummy"])),
        two_fa_last_totp_counter: None,
        google_id: None,
        oauth_provider: None,
        session_auth_secret: "test-secret".into(),
        created_at: now,
        updated_at: now,
    };

    let json = serde_json::to_value(&model).expect("user model must serialize");
    let obj = json.as_object().expect("serialized user is an object");

    for secret_field in ["password", "two_fa_secret", "two_fa_backup_codes"] {
        assert!(
            !obj.contains_key(secret_field),
            "{secret_field} leaked into serialized user JSON: {json}"
        );
    }

    assert_eq!(
        obj.get("email").and_then(|v| v.as_str()),
        Some("test@example.com")
    );
}

#[test]
fn error_codes_distinct_status_for_auth_vs_db() {
    use ruxlog::error::codes::ErrorCode;

    let auth_401 = vec![
        ErrorCode::InvalidCredentials,
        ErrorCode::SessionExpired,
        ErrorCode::InvalidToken,
    ];
    for code in &auth_401 {
        assert_eq!(code.status_code(), axum::http::StatusCode::UNAUTHORIZED);
    }

    let auth_403 = vec![
        ErrorCode::Unauthorized,
        ErrorCode::AccountLocked,
        ErrorCode::EmailVerificationRequired,
    ];
    for code in &auth_403 {
        assert_eq!(code.status_code(), axum::http::StatusCode::FORBIDDEN);
    }

    assert_eq!(
        ErrorCode::RecordNotFound.status_code(),
        axum::http::StatusCode::NOT_FOUND
    );
    assert_eq!(
        ErrorCode::DuplicateEntry.status_code(),
        axum::http::StatusCode::CONFLICT
    );
    assert_eq!(
        ErrorCode::DatabaseConnectionError.status_code(),
        axum::http::StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[test]
fn auth_path_logs_contain_no_sensitive_values() {
    // W8f invariant: auth-path logs emit only opaque user id, provider NAME,
    // result, trace id, client_ip — NEVER email, OTP/verification code,
    // recipient address, or subject. Source-level guard against reintroduction.
    //
    // Deliberate exception: each auth controller has a commented `── DELIVERY:
    // …-code hand-off ──` block that logs the plaintext code ONLY on the
    // !is_production() branch (dev/test has no SMTP). Production keeps the real
    // transport and never logs the code — the matchers below must stay blind to
    // those gated `verification_code`/`reset_code` fields.
    let email_verify = include_str!("../src/modules/email_verification_v1/controller.rs");
    let forgot_pw = include_str!("../src/modules/forgot_password_v1/controller.rs");
    let mail_none = include_str!("../src/services/mail/none.rs");
    let user_actions = include_str!("../src/db/sea_models/user/actions.rs");

    assert!(
        !email_verify.contains("code = %payload.code"),
        "email_verification_v1 controller must not log the OTP (code = %payload.code)"
    );

    assert!(
        !forgot_pw.contains("email = %"),
        "forgot_password_v1 controller must not log the recovery email address"
    );

    assert!(
        !mail_none.contains("recipient = %msg.to"),
        "noop mail provider must not log the recipient address"
    );
    assert!(
        !mail_none.contains("subject = %msg.subject"),
        "noop mail provider must not log the email subject"
    );

    assert!(
        !user_actions.contains("email = %"),
        "user actions must not log email (create/find_by_email/create_from_google/admin_create)"
    );

    // --- W8f step 6: broaden the source-level guard across every auth/mail path ---

    // auth_v1/controller.rs — login, register, 2FA. email/password/code are
    // payload fields that must never reach tracing output (only user_id/ip/result).
    //
    // W8f-003: the original `email = %payload` / `password = %` / `code = %payload`
    // matchers only catch the `field = %value` form. They miss two blind spots:
    //   (a) message interpolation — e.g. `info!("reg {email}")` or
    //       `error!("login fail {login_key}")` — where the controller binds
    //       `let email = payload.email.clone()` / `let login_key = payload.email
    //       .trim().to_lowercase()` and then interpolates the local into a
    //       tracing message;
    //   (b) field form against the LOCAL binding — `email = %email`,
    //       `email = %login_key` — rather than `email = %payload.email`.
    // The guards below close both. `error = %err` / `error = ?err` stay allowed:
    // those carry an opaque DbErr/Backend error, NOT a payload field, and blanket
    // banning them would false-positive on the legitimate session/auth error logs.
    // (The risk that such an `err` embeds an email at runtime is covered by the
    //  register DB-path runtime capture test further down.)
    let auth_v1 = include_str!("../src/modules/auth_v1/controller.rs");
    assert!(
        !auth_v1.contains("email = %payload"),
        "auth_v1 controller must not log the login/register email (email = %payload.*)"
    );
    assert!(
        !auth_v1.contains("password = %"),
        "auth_v1 controller must not log the password"
    );
    assert!(
        !auth_v1.contains("code = %payload"),
        "auth_v1 controller must not log the 2FA/backup code (code = %payload.*)"
    );
    // Local-binding field form: the controller materializes `email` and
    // `login_key` (lowercased email, also used as the per-account throttle key)
    // into locals — never log those by name either.
    assert!(
        !auth_v1.contains("email = %email"),
        "auth_v1 controller must not log the local `email` binding (payload.email clone)"
    );
    assert!(
        !auth_v1.contains("email = %login_key"),
        "auth_v1 controller must not log the throttle key (lowercased email) as an email field"
    );
    assert!(
        !auth_v1.contains("login_key = %"),
        "auth_v1 controller must not log the login throttle key (lowercased email)"
    );
    // Message interpolation: a tracing message literal must never interpolate the
    // PII locals. `{login_key}` appears legitimately inside `format!("login:
    // {login_key}")` (the rate-limit KEY, not a log), so it is excluded; the rest
    // are pure leak vectors.
    assert!(
        !auth_v1.contains("{email}"),
        "auth_v1 controller must not interpolate the email local into a tracing message"
    );
    assert!(
        !auth_v1.contains("{password}"),
        "auth_v1 controller must not interpolate the password into a tracing message"
    );
    assert!(
        !auth_v1.contains("{code}"),
        "auth_v1 controller must not interpolate the 2FA/backup code into a tracing message"
    );

    // user/actions.rs create() is the DB-layer log on the register path (register
    // -> user::Entity::create). It is #[instrument(skip(conn, new_user,
    // email_code_hash))] so new_user (email/password) never enters the span; the
    // only field log is `error!("Failed to create user: {}", err)`. Guard the
    // interpolation blind spot here too. `new_user.email`/`new_user.password`
    // appear in non-log `Set(..)`/`generate_hash(..)` calls, so they are NOT
    // blanket-banned — only their presence inside a tracing message literal.
    assert!(
        !user_actions.contains("{email}"),
        "user actions must not interpolate an email into a tracing message (create/create_from_google/admin_create)"
    );
    assert!(
        !user_actions.contains("{password}"),
        "user actions must not interpolate a password into a tracing message"
    );

    // OAuth provider controllers. `code = %err.code` is the ErrorCode enum
    // (legitimate, opaque) — never confuse it with the authorization/OTP code,
    // so scope to `code = %payload` and `email = %<source>`.
    let google = include_str!("../src/modules/google_auth_v1/controller.rs");
    assert!(
        !google.contains("email = %claims"),
        "google_auth_v1 must not log the id_token claims email"
    );
    assert!(
        !google.contains("email = %user_info"),
        "google_auth_v1 must not log the userinfo email"
    );
    assert!(
        !google.contains("code = %payload"),
        "google_auth_v1 must not log the OAuth authorization code"
    );
    assert!(
        !google.contains("password = %"),
        "google_auth_v1 must not log credentials"
    );

    let apple = include_str!("../src/modules/apple_auth_v1/controller.rs");
    assert!(
        !apple.contains("email = %claims"),
        "apple_auth_v1 must not log the id_token claims email"
    );
    assert!(
        !apple.contains("code = %payload"),
        "apple_auth_v1 must not log the OAuth authorization code"
    );
    assert!(
        !apple.contains("password = %"),
        "apple_auth_v1 must not log credentials"
    );

    let facebook = include_str!("../src/modules/facebook_auth_v1/controller.rs");
    assert!(
        !facebook.contains("email = %user_info"),
        "facebook_auth_v1 must not log the Graph API email"
    );
    assert!(
        !facebook.contains("code = %payload"),
        "facebook_auth_v1 must not log the OAuth authorization code"
    );
    assert!(
        !facebook.contains("password = %"),
        "facebook_auth_v1 must not log credentials"
    );

    let github = include_str!("../src/modules/github_auth_v1/controller.rs");
    assert!(
        !github.contains("email = %"),
        "github_auth_v1 must not log the GitHub email"
    );
    assert!(
        !github.contains("code = %payload"),
        "github_auth_v1 must not log the OAuth authorization code"
    );
    assert!(
        !github.contains("password = %"),
        "github_auth_v1 must not log credentials"
    );

    // services/oauth/login.rs — find_or_create_user_for_oauth receives the IdP
    // email/name; only user_id + provider NAME may appear.
    let oauth_login = include_str!("../src/services/oauth/login.rs");
    assert!(
        !oauth_login.contains("email = %"),
        "oauth::login must not log the IdP email"
    );
    assert!(
        !oauth_login.contains("code = %"),
        "oauth::login must not log any code value"
    );
    assert!(
        !oauth_login.contains("password = %"),
        "oauth::login must not log credentials"
    );

    // Mail providers — recipient/subject/to are PII and must never be logged;
    // only opaque domain + provider name + redacted rate key are permitted.
    let smtp = include_str!("../src/services/mail/smtp.rs");
    assert!(
        !smtp.contains("recipient = %msg"),
        "smtp provider must not log the recipient address"
    );
    assert!(
        !smtp.contains("subject = %msg"),
        "smtp provider must not log the email subject"
    );
    assert!(
        !smtp.contains("to = %msg"),
        "smtp provider must not log the recipient (msg.to)"
    );
    assert!(
        !smtp.contains("password = %"),
        "smtp provider must not log the SMTP password"
    );
    assert!(
        !smtp.contains("= %username"),
        "smtp provider must not log the SMTP username (credential component, often an email address)"
    );

    let cloudflare = include_str!("../src/services/mail/cloudflare.rs");
    assert!(
        !cloudflare.contains("recipient = %"),
        "cloudflare provider must not log the recipient address"
    );
    assert!(
        !cloudflare.contains("subject = %msg"),
        "cloudflare provider must not log the email subject"
    );
    assert!(
        !cloudflare.contains("to = %msg"),
        "cloudflare provider must not log the recipient (msg.to)"
    );
    assert!(
        !cloudflare.contains("email = %"),
        "cloudflare provider must not log an email address"
    );

    let mail_router = include_str!("../src/services/mail/router.rs");
    assert!(
        !mail_router.contains("recipient = %msg"),
        "mail router must not log the full recipient address (domain-only is allowed)"
    );
    assert!(
        !mail_router.contains("subject = %msg"),
        "mail router must not log the email subject"
    );
    assert!(
        !mail_router.contains("email = %msg"),
        "mail router must not log the recipient email"
    );
    assert!(
        !mail_router.contains("to = %msg"),
        "mail router must not log msg.to"
    );
}

#[tokio::test]
async fn tracing_capture_asserts_no_pii_in_mail_drop_path() {
    // W8f step 6: tracing-capture guard. Drives a representative mail path
    // (NoOpMailProvider::send — the MAIL_PROVIDER=none drop/failure path) under
    // a capturing fmt subscriber and asserts no recipient/code/subject VALUE
    // appears in the captured event fields. The provider is handed a message
    // whose `to`/`subject` carry real-looking PII; the invariant is that those
    // values never reach tracing output.
    //
    // login / forgot-password-generate need a full AppState + DB harness
    // (integration scope) and are covered by the source-level guard above; this
    // capture test is the runtime check for the callable mail-failure path.
    use ruxlog::services::mail::none::NoOpMailProvider;
    use ruxlog::services::mail::{MailProvider, OutboundEmail};
    use std::sync::{Arc, Mutex};

    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let guard = install_capture_subscriber(buf.clone());

    let pii_email = "victim@example.com";
    let pii_code = "123456";
    let msg = OutboundEmail {
        to: pii_email.to_string(),
        subject: format!("Reset code {pii_code}"),
        html: None,
        text: None,
        template: None,
    };
    let provider = NoOpMailProvider;
    let _ = MailProvider::send(&provider, msg).await;

    drop(guard);
    let captured = captured_string(&buf);

    // Capture must have actually happened — else the negative asserts are vacuous.
    assert!(
        captured.contains("mail dropped"),
        "captured tracing output should include the noop-drop event; got: {captured}"
    );
    assert!(
        !captured.contains(pii_email),
        "recipient address leaked into noop mailer tracing output: {captured}"
    );
    assert!(
        !captured.contains(pii_code),
        "verification/reset code leaked into noop mailer tracing output: {captured}"
    );
}

// ===========================================================================
// W8f runtime tracing-capture harness — shared by the mail-funnel capture tests.
// ===========================================================================
// Drives the callable auth/mail funnels (recovery-generate via
// send_forgot_password_email; login/register/verification-resend via
// send_email_verification_code) through the REAL MailRouter under a thread-local
// capturing subscriber, and asserts no recipient email, OTP/reset code, or
// subject value reaches tracing output. The router's #[instrument(...)] span
// skips `msg` and records only recipient_domain; this is the runtime complement
// to the static source guard, closing its blind spots on the call paths most
// likely to leak email/code/subject.

use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing_subscriber::fmt::MakeWriter;

#[derive(Clone)]
struct CaptureMaker(Arc<Mutex<Vec<u8>>>);
impl<'a> MakeWriter<'a> for CaptureMaker {
    type Writer = CaptureBuf;
    fn make_writer(&'a self) -> Self::Writer {
        CaptureBuf(self.0.clone())
    }
}
struct CaptureBuf(Arc<Mutex<Vec<u8>>>);
impl Write for CaptureBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Install a thread-local capturing fmt subscriber. The returned guard restores
/// the prior default on drop; keep it alive across the awaited call.
fn install_capture_subscriber(buf: Arc<Mutex<Vec<u8>>>) -> tracing::subscriber::DefaultGuard {
    let subscriber = tracing_subscriber::fmt()
        .with_writer(CaptureMaker(buf))
        .with_ansi(false)
        .finish();
    tracing::subscriber::set_default(subscriber)
}

fn captured_string(buf: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8(buf.lock().unwrap().clone()).expect("utf8")
}

/// MailRouter funnel backed by the no-op provider on an empty in-memory DB. The
/// suppression-list lookup fails open against the absent table (domain-only warn),
/// so transactional sends reach the no-op drop — exercising the router's span
/// instrumentation, the fail-open warn, and the provider drop log in one call.
async fn noop_mail_router() -> ruxlog::services::mail::MailRouter {
    use ruxlog::services::mail::{
        none::NoOpMailProvider, router::MailRouterLimits, MailProvider, MailRouter,
    };
    use std::collections::HashMap;

    let db = sea_orm::Database::connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite connects");
    let providers: HashMap<String, Arc<dyn MailProvider>> = [(
        "none".to_string(),
        Arc::new(NoOpMailProvider) as Arc<dyn MailProvider>,
    )]
    .into_iter()
    .collect();
    MailRouter::new(
        providers,
        "none".to_string(),
        Arc::new(rux_request_gate::InMemoryStore::default()),
        db,
        MailRouterLimits::default(),
        true,
    )
}

#[tokio::test]
async fn tracing_capture_asserts_no_pii_in_recovery_generate_mail_funnel() {
    // W8f runtime guard for the recovery-generate path
    // (forgot_password_v1::generate -> send_forgot_password_email -> MailRouter).
    // The router's instrumented span + the no-op drop are where a recipient
    // address or reset code could leak; this asserts they don't. Only the
    // recipient DOMAIN may appear (router policy).
    use ruxlog::services::mail::send_forgot_password_email;

    let mailer = noop_mail_router().await;
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let guard = install_capture_subscriber(buf.clone());

    let pii_email = "victim@example.com";
    let pii_local = "victim";
    let pii_code = "918273";
    let _ = send_forgot_password_email(&mailer, pii_email, pii_code).await;

    drop(guard);
    let captured = captured_string(&buf);

    assert!(
        captured.contains("mail dropped"),
        "capture sentinel missing — funnel did not reach the no-op drop; got: {captured}"
    );
    assert!(
        captured.contains("example.com"),
        "recipient DOMAIN should be surfaced (router domain-only policy); got: {captured}"
    );
    assert!(
        !captured.contains(pii_email),
        "full recipient address leaked into recovery-generate tracing output: {captured}"
    );
    assert!(
        !captured.contains(pii_local),
        "recipient mailbox local-part leaked into recovery-generate tracing output (domain-only is allowed): {captured}"
    );
    assert!(
        !captured.contains(pii_code),
        "reset code leaked into recovery-generate tracing output: {captured}"
    );
    assert!(
        !captured.contains("Password reset verification code"),
        "subject text leaked into recovery-generate tracing output: {captured}"
    );
}

#[tokio::test]
async fn tracing_capture_asserts_no_pii_in_login_verification_mail_funnel() {
    // W8f runtime guard for the register / verification-resend paths, both of
    // which funnel through send_email_verification_code -> MailRouter (the same
    // service fn admin_issue_code uses too). This is the path most likely to
    // leak an OTP code or recipient address; asserts neither does. The login
    // handler's own info/warn logs (payload skipped by #[instrument]) stay on
    // the static source guard — a full log_in runtime capture needs the
    // AppState+AuthSession+DB integration harness (see blockers).
    use ruxlog::services::mail::send_email_verification_code;

    let mailer = noop_mail_router().await;
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let guard = install_capture_subscriber(buf.clone());

    let pii_email = "victim@example.com";
    let pii_local = "victim";
    let pii_code = "547219";
    let _ = send_email_verification_code(&mailer, pii_email, pii_code).await;

    drop(guard);
    let captured = captured_string(&buf);

    assert!(
        captured.contains("mail dropped"),
        "capture sentinel missing — funnel did not reach the no-op drop; got: {captured}"
    );
    assert!(
        captured.contains("example.com"),
        "recipient DOMAIN should be surfaced (router domain-only policy); got: {captured}"
    );
    assert!(
        !captured.contains(pii_email),
        "full recipient address leaked into login/verification tracing output: {captured}"
    );
    assert!(
        !captured.contains(pii_local),
        "recipient mailbox local-part leaked into login/verification tracing output (domain-only is allowed): {captured}"
    );
    assert!(
        !captured.contains(pii_code),
        "OTP code leaked into login/verification tracing output: {captured}"
    );
    assert!(
        !captured.contains("Email verification code"),
        "subject text leaked into login/verification tracing output: {captured}"
    );
}

// ===========================================================================
// W8f-003: runtime tracing-capture for the register DB path + login/register
// handler-scope limitation doc.
// ===========================================================================
// The mail-funnel capture tests above exercise the shared send_* service fns.
// They do NOT exercise the login/register HANDLERS' own tracing, because:
//   - `log_in` needs a full AppState + AuthSession (axum-login session) + an
//     argon2-hashed user row + a ban-lookup. AuthSession is constructed by the
//     tower-sessions middleware layer, not directly instantiable in a unit test.
//   - `register` is AuthSession-free but still needs an AppState, whose struct
//     requires aws_sdk_s3::Client + BillingRouter + QuranStore + TranslationPool
//     + FcmClient + WebauthnService — far too heavy and fragile to stand up here.
// Both handlers are #[instrument(skip(state, auth, payload), ...)] so the PII
// payload (email/password/code) never enters the span; their field logs record
// only client_ip / user_id / user_role / device / result. The static source
// guard above (now strengthened for the interpolation + local-binding blind
// spots) covers the handler bodies.
//
// What IS callable without that fixture is the register path's DB-layer log:
// `register` -> `user::Entity::create`. create() is its own #[instrument(...)]
// (skipping new_user) and emits exactly one field log on the failure branch —
// `error!("Failed to create user: {}", err)`. Driving it against an empty
// in-memory SQLite (no `user` table) forces that branch under a capturing
// subscriber, and we assert the input email / password / code_hash never reach
// tracing output. This is the runtime complement to the static guard for the
// part of the register path that is unit-testable.

#[tokio::test]
async fn tracing_capture_asserts_no_pii_in_register_db_create_path() {
    use ruxlog::db::sea_models::user::{self, NewUser, UserRole};

    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let guard = install_capture_subscriber(buf.clone());

    // Distinctive PII values so a partial/substring leak is caught unambiguously.
    let pii_email = "victim@example.com";
    let pii_password = "hunter2-hunter2-register-pw!";
    let pii_code_hash = "deadbeefcafebabe1234".to_string();

    let new_user = NewUser {
        name: "Target User".into(),
        email: pii_email.into(),
        password: pii_password.into(),
        role: UserRole::User,
    };

    // Empty in-memory SQLite: no schema -> user.insert fails ->
    // error!("Failed to create user: {}", err) fires on the test thread.
    let db = sea_orm::Database::connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite connects");
    let result = user::Entity::create(&db, new_user, pii_code_hash.clone()).await;
    assert!(
        result.is_err(),
        "create() must error against a schema-less DB so the failure-log branch runs"
    );

    drop(guard);
    let captured = captured_string(&buf);

    // Sentinel MUST appear — otherwise the negative asserts below are vacuous
    // (e.g. create() started succeeding, or the log line was renamed/removed).
    assert!(
        captured.contains("Failed to create user"),
        "capture sentinel missing — register DB create() did not reach its error log; got: {captured}"
    );
    assert!(
        !captured.contains(pii_email),
        "register email leaked into user::Entity::create tracing output: {captured}"
    );
    assert!(
        !captured.contains(pii_password),
        "register password leaked into user::Entity::create tracing output: {captured}"
    );
    assert!(
        !captured.contains(&pii_code_hash),
        "verification code hash leaked into user::Entity::create tracing output: {captured}"
    );
    // The opaque user_id span field is recorded ONLY on the success branch; on
    // this failure branch it stays unset, so no PII-derived id appears either.
    assert!(
        !captured.contains("user_id"),
        "failure-branch create() should not record a user_id span field: {captured}"
    );
}
