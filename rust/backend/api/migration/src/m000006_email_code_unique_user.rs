use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

// email_verifications.regenerate() issues INSERT .. ON CONFLICT ("user_id") DO
// UPDATE, but m000001 never created a UNIQUE index on user_id — SQLite rejects
// the statement ("ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
// constraint"), which surfaced as DB_003 "Duplicate entry" on every verification
// resend after the first. forgot_passwords.regenerate() dodges this with a
// find-then-update, but the 1:1 row-per-user invariant was equally unenforced.
//
// Both tables get UNIQUE(user_id). Deduplicate first (keep the newest row per
// user) so an existing DB with stray duplicates — possible for forgot_passwords
// via its find-then-insert race — migrates cleanly.

const DEDUPE_EMAIL_VERIFICATIONS: &str = "DELETE FROM email_verifications WHERE id NOT IN \
     (SELECT MAX(id) FROM email_verifications GROUP BY user_id)";

const DEDUPE_FORGOT_PASSWORDS: &str = "DELETE FROM forgot_passwords WHERE id NOT IN \
     (SELECT MAX(id) FROM forgot_passwords GROUP BY user_id)";

const CREATE_EMAIL_VERIFICATIONS_INDEX: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verifications_user \
     ON email_verifications (user_id)";

const CREATE_FORGOT_PASSWORDS_INDEX: &str =
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_forgot_passwords_user \
     ON forgot_passwords (user_id)";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared(DEDUPE_EMAIL_VERIFICATIONS).await?;
        conn.execute_unprepared(DEDUPE_FORGOT_PASSWORDS).await?;
        conn.execute_unprepared(CREATE_EMAIL_VERIFICATIONS_INDEX)
            .await?;
        conn.execute_unprepared(CREATE_FORGOT_PASSWORDS_INDEX)
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS idx_email_verifications_user")
            .await?;
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX IF EXISTS idx_forgot_passwords_user")
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectOptions, Database, Statement};
    use sea_orm_migration::SchemaManager;

    async fn mem_db() -> sea_orm::DatabaseConnection {
        let mut opt = ConnectOptions::new("sqlite::memory:".to_string());
        opt.max_connections(1);
        Database::connect(opt).await.unwrap()
    }

    async fn create_fixture_table(db: &sea_orm::DatabaseConnection) {
        db.execute_unprepared(
            "CREATE TABLE email_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, \
             user_id INTEGER NOT NULL, code_hash TEXT NOT NULL, \
             created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        )
        .await
        .unwrap();
    }

    async fn user_rows(db: &sea_orm::DatabaseConnection) -> Vec<(i32, i32)> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT id, user_id FROM email_verifications ORDER BY id",
            ))
            .await
            .unwrap();
        rows.into_iter()
            .map(|r| {
                (
                    r.try_get_by_index::<i32>(0).unwrap(),
                    r.try_get_by_index::<i32>(1).unwrap(),
                )
            })
            .collect()
    }

    #[tokio::test]
    async fn dedupes_and_creates_unique_index() {
        let db = mem_db().await;
        create_fixture_table(&db).await;
        db.execute_unprepared(
            "INSERT INTO email_verifications (user_id, code_hash) VALUES (1,'a'), (1,'b'), (2,'c')",
        )
        .await
        .unwrap();

        let mgr = SchemaManager::new(&db);
        // The email_verifications statements run before the forgot_passwords ones; give
        // the second table an empty fixture so its dedupe/index statements succeed.
        db.execute_unprepared(
            "CREATE TABLE forgot_passwords (id INTEGER PRIMARY KEY AUTOINCREMENT, \
             user_id INTEGER NOT NULL, code_hash TEXT NOT NULL, \
             created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        )
        .await
        .unwrap();

        Migration.up(&mgr).await.unwrap();

        let rows = user_rows(&db).await;
        assert_eq!(rows.len(), 2, "one row per user_id after dedupe: {rows:?}");
        assert_eq!(rows[0], (2, 1), "keeps the newest row for user 1");
        assert_eq!(rows[1], (3, 2));

        let dup = db
            .execute_unprepared(
                "INSERT INTO email_verifications (user_id, code_hash) VALUES (1,'d')",
            )
            .await;
        assert!(
            dup.is_err(),
            "unique index on user_id must reject a second row for a user"
        );
    }

    #[tokio::test]
    async fn migration_is_idempotent() {
        let db = mem_db().await;
        create_fixture_table(&db).await;
        db.execute_unprepared(
            "CREATE TABLE forgot_passwords (id INTEGER PRIMARY KEY AUTOINCREMENT, \
             user_id INTEGER NOT NULL, code_hash TEXT NOT NULL, \
             created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, \
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        )
        .await
        .unwrap();

        let mgr = SchemaManager::new(&db);
        Migration.up(&mgr).await.unwrap();
        Migration.up(&mgr).await.unwrap();
    }
}
