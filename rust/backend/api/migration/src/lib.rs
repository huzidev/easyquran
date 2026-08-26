pub use sea_orm_migration::prelude::*;

mod m000001_init;
mod m000002_rate_limit_state;
mod m000003_translation_popularity;
mod m000004_auth_session_binding;
mod m000005_device_notification_oauth;
mod m000006_email_code_unique_user;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m000001_init::Migration),
            Box::new(m000002_rate_limit_state::Migration),
            Box::new(m000003_translation_popularity::Migration),
            // m000004 ships AFTER m000003; additive (new table only), so an old
            // binary rolled back across this migration simply ignores the table.
            Box::new(m000004_auth_session_binding::Migration),
            // m000005 backfills tables the device/notification/OAuth code paths
            // always wrote but no migration owned; IF NOT EXISTS keeps any
            // out-of-band-provisioned DB that already has them untouched.
            Box::new(m000005_device_notification_oauth::Migration),
            // m000006 adds the missing UNIQUE(user_id) on email_verifications —
            // without it the regenerate() upsert fails at prepare time in SQLite
            // (surfaced as DB_003 "Duplicate entry" on resend) — and enforces the
            // same 1:1 invariant on forgot_passwords.
            Box::new(m000006_email_code_unique_user::Migration),
        ]
    }
}
