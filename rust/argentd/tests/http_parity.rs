use argentd::server::{bind_listener, serve};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::thread;
use std::time::Instant;

fn spawn_server(expected_token: &str) -> (SocketAddr, thread::JoinHandle<std::io::Result<()>>) {
    let listener = bind_listener("127.0.0.1:0").expect("listener should bind");
    let addr = listener
        .local_addr()
        .expect("listener should have local addr");
    let token = expected_token.to_string();
    let handle = thread::spawn(move || serve(listener, Instant::now(), &token, Some(1)));
    (addr, handle)
}

fn send_http(addr: SocketAddr, request: &str) -> String {
    let mut stream = TcpStream::connect(addr).expect("client should connect");
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

fn join_server(handle: thread::JoinHandle<std::io::Result<()>>) {
    handle
        .join()
        .expect("server thread should finish")
        .expect("server should exit cleanly");
}

#[test]
fn health_returns_ok_json_over_real_tcp() {
    let (addr, handle) = spawn_server("shadow-token");
    let response = send_http(
        addr,
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );
    join_server(handle);

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"status\":\"ok\""));
    assert!(response.contains("\"version\":\"0.1.0\""));
    assert!(response.contains("\"mode\":\"shadow\""));
    assert!(response.contains("\"protocolVersion\":3"));
    assert!(response.contains("\"liveAuthority\":\"node\""));
    assert!(response.contains("\"gatewayAuthority\":\"shadow-only\""));
    assert!(response.contains("\"promotionReady\":false"));
    assert!(response.contains("\"statePersistence\":\"memory-only\""));
}

#[test]
fn connect_returns_hello_ok_over_real_tcp() {
    let (addr, handle) = spawn_server("shadow-token");
    let request_body = r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent.","session."]}}"#;
    let request = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        request_body.len(),
        request_body
    );
    let response = send_http(addr, &request);
    join_server(handle);

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"type\":\"res\""));
    assert!(response.contains("\"ok\":true"));
    assert!(response.contains("\"type\":\"hello-ok\""));
    assert!(response.contains("\"connId\":\"shadow-conn-1\""));
}

#[test]
fn connect_wrong_token_returns_invalid_request_over_real_tcp() {
    let (addr, handle) = spawn_server("shadow-token");
    let request_body = r#"{"type":"req","id":"req-2","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"wrong-token"}}}"#;
    let request = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        request_body.len(),
        request_body
    );
    let response = send_http(addr, &request);
    join_server(handle);

    assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("gateway token mismatch"));
}

#[test]
fn connect_protocol_mismatch_returns_invalid_request_over_real_tcp() {
    let (addr, handle) = spawn_server("shadow-token");
    let request_body = r#"{"type":"req","id":"req-3","method":"connect","params":{"minProtocol":4,"maxProtocol":5,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"}}}"#;
    let request = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        request_body.len(),
        request_body
    );
    let response = send_http(addr, &request);
    join_server(handle);

    assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("\"message\":\"protocol mismatch\""));
}

#[test]
fn malformed_connect_payload_returns_invalid_request_over_real_tcp() {
    let (addr, handle) = spawn_server("shadow-token");
    let request_body = r#"{"type":"req","id":"req-4","method":"connect","params":{"client":{"id":"test-client"}}}"#;
    let request = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        request_body.len(),
        request_body
    );
    let response = send_http(addr, &request);
    join_server(handle);

    assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("\"message\":\"invalid connect params\""));
}
