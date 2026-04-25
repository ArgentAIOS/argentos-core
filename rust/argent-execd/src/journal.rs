use crate::state::{ExecutiveState, LaneState, LaneStatus};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExecutiveEvent {
    Booted {
        boot_count: u64,
    },
    Recovered {
        boot_count: u64,
        recovered_at_ms: u64,
    },
    Tick {
        tick_count: u64,
    },
    LaneRequested {
        lane: String,
        priority: u32,
        reason: Option<String>,
        lease_ms: u64,
    },
    LaneActivated {
        lane: String,
        lease_expires_at_ms: u64,
    },
    LaneReleased {
        lane: String,
        outcome: String,
    },
}

impl ExecutiveEvent {
    pub fn event_type_label(&self) -> &'static str {
        match self {
            ExecutiveEvent::Booted { .. } => "booted",
            ExecutiveEvent::Recovered { .. } => "recovered",
            ExecutiveEvent::Tick { .. } => "tick",
            ExecutiveEvent::LaneRequested { .. } => "lane_requested",
            ExecutiveEvent::LaneActivated { .. } => "lane_activated",
            ExecutiveEvent::LaneReleased { .. } => "lane_released",
        }
    }

    pub fn lane_name(&self) -> Option<String> {
        match self {
            ExecutiveEvent::LaneRequested { lane, .. }
            | ExecutiveEvent::LaneActivated { lane, .. }
            | ExecutiveEvent::LaneReleased { lane, .. } => Some(lane.clone()),
            ExecutiveEvent::Booted { .. }
            | ExecutiveEvent::Recovered { .. }
            | ExecutiveEvent::Tick { .. } => None,
        }
    }

    pub fn summary_text(&self) -> String {
        match self {
            ExecutiveEvent::Booted { boot_count } => format!("booted (boot #{boot_count})"),
            ExecutiveEvent::Recovered { boot_count, .. } => {
                format!("recovered (boot #{boot_count})")
            }
            ExecutiveEvent::Tick { tick_count } => format!("tick #{tick_count}"),
            ExecutiveEvent::LaneRequested {
                lane,
                priority,
                reason,
                lease_ms,
            } => format!(
                "lane {lane} requested (priority {priority}, lease {lease_ms}ms{})",
                reason
                    .as_deref()
                    .map(|value| format!(", reason {value}"))
                    .unwrap_or_default()
            ),
            ExecutiveEvent::LaneActivated {
                lane,
                lease_expires_at_ms,
            } => format!("lane {lane} activated (lease expires at {lease_expires_at_ms})"),
            ExecutiveEvent::LaneReleased { lane, outcome } => {
                format!("lane {lane} released ({outcome})")
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JournalRecord {
    pub seq: u64,
    pub at_ms: u64,
    pub event: ExecutiveEvent,
}

pub fn append_record(path: &Path, record: &JournalRecord) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    serde_json::to_writer(&mut file, record)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(())
}

pub fn load_records(path: &Path) -> io::Result<Vec<JournalRecord>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let record = serde_json::from_str::<JournalRecord>(trimmed)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        out.push(record);
    }
    Ok(out)
}

pub fn save_snapshot(path: &Path, state: &ExecutiveState) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("tmp");
    let mut file = File::create(&tmp_path)?;
    serde_json::to_writer_pretty(&mut file, state)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    file.write_all(b"\n")?;
    file.flush()?;
    fs::rename(tmp_path, path)?;
    Ok(())
}

pub fn load_snapshot(path: &Path) -> io::Result<Option<ExecutiveState>> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)?;
    let state = serde_json::from_str::<ExecutiveState>(&contents)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(Some(state))
}

pub fn apply_record(state: &mut ExecutiveState, record: &JournalRecord) {
    state.last_seq = record.seq;
    match &record.event {
        ExecutiveEvent::Booted { boot_count } => {
            state.boot_count = *boot_count;
        }
        ExecutiveEvent::Recovered {
            boot_count,
            recovered_at_ms,
        } => {
            state.boot_count = *boot_count;
            state.last_recovered_at_ms = Some(*recovered_at_ms);
        }
        ExecutiveEvent::Tick { tick_count } => {
            state.tick_count = *tick_count;
            state.last_tick_at_ms = Some(record.at_ms);
            state.next_tick_due_at_ms = record.at_ms + state.tick_interval_ms;
        }
        ExecutiveEvent::LaneRequested {
            lane,
            priority,
            reason,
            ..
        } => {
            let entry = state
                .lanes
                .entry(lane.clone())
                .or_insert_with(|| LaneState::idle(lane));
            entry.name = lane.clone();
            entry.status = LaneStatus::Pending;
            entry.priority = *priority;
            entry.reason = reason.clone();
            entry.requested_at_ms = Some(record.at_ms);
        }
        ExecutiveEvent::LaneActivated {
            lane,
            lease_expires_at_ms,
        } => {
            let entry = state
                .lanes
                .entry(lane.clone())
                .or_insert_with(|| LaneState::idle(lane));
            entry.name = lane.clone();
            entry.status = LaneStatus::Active;
            entry.started_at_ms = Some(record.at_ms);
            entry.lease_expires_at_ms = Some(*lease_expires_at_ms);
            state.active_lane = Some(lane.clone());
        }
        ExecutiveEvent::LaneReleased { lane, outcome } => {
            let entry = state
                .lanes
                .entry(lane.clone())
                .or_insert_with(|| LaneState::idle(lane));
            entry.name = lane.clone();
            entry.status = LaneStatus::Idle;
            entry.completed_at_ms = Some(record.at_ms);
            entry.lease_expires_at_ms = None;
            entry.last_outcome = Some(outcome.clone());
            entry.reason = None;
            entry.priority = 0;
            entry.requested_at_ms = None;
            if state.active_lane.as_deref() == Some(lane.as_str()) {
                state.active_lane = None;
            }
        }
    }
}
