use crate::error::{DbResult, ErrorCode, ErrorResponse};
use chrono::Utc;
use ruxlog_types::PaginatedList;
use sea_orm::{entity::prelude::*, IntoActiveModel, Order, QueryOrder, Set};

use super::*;

const ADMIN_PER_PAGE: u64 = 20;

impl Entity {
    pub async fn create<T: ConnectionTrait>(
        conn: &T,
        user_id: i32,
        code_hash: String,
    ) -> DbResult<Model> {
        let now = Utc::now().fixed_offset();
        let verification = ActiveModel {
            user_id: Set(user_id),
            code_hash: Set(code_hash),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };

        match verification.insert(conn).await {
            Ok(model) => Ok(model),
            Err(err) => Err(err.into()),
        }
    }

    pub async fn find_by_user_id_or_code(
        conn: &DbConn,
        user_id: Option<i32>,
        code_hash: Option<String>,
    ) -> DbResult<Model> {
        if user_id.is_none() && code_hash.is_none() {
            return Err(ErrorResponse::new(ErrorCode::InvalidInput)
                .with_message("Either user_id or code must be provided"));
        }

        let mut query = Self::find();

        if let Some(user_id) = user_id {
            query = query.filter(Column::UserId.eq(user_id));
        }
        if let Some(code_hash) = code_hash {
            query = query.filter(Column::CodeHash.eq(code_hash));
        }

        match query.one(conn).await {
            Ok(Some(result)) => Ok(result),
            Ok(None) => Err(ErrorResponse::new(ErrorCode::InvalidInput)
                .with_message("The provided verification code is invalid")),
            Err(err) => Err(err.into()),
        }
    }

    pub async fn regenerate(conn: &DbConn, user_id: i32, code_hash: String) -> DbResult<Model> {
        let now = Utc::now().fixed_offset();

        // Find-then-update-or-insert (mirrors forgot_password::regenerate): the
        // INSERT .. ON CONFLICT ("user_id") DO UPDATE upsert compiles on SQLite
        // only with the UNIQUE index (m000006) AND its exec_with_returning cannot
        // fetch the row on the update path ("Failed to find inserted item"). The
        // unique index from m000006 guards the insert race this shape would have.
        let existing = Self::find()
            .filter(Column::UserId.eq(user_id))
            .one(conn)
            .await;

        match existing {
            Ok(Some(existing_model)) => {
                let mut active_model: ActiveModel = existing_model.into_active_model();
                active_model.code_hash = Set(code_hash);
                active_model.updated_at = Set(now);

                match active_model.update(conn).await {
                    Ok(model) => Ok(model),
                    Err(err) => Err(err.into()),
                }
            }
            Ok(None) => Self::create(conn, user_id, code_hash).await,
            Err(err) => Err(err.into()),
        }
    }

    pub async fn consume(conn: &DbConn, user_id: i32) -> DbResult<u64> {
        match Self::delete_many()
            .filter(Column::UserId.eq(user_id))
            .exec(conn)
            .await
        {
            Ok(res) => Ok(res.rows_affected),
            Err(err) => Err(err.into()),
        }
    }

    pub async fn admin_query(
        conn: &DbConn,
        query: &AdminEmailVerificationQuery,
    ) -> DbResult<PaginatedList<Model>> {
        let mut db_query = Self::find();

        if let Some(user_id) = query.user_id {
            db_query = db_query.filter(Column::UserId.eq(user_id));
        }

        if let Some(code_hash) = &query.code_hash {
            db_query = db_query.filter(Column::CodeHash.eq(code_hash));
        }

        if let Some(created_at) = query.created_at {
            db_query = db_query.filter(Column::CreatedAt.gte(created_at));
        }

        if let Some(updated_at) = query.updated_at {
            db_query = db_query.filter(Column::UpdatedAt.gte(updated_at));
        }

        if let (Some(sort_by), Some(sort_order)) = (&query.sort_by, &query.sort_order) {
            for field in sort_by {
                let order = if sort_order == "asc" {
                    Order::Asc
                } else {
                    Order::Desc
                };

                match field.as_str() {
                    "id" => db_query = db_query.order_by(Column::Id, order),
                    "user_id" => db_query = db_query.order_by(Column::UserId, order),
                    "code_hash" => db_query = db_query.order_by(Column::CodeHash, order),
                    "created_at" => db_query = db_query.order_by(Column::CreatedAt, order),
                    "updated_at" => db_query = db_query.order_by(Column::UpdatedAt, order),
                    _ => {}
                }
            }
        } else {
            db_query = db_query.order_by(Column::Id, Order::Desc);
        }

        let page = match query.page_no {
            Some(p) if p > 0 => p as u64,
            _ => 1,
        };

        let paginator = db_query.paginate(conn, ADMIN_PER_PAGE);

        match paginator.num_items().await {
            Ok(total) => match paginator.fetch_page(page - 1).await {
                Ok(results) => Ok(PaginatedList::new(results, total, page, ADMIN_PER_PAGE)),
                Err(err) => Err(err.into()),
            },
            Err(err) => Err(err.into()),
        }
    }
}
