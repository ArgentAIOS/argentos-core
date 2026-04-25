use crate::journal::ExecutiveEvent;
use crate::state::{ExecutiveState, LaneStatus};

fn lane_sort_key(state: &ExecutiveState, lane: &str) -> (u32, u64, String) {
    let entry = state
        .lanes
        .get(lane)
        .expect("lane key must exist while sorting");
    (
        entry.priority,
        entry.requested_at_ms.unwrap_or(u64::MAX),
        lane.to_string(),
    )
}

pub fn plan_tick(state: &ExecutiveState, now_ms: u64) -> Vec<ExecutiveEvent> {
    let mut events = vec![ExecutiveEvent::Tick {
        tick_count: state.tick_count + 1,
    }];

    if let Some(active_lane) = state.active_lane.as_deref() {
        if let Some(entry) = state.lanes.get(active_lane) {
            if entry.status == LaneStatus::Active
                && entry
                    .lease_expires_at_ms
                    .is_some_and(|lease_expires_at_ms| now_ms >= lease_expires_at_ms)
            {
                events.push(ExecutiveEvent::LaneReleased {
                    lane: active_lane.to_string(),
                    outcome: "lease_expired".to_string(),
                });
            }
        }
    }

    let active_lane_remains = if let Some(active_lane) = state.active_lane.as_deref() {
        state
            .lanes
            .get(active_lane)
            .is_some_and(|entry| entry.status == LaneStatus::Active)
            && !state
                .lanes
                .get(active_lane)
                .and_then(|entry| entry.lease_expires_at_ms)
                .is_some_and(|lease_expires_at_ms| now_ms >= lease_expires_at_ms)
    } else {
        false
    };

    if active_lane_remains {
        return events;
    }

    let next_pending = state
        .lanes
        .iter()
        .filter(|(_, entry)| entry.status == LaneStatus::Pending)
        .map(|(lane, _)| lane.as_str())
        .max_by(|left, right| lane_sort_key(state, left).cmp(&lane_sort_key(state, right)));

    if let Some(lane) = next_pending {
        let lease_ms = state
            .lanes
            .get(lane)
            .and_then(|entry| match entry.status {
                LaneStatus::Pending => Some(state.default_lease_ms),
                _ => None,
            })
            .unwrap_or(state.default_lease_ms);
        events.push(ExecutiveEvent::LaneActivated {
            lane: lane.to_string(),
            lease_expires_at_ms: now_ms + lease_ms,
        });
    }

    events
}

#[cfg(test)]
mod tests {
    use super::plan_tick;
    use crate::journal::{apply_record, JournalRecord};
    use crate::state::ExecutiveState;

    fn apply_sequence(
        state: &mut ExecutiveState,
        events: Vec<crate::journal::ExecutiveEvent>,
        now_ms: u64,
    ) {
        for (idx, event) in events.into_iter().enumerate() {
            let record = JournalRecord {
                seq: state.last_seq + idx as u64 + 1,
                at_ms: now_ms,
                event,
            };
            apply_record(state, &record);
        }
    }

    #[test]
    fn picks_highest_priority_pending_lane() {
        let mut state = ExecutiveState::new(1_000, 5_000, 30_000);
        apply_sequence(
            &mut state,
            vec![
                crate::journal::ExecutiveEvent::LaneRequested {
                    lane: "background".to_string(),
                    priority: 10,
                    reason: Some("reconcile".to_string()),
                    lease_ms: 30_000,
                },
                crate::journal::ExecutiveEvent::LaneRequested {
                    lane: "operator".to_string(),
                    priority: 90,
                    reason: Some("interactive".to_string()),
                    lease_ms: 30_000,
                },
            ],
            2_000,
        );

        let events = plan_tick(&state, 3_000);
        assert!(events.iter().any(|event| matches!(
            event,
            crate::journal::ExecutiveEvent::LaneActivated { lane, .. } if lane == "operator"
        )));
    }

    #[test]
    fn expires_lane_and_promotes_next_pending_lane() {
        let mut state = ExecutiveState::new(1_000, 5_000, 1_000);
        apply_sequence(
            &mut state,
            vec![
                crate::journal::ExecutiveEvent::LaneRequested {
                    lane: "operator".to_string(),
                    priority: 90,
                    reason: Some("interactive".to_string()),
                    lease_ms: 1_000,
                },
                crate::journal::ExecutiveEvent::LaneActivated {
                    lane: "operator".to_string(),
                    lease_expires_at_ms: 2_000,
                },
                crate::journal::ExecutiveEvent::LaneRequested {
                    lane: "background".to_string(),
                    priority: 10,
                    reason: Some("reconcile".to_string()),
                    lease_ms: 1_000,
                },
            ],
            1_000,
        );

        let events = plan_tick(&state, 2_500);
        assert!(events.iter().any(|event| matches!(
            event,
            crate::journal::ExecutiveEvent::LaneReleased { lane, outcome }
                if lane == "operator" && outcome == "lease_expired"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            crate::journal::ExecutiveEvent::LaneActivated { lane, .. } if lane == "background"
        )));
    }
}
