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
    let dir = env::temp_dir().join(format!("argent-execd-lease-{name}-{millis}"));
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
fn lease_expiry_promotes_next_pending_lane() {
    let state_dir = temp_state_dir("promotion");
    let config = RuntimeConfig {
        bind_addr: "127.0.0.1:0".to_string(),
        state_dir: state_dir.clone(),
        tick_interval_ms: 60_000,
        default_lease_ms: 100,
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

    let operator_body = r#"{"lane":"operator","priority":90,"reason":"interactive","leaseMs":100}"#;
    let background_body =
        r#"{"lane":"background","priority":10,"reason":"reconcile","leaseMs":100}"#;

    for body in [operator_body, background_body] {
        let request = format!(
            "POST /v1/lanes/request HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let response = http_request(&addr, &request);
        assert!(response.starts_with("HTTP/1.1 200 OK"));
    }

    let tick_request = format!(
        "POST /v1/executive/tick HTTP/1.1\r\nHost: {addr}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let tick_response = http_request(&addr, &tick_request);
    assert!(tick_response.starts_with("HTTP/1.1 200 OK"));

    let state_response = http_request(
        &addr,
        &format!("GET /v1/executive/state HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"),
    );
    assert!(response_body(&state_response).contains("\"active_lane\": \"operator\""));

    thread::sleep(Duration::from_millis(150));

    let tick_response = http_request(&addr, &tick_request);
    assert!(tick_response.starts_with("HTTP/1.1 200 OK"));
    let final_state = http_request(
        &addr,
        &format!("GET /v1/executive/state HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"),
    );
    let final_body = response_body(&final_state);
    assert!(final_body.contains("\"active_lane\": \"background\""));
    assert!(final_body.contains("\"last_outcome\": \"lease_expired\""));

    let shutdown_request = format!(
        "POST /v1/executive/shutdown HTTP/1.1\r\nHost: {addr}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let shutdown_response = http_request(&addr, &shutdown_request);
    assert!(shutdown_response.starts_with("HTTP/1.1 200 OK"));
    handle.join().expect("server thread should exit");
}
