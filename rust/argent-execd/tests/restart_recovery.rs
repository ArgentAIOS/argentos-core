use argent_execd::runtime::{ExecutiveRuntime, RuntimeConfig};
use std::env;
use std::fs;

fn temp_state_dir(name: &str) -> std::path::PathBuf {
    let dir = env::temp_dir().join(format!("argent-execd-it-{name}-{}", std::process::id()));
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
}

#[test]
fn restart_recovery_preserves_lane_state() {
    let state_dir = temp_state_dir("restart");
    let config = RuntimeConfig {
        bind_addr: "127.0.0.1:18809".to_string(),
        state_dir: state_dir.clone(),
        tick_interval_ms: 25,
        default_lease_ms: 250,
    };

    let mut first = ExecutiveRuntime::load_or_boot(config.clone()).expect("runtime should boot");
    first
        .request_lane("operator", 99, Some("interactive".to_string()), Some(250))
        .expect("lane request should succeed");
    first.tick().expect("tick should succeed");

    let second = ExecutiveRuntime::load_or_boot(config).expect("runtime should recover");
    let operator = second
        .state
        .lanes
        .get("operator")
        .expect("operator lane should exist after recovery");
    assert!(second.journal_event_count >= 3);
    assert!(
        second.state.active_lane.as_deref() == Some("operator")
            || operator.priority == 99
            || operator.last_outcome.as_deref() == Some("lease_expired")
    );
}
