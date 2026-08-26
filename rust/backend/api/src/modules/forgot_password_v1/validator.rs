use serde::{Deserialize, Serialize};
use validator::Validate;

// CODE_LEN must match the code generator (6 numeric digits); PASSWORD_MIN must match the auth password floor (desync silently breaks verify / reset).
const CODE_LEN: u64 = 6;
const PASSWORD_MIN: u64 = 12;
const PASSWORD_MAX: u64 = 256;

#[derive(Debug, Deserialize, Serialize, Validate)]
pub struct V1GeneratePayload {
    #[validate(email)]
    pub email: String,
}

#[derive(Debug, Deserialize, Serialize, Validate)]
pub struct V1VerifyPayload {
    #[validate(length(min = CODE_LEN, max = CODE_LEN))]
    pub code: String,
    #[validate(email)]
    pub email: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct V1VerifyResponse {
    pub reset_token: String,
}

#[derive(Debug, Deserialize, Serialize, Validate)]
pub struct V1ResetPayload {
    #[validate(length(min = 1))]
    pub reset_token: String,
    #[validate(length(min = PASSWORD_MIN, max = PASSWORD_MAX))]
    pub password: String,
    #[validate(length(min = PASSWORD_MIN, max = PASSWORD_MAX))]
    pub confirm_password: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    const STRONG_PW: &str = "sup3rstr0ngpw!";

    #[test]
    fn reset_payload_rejects_legacy_code_only_request() {
        let raw = serde_json::json!({
            "code": "12345678",
            "email": "victim@example.com",
            "password": STRONG_PW,
            "confirm_password": STRONG_PW,
        });
        let err = serde_json::from_value::<V1ResetPayload>(raw).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("reset_token"),
            "expected missing-field error for reset_token, got: {msg}"
        );
    }

    #[test]
    fn reset_payload_rejects_empty_token() {
        let payload = V1ResetPayload {
            reset_token: String::new(),
            password: STRONG_PW.to_string(),
            confirm_password: STRONG_PW.to_string(),
        };
        assert!(
            payload.validate().is_err(),
            "empty reset_token must fail validation"
        );
    }

    #[test]
    fn reset_payload_accepts_valid_token() {
        let payload = V1ResetPayload {
            reset_token: "deadbeefcafebabe".to_string(),
            password: STRONG_PW.to_string(),
            confirm_password: STRONG_PW.to_string(),
        };
        assert!(
            payload.validate().is_ok(),
            "a valid token + strong password must validate"
        );
    }

    #[test]
    fn reset_payload_rejects_short_password() {
        let payload = V1ResetPayload {
            reset_token: "deadbeefcafebabe".to_string(),
            password: "short".to_string(),
            confirm_password: "short".to_string(),
        };
        assert!(
            payload.validate().is_err(),
            "short passwords must fail validation"
        );
    }

    #[test]
    fn reset_payload_extra_code_field_does_not_supply_token() {
        let raw = serde_json::json!({
            "code": "12345678",
            "email": "victim@example.com",
            "reset_token": "",
            "password": STRONG_PW,
            "confirm_password": STRONG_PW,
        });
        let payload = serde_json::from_value::<V1ResetPayload>(raw).unwrap();
        assert!(
            payload.validate().is_err(),
            "empty reset_token must fail even if code is present"
        );
    }

    #[test]
    fn reset_payload_max_length_password_validates() {
        let long = "a".repeat(PASSWORD_MAX as usize);
        let payload = V1ResetPayload {
            reset_token: "deadbeefcafebabe".to_string(),
            password: long.clone(),
            confirm_password: long,
        };
        assert!(
            payload.validate().is_ok(),
            "a 256-char password (PASSWORD_MAX) must validate"
        );
    }

    #[test]
    fn reset_payload_over_max_password_rejected() {
        let over = "a".repeat((PASSWORD_MAX + 1) as usize);
        let payload = V1ResetPayload {
            reset_token: "deadbeefcafebabe".to_string(),
            password: over.clone(),
            confirm_password: over,
        };
        assert!(
            payload.validate().is_err(),
            "passwords longer than PASSWORD_MAX must be rejected (CWE-400)"
        );
    }

    #[test]
    fn reset_payload_over_max_confirm_password_rejected() {
        let payload = V1ResetPayload {
            reset_token: "deadbeefcafebabe".to_string(),
            password: STRONG_PW.to_string(),
            confirm_password: "a".repeat((PASSWORD_MAX + 1) as usize),
        };
        assert!(payload.validate().is_err());
    }
}
