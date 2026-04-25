use serde::{Deserialize, Serialize};

pub const DEFAULT_BIND_ADDR: &str = "127.0.0.1:18809";
pub const COMPONENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_TICK_INTERVAL_MS: u64 = 5_000;
pub const DEFAULT_LANE_LEASE_MS: u64 = 30_000;
pub const DEFAULT_STATE_DIR_SUFFIX: &str = ".argentos/runtime/argent-execd-shadow";
pub const SNAPSHOT_FILE_NAME: &str = "executive-state.json";
pub const JOURNAL_FILE_NAME: &str = "executive.journal.jsonl";
pub const ACCEPT_LOOP_IDLE_MS: u64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LaneRequestPayload {
    pub lane: String,
    pub priority: Option<u32>,
    pub reason: Option<String>,
    #[serde(rename = "leaseMs")]
    pub lease_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LaneReleasePayload {
    pub lane: String,
    pub outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TickPayload {
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ShutdownPayload {
    pub reason: Option<String>,
}
