use crate::contracts::{
    DEFAULT_LANE_LEASE_MS, DEFAULT_STATE_DIR_SUFFIX, DEFAULT_TICK_INTERVAL_MS, JOURNAL_FILE_NAME,
    SNAPSHOT_FILE_NAME,
};
use crate::journal::{
    append_record, apply_record, load_records, load_snapshot, save_snapshot, ExecutiveEvent,
    JournalRecord,
};
use crate::scheduler::plan_tick;
use crate::state::{ExecutiveState, LaneStatus};
use serde::Serialize;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub bind_addr: String,
    pub state_dir: PathBuf,
    pub tick_interval_ms: u64,
    pub default_lease_ms: u64,
}

impl RuntimeConfig {
    pub fn from_env(bind_addr: &str) -> Self {
        Self {
            bind_addr: bind_addr.to_string(),
            state_dir: resolve_state_dir(),
            tick_interval_ms: env::var("ARGENT_EXECD_TICK_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_TICK_INTERVAL_MS),
            default_lease_ms: env::var("ARGENT_EXECD_DEFAULT_LEASE_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_LANE_LEASE_MS),
        }
    }

    pub fn snapshot_path(&self) -> PathBuf {
        self.state_dir.join(SNAPSHOT_FILE_NAME)
    }

    pub fn journal_path(&self) -> PathBuf {
        self.state_dir.join(JOURNAL_FILE_NAME)
    }
}

#[derive(Debug)]
pub struct ExecutiveRuntime {
    pub config: RuntimeConfig,
    pub state: ExecutiveState,
    pub started_at: Instant,
    pub journal_event_count: u64,
}

#[derive(Debug, Serialize)]
pub struct HealthPayload {
    pub status: String,
    #[serde(rename = "uptimeSeconds")]
    pub uptime_seconds: u64,
    #[serde(rename = "bootCount")]
    pub boot_count: u64,
    #[serde(rename = "tickCount")]
    pub tick_count: u64,
    #[serde(rename = "activeLane")]
    pub active_lane: Option<String>,
    #[serde(rename = "journalEventCount")]
    pub journal_event_count: u64,
    #[serde(rename = "stateDir")]
    pub state_dir: String,
    #[serde(rename = "nextTickDueAtMs")]
    pub next_tick_due_at_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct StatePayload<'a> {
    pub config: StateConfigPayload<'a>,
    pub state: &'a ExecutiveState,
}

#[derive(Debug, Serialize)]
pub struct StateConfigPayload<'a> {
    #[serde(rename = "bindAddr")]
    pub bind_addr: &'a str,
    #[serde(rename = "stateDir")]
    pub state_dir: String,
}

#[derive(Debug, Serialize)]
pub struct MetricsPayload {
    #[serde(rename = "activeLane")]
    pub active_lane: Option<String>,
    #[serde(rename = "laneCounts")]
    pub lane_counts: LaneCountsPayload,
    #[serde(rename = "bootCount")]
    pub boot_count: u64,
    #[serde(rename = "tickCount")]
    pub tick_count: u64,
    #[serde(rename = "journalEventCount")]
    pub journal_event_count: u64,
    #[serde(rename = "nextTickDueAtMs")]
    pub next_tick_due_at_ms: u64,
    #[serde(rename = "lastTickAtMs")]
    pub last_tick_at_ms: Option<u64>,
    #[serde(rename = "lastRecoveredAtMs")]
    pub last_recovered_at_ms: Option<u64>,
    #[serde(rename = "nextLeaseExpiryAtMs")]
    pub next_lease_expiry_at_ms: Option<u64>,
    #[serde(rename = "highestPendingPriority")]
    pub highest_pending_priority: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct LaneCountsPayload {
    pub idle: usize,
    pub pending: usize,
    pub active: usize,
}

#[derive(Debug, Serialize)]
pub struct TimelineEventPayload {
    pub seq: u64,
    #[serde(rename = "atMs")]
    pub at_ms: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub lane: Option<String>,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct TimelineCountsPayload {
    pub booted: usize,
    pub recovered: usize,
    pub tick: usize,
    pub lane_requested: usize,
    pub lane_activated: usize,
    pub lane_released: usize,
}

#[derive(Debug, Serialize)]
pub struct TimelineSummaryPayload {
    #[serde(rename = "activeLane")]
    pub active_lane: Option<String>,
    #[serde(rename = "journalEventCount")]
    pub journal_event_count: u64,
    #[serde(rename = "recentEvents")]
    pub recent_events: Vec<TimelineEventPayload>,
    pub counts: TimelineCountsPayload,
    #[serde(rename = "lastRequestAtMs")]
    pub last_request_at_ms: Option<u64>,
    #[serde(rename = "lastActivationAtMs")]
    pub last_activation_at_ms: Option<u64>,
    #[serde(rename = "lastReleaseAtMs")]
    pub last_release_at_ms: Option<u64>,
    #[serde(rename = "lastReleaseOutcome")]
    pub last_release_outcome: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KernelReadinessPayload {
    pub mode: &'static str,
    #[serde(rename = "authoritySwitchAllowed")]
    pub authority_switch_allowed: bool,
    #[serde(rename = "promotionStatus")]
    pub promotion_status: &'static str,
    #[serde(rename = "kernelShadow")]
    pub kernel_shadow: KernelShadowPayload,
    #[serde(rename = "currentAuthority")]
    pub current_authority: KernelAuthorityPayload,
    #[serde(rename = "nodeResponsibilities")]
    pub node_responsibilities: Vec<&'static str>,
    #[serde(rename = "rustResponsibilities")]
    pub rust_responsibilities: Vec<&'static str>,
    #[serde(rename = "persistenceModel")]
    pub persistence_model: KernelPersistencePayload,
    #[serde(rename = "promotionGates")]
    pub promotion_gates: Vec<KernelPromotionGatePayload>,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowPayload {
    pub reachable: bool,
    pub status: &'static str,
    pub authority: &'static str,
    pub wakefulness: &'static str,
    pub agenda: KernelShadowAgendaPayload,
    pub focus: Option<String>,
    pub ticks: KernelShadowTicksPayload,
    #[serde(rename = "reflectionQueue")]
    pub reflection_queue: KernelShadowReflectionQueuePayload,
    #[serde(rename = "persistedAt")]
    pub persisted_at: u64,
    #[serde(rename = "restartRecovery")]
    pub restart_recovery: KernelShadowRestartRecoveryPayload,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowAgendaPayload {
    #[serde(rename = "activeLane")]
    pub active_lane: Option<String>,
    #[serde(rename = "pendingLanes")]
    pub pending_lanes: Vec<String>,
    pub focus: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowTicksPayload {
    pub count: u64,
    #[serde(rename = "lastTickAtMs")]
    pub last_tick_at_ms: Option<u64>,
    #[serde(rename = "nextTickDueAtMs")]
    pub next_tick_due_at_ms: u64,
    #[serde(rename = "intervalMs")]
    pub interval_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowReflectionQueuePayload {
    pub status: &'static str,
    pub depth: usize,
    pub items: Vec<KernelShadowReflectionItemPayload>,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowReflectionItemPayload {
    pub lane: String,
    pub priority: u32,
    pub reason: Option<String>,
    #[serde(rename = "requestedAtMs")]
    pub requested_at_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct KernelShadowRestartRecoveryPayload {
    pub model: &'static str,
    pub status: &'static str,
    #[serde(rename = "bootCount")]
    pub boot_count: u64,
    #[serde(rename = "lastRecoveredAtMs")]
    pub last_recovered_at_ms: Option<u64>,
    #[serde(rename = "journalEventCount")]
    pub journal_event_count: u64,
    #[serde(rename = "snapshotFile")]
    pub snapshot_file: &'static str,
    #[serde(rename = "journalFile")]
    pub journal_file: &'static str,
}

#[derive(Debug, Serialize)]
pub struct KernelAuthorityPayload {
    pub gateway: &'static str,
    pub scheduler: &'static str,
    pub workflows: &'static str,
    pub channels: &'static str,
    pub sessions: &'static str,
    pub executive: &'static str,
}

#[derive(Debug, Serialize)]
pub struct KernelPersistencePayload {
    #[serde(rename = "snapshotFile")]
    pub snapshot_file: &'static str,
    #[serde(rename = "journalFile")]
    pub journal_file: &'static str,
    #[serde(rename = "restartRecovery")]
    pub restart_recovery: &'static str,
    #[serde(rename = "leaseRecovery")]
    pub lease_recovery: &'static str,
}

#[derive(Debug, Serialize)]
pub struct KernelPromotionGatePayload {
    pub id: &'static str,
    pub status: &'static str,
    pub owner: &'static str,
    #[serde(rename = "requiredProof")]
    pub required_proof: Vec<&'static str>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_state_dir() -> PathBuf {
    if let Ok(explicit) = env::var("ARGENT_EXECD_STATE_DIR") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(DEFAULT_STATE_DIR_SUFFIX)
}

impl ExecutiveRuntime {
    pub fn load_or_boot(config: RuntimeConfig) -> io::Result<Self> {
        fs::create_dir_all(&config.state_dir)?;
        let snapshot_path = config.snapshot_path();
        let journal_path = config.journal_path();
        let mut state = load_snapshot(&snapshot_path)?.unwrap_or_else(|| {
            ExecutiveState::new(now_ms(), config.tick_interval_ms, config.default_lease_ms)
        });
        let existing_records = load_records(&journal_path)?;
        for record in &existing_records {
            if record.seq > state.last_seq {
                apply_record(&mut state, record);
            }
        }
        let started_at_ms = now_ms();
        let mut runtime = Self {
            config,
            state,
            started_at: Instant::now(),
            journal_event_count: existing_records.len() as u64,
        };

        if runtime.journal_event_count > 0 {
            let recovered_record = runtime.make_record(ExecutiveEvent::Recovered {
                boot_count: runtime.state.boot_count + 1,
                recovered_at_ms: started_at_ms,
            });
            runtime.persist_record(recovered_record)?;
        } else {
            let booted_record = runtime.make_record(ExecutiveEvent::Booted {
                boot_count: runtime.state.boot_count,
            });
            runtime.persist_record(booted_record)?;
        }

        Ok(runtime)
    }

    pub fn health_payload(&self) -> HealthPayload {
        HealthPayload {
            status: "ok".to_string(),
            uptime_seconds: self.started_at.elapsed().as_secs(),
            boot_count: self.state.boot_count,
            tick_count: self.state.tick_count,
            active_lane: self.state.active_lane.clone(),
            journal_event_count: self.journal_event_count,
            state_dir: self.config.state_dir.display().to_string(),
            next_tick_due_at_ms: self.state.next_tick_due_at_ms,
        }
    }

    pub fn state_payload(&self) -> StatePayload<'_> {
        StatePayload {
            config: StateConfigPayload {
                bind_addr: &self.config.bind_addr,
                state_dir: self.config.state_dir.display().to_string(),
            },
            state: &self.state,
        }
    }

    pub fn metrics_payload(&self) -> MetricsPayload {
        let mut idle = 0_usize;
        let mut pending = 0_usize;
        let mut active = 0_usize;
        let mut next_lease_expiry_at_ms: Option<u64> = None;
        let mut highest_pending_priority: Option<u32> = None;

        for lane in self.state.lanes.values() {
            match lane.status {
                LaneStatus::Idle => idle += 1,
                LaneStatus::Pending => {
                    pending += 1;
                    highest_pending_priority = Some(
                        highest_pending_priority
                            .map(|value| value.max(lane.priority))
                            .unwrap_or(lane.priority),
                    );
                }
                LaneStatus::Active => active += 1,
            }

            if let Some(lease_expires_at_ms) = lane.lease_expires_at_ms {
                next_lease_expiry_at_ms = Some(
                    next_lease_expiry_at_ms
                        .map(|value| value.min(lease_expires_at_ms))
                        .unwrap_or(lease_expires_at_ms),
                );
            }
        }

        MetricsPayload {
            active_lane: self.state.active_lane.clone(),
            lane_counts: LaneCountsPayload {
                idle,
                pending,
                active,
            },
            boot_count: self.state.boot_count,
            tick_count: self.state.tick_count,
            journal_event_count: self.journal_event_count,
            next_tick_due_at_ms: self.state.next_tick_due_at_ms,
            last_tick_at_ms: self.state.last_tick_at_ms,
            last_recovered_at_ms: self.state.last_recovered_at_ms,
            next_lease_expiry_at_ms,
            highest_pending_priority,
        }
    }

    pub fn timeline_summary(&self, limit: usize) -> io::Result<TimelineSummaryPayload> {
        let records = load_records(&self.config.journal_path())?;
        let mut counts = TimelineCountsPayload {
            booted: 0,
            recovered: 0,
            tick: 0,
            lane_requested: 0,
            lane_activated: 0,
            lane_released: 0,
        };
        let mut last_request_at_ms = None;
        let mut last_activation_at_ms = None;
        let mut last_release_at_ms = None;
        let mut last_release_outcome = None;

        for record in &records {
            match &record.event {
                ExecutiveEvent::Booted { .. } => counts.booted += 1,
                ExecutiveEvent::Recovered { .. } => counts.recovered += 1,
                ExecutiveEvent::Tick { .. } => counts.tick += 1,
                ExecutiveEvent::LaneRequested { .. } => {
                    counts.lane_requested += 1;
                    last_request_at_ms = Some(record.at_ms);
                }
                ExecutiveEvent::LaneActivated { .. } => {
                    counts.lane_activated += 1;
                    last_activation_at_ms = Some(record.at_ms);
                }
                ExecutiveEvent::LaneReleased { outcome, .. } => {
                    counts.lane_released += 1;
                    last_release_at_ms = Some(record.at_ms);
                    last_release_outcome = Some(outcome.clone());
                }
            }
        }

        let slice = if limit == 0 || records.len() <= limit {
            records
        } else {
            records[records.len() - limit..].to_vec()
        };
        let recent_events = slice
            .into_iter()
            .map(|record| TimelineEventPayload {
                seq: record.seq,
                at_ms: record.at_ms,
                event_type: record.event.event_type_label().to_string(),
                lane: record.event.lane_name(),
                summary: record.event.summary_text(),
            })
            .collect::<Vec<_>>();

        Ok(TimelineSummaryPayload {
            active_lane: self.state.active_lane.clone(),
            journal_event_count: self.journal_event_count,
            recent_events,
            counts,
            last_request_at_ms,
            last_activation_at_ms,
            last_release_at_ms,
            last_release_outcome,
        })
    }

    pub fn kernel_readiness_payload(&self) -> KernelReadinessPayload {
        KernelReadinessPayload {
            mode: "shadow-readiness",
            authority_switch_allowed: false,
            promotion_status: "blocked",
            kernel_shadow: self.kernel_shadow_payload(),
            current_authority: KernelAuthorityPayload {
                gateway: "node",
                scheduler: "node",
                workflows: "node",
                channels: "node",
                sessions: "node",
                executive: "shadow-only",
            },
            node_responsibilities: vec![
                "gateway live authority",
                "scheduler live authority",
                "workflow execution live authority",
                "channel/session/run live authority",
                "model/tool/product behavior",
            ],
            rust_responsibilities: vec![
                "executive shadow state",
                "lane arbitration shadow evidence",
                "continuity journal",
                "restart recovery proof",
                "read-only health and metrics",
            ],
            persistence_model: KernelPersistencePayload {
                snapshot_file: SNAPSHOT_FILE_NAME,
                journal_file: JOURNAL_FILE_NAME,
                restart_recovery: "snapshot-plus-journal-replay",
                lease_recovery: "tick-expiry-before-promotion",
            },
            promotion_gates: vec![
                KernelPromotionGatePayload {
                    id: "contract-integrity",
                    status: "blocked",
                    owner: "master-operator",
                    required_proof: vec![
                        "executive shadow protocol schema regenerated and checked",
                        "TypeScript contract validation tests pass",
                        "Rust and TypeScript payload schemas match",
                    ],
                },
                KernelPromotionGatePayload {
                    id: "restart-and-lease-recovery",
                    status: "blocked",
                    owner: "master-operator",
                    required_proof: vec![
                        "cargo argent-execd tests pass",
                        "restart smoke proves state and journal recovery",
                        "lease soak proves expired active lanes do not wedge arbitration",
                    ],
                },
                KernelPromotionGatePayload {
                    id: "authority-boundary",
                    status: "blocked",
                    owner: "master-operator",
                    required_proof: vec![
                        "no live gateway/scheduler/workflow/channel/session/run authority switch",
                        "TypeScript remains consumer/client until explicit adoption",
                        "operator status shows executive shadow without implying live kernel authority",
                    ],
                },
            ],
        }
    }

    fn kernel_shadow_payload(&self) -> KernelShadowPayload {
        let pending_items = self
            .state
            .lanes
            .values()
            .filter(|lane| lane.status == LaneStatus::Pending)
            .map(|lane| KernelShadowReflectionItemPayload {
                lane: lane.name.clone(),
                priority: lane.priority,
                reason: lane.reason.clone(),
                requested_at_ms: lane.requested_at_ms,
            })
            .collect::<Vec<_>>();
        let pending_lanes = pending_items
            .iter()
            .map(|item| item.lane.clone())
            .collect::<Vec<_>>();
        let active_focus = self
            .state
            .active_lane
            .as_ref()
            .and_then(|lane_name| self.state.lanes.get(lane_name))
            .and_then(|lane| lane.reason.clone())
            .or_else(|| self.state.active_lane.clone())
            .or_else(|| pending_items.first().and_then(|item| item.reason.clone()))
            .or_else(|| pending_items.first().map(|item| item.lane.clone()));
        let persisted_at = self
            .state
            .last_tick_at_ms
            .or(self.state.last_recovered_at_ms)
            .unwrap_or(self.state.last_started_at_ms);
        let wakefulness = if self.state.active_lane.is_some() {
            "active"
        } else if pending_items.is_empty() {
            "watching"
        } else {
            "attentive"
        };
        let restart_status = if self.state.last_recovered_at_ms.is_some() {
            "recovered"
        } else {
            "booted"
        };

        KernelShadowPayload {
            reachable: true,
            status: "fail-closed",
            authority: "shadow",
            wakefulness,
            agenda: KernelShadowAgendaPayload {
                active_lane: self.state.active_lane.clone(),
                pending_lanes,
                focus: active_focus.clone(),
            },
            focus: active_focus,
            ticks: KernelShadowTicksPayload {
                count: self.state.tick_count,
                last_tick_at_ms: self.state.last_tick_at_ms,
                next_tick_due_at_ms: self.state.next_tick_due_at_ms,
                interval_ms: self.state.tick_interval_ms,
            },
            reflection_queue: KernelShadowReflectionQueuePayload {
                status: "shadow-only",
                depth: pending_items.len(),
                items: pending_items,
            },
            persisted_at,
            restart_recovery: KernelShadowRestartRecoveryPayload {
                model: "snapshot-plus-journal-replay",
                status: restart_status,
                boot_count: self.state.boot_count,
                last_recovered_at_ms: self.state.last_recovered_at_ms,
                journal_event_count: self.journal_event_count,
                snapshot_file: SNAPSHOT_FILE_NAME,
                journal_file: JOURNAL_FILE_NAME,
            },
        }
    }

    pub fn request_lane(
        &mut self,
        lane: &str,
        priority: u32,
        reason: Option<String>,
        lease_ms: Option<u64>,
    ) -> io::Result<()> {
        let record = self.make_record(ExecutiveEvent::LaneRequested {
            lane: lane.to_string(),
            priority,
            reason,
            lease_ms: lease_ms.unwrap_or(self.state.default_lease_ms),
        });
        self.persist_record(record)
    }

    pub fn release_lane(&mut self, lane: &str, outcome: &str) -> io::Result<()> {
        let record = self.make_record(ExecutiveEvent::LaneReleased {
            lane: lane.to_string(),
            outcome: outcome.to_string(),
        });
        self.persist_record(record)
    }

    pub fn tick(&mut self) -> io::Result<()> {
        let planned = plan_tick(&self.state, now_ms());
        for event in planned {
            let record = self.make_record(event);
            self.persist_record(record)?;
        }
        Ok(())
    }

    pub fn tick_sleep_duration(&self) -> Duration {
        Duration::from_millis(self.state.tick_interval_ms)
    }

    pub fn recent_records(&self, limit: usize) -> io::Result<Vec<JournalRecord>> {
        let mut records = load_records(&self.config.journal_path())?;
        if limit == 0 || records.len() <= limit {
            return Ok(records);
        }
        let start = records.len() - limit;
        Ok(records.split_off(start))
    }

    fn make_record(&self, event: ExecutiveEvent) -> JournalRecord {
        JournalRecord {
            seq: self.state.last_seq + 1,
            at_ms: now_ms(),
            event,
        }
    }

    fn persist_record(&mut self, record: JournalRecord) -> io::Result<()> {
        append_record(&self.config.journal_path(), &record)?;
        apply_record(&mut self.state, &record);
        save_snapshot(&self.config.snapshot_path(), &self.state)?;
        self.journal_event_count += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{now_ms, ExecutiveRuntime, RuntimeConfig, JOURNAL_FILE_NAME, SNAPSHOT_FILE_NAME};
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    fn temp_state_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("argent-execd-{name}-{}", now_ms()));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn recovers_requested_lane_from_snapshot_and_journal() {
        let state_dir = temp_state_dir("recovery");
        let config = RuntimeConfig {
            bind_addr: "127.0.0.1:18809".to_string(),
            state_dir: state_dir.clone(),
            tick_interval_ms: 50,
            default_lease_ms: 500,
        };

        let mut runtime =
            ExecutiveRuntime::load_or_boot(config.clone()).expect("runtime should boot");
        runtime
            .request_lane("background", 42, Some("reconcile".to_string()), Some(500))
            .expect("lane request should persist");
        runtime.tick().expect("tick should persist");

        let recovered = ExecutiveRuntime::load_or_boot(config).expect("runtime should recover");
        let background = recovered
            .state
            .lanes
            .get("background")
            .expect("background lane should exist");
        assert!(recovered.journal_event_count >= 3);
        assert!(
            background.priority == 42
                || recovered.state.active_lane.as_deref() == Some("background")
        );
    }

    #[test]
    fn reports_kernel_shadow_agenda_ticks_and_restart_recovery() {
        let state_dir = temp_state_dir("kernel-shadow");
        let config = RuntimeConfig {
            bind_addr: "127.0.0.1:18809".to_string(),
            state_dir,
            tick_interval_ms: 50,
            default_lease_ms: 500,
        };

        let mut runtime =
            ExecutiveRuntime::load_or_boot(config.clone()).expect("runtime should boot");
        runtime
            .request_lane("background", 20, Some("reflection".to_string()), Some(500))
            .expect("background lane request should persist");
        runtime
            .request_lane("operator", 90, Some("interactive".to_string()), Some(500))
            .expect("operator lane request should persist");
        runtime
            .tick()
            .expect("tick should activate highest priority lane");

        let readiness = runtime.kernel_readiness_payload();
        let shadow = readiness.kernel_shadow;

        assert!(!readiness.authority_switch_allowed);
        assert_eq!(readiness.current_authority.gateway, "node");
        assert_eq!(shadow.status, "fail-closed");
        assert_eq!(shadow.authority, "shadow");
        assert_eq!(shadow.wakefulness, "active");
        assert_eq!(shadow.agenda.active_lane.as_deref(), Some("operator"));
        assert_eq!(shadow.agenda.focus.as_deref(), Some("interactive"));
        assert_eq!(shadow.ticks.count, 1);
        assert_eq!(shadow.reflection_queue.status, "shadow-only");
        assert_eq!(shadow.reflection_queue.depth, 1);
        assert_eq!(shadow.reflection_queue.items[0].lane, "background");
        assert_eq!(
            shadow.reflection_queue.items[0].reason.as_deref(),
            Some("reflection")
        );
        assert_eq!(
            shadow.restart_recovery.model,
            "snapshot-plus-journal-replay"
        );
        assert_eq!(shadow.restart_recovery.status, "booted");
        assert!(shadow.persisted_at >= shadow.ticks.last_tick_at_ms.unwrap_or(0));

        let recovered = ExecutiveRuntime::load_or_boot(config).expect("runtime should recover");
        let recovered_shadow = recovered.kernel_readiness_payload().kernel_shadow;

        assert_eq!(recovered_shadow.restart_recovery.status, "recovered");
        assert_eq!(recovered_shadow.restart_recovery.boot_count, 2);
        assert!(recovered_shadow
            .restart_recovery
            .last_recovered_at_ms
            .is_some());
        assert!(recovered_shadow.restart_recovery.journal_event_count >= 5);
        assert_eq!(
            recovered_shadow.restart_recovery.snapshot_file,
            SNAPSHOT_FILE_NAME
        );
        assert_eq!(
            recovered_shadow.restart_recovery.journal_file,
            JOURNAL_FILE_NAME
        );
    }
}
