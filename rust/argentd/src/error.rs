#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayErrorCode {
    InvalidRequest,
    Internal,
}

impl GatewayErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            GatewayErrorCode::InvalidRequest => "INVALID_REQUEST",
            GatewayErrorCode::Internal => "E_INTERNAL",
        }
    }
}
