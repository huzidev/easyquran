use async_trait::async_trait;
use password_auth::verify_password;
use rux_auth::{
    AuthBackend as RuxAuthBackend, AuthError, AuthErrorCode, AuthUser, BanStatus, SessionRevocation,
};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, DbErr, Statement, TransactionError,
    TransactionTrait, Value,
};
use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::task;
use tower_sessions::SessionStore;
use tracing::{error, info, instrument, warn};

use crate::{
    db::sea_models::{user, user_ban},
    services::session_store::SqliteSessionStore,
    utils::telemetry,
};

const DUMMY_VERIFY_PASSWORD: &str = "timing-equalization-dummy-fixture";
// Timing-oracle mitigation: not-found and OAuth login branches run a dummy Argon2id verify against this fixed hash to cost the same as a real wrong-password attempt; removing it leaks account existence via request latency.
static DUMMY_VERIFY_HASH: LazyLock<String> =
    LazyLock::new(|| password_auth::generate_hash(DUMMY_VERIFY_PASSWORD));

pub type AuthSession = rux_auth::AuthSession<AuthBackend>;

#[derive(Clone)]
pub struct AuthBackend {
    pub pool: DatabaseConnection,
    pub session_store: Arc<SqliteSessionStore>,
    pub revoked: Arc<Mutex<HashSet<String>>>,
}

impl AuthBackend {
    pub fn new(
        pool: &DatabaseConnection,
        session_store: Arc<SqliteSessionStore>,
        revoked: Arc<Mutex<HashSet<String>>>,
    ) -> Self {
        Self {
            pool: pool.clone(),
            session_store,
            revoked,
        }
    }

    #[instrument(skip(self))]
    pub async fn terminate(&self, tower_session_id: &str) {
        use std::str::FromStr;
        use tower_sessions::session::Id;

        match Id::from_str(tower_session_id) {
            Ok(id) => {
                if let Err(e) = self.session_store.delete(&id).await {
                    warn!(
                        error = %e,
                        "Failed to delete tower-session from store (revoked_at audit row still set)"
                    );
                } else {
                    info!("Deleted tower-session from session store");
                }
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Could not parse tower-session id for termination; skipping store delete"
                );
            }
        }

        if let Ok(mut set) = self.revoked.lock() {
            set.insert(tower_session_id.to_string());
        }
    }

    pub fn check_password(password: String, hash: &str) -> Result<bool, AuthError> {
        // A verification failure IS the "wrong password" answer — argon2 signals
        // plain mismatches as errors, so any Err here means "did not verify"
        // (wrong password or unusable hash) and must surface as Ok(false).
        // Returning Err propagated through authenticate_password into the login
        // handler's catch-all 500 "Authentication error" arm for every wrong
        // password (and the dummy-verify twin below did the same for unknown
        // emails).
        Ok(verify_password(password, hash).is_ok())
    }

    fn run_dummy_password_verify(password: String) -> Result<bool, AuthError> {
        let hash: &str = DUMMY_VERIFY_HASH.as_str();
        Ok(verify_password(password, hash).is_ok())
    }

    async fn run_blocking_dummy_verify(password: String) -> Result<(), AuthError> {
        match task::spawn_blocking(move || Self::run_dummy_password_verify(password)).await {
            Ok(_) => Ok(()),
            Err(join_err) => {
                error!(error = %join_err, "Dummy password verification task failed");
                Err(AuthError::new(AuthErrorCode::InternalError)
                    .with_message("Password verification failed"))
            }
        }
    }

    #[instrument(skip(self, password, email), fields(result))]
    pub async fn authenticate_password(
        &self,
        email: String,
        password: String,
    ) -> Result<Option<user::Model>, AuthError> {
        let metrics = telemetry::auth_metrics();
        metrics.login_attempts.add(1, &[]);

        info!("Attempting password authentication");

        let user_result = user::Entity::find_by_email(&self.pool, email.clone()).await;

        let user = match user_result {
            Ok(Some(user)) => user,
            Ok(None) => {
                warn!("User not found");
                tracing::Span::current().record("result", "user_not_found");
                metrics.login_failure.add(
                    1,
                    &[opentelemetry::KeyValue::new("reason", "user_not_found")],
                );
                Self::run_blocking_dummy_verify(password).await?;
                return Ok(None);
            }
            Err(err) => {
                error!(error = ?err, "Database error during user lookup");
                metrics
                    .login_failure
                    .add(1, &[opentelemetry::KeyValue::new("reason", "db_error")]);
                return Err(AuthError::new(AuthErrorCode::BackendError)
                    .with_message("Database error during authentication"));
            }
        };

        let pwd_hash = match &user.password {
            Some(pwd) => pwd.clone(),
            None => {
                warn!("User has no password (OAuth user attempting password login)");
                tracing::Span::current().record("result", "no_password");
                metrics
                    .login_failure
                    .add(1, &[opentelemetry::KeyValue::new("reason", "oauth_user")]);
                Self::run_blocking_dummy_verify(password).await?;
                return Ok(None);
            }
        };

        let verify_start = Instant::now();
        let password_valid =
            match task::spawn_blocking(move || Self::check_password(password, &pwd_hash)).await {
                Ok(result) => result?,
                Err(join_err) => {
                    error!(error = %join_err, "Password verification task failed");
                    metrics
                        .login_failure
                        .add(1, &[opentelemetry::KeyValue::new("reason", "task_error")]);
                    return Err(AuthError::new(AuthErrorCode::InternalError)
                        .with_message("Password verification failed"));
                }
            };

        let verify_duration = verify_start.elapsed().as_millis() as f64;
        metrics
            .password_verification_duration
            .record(verify_duration, &[]);

        if password_valid {
            info!(user_id = user.id, "Authentication successful");
            tracing::Span::current().record("result", "success");
            metrics.login_success.add(1, &[]);
            metrics.session_created.add(1, &[]);
            Ok(Some(user))
        } else {
            warn!("Invalid password");
            tracing::Span::current().record("result", "invalid_password");
            metrics.login_failure.add(
                1,
                &[opentelemetry::KeyValue::new("reason", "invalid_password")],
            );
            Ok(None)
        }
    }

    #[instrument(skip(self), fields(result))]
    pub async fn authenticate_oauth(
        &self,
        google_id: String,
    ) -> Result<Option<user::Model>, AuthError> {
        let metrics = telemetry::auth_metrics();
        info!("OAuth authentication attempt");

        let user = user::Entity::find_by_google_id(&self.pool, google_id)
            .await
            .map_err(|err| {
                error!(error = ?err, "Database error during OAuth user lookup");
                AuthError::new(AuthErrorCode::BackendError)
                    .with_message("Database error during OAuth lookup")
            })?;

        match user {
            Some(user) => {
                info!(user_id = user.id, "OAuth authentication successful");
                metrics.login_success.add(1, &[]);
                metrics.session_created.add(1, &[]);
                Ok(Some(user))
            }
            None => {
                warn!("OAuth user not found");
                metrics.login_failure.add(
                    1,
                    &[opentelemetry::KeyValue::new(
                        "reason",
                        "oauth_user_not_found",
                    )],
                );
                Ok(None)
            }
        }
    }

    // ── Durable session binding (W8e) ───────────────────────────────────────
    // Backs the user_session audit row ↔ opaque tower session id mapping with
    // the auth_session_binding table (m000004). record + replace are FAIL-CLOSED:
    // a DB error returns Err so the caller destroys/rolls back the tower session
    // instead of serving one that can never be terminated by audit id.

    /// Record the 1:1 binding from a `user_session` audit row to its opaque tower
    /// session id at login/passkey/OAuth creation. FAIL-CLOSED: returns Err on any
    /// DB error so the caller tears down the tower session it just created.
    pub async fn record_session_mapping(
        &self,
        db: &DatabaseConnection,
        user_session_id: i32,
        tower_session_id: &str,
    ) -> Result<(), DbErr> {
        let now = epoch_secs();
        // UPSERT on tower_session_id; the UNIQUE(user_session_id) index makes a
        // collision with a different audit row a constraint error → caller fails.
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "INSERT INTO auth_session_binding (tower_session_id, user_session_id, created_at) \
             VALUES (?, ?, ?) \
             ON CONFLICT(tower_session_id) DO UPDATE SET \
             user_session_id=excluded.user_session_id, created_at=excluded.created_at",
            vec![
                Value::from(tower_session_id.to_string()),
                Value::from(user_session_id),
                Value::from(now),
            ],
        ))
        .await?;
        Ok(())
    }

    /// Reverse lookup used by session termination: opaque tower session id → the
    /// owning `user_session` audit row id. None on miss; a DB error is logged and
    /// treated as a miss (fail-closed lives at record/replace time, not on reads).
    pub async fn lookup_session_mapping_by_tower(
        &self,
        db: &DatabaseConnection,
        tower_session_id: &str,
    ) -> Option<i32> {
        match db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT user_session_id FROM auth_session_binding WHERE tower_session_id = ?",
                vec![Value::from(tower_session_id.to_string())],
            ))
            .await
        {
            Ok(Some(row)) => row.try_get_by_index::<i64>(0).ok().map(|v| v as i32),
            Ok(None) => None,
            Err(e) => {
                warn!(error = %e, "session binding lookup failed (treated as miss)");
                None
            }
        }
    }

    /// Forward lookup used by audit-row-keyed termination (`sessions_terminate`):
    /// `user_session` audit row id → the opaque tower session id bound to it.
    /// None on miss; a DB error is logged and treated as a miss (fail-closed
    /// lives at record/replace time, not on reads).
    pub async fn lookup_tower_by_audit_id(
        &self,
        db: &DatabaseConnection,
        user_session_id: i32,
    ) -> Option<String> {
        match db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT tower_session_id FROM auth_session_binding WHERE user_session_id = ?",
                vec![Value::from(user_session_id)],
            ))
            .await
        {
            Ok(Some(row)) => row.try_get_by_index::<String>(0).ok(),
            Ok(None) => None,
            Err(e) => {
                warn!(error = %e, "session binding tower lookup failed (treated as miss)");
                None
            }
        }
    }

    /// Drop the binding for a tower session id (logout / termination). A missing
    /// row is not an error; a real DB error is returned so logout can surface it.
    pub async fn clear_session_mapping(
        &self,
        db: &DatabaseConnection,
        tower_session_id: &str,
    ) -> Result<(), DbErr> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "DELETE FROM auth_session_binding WHERE tower_session_id = ?",
            vec![Value::from(tower_session_id.to_string())],
        ))
        .await?;
        Ok(())
    }

    /// Swap the binding on a `cycle_id()` rotation: the audit row is unchanged,
    /// the opaque tower id moves from `old_tower` to `new_tower`. FAIL-CLOSED: one
    /// transaction, and on DB error the caller destroys the freshly-rotated tower
    /// session rather than leaving one that maps to no audit row.
    pub async fn replace_session_mapping(
        &self,
        db: &DatabaseConnection,
        user_session_id: i32,
        old_tower: &str,
        new_tower: &str,
    ) -> Result<(), DbErr> {
        let now = epoch_secs();
        let old = old_tower.to_string();
        let new = new_tower.to_string();
        db.transaction::<_, (), DbErr>(|txn| {
            let (old, new) = (old.clone(), new.clone());
            Box::pin(async move {
                // Drop the old tower row, then evict any stale row still pointing
                // this audit row at an earlier tower id (enforces exactly-one).
                txn.execute(Statement::from_sql_and_values(
                    DatabaseBackend::Sqlite,
                    "DELETE FROM auth_session_binding WHERE tower_session_id = ?",
                    vec![Value::from(old)],
                ))
                .await?;
                txn.execute(Statement::from_sql_and_values(
                    DatabaseBackend::Sqlite,
                    "DELETE FROM auth_session_binding WHERE user_session_id = ?",
                    vec![Value::from(user_session_id)],
                ))
                .await?;
                txn.execute(Statement::from_sql_and_values(
                    DatabaseBackend::Sqlite,
                    "INSERT INTO auth_session_binding (tower_session_id, user_session_id, created_at) \
                     VALUES (?, ?, ?)",
                    vec![Value::from(new), Value::from(user_session_id), Value::from(now)],
                ))
                .await?;
                Ok(())
            })
        })
        .await
        .map_err(|e| match e {
            TransactionError::Connection(e) => e,
            TransactionError::Transaction(e) => e,
        })?;
        Ok(())
    }

    /// Boot reconciliation (W8e): (1) revoke live `user_session` audit rows that
    /// have NO durable binding (pre-binding-era sessions), (2) reap binding rows
    /// whose audit row is already revoked and delete their live tower sessions,
    /// and (3) forcibly remove live AUTH tower sessions that have no binding row
    /// by enumerating the session store (the one path that works without a
    /// per-id binding lookup). Together these make the startup restart a single
    /// clean re-authentication boundary. Returns the count of newly-revoked
    /// unbound audit rows.
    pub async fn reconcile_unbound_sessions(
        &self,
        db: &DatabaseConnection,
        session_store: Arc<crate::services::session_store::SqliteSessionStore>,
    ) -> Result<usize, DbErr> {
        let now = chrono::Utc::now().fixed_offset();
        // 1. Revoke live audit rows with no durable binding. Their tower-session
        //    id was never recorded, so neither this step nor step 2 can reach the
        //    live tower session by id — step 3 enumerates the store to remove it.
        let revoked = db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "UPDATE user_sessions SET revoked_at = ? \
                 WHERE revoked_at IS NULL \
                 AND id NOT IN (SELECT user_session_id FROM auth_session_binding)",
                vec![Value::from(now)],
            ))
            .await?;
        let count = revoked.rows_affected() as usize;

        // 2. Orphan bindings: binding exists but its audit row is revoked. Delete
        //    the live tower session (the binding holds the opaque id), then drop
        //    the binding row so a re-issue under the same audit row cannot collide.
        let orphans = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT b.tower_session_id FROM auth_session_binding b \
                 JOIN user_sessions u ON b.user_session_id = u.id \
                 WHERE u.revoked_at IS NOT NULL",
                Vec::<Value>::new(),
            ))
            .await?;
        use std::str::FromStr;
        for row in orphans {
            let tower: Option<String> = row.try_get_by_index(0).ok();
            if let Some(tower) = tower.filter(|s| !s.is_empty()) {
                if let Ok(id) = tower_sessions::session::Id::from_str(&tower) {
                    if let Err(e) = session_store.delete(&id).await {
                        warn!(
                            error = %e,
                            "reconcile: tower-session delete failed (audit row already revoked)"
                        );
                    }
                }
                if let Ok(mut set) = self.revoked.lock() {
                    set.insert(tower);
                }
            }
        }
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "DELETE FROM auth_session_binding WHERE user_session_id IN \
             (SELECT id FROM user_sessions WHERE revoked_at IS NOT NULL)",
            Vec::<Value>::new(),
        ))
        .await?;

        // 3. Forcibly remove live AUTH tower sessions that have no durable binding.
        //    Steps 1+2 only reach sessions whose audit row IS bound. Pre-binding
        //    sessions have no binding row, so there is no tower id to delete by —
        //    enumerate the live store and drop any auth session whose id is not
        //    bound. This is what makes the restart a true single re-authentication
        //    boundary instead of leaving legacy sessions live to their 14-day TTL.
        //    Anonymous (non-auth) sessions are preserved. Non-fatal: a sweep error
        //    logs and the boundary still holds via the revoked audit rows + the
        //    in-memory revocation set.
        let bound: HashSet<String> = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT tower_session_id FROM auth_session_binding",
                Vec::<Value>::new(),
            ))
            .await?
            .into_iter()
            .filter_map(|r| r.try_get_by_index::<String>(0).ok())
            .collect();
        match session_store.delete_unbound_auth_sessions(&bound).await {
            Ok(removed) => {
                let n = removed.len();
                if n > 0 {
                    info!(
                        removed_live = n,
                        "Session-binding reconciliation: removed unbound live auth tower sessions"
                    );
                    if let Ok(mut set) = self.revoked.lock() {
                        set.extend(removed);
                    }
                }
            }
            Err(e) => warn!(
                error = %e,
                "reconcile: unbound live session sweep failed (non-fatal; boundary holds via audit rows)"
            ),
        }

        if count > 0 {
            info!(
                revoked_unbound = count,
                "Session-binding reconciliation: revoked pre-binding audit rows"
            );
        }
        Ok(count)
    }
}

fn epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl std::fmt::Debug for AuthBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthBackend")
            .field("pool", &"DatabaseConnection{...}")
            .field("session_store", &"Arc<SqliteSessionStore>")
            .field("revoked", &"Arc<Mutex<HashSet<String>>>")
            .finish()
    }
}

impl AuthUser for user::Model {
    type Id = i32;

    fn id(&self) -> Self::Id {
        self.id
    }

    fn session_auth_hash(&self) -> &[u8] {
        // Bind sessions to the per-user random session_auth_secret, not email (public/derivable); falling back to the password hash keeps password users' sessions valid if the secret column is unexpectedly absent.
        if !self.session_auth_secret.is_empty() {
            return self.session_auth_secret.as_bytes();
        }
        match &self.password {
            Some(password) => password.as_bytes(),
            None => &[],
        }
    }

    fn email_verified(&self) -> bool {
        self.is_verified
    }

    fn totp_enabled(&self) -> bool {
        self.two_fa_enabled
    }

    fn role_level(&self) -> i32 {
        self.role.to_i32()
    }
}

#[async_trait]
impl RuxAuthBackend for AuthBackend {
    type User = user::Model;

    #[instrument(skip(self), fields(user_id = %id))]
    async fn get_user(&self, id: &i32) -> Result<Option<Self::User>, AuthError> {
        user::Entity::get_by_id(&self.pool, *id)
            .await
            .map_err(|err| {
                error!(error = ?err, "Error retrieving user");
                AuthError::new(AuthErrorCode::BackendError).with_message("Failed to retrieve user")
            })
    }

    #[instrument(skip(self), fields(user_id = %user_id))]
    async fn check_ban(&self, user_id: &i32) -> Result<BanStatus, AuthError> {
        let ban = user_ban::Entity::get_active_ban(&self.pool, *user_id)
            .await
            .map_err(|err| {
                error!(error = ?err, "Error checking ban status");
                AuthError::new(AuthErrorCode::BackendError)
                    .with_message("Failed to check ban status")
            })?;

        match ban {
            Some(ban) => Ok(BanStatus::Banned {
                reason: ban.reason,
                expires_at: ban.expires_at,
                banned_by: ban.banned_by.map(|id| id as i64),
            }),
            None => Ok(BanStatus::NotBanned),
        }
    }

    #[instrument(skip(self, password), fields(user_id = %user_id))]
    async fn verify_password(&self, user_id: &i32, password: &str) -> Result<bool, AuthError> {
        let user = self.get_user(user_id).await?;

        let user = match user {
            Some(u) => u,
            None => return Ok(false),
        };

        let pwd_hash = match &user.password {
            Some(pwd) => pwd.clone(),
            None => return Ok(false),
        };

        let password = password.to_string();
        match task::spawn_blocking(move || Self::check_password(password, &pwd_hash)).await {
            Ok(result) => result.map_err(|_| AuthError::new(AuthErrorCode::InvalidCredentials)),
            Err(_) => Err(AuthError::new(AuthErrorCode::InternalError)
                .with_message("Password verification task failed")),
        }
    }

    async fn on_login(&self, user: &Self::User) -> Result<(), AuthError> {
        info!(user_id = user.id, "User logged in via rux-auth");
        Ok(())
    }

    async fn on_logout(&self, user_id: &i32) -> Result<(), AuthError> {
        info!(user_id = user_id, "User logged out via rux-auth");
        Ok(())
    }
}

pub const SESSION_MAX_AGE_SECS: u64 = 14 * 24 * 60 * 60;

#[async_trait]
impl SessionRevocation for AuthBackend {
    #[instrument(skip(self), level = "debug")]
    async fn is_session_revoked(&self, tower_session_id: &str) -> Result<bool, AuthError> {
        match self.revoked.lock() {
            Ok(set) => Ok(set.contains(tower_session_id)),
            Err(e) => {
                warn!(
                    error = %e,
                    tower_session_id = %tower_session_id,
                    "Revocation set lock poisoned (fail-open): session remains valid"
                );
                Ok(false)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dummy_verify_does_full_work_not_parse_short_circuit() {
        let dummy = DUMMY_VERIFY_HASH.as_str();

        let wrong = password_auth::verify_password("definitely-not-the-fixture", dummy);
        assert!(
            matches!(wrong, Err(password_auth::VerifyError::PasswordInvalid)),
            "dummy verify must fail as a wrong password (PasswordInvalid), \
             not short-circuit with a Parse error — got: {wrong:?}"
        );

        assert_eq!(
            password_auth::verify_password(DUMMY_VERIFY_PASSWORD, dummy),
            Ok(()),
            "fixture password must round-trip against DUMMY_VERIFY_HASH"
        );
    }

    #[test]
    fn dummy_hash_is_full_argon2id_phc() {
        let dummy = DUMMY_VERIFY_HASH.as_str();
        assert!(
            dummy.starts_with("$argon2id$"),
            "DUMMY_VERIFY_HASH must be an Argon2id PHC string, got: {dummy:?}"
        );
    }

    #[test]
    fn check_password_reports_mismatch_as_ok_false_not_err() {
        let hash = password_auth::generate_hash("correct-horse-battery");
        assert!(matches!(
            AuthBackend::check_password("correct-horse-battery".to_string(), &hash),
            Ok(true)
        ));
        let wrong = AuthBackend::check_password("wrong-password".to_string(), &hash);
        assert!(
            matches!(wrong, Ok(false)),
            "a wrong password must surface as Ok(false) — Err propagates into the login handler's 500 'Authentication error' arm, got: {wrong:?}"
        );
        // An unusable hash is also just "did not verify", not an internal error.
        assert!(matches!(
            AuthBackend::check_password("x".to_string(), "not-a-hash"),
            Ok(false)
        ));
    }

    // --- W8e durable session binding ------------------------------------------

    async fn mem_db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectOptions, Database};
        let mut opt = ConnectOptions::new("sqlite::memory:".to_string());
        opt.max_connections(1);
        let db = Database::connect(opt).await.unwrap();
        db.execute_unprepared(
            r#"CREATE TABLE "user_sessions" (
                "id" INTEGER PRIMARY KEY AUTOINCREMENT,
                "user_id" INTEGER NOT NULL,
                "device" TEXT,
                "ip_address" TEXT,
                "last_seen" TEXT NOT NULL,
                "revoked_at" TEXT
            )"#,
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "CREATE TABLE auth_session_binding (\
             tower_session_id TEXT PRIMARY KEY, \
             user_session_id INTEGER NOT NULL, \
             created_at INTEGER NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "CREATE UNIQUE INDEX idx_auth_session_binding_user \
             ON auth_session_binding (user_session_id)",
        )
        .await
        .unwrap();
        db
    }

    async fn backend(
        db: &sea_orm::DatabaseConnection,
    ) -> (
        AuthBackend,
        std::sync::Arc<crate::services::session_store::SqliteSessionStore>,
    ) {
        use std::collections::HashSet;
        let store = std::sync::Arc::new(
            crate::services::session_store::SqliteSessionStore::new(db.clone()).await,
        );
        let revoked = std::sync::Arc::new(std::sync::Mutex::new(HashSet::<String>::new()));
        (AuthBackend::new(db, store.clone(), revoked), store)
    }

    #[tokio::test]
    async fn binding_record_lookup_replace_clear_roundtrip() {
        let db = mem_db().await;
        let (b, _store) = backend(&db).await;

        b.record_session_mapping(&db, 10, "t1").await.unwrap();
        assert_eq!(b.lookup_session_mapping_by_tower(&db, "t1").await, Some(10));
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "missing").await,
            None
        );

        // cycle_id rotation: same audit row, new opaque tower id; old tower cleared.
        b.replace_session_mapping(&db, 10, "t1", "t2")
            .await
            .unwrap();
        assert_eq!(b.lookup_session_mapping_by_tower(&db, "t2").await, Some(10));
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "t1").await,
            None,
            "old tower must be cleared after rotate"
        );

        b.clear_session_mapping(&db, "t2").await.unwrap();
        assert_eq!(b.lookup_session_mapping_by_tower(&db, "t2").await, None);
    }

    #[tokio::test]
    async fn binding_record_second_tower_for_same_audit_row_fails_closed() {
        // The UNIQUE(user_session_id) index must keep exactly one live tower per
        // audit row. A direct second INSERT bypassing replace() surfaces as a
        // constraint error → record returns Err (fail-closed), never silently OK.
        let db = mem_db().await;
        let (b, _store) = backend(&db).await;
        b.record_session_mapping(&db, 20, "a").await.unwrap();
        // 'a' is a fresh tower id, so this UPSERTs; but the user_session_id 20
        // already has a row and the ON CONFLICT(tower_session_id) clause does not
        // fire (tower differs) → the UNIQUE(user_session_id) index rejects it.
        let err = b.record_session_mapping(&db, 20, "b").await;
        assert!(
            err.is_err(),
            "second tower for one audit row must fail closed"
        );
    }

    // W8e durable termination: terminating an OTHER session by audit id must clear
    // that audit row's binding on the auth_session_binding (m000004) table and leave
    // the CURRENT session's binding untouched. The m000004 round-trip (write →
    // forward-lookup → clear) is what makes termination survive a restart — the
    // tower-session store is volatile, but the audit row ↔ tower-id binding is
    // durable, so a reboot reconcile can still resolve and reap the live record.
    #[tokio::test]
    async fn terminate_other_session_clears_its_binding_and_keeps_current_intact() {
        use sea_orm::{DatabaseBackend, Statement, Value};
        let db = mem_db().await;
        let now = "2026-01-01T00:00:00+00:00";
        // Two live audit rows for the same user: id=1 is the CURRENT session,
        // id=2 is another device. Both have durable bindings on m000004.
        db.execute_unprepared(
            "INSERT INTO \"user_sessions\" (id, user_id, last_seen, revoked_at) VALUES \
             (1, 100, '2026-01-01T00:00:00+00:00', NULL), \
             (2, 100, '2026-01-01T00:00:00+00:00', NULL)",
        )
        .await
        .unwrap();
        let (b, _store) = backend(&db).await;
        b.record_session_mapping(&db, 1, "tower-current")
            .await
            .unwrap();
        b.record_session_mapping(&db, 2, "tower-other")
            .await
            .unwrap();

        // Terminate the OTHER session by audit id, mirroring sessions_terminate:
        // forward-lookup the bound tower id, revoke the audit row, clear the binding.
        let other_tower = b.lookup_tower_by_audit_id(&db, 2).await;
        assert_eq!(
            other_tower.as_deref(),
            Some("tower-other"),
            "m000004 forward lookup must resolve the bound tower id"
        );
        let other_tower = other_tower.unwrap();
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
            vec![Value::from(now), Value::from(2)],
        ))
        .await
        .unwrap();
        b.clear_session_mapping(&db, &other_tower).await.unwrap();

        // OTHER: durable binding cleared and audit row revoked.
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 2).await,
            None,
            "terminated other session must have its m000004 binding cleared"
        );
        let ra2: Option<String> = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT revoked_at FROM user_sessions WHERE id = 2",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        assert!(
            ra2.is_some(),
            "terminated other session audit row must be revoked"
        );

        // CURRENT: binding intact and audit row still live — not terminatable by
        // accident when another session is revoked.
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 1).await.as_deref(),
            Some("tower-current"),
            "current session binding must survive terminating another session"
        );
        let ra1: Option<String> = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT revoked_at FROM user_sessions WHERE id = 1",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        assert!(
            ra1.is_none(),
            "current session must stay live (not revoked by accident)"
        );
    }

    // Spec scenario: durable current-vs-other termination AFTER a cycle_id()
    // rotation (the post-2FA/passkey re-auth path). The audit row is unchanged;
    // only the opaque tower id moves old→new via replace_session_mapping. A later
    // sessions_terminate must resolve the NEW tower id and reap it, and the OLD
    // tower id must no longer resolve (it was evicted by replace).
    #[tokio::test]
    async fn rotation_then_terminate_via_new_tower_old_no_longer_resolves() {
        use sea_orm::{DatabaseBackend, Statement, Value};
        let db = mem_db().await;
        let now = "2026-01-01T00:00:00+00:00";
        db.execute_unprepared(
            "INSERT INTO \"user_sessions\" (id, user_id, last_seen, revoked_at) VALUES \
             (7, 100, '2026-01-01T00:00:00+00:00', NULL)",
        )
        .await
        .unwrap();
        let (b, _store) = backend(&db).await;

        // 1. Login: bind audit row 7 → "pre-rotation" tower id.
        b.record_session_mapping(&db, 7, "pre-rotation")
            .await
            .unwrap();
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 7).await.as_deref(),
            Some("pre-rotation"),
        );

        // 2. cycle_id() rotation (2FA/passkey): same audit row, new tower id.
        b.replace_session_mapping(&db, 7, "pre-rotation", "post-rotation")
            .await
            .unwrap();

        // OLD tower id no longer resolves; the NEW tower id owns audit row 7.
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "pre-rotation").await,
            None,
            "old tower id must not resolve after cycle_id rotation",
        );
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 7).await.as_deref(),
            Some("post-rotation"),
            "new tower id must be bound to the audit row post-rotation",
        );

        // 3. Terminate the session via the NEW tower id — the only id that
        //    resolves — mirroring sessions_terminate on a post-rotation session.
        let live_tower = b.lookup_tower_by_audit_id(&db, 7).await.unwrap();
        assert_eq!(live_tower, "post-rotation");
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
            vec![Value::from(now), Value::from(7)],
        ))
        .await
        .unwrap();
        b.clear_session_mapping(&db, &live_tower).await.unwrap();

        // Post-termination: both tower ids are dead, audit row revoked.
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "post-rotation")
                .await,
            None,
            "terminated session's new tower binding must be cleared",
        );
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "pre-rotation").await,
            None,
            "pre-rotation tower id stays dead after termination",
        );
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 7).await,
            None,
            "audit row 7 must have no live tower binding after termination",
        );
        let ra: Option<String> = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT revoked_at FROM user_sessions WHERE id = 7",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        assert!(
            ra.is_some(),
            "rotated+terminated session audit row must be revoked"
        );
    }

    // Cross-RESTART guarantee: a true multi-process restart is impractical in a
    // unit test, so this asserts the PROPERTY that makes termination survive a
    // reboot — the binding is persisted to the auth_session_binding (m000004)
    // TABLE, never held in an in-memory cache. Every lookup_* / record / clear /
    // replace method issues a fresh SQL statement against the table, so a
    // brand-new AuthBackend with ZERO shared in-memory state (empty revoked set,
    // fresh session_store — i.e. a rebooted process) resolves the binding purely
    // from durable storage. A direct table read-back after the writer is dropped
    // is therefore the cross-restart proof.
    #[tokio::test]
    async fn binding_survives_simulated_restart_via_table_readback() {
        use sea_orm::{DatabaseBackend, Statement, Value};
        let db = mem_db().await;
        db.execute_unprepared(
            "INSERT INTO \"user_sessions\" (id, user_id, last_seen, revoked_at) VALUES \
             (42, 100, '2026-01-01T00:00:00+00:00', NULL)",
        )
        .await
        .unwrap();

        // Process A: record the binding at login, then "exit".
        let (a, _store_a) = backend(&db).await;
        a.record_session_mapping(&db, 42, "tower-A").await.unwrap();
        drop(a);

        // The binding is in the TABLE, not in any backend-owned cache — prove it
        // by reading the row straight off auth_session_binding after the writer
        // is gone.
        let persisted_tower: String = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT tower_session_id FROM auth_session_binding WHERE user_session_id = ?",
                vec![Value::from(42)],
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get_by_index(0)
            .unwrap();
        assert_eq!(persisted_tower, "tower-A");

        // Process B: freshly-booted AuthBackend shares NO in-memory state with A
        // (empty revoked set, new session_store). It resolves the binding purely
        // by reading the table — exactly what a rebooted process does.
        let (b, _store_b) = backend(&db).await;
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 42).await.as_deref(),
            Some("tower-A"),
            "fresh process must resolve the durable binding from the table",
        );
        assert_eq!(
            b.lookup_session_mapping_by_tower(&db, "tower-A").await,
            Some(42),
            "fresh process must resolve the reverse mapping from the table",
        );

        // The fresh process can terminate the session by audit id — the
        // cross-restart termination path a boot reconcile relies on.
        let tower = b.lookup_tower_by_audit_id(&db, 42).await.unwrap();
        b.clear_session_mapping(&db, &tower).await.unwrap();
        assert_eq!(
            b.lookup_tower_by_audit_id(&db, 42).await,
            None,
            "fresh process can terminate the binding it resolved from the table",
        );
    }

    #[tokio::test]
    async fn reconcile_revokes_unbound_and_cleans_orphan_bindings() {
        use sea_orm::{DatabaseBackend, Statement, Value};
        let db = mem_db().await;
        let now = "2026-01-01T00:00:00+00:00";
        // row 1: live + bound  (survives)
        // row 2: live + unbound (revoked by reconcile)
        // row 3: revoked + orphan binding (binding reaped)
        db.execute_unprepared(&format!(
            "INSERT INTO \"user_sessions\" (id, user_id, last_seen, revoked_at) VALUES \
             (1, 100, '{now}', NULL), \
             (2, 100, '{now}', NULL), \
             (3, 100, '{now}', '{now}')"
        ))
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO auth_session_binding (tower_session_id, user_session_id, created_at) \
             VALUES ('t1', 1, 0), ('t3', 3, 0)",
        )
        .await
        .unwrap();

        let (b, store) = backend(&db).await;
        let count = b.reconcile_unbound_sessions(&db, store).await.unwrap();
        assert_eq!(
            count, 1,
            "only the live unbound row (id=2) is newly revoked"
        );

        let r2 = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT revoked_at FROM user_sessions WHERE id = 2",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .unwrap();
        let ra2: Option<String> = r2.try_get_by_index(0).unwrap();
        assert!(ra2.is_some(), "unbound live session must be revoked");

        let r1 = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT revoked_at FROM user_sessions WHERE id = 1",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .unwrap();
        let ra1: Option<String> = r1.try_get_by_index(0).unwrap();
        assert!(ra1.is_none(), "bound live session must stay live");

        let bindings: Vec<String> = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT tower_session_id FROM auth_session_binding",
                Vec::<Value>::new(),
            ))
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.try_get_by_index::<String>(0).unwrap())
            .collect();
        assert!(
            bindings.contains(&"t1".to_string()),
            "row1 binding must survive"
        );
        assert!(
            !bindings.contains(&"t3".to_string()),
            "orphan binding for revoked row must be reaped"
        );

        // Re-running reconcile is a no-op (idempotent): nothing unbound remains.
        let (b2, store2) = backend(&db).await;
        let again = b2.reconcile_unbound_sessions(&db, store2).await.unwrap();
        assert_eq!(again, 0, "second reconcile revokes nothing new");
    }

    // W8e step 3: a pre-binding live AUTH tower session has no binding row, so
    // steps 1+2 cannot reach it by id. Reconcile must enumerate the session store
    // and forcibly delete it (the "one clean re-authentication boundary"), while
    // leaving an anonymous session and a bound auth session intact.
    #[tokio::test]
    async fn reconcile_forcibly_removes_unbound_live_auth_sessions_only() {
        use std::collections::HashMap;
        use std::str::FromStr;
        use tower_sessions::session::{Id, Record};
        use tower_sessions::SessionStore;

        async fn save_tower(
            store: &crate::services::session_store::SqliteSessionStore,
            id_val: i128,
            auth: bool,
        ) -> String {
            let mut data = HashMap::<String, serde_json::Value>::new();
            if auth {
                data.insert("rux_auth".to_string(), serde_json::json!({"user_id": 100}));
            } else {
                data.insert("csrf_issued".to_string(), serde_json::json!(true));
            }
            let rec = Record {
                id: Id(id_val),
                data,
                expiry_date: time::OffsetDateTime::now_utc() + time::Duration::weeks(2),
            };
            store.save(&rec).await.unwrap();
            Id(id_val).to_string()
        }

        let db = mem_db().await;
        // One LIVE audit row with a durable binding → its auth tower session survives.
        db.execute_unprepared(
            "INSERT INTO \"user_sessions\" (id, user_id, last_seen, revoked_at) VALUES \
             (1, 100, '2026-01-01T00:00:00+00:00', NULL)",
        )
        .await
        .unwrap();
        let (b, store) = backend(&db).await;

        // bound-auth: binding present → kept. unbound-auth: no binding → reaped.
        // anon: not an auth session (no rux_auth key) → kept.
        let bound_auth = save_tower(&store, 11_111, true).await;
        let unbound_auth = save_tower(&store, 22_222, true).await;
        let anon = save_tower(&store, 33_333, false).await;
        b.record_session_mapping(&db, 1, &bound_auth).await.unwrap();

        let count = b
            .reconcile_unbound_sessions(&db, store.clone())
            .await
            .unwrap();
        assert_eq!(count, 0, "no live unbound AUDIT rows in this scenario");

        // Unbound auth session was forcibly removed from the live store.
        let unbound_id = Id::from_str(&unbound_auth).unwrap();
        assert!(
            store.load(&unbound_id).await.unwrap().is_none(),
            "unbound live auth tower session must be forcibly removed by the sweep"
        );
        // Anonymous session preserved (CSRF continuity for logged-out visitors).
        let anon_id = Id::from_str(&anon).unwrap();
        assert!(
            store.load(&anon_id).await.unwrap().is_some(),
            "anonymous tower session must survive the unbound sweep"
        );
        // Bound auth session preserved.
        let bound_id = Id::from_str(&bound_auth).unwrap();
        assert!(
            store.load(&bound_id).await.unwrap().is_some(),
            "bound live auth tower session must survive"
        );

        // Removed tower id mirrored into the in-memory revocation set.
        let in_revoked = b
            .revoked
            .lock()
            .map(|s| s.contains(&unbound_auth))
            .unwrap_or(false);
        assert!(
            in_revoked,
            "removed unbound tower id must be in the revocation set"
        );

        // Idempotent: a second reconcile finds no unbound auth session to remove.
        let (b2, store2) = backend(&db).await;
        let _ = b2.reconcile_unbound_sessions(&db, store2).await.unwrap();
        assert!(
            store.load(&anon_id).await.unwrap().is_some(),
            "re-running reconcile must not touch anonymous sessions"
        );
        assert!(
            store.load(&bound_id).await.unwrap().is_some(),
            "re-running reconcile must not touch bound sessions"
        );
    }
}
