use argent_execd::runtime::{ExecutiveRuntime, RuntimeConfig};
use argent_execd::server::{bind_listener, serve, start_tick_loop, ShutdownSignal};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn temp_state_dir(name: &str) -> std::path::PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let dir = env::temp_dir().join(format!("argent-execd-http-{name}-{millis}"));
    fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
}

fn http_request(addr: &str, request: &str) -> String {
    let mut stream = TcpStream::connect(addr).expect("server should accept connection");
    stream
        .write_all(request.as_bytes())
        .expect("request should write");
    stream.flush().expect("request should flush");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("response should read");
    response
}

fn response_body(response: &str) -> &str {
    response.split("\r\n\r\n").nth(1).unwrap_or("")
}

#[test]
fn http_control_surface_drives_tick_and_restart_recovery() {
    let state_dir = temp_state_dir("control");
    let config = RuntimeConfig {
        bind_addr: "127.0.0.1:0".to_string(),
        state_dir: state_dir.clone(),
        tick_interval_ms: 60_000,
        default_lease_ms: 5_000,
    };

    let runtime = Arc::new(Mutex::new(
        ExecutiveRuntime::load_or_boot(config.clone()).expect("runtime should boot"),
    ));
    let shutdown = Arc::new(ShutdownSignal::new());
    let listener = bind_listener(&config.bind_addr).expect("listener should bind");
    let addr = listener
        .local_addr()
        .expect("local addr should exist")
        .to_string();

    start_tick_loop(runtime.clone(), shutdown.clone());
    let server_shutdown = shutdown.clone();
    let server_runtime = runtime.clone();
    let handle = thread::spawn(move || {
        serve(listener, server_runtime, server_shutdown).expect("server should run");
    });
    thread::sleep(Duration::from_millis(100));

    let body = r#"{"lane":"operator","priority":90,"reason":"interactive","leaseMs":5000}"#;
    let request = format!(
        "POST /v1/lanes/request HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let response = http_request(&addr, &request);
    assert!(response.starts_with("HTTP/1.1 200 OK"));

    let tick_body = r#"{"count":1}"#;
    let tick_request = format!(
        "POST /v1/executive/tick HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        tick_body.len(),
        tick_body
    );
    let tick_response = http_request(&addr, &tick_request);
    assert!(tick_response.starts_with("HTTP/1.1 200 OK"));

    let state_response = http_request(
        &addr,
        &format!("GET /v1/executive/state HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"),
    );
    let state_body = response_body(&state_response);
    assert!(state_body.contains("\"active_lane\": \"operator\""));

    let journal_response = http_request(
        &addr,
        &format!(
            "GET /v1/executive/journal?limit=5 HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
        ),
    );
    let journal_body = response_body(&journal_response);
    assert!(journal_body.contains("\"lane\": \"operator\""));
    assert!(journal_body.contains("\"lane_activated\""));

    let readiness_response = http_request(
        &addr,
        &format!(
            "GET /v1/executive/readiness HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
        ),
    );
    let readiness_body = response_body(&readiness_response);
    assert!(readiness_body.contains("\"mode\": \"shadow-readiness\""));
    assert!(readiness_body.contains("\"authoritySwitchAllowed\": false"));
    assert!(readiness_body.contains("\"executive\": \"shadow-only\""));
    assert!(readiness_body.contains("\"gateway\": \"node\""));
    assert!(readiness_body.contains("\"snapshot-plus-journal-replay\""));
    assert!(readiness_body.contains("\"restart-and-lease-recovery\""));
    assert!(readiness_body.contains("\"authority-boundary\""));

    let shutdown_request = format!(
        "POST /v1/executive/shutdown HTTP/1.1\r\nHost: {addr}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    );
    let shutdown_response = http_request(&addr, &shutdown_request);
    assert!(shutdown_response.starts_with("HTTP/1.1 200 OK"));
    handle.join().expect("server thread should exit");

    let recovered = ExecutiveRuntime::load_or_boot(config).expect("runtime should recover");
    assert_eq!(recovered.state.active_lane.as_deref(), Some("operator"));
    assert!(recovered.journal_event_count >= 4);
}

#[test]
fn auth_enforced_rejects_missing_and_wrong_token_accepts_correct() {
    use argent_execd::server::serve_with_auth;

    let state_dir = temp_state_dir("auth");
    let config = RuntimeConfig {
        bind_addr: "127.0.0.1:0".to_string(),
        state_dir,
        tick_interval_ms: 60_000,
        default_lease_ms: 5_000,
    };
    let runtime = Arc::new(Mutex::new(
        ExecutiveRuntime::load_or_boot(config.clone()).expect("runtime should boot"),
    ));
    let shutdown = Arc::new(ShutdownSignal::new());
    let listener = bind_listener(&config.bind_addr).expect("listener should bind");
    let addr = listener.local_addr().expect("addr").to_string();

    let server_shutdown = shutdown.clone();
    let server_runtime = runtime.clone();
    let handle = thread::spawn(move || {
        serve_with_auth(
            listener,
            server_runtime,
            server_shutdown,
            Some("secret-token".to_string()),
        )
        .expect("server should run");
    });
    thread::sleep(Duration::from_millis(100));

    // No Authorization header → 401, even on a read route.
    let no_auth = http_request(
        &addr,
        &format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"),
    );
    assert!(no_auth.starts_with("HTTP/1.1 401"), "missing token must 401: {no_auth}");

    // Wrong token → 401.
    let wrong = http_request(
        &addr,
        &format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer nope\r\nConnection: close\r\n\r\n"),
    );
    assert!(wrong.starts_with("HTTP/1.1 401"), "wrong token must 401: {wrong}");

    // Unauthenticated POST shutdown must NOT shut the daemon down.
    let shutdown_denied = http_request(
        &addr,
        &format!("POST /v1/executive/shutdown HTTP/1.1\r\nHost: {addr}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"),
    );
    assert!(shutdown_denied.starts_with("HTTP/1.1 401"), "unauth shutdown must 401: {shutdown_denied}");

    // Correct token → 200.
    let ok = http_request(
        &addr,
        &format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer secret-token\r\nConnection: close\r\n\r\n"),
    );
    assert!(ok.starts_with("HTTP/1.1 200 OK"), "correct token must 200: {ok}");

    // Now really shut it down (authorized).
    let _ = http_request(
        &addr,
        &format!("POST /v1/executive/shutdown HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer secret-token\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"),
    );
    handle.join().expect("server thread should exit");
}
