pub const DEFAULT_BIND_ADDR: &str = "127.0.0.1:18799";
pub const COMPONENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PROTOCOL_VERSION: u64 = 3;
pub const MAX_PAYLOAD_BYTES: u64 = 1_048_576;
pub const MAX_BUFFERED_BYTES: u64 = 1_048_576;
pub const TICK_INTERVAL_MS: u64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealthStatus {
    pub uptime_seconds: u64,
}

impl HealthStatus {
    pub fn to_json(&self) -> String {
        format!(
            "{{\"status\":\"ok\",\"uptimeSeconds\":{},\"version\":\"{}\",\"component\":\"argentd\",\"mode\":\"shadow\",\"protocolVersion\":{},\"liveAuthority\":\"node\",\"gatewayAuthority\":\"shadow-only\",\"readiness\":{{\"promotionReady\":false,\"reason\":\"shadow parity evidence incomplete\"}},\"capabilities\":{{\"httpHealth\":true,\"websocketRpc\":true,\"statePersistence\":\"memory-only\",\"schedulerAuthority\":false,\"workflowAuthority\":false,\"channelAuthority\":false,\"sessionAuthority\":false,\"runAuthority\":false}}}}",
            self.uptime_seconds, COMPONENT_VERSION, PROTOCOL_VERSION
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectRequest {
    pub id: String,
    pub token: String,
    pub subscriptions: Vec<String>,
    pub min_protocol: u64,
    pub max_protocol: u64,
    pub client_id: String,
    pub client_display_name: Option<String>,
    pub client_mode: String,
    pub client_version: String,
    pub client_platform: String,
    pub client_instance_id: Option<String>,
}
