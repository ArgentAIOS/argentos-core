use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaneStatus {
    Idle,
    Pending,
    Active,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LaneState {
    pub name: String,
    pub status: LaneStatus,
    pub priority: u32,
    pub reason: Option<String>,
    pub requested_at_ms: Option<u64>,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub lease_expires_at_ms: Option<u64>,
    pub last_outcome: Option<String>,
}

impl LaneState {
    pub fn idle(name: &str) -> Self {
        Self {
            name: name.to_string(),
            status: LaneStatus::Idle,
            priority: 0,
            reason: None,
            requested_at_ms: None,
            started_at_ms: None,
            completed_at_ms: None,
            lease_expires_at_ms: None,
            last_outcome: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutiveState {
    pub schema_version: u32,
    pub boot_count: u64,
    pub last_seq: u64,
    pub tick_count: u64,
    pub active_lane: Option<String>,
    pub last_started_at_ms: u64,
    pub last_recovered_at_ms: Option<u64>,
    pub last_tick_at_ms: Option<u64>,
    pub next_tick_due_at_ms: u64,
    pub tick_interval_ms: u64,
    pub default_lease_ms: u64,
    pub lanes: BTreeMap<String, LaneState>,
}

impl ExecutiveState {
    pub fn new(now_ms: u64, tick_interval_ms: u64, default_lease_ms: u64) -> Self {
        let mut lanes = BTreeMap::new();
        for name in ["operator", "background", "maintenance"] {
            lanes.insert(name.to_string(), LaneState::idle(name));
        }

        Self {
            schema_version: 1,
            boot_count: 1,
            last_seq: 0,
            tick_count: 0,
            active_lane: None,
            last_started_at_ms: now_ms,
            last_recovered_at_ms: None,
            last_tick_at_ms: None,
            next_tick_due_at_ms: now_ms + tick_interval_ms,
            tick_interval_ms,
            default_lease_ms,
            lanes,
        }
    }
}
