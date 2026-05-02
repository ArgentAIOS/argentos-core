use argentd::server::{
    bind_listener, serve_with_config, serve_with_config_and_stop, MaintenanceConfig, ShutdownSignal,
};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

struct WsClient {
    stream: TcpStream,
    pending: Vec<u8>,
}

fn spawn_server(expected_token: &str) -> (SocketAddr, thread::JoinHandle<std::io::Result<()>>) {
    spawn_server_with_limit(expected_token, 1)
}

fn spawn_server_with_limit(
    expected_token: &str,
    max_connections: usize,
) -> (SocketAddr, thread::JoinHandle<std::io::Result<()>>) {
    spawn_server_with_config(
        expected_token,
        max_connections,
        MaintenanceConfig {
            tick_interval_ms: 60_000,
            health_interval_ms: 60_000,
            heartbeat_interval_ms: 60_000,
        },
    )
}

fn spawn_server_with_config(
    expected_token: &str,
    max_connections: usize,
    maintenance: MaintenanceConfig,
) -> (SocketAddr, thread::JoinHandle<std::io::Result<()>>) {
    let listener = bind_listener("127.0.0.1:0").expect("listener should bind");
    let addr = listener.local_addr().expect("listener should have local addr");
    let token = expected_token.to_string();
    let handle = thread::spawn(move || {
        serve_with_config(listener, Instant::now(), &token, Some(max_connections), maintenance)
    });
    (addr, handle)
}

fn spawn_server_with_stop(
    expected_token: &str,
    max_connections: usize,
    maintenance: MaintenanceConfig,
) -> (
    SocketAddr,
    Arc<ShutdownSignal>,
    thread::JoinHandle<std::io::Result<()>>,
) {
    let listener = bind_listener("127.0.0.1:0").expect("listener should bind");
    let addr = listener.local_addr().expect("listener should have local addr");
    let token = expected_token.to_string();
    let stop = Arc::new(ShutdownSignal::new());
    let stop_for_server = stop.clone();
    let handle = thread::spawn(move || {
        serve_with_config_and_stop(
            listener,
            Instant::now(),
            &token,
            Some(max_connections),
            maintenance,
            stop_for_server,
        )
    });
    (addr, stop, handle)
}

fn open_ws(addr: SocketAddr) -> WsClient {
    let mut stream = TcpStream::connect(addr).expect("client should connect");
    let request = concat!(
        "GET / HTTP/1.1\r\n",
        "Host: 127.0.0.1\r\n",
        "Upgrade: websocket\r\n",
        "Connection: Upgrade\r\n",
        "Sec-WebSocket-Version: 13\r\n",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
        "\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .expect("handshake should write");
    stream.flush().expect("handshake should flush");
    let mut response = vec![0_u8; 1024];
    let size = stream.read(&mut response).expect("handshake response should read");
    let bytes = &response[..size];
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .expect("handshake should contain header terminator");
    let text = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
    assert!(text.starts_with("HTTP/1.1 101 Switching Protocols"));
    assert!(text.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    WsClient {
        stream,
        pending: bytes[header_end..].to_vec(),
    }
}

fn send_masked_text(client: &mut WsClient, payload: &str) {
    let bytes = payload.as_bytes();
    let mask = [0x12_u8, 0x34, 0x56, 0x78];
    let mut frame = Vec::with_capacity(bytes.len() + 10);
    frame.push(0x81);
    if bytes.len() < 126 {
        frame.push(0x80 | bytes.len() as u8);
    } else {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    }
    frame.extend_from_slice(&mask);
    for (index, byte) in bytes.iter().enumerate() {
        frame.push(byte ^ mask[index % 4]);
    }
    client
        .stream
        .write_all(&frame)
        .expect("ws frame should write");
    client.stream.flush().expect("ws frame should flush");
}

fn read_exact_from_client(client: &mut WsClient, size: usize) -> Option<Vec<u8>> {
    if client.pending.len() >= size {
        let bytes = client.pending.drain(..size).collect::<Vec<_>>();
        return Some(bytes);
    }

    let mut out = Vec::with_capacity(size);
    if !client.pending.is_empty() {
        out.extend(client.pending.drain(..));
    }
    while out.len() < size {
        let mut buffer = vec![0_u8; size - out.len()];
        match client.stream.read(&mut buffer) {
            Ok(0) => return None,
            Ok(read) => out.extend_from_slice(&buffer[..read]),
            Err(_) => return None,
        }
    }
    Some(out)
}

fn read_server_text(client: &mut WsClient) -> Option<String> {
    let header = read_exact_from_client(client, 2)?;
    let opcode = header[0] & 0x0f;
    if opcode == 0x8 {
        return None;
    }
    assert_eq!(opcode, 0x1, "expected text frame");
    let mut payload_len = (header[1] & 0x7f) as usize;
    if payload_len == 126 {
        let ext = read_exact_from_client(client, 2).expect("extended length");
        payload_len = u16::from_be_bytes([ext[0], ext[1]]) as usize;
    } else if payload_len == 127 {
        let ext = read_exact_from_client(client, 8).expect("extended length");
        payload_len = u64::from_be_bytes([
            ext[0], ext[1], ext[2], ext[3], ext[4], ext[5], ext[6], ext[7],
        ]) as usize;
    }
    let payload = read_exact_from_client(client, payload_len).expect("payload should read");
    Some(String::from_utf8_lossy(&payload).into_owned())
}

fn read_until(
    client: &mut WsClient,
    predicate: impl Fn(&str) -> bool,
    max_messages: usize,
) -> Option<String> {
    for _ in 0..max_messages {
        let message = read_server_text(client)?;
        if predicate(&message) {
            return Some(message);
        }
    }
    None
}

fn read_response_for_id(client: &mut WsClient, id: &str, max_messages: usize) -> Option<String> {
    read_until(
        client,
        |message| message.contains("\"type\":\"res\"") && message.contains(&format!("\"id\":\"{}\"", id)),
        max_messages,
    )
}

fn read_response_and_event(
    client: &mut WsClient,
    id: &str,
    event: &str,
    max_messages: usize,
) -> Option<(String, String)> {
    let mut response = None;
    let mut observed_event = None;
    for _ in 0..max_messages {
        let message = read_server_text(client)?;
        if response.is_none()
            && message.contains("\"type\":\"res\"")
            && message.contains(&format!("\"id\":\"{}\"", id))
        {
            response = Some(message);
        } else if observed_event.is_none() && message.contains(&format!("\"event\":\"{}\"", event))
        {
            observed_event = Some(message);
        }
        if let (Some(response), Some(observed_event)) = (response.as_ref(), observed_event.as_ref())
        {
            return Some((response.clone(), observed_event.clone()));
        }
    }
    None
}

fn read_close(client: &mut WsClient) -> bool {
    match read_exact_from_client(client, 2) {
        Some(header) => (header[0] & 0x0f) == 0x8,
        None => true,
    }
}

fn join_server(handle: thread::JoinHandle<std::io::Result<()>>) {
    handle
        .join()
        .expect("server thread should finish")
        .expect("server should exit cleanly");
}

#[test]
fn websocket_open_sends_connect_challenge() {
    let (addr, handle) = spawn_server("shadow-token");
    let mut client = open_ws(addr);
    let message = read_server_text(&mut client).expect("challenge frame should arrive");
    assert!(message.contains("\"type\":\"event\""));
    assert!(message.contains("\"event\":\"connect.challenge\""));
    assert!(message.contains("\"nonce\":\"shadow-nonce\""));
    drop(client);
    join_server(handle);
}

#[test]
fn websocket_connect_then_health_succeeds() {
    let (addr, handle) = spawn_server("shadow-token");
    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge frame should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let connect = read_server_text(&mut client).expect("connect response should arrive");
    assert!(connect.contains("\"type\":\"res\""));
    assert!(connect.contains("\"id\":\"req-1\""));
    assert!(connect.contains("\"ok\":true"));
    assert!(connect.contains("\"type\":\"hello-ok\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"health-1","method":"health","params":{"probe":true}}"#,
    );
    let health = read_server_text(&mut client).expect("health response should arrive");
    assert!(health.contains("\"type\":\"res\""));
    assert!(health.contains("\"id\":\"health-1\""));
    assert!(health.contains("\"ok\":true"));
    assert!(health.contains("\"defaultAgentId\":\"main\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"presence-1","method":"system-presence"}"#,
    );
    let presence = read_server_text(&mut client).expect("presence response should arrive");
    assert!(presence.contains("\"type\":\"res\""));
    assert!(presence.contains("\"id\":\"presence-1\""));
    assert!(presence.contains("\"ok\":true"));
    assert!(presence.contains("\"reason\":\"connect\""));
    assert!(presence.contains("\"mode\":\"operator\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"status-1","method":"status"}"#);
    let status = read_server_text(&mut client).expect("status response should arrive");
    assert!(status.contains("\"type\":\"res\""));
    assert!(status.contains("\"id\":\"status-1\""));
    assert!(status.contains("\"ok\":true"));
    assert!(status.contains("\"defaultAgentId\":\"main\""));
    assert!(status.contains("\"channelSummary\":[]"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"evt-1","method":"system-event","params":{"text":"Node: Studio","mode":"ui","reason":"periodic","instanceId":"instance-2"}}"#,
    );
    let event_ack = read_server_text(&mut client).expect("system-event ack should arrive");
    assert!(event_ack.contains("\"type\":\"res\""));
    assert!(event_ack.contains("\"id\":\"evt-1\""));
    assert!(event_ack.contains("\"ok\":true"));

    let presence_event = read_server_text(&mut client).expect("presence event should arrive");
    assert!(presence_event.contains("\"type\":\"event\""));
    assert!(presence_event.contains("\"event\":\"presence\""));
    assert!(presence_event.contains("\"seq\":1"));
    assert!(presence_event.contains("\"stateVersion\":{\"presence\":2,\"health\":1}"));
    assert!(presence_event.contains("\"text\":\"Node: Studio\""));
    assert!(presence_event.contains("\"instanceId\":\"instance-2\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"presence-2","method":"system-presence"}"#,
    );
    let updated_presence = read_server_text(&mut client).expect("updated presence should arrive");
    assert!(updated_presence.contains("\"id\":\"presence-2\""));
    assert!(updated_presence.contains("\"Node: Studio\""));
    assert!(updated_presence.contains("\"instanceId\":\"instance-2\""));
    drop(client);
    join_server(handle);
}

#[test]
fn websocket_rejects_non_connect_first_request() {
    let (addr, handle) = spawn_server("shadow-token");
    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge frame should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"h1","method":"health"}"#);
    let response = read_server_text(&mut client).expect("error response should arrive");
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("first request must be connect"));
    assert!(read_close(&mut client));
    drop(client);
    join_server(handle);
}

#[test]
fn websocket_rejects_missing_auth_with_request_id() {
    let (addr, handle) = spawn_server("shadow-token");
    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge frame should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-missing-auth","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"}}}"#,
    );
    let response = read_server_text(&mut client).expect("error response should arrive");
    assert!(response.contains("\"type\":\"res\""));
    assert!(response.contains("\"id\":\"req-missing-auth\""));
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("\"message\":\"invalid connect params\""));
    assert!(!response.contains("shadow-token"));
    assert!(read_close(&mut client));
    drop(client);
    join_server(handle);
}

#[test]
fn websocket_rejects_protocol_mismatch() {
    let (addr, handle) = spawn_server("shadow-token");
    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge frame should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-2","method":"connect","params":{"minProtocol":4,"maxProtocol":5,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"}}}"#,
    );
    let response = read_server_text(&mut client).expect("error response should arrive");
    assert!(response.contains("\"code\":\"INVALID_REQUEST\""));
    assert!(response.contains("\"message\":\"protocol mismatch\""));
    assert!(read_close(&mut client));
    drop(client);
    join_server(handle);
}

#[test]
fn websocket_system_event_fans_out_to_multiple_clients() {
    let (addr, handle) = spawn_server_with_limit("shadow-token", 2);

    let mut client_a = open_ws(addr);
    let mut client_b = open_ws(addr);

    let _challenge_a = read_server_text(&mut client_a).expect("challenge A should arrive");
    let _challenge_b = read_server_text(&mut client_b).expect("challenge B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"req-a","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let connect_a = read_server_text(&mut client_a).expect("connect A should arrive");
    assert!(connect_a.contains("\"ok\":true"));

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"req-b","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-b","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-b"},"auth":{"token":"shadow-token"}}}"#,
    );
    let connect_b = read_server_text(&mut client_b).expect("connect B should arrive");
    assert!(connect_b.contains("\"ok\":true"));

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"evt-1","method":"system-event","params":{"text":"Node: Shared","mode":"ui","reason":"periodic","instanceId":"instance-shared"}}"#,
    );
    let ack_a = read_server_text(&mut client_a).expect("ack should arrive on A");
    assert!(ack_a.contains("\"id\":\"evt-1\""));
    assert!(ack_a.contains("\"ok\":true"));

    let event_a = read_server_text(&mut client_a).expect("presence event should arrive on A");
    let event_b = read_server_text(&mut client_b).expect("presence event should arrive on B");
    assert_eq!(event_a, event_b);
    assert!(event_a.contains("\"event\":\"presence\""));
    assert!(event_a.contains("\"seq\":1"));
    assert!(event_a.contains("\"stateVersion\":{\"presence\":3,\"health\":1}"));
    assert!(event_a.contains("\"instanceId\":\"instance-shared\""));

    drop(client_a);
    drop(client_b);
    join_server(handle);
}

#[test]
fn websocket_disconnect_prunes_presence_and_broadcasts_update() {
    let (addr, handle) = spawn_server_with_limit("shadow-token", 2);

    let mut client_a = open_ws(addr);
    let mut client_b = open_ws(addr);

    let _challenge_a = read_server_text(&mut client_a).expect("challenge A should arrive");
    let _challenge_b = read_server_text(&mut client_b).expect("challenge B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"req-a","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_a = read_server_text(&mut client_a).expect("connect A should arrive");

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"req-b","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-b","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-b"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_b = read_server_text(&mut client_b).expect("connect B should arrive");

    drop(client_a);

    let presence_event = read_server_text(&mut client_b).expect("disconnect presence event should arrive");
    assert!(presence_event.contains("\"event\":\"presence\""));
    assert!(presence_event.contains("\"seq\":1"));
    assert!(presence_event.contains("\"stateVersion\":{\"presence\":3,\"health\":1}"));
    assert!(!presence_event.contains("\"instanceId\":\"instance-a\""));
    assert!(presence_event.contains("\"instanceId\":\"instance-b\""));

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"presence-after","method":"system-presence"}"#,
    );
    let updated_presence =
        read_server_text(&mut client_b).expect("updated system-presence should arrive");
    assert!(updated_presence.contains("\"id\":\"presence-after\""));
    assert!(!updated_presence.contains("\"instanceId\":\"instance-a\""));
    assert!(updated_presence.contains("\"instanceId\":\"instance-b\""));

    drop(client_b);
    join_server(handle);
}

#[test]
fn websocket_tick_and_health_broadcast_to_multiple_clients() {
    let (addr, handle) = spawn_server_with_config(
        "shadow-token",
        2,
        MaintenanceConfig {
            tick_interval_ms: 25,
            health_interval_ms: 25,
            heartbeat_interval_ms: 60_000,
        },
    );

    let mut client_a = open_ws(addr);
    let mut client_b = open_ws(addr);

    let _challenge_a = read_server_text(&mut client_a).expect("challenge A should arrive");
    let _challenge_b = read_server_text(&mut client_b).expect("challenge B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"req-a","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_a = read_server_text(&mut client_a).expect("connect A should arrive");

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"req-b","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-b","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-b"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_b = read_server_text(&mut client_b).expect("connect B should arrive");

    let event_a1 = read_server_text(&mut client_a).expect("event A1 should arrive");
    let event_b1 = read_server_text(&mut client_b).expect("event B1 should arrive");
    let event_a2 = read_server_text(&mut client_a).expect("event A2 should arrive");
    let event_b2 = read_server_text(&mut client_b).expect("event B2 should arrive");

    let events_a = [&event_a1, &event_a2];
    let events_b = [&event_b1, &event_b2];

    assert!(events_a.iter().any(|event| event.contains("\"event\":\"tick\"")));
    assert!(events_a.iter().any(|event| event.contains("\"event\":\"health\"")));
    assert!(events_b.iter().any(|event| event.contains("\"event\":\"tick\"")));
    assert!(events_b.iter().any(|event| event.contains("\"event\":\"health\"")));
    assert!(events_a.iter().any(|event| event.contains("\"seq\":1")));
    assert!(events_a.iter().any(|event| event.contains("\"seq\":2")));
    assert!(events_b.iter().any(|event| event.contains("\"seq\":1")));
    assert!(events_b.iter().any(|event| event.contains("\"seq\":2")));
    assert!(events_a.iter().any(|event| event.contains("\"stateVersion\":{\"presence\":2,\"health\":1}")));
    assert!(events_b.iter().any(|event| event.contains("\"stateVersion\":{\"presence\":2,\"health\":1}")));

    drop(client_a);
    drop(client_b);
    join_server(handle);
}

#[test]
fn websocket_broadcasts_heartbeat_and_serves_last_heartbeat() {
    let (addr, handle) = spawn_server_with_config(
        "shadow-token",
        1,
        MaintenanceConfig {
            tick_interval_ms: 60_000,
            health_interval_ms: 60_000,
            heartbeat_interval_ms: 25,
        },
    );

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect response should arrive");

    let heartbeat = read_server_text(&mut client).expect("heartbeat event should arrive");
    assert!(heartbeat.contains("\"type\":\"event\""));
    assert!(heartbeat.contains("\"event\":\"heartbeat\""));
    assert!(heartbeat.contains("\"status\":\"ok-empty\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"hb-last","method":"last-heartbeat"}"#);
    let last = read_server_text(&mut client).expect("last-heartbeat response should arrive");
    assert!(last.contains("\"type\":\"res\""));
    assert!(last.contains("\"id\":\"hb-last\""));
    assert!(last.contains("\"ok\":true"));
    assert!(last.contains("\"status\":\"ok-empty\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"hb-toggle","method":"set-heartbeats","params":{"enabled":false}}"#,
    );
    let toggle = read_server_text(&mut client).expect("set-heartbeats response should arrive");
    assert!(toggle.contains("\"type\":\"res\""));
    assert!(toggle.contains("\"id\":\"hb-toggle\""));
    assert!(toggle.contains("\"enabled\":false"));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_talk_mode_round_trips_and_fans_out() {
    let (addr, handle) = spawn_server_with_limit("shadow-token", 2);

    let mut client_a = open_ws(addr);
    let mut client_b = open_ws(addr);

    let _challenge_a = read_server_text(&mut client_a).expect("challenge A should arrive");
    let _challenge_b = read_server_text(&mut client_b).expect("challenge B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"req-a","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_a = read_server_text(&mut client_a).expect("connect A should arrive");

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"req-b","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-b","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-b"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_b = read_server_text(&mut client_b).expect("connect B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"talk-1","method":"talk.mode","params":{"enabled":true,"phase":"listening"}}"#,
    );
    let response = read_server_text(&mut client_a).expect("talk.mode response should arrive");
    assert!(response.contains("\"id\":\"talk-1\""));
    assert!(response.contains("\"ok\":true"));
    assert!(response.contains("\"enabled\":true"));
    assert!(response.contains("\"phase\":\"listening\""));

    let event_a = read_server_text(&mut client_a).expect("talk.mode event should arrive on A");
    let event_b = read_server_text(&mut client_b).expect("talk.mode event should arrive on B");
    assert_eq!(event_a, event_b);
    assert!(event_a.contains("\"event\":\"talk.mode\""));
    assert!(event_a.contains("\"enabled\":true"));
    assert!(event_a.contains("\"phase\":\"listening\""));

    drop(client_a);
    drop(client_b);
    join_server(handle);
}

#[test]
fn websocket_voicewake_round_trips_and_fans_out() {
    let (addr, handle) = spawn_server_with_limit("shadow-token", 2);

    let mut client_a = open_ws(addr);
    let mut client_b = open_ws(addr);

    let _challenge_a = read_server_text(&mut client_a).expect("challenge A should arrive");
    let _challenge_b = read_server_text(&mut client_b).expect("challenge B should arrive");

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"req-a","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_a = read_server_text(&mut client_a).expect("connect A should arrive");

    send_masked_text(
        &mut client_b,
        r#"{"type":"req","id":"req-b","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-b","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-b"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect_b = read_server_text(&mut client_b).expect("connect B should arrive");

    send_masked_text(&mut client_a, r#"{"type":"req","id":"vw-get","method":"voicewake.get"}"#);
    let get_res = read_server_text(&mut client_a).expect("voicewake.get response should arrive");
    assert!(get_res.contains("\"id\":\"vw-get\""));
    assert!(get_res.contains("\"triggers\""));
    assert!(get_res.contains("\"argent\""));

    send_masked_text(
        &mut client_a,
        r#"{"type":"req","id":"vw-set","method":"voicewake.set","params":{"triggers":["argent","computer","nova"]}}"#,
    );
    let set_res = read_server_text(&mut client_a).expect("voicewake.set response should arrive");
    assert!(set_res.contains("\"id\":\"vw-set\""));
    assert!(set_res.contains("\"nova\""));

    let event_a = read_server_text(&mut client_a).expect("voicewake.changed should arrive on A");
    let event_b = read_server_text(&mut client_b).expect("voicewake.changed should arrive on B");
    assert_eq!(event_a, event_b);
    assert!(event_a.contains("\"event\":\"voicewake.changed\""));
    assert!(event_a.contains("\"nova\""));

    drop(client_a);
    drop(client_b);
    join_server(handle);
}

#[test]
fn websocket_wake_enqueues_status_and_triggers_heartbeat() {
    let (addr, handle) = spawn_server_with_limit("shadow-token", 1);

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"wake-1","method":"wake","params":{"mode":"now","text":"Wake from test"}}"#,
    );
    let response = read_server_text(&mut client).expect("wake response should arrive");
    assert!(response.contains("\"id\":\"wake-1\""));
    assert!(response.contains("\"ok\":true"));

    let heartbeat = read_server_text(&mut client).expect("wake heartbeat should arrive");
    assert!(heartbeat.contains("\"event\":\"heartbeat\""));
    assert!(heartbeat.contains("\"status\":\"ok-empty\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"status-1","method":"status"}"#);
    let status = read_server_text(&mut client).expect("status response should arrive");
    assert!(status.contains("\"id\":\"status-1\""));
    assert!(status.contains("Wake from test"));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_catalog_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"models-1","method":"models.list"}"#);
    let models = read_server_text(&mut client).expect("models.list response should arrive");
    assert!(models.contains("\"id\":\"models-1\""));
    assert!(models.contains("\"models\""));
    assert!(models.contains("\"shadow-gpt-mini\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"connectors-1","method":"connectors.catalog"}"#,
    );
    let connectors =
        read_server_text(&mut client).expect("connectors.catalog response should arrive");
    assert!(connectors.contains("\"id\":\"connectors-1\""));
    assert!(connectors.contains("\"connectors\""));
    assert!(connectors.contains("\"aos-shadow\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_usage_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"usage-status","method":"usage.status"}"#);
    let usage_status = read_server_text(&mut client).expect("usage.status response should arrive");
    assert!(usage_status.contains("\"id\":\"usage-status\""));
    assert!(usage_status.contains("\"providers\""));
    assert!(usage_status.contains("\"openai-codex\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"usage-cost","method":"usage.cost","params":{"days":30}}"#,
    );
    let usage_cost = read_server_text(&mut client).expect("usage.cost response should arrive");
    assert!(usage_cost.contains("\"id\":\"usage-cost\""));
    assert!(usage_cost.contains("\"totals\""));
    assert!(usage_cost.contains("\"totalTokens\":165"));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_tools_and_skills_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"bins-1","method":"skills.bins"}"#);
    let bins = read_server_text(&mut client).expect("skills.bins response should arrive");
    assert!(bins.contains("\"id\":\"bins-1\""));
    assert!(bins.contains("\"bins\""));
    assert!(bins.contains("\"git\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"tools-1","method":"tools.status"}"#);
    let tools = read_server_text(&mut client).expect("tools.status response should arrive");
    assert!(tools.contains("\"id\":\"tools-1\""));
    assert!(tools.contains("\"tools\""));
    assert!(tools.contains("\"health\""));
    assert!(tools.contains("\"system-event\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_agents_and_skills_status_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"agents-1","method":"agents.list"}"#);
    let agents = read_server_text(&mut client).expect("agents.list response should arrive");
    assert!(agents.contains("\"id\":\"agents-1\""));
    assert!(agents.contains("\"defaultId\":\"argent\""));
    assert!(agents.contains("\"agents\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"skills-1","method":"skills.status"}"#);
    let skills = read_server_text(&mut client).expect("skills.status response should arrive");
    assert!(skills.contains("\"id\":\"skills-1\""));
    assert!(skills.contains("\"workspaceDir\""));
    assert!(skills.contains("\"skills\""));
    assert!(skills.contains("\"shadow-routing\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_tts_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"tts-status","method":"tts.status"}"#);
    let tts_status = read_server_text(&mut client).expect("tts.status response should arrive");
    assert!(tts_status.contains("\"id\":\"tts-status\""));
    assert!(tts_status.contains("\"provider\":\"openai\""));
    assert!(tts_status.contains("\"edgeEnabled\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"tts-providers","method":"tts.providers"}"#,
    );
    let tts_providers =
        read_server_text(&mut client).expect("tts.providers response should arrive");
    assert!(tts_providers.contains("\"id\":\"tts-providers\""));
    assert!(tts_providers.contains("\"providers\""));
    assert!(tts_providers.contains("\"OpenAI\""));
    assert!(tts_providers.contains("\"ElevenLabs\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_tts_write_methods_update_status() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"tts-enable","method":"tts.enable"}"#);
    let enable = read_server_text(&mut client).expect("tts.enable response should arrive");
    assert!(enable.contains("\"id\":\"tts-enable\""));
    assert!(enable.contains("\"enabled\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"tts-provider","method":"tts.setProvider","params":{"provider":"edge"}}"#,
    );
    let provider = read_server_text(&mut client).expect("tts.setProvider response should arrive");
    assert!(provider.contains("\"id\":\"tts-provider\""));
    assert!(provider.contains("\"provider\":\"edge\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"tts-status-2","method":"tts.status"}"#);
    let status = read_server_text(&mut client).expect("tts.status response should arrive");
    assert!(status.contains("\"id\":\"tts-status-2\""));
    assert!(status.contains("\"enabled\":true"));
    assert!(status.contains("\"provider\":\"edge\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"tts-disable","method":"tts.disable"}"#);
    let disable = read_server_text(&mut client).expect("tts.disable response should arrive");
    assert!(disable.contains("\"id\":\"tts-disable\""));
    assert!(disable.contains("\"enabled\":false"));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_commands_and_providers_status_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"commands-1","method":"commands.list"}"#);
    let commands = read_server_text(&mut client).expect("commands.list response should arrive");
    assert!(commands.contains("\"id\":\"commands-1\""));
    assert!(commands.contains("\"commands\""));
    assert!(commands.contains("\"/status\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"providers-1","method":"providers.status"}"#,
    );
    let providers =
        read_server_text(&mut client).expect("providers.status response should arrive");
    assert!(providers.contains("\"id\":\"providers-1\""));
    assert!(providers.contains("\"providers\""));
    assert!(providers.contains("\"shadow-default\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_family_and_logs_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"family-1","method":"family.members"}"#);
    let family = read_server_text(&mut client).expect("family.members response should arrive");
    assert!(family.contains("\"id\":\"family-1\""));
    assert!(family.contains("\"members\""));
    assert!(family.contains("\"argent\""));

    send_masked_text(&mut client, r#"{"type":"req","id":"logs-1","method":"logs.tail"}"#);
    let logs = read_server_text(&mut client).expect("logs.tail response should arrive");
    assert!(logs.contains("\"id\":\"logs-1\""));
    assert!(logs.contains("\"shadow.log\""));
    assert!(logs.contains("\"lines\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_control_methods_emit_parity_events() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"intent-sim-evt-1","method":"intent.simulate","params":{"agentId":"main"}}"#,
    );
    let (intent_res, intent_evt) = read_response_and_event(
        &mut client,
        "intent-sim-evt-1",
        "intent.simulation",
        10,
    )
    .expect("intent.simulate response and event should arrive");
    assert!(intent_res.contains("\"ok\":false"));
    assert!(intent_evt.contains("\"status\":\"error\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approval-request-evt-1","method":"exec.approval.request","params":{"command":"echo ok","cwd":"/tmp","host":"node","timeoutMs":2000}}"#,
    );
    let (exec_req_res, exec_req_evt) = read_response_and_event(
        &mut client,
        "exec-approval-request-evt-1",
        "exec.approval.requested",
        10,
    )
    .expect("exec.approval.request response and event should arrive");
    assert!(exec_req_res.contains("\"decision\":\"allow-once\""));
    assert!(exec_req_evt.contains("\"id\":\"approval-123\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approval-resolve-evt-1","method":"exec.approval.resolve","params":{"id":"approval-123","decision":"allow-once"}}"#,
    );
    let (exec_resolve_res, exec_resolve_evt) = read_response_and_event(
        &mut client,
        "exec-approval-resolve-evt-1",
        "exec.approval.resolved",
        10,
    )
    .expect("exec.approval.resolve response and event should arrive");
    assert!(exec_resolve_res.contains("\"ok\":true"));
    assert!(exec_resolve_evt.contains("\"decision\":\"allow-once\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-request-evt-1","method":"node.pair.request","params":{"nodeId":"node-shadow-1","displayName":"Shadow Node","platform":"macos","version":"0.1.0","deviceFamily":"Mac","commands":["canvas.snapshot"]}}"#,
    );
    let (node_pair_req_res, node_pair_req_evt) = read_response_and_event(
        &mut client,
        "node-pair-request-evt-1",
        "node.pair.requested",
        10,
    )
    .expect("node.pair.request response and event should arrive");
    assert!(node_pair_req_res.contains("\"status\":\"pending\""));
    assert!(node_pair_req_evt.contains("\"requestId\":\"node-pair-req-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-approve-evt-1","method":"node.pair.approve","params":{"requestId":"node-pair-req-1"}}"#,
    );
    let (node_pair_approve_res, node_pair_approve_evt) = read_response_and_event(
        &mut client,
        "node-pair-approve-evt-1",
        "node.pair.resolved",
        10,
    )
    .expect("node.pair.approve response and event should arrive");
    assert!(node_pair_approve_res.contains("\"paired\":true"));
    assert!(node_pair_approve_evt.contains("\"decision\":\"approved\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-invoke-evt-1","method":"node.invoke","params":{"nodeId":"node-shadow-1","command":"canvas.snapshot","params":{"format":"png"},"idempotencyKey":"allowlist-3"}}"#,
    );
    let (node_invoke_res, node_invoke_evt) = read_response_and_event(
        &mut client,
        "node-invoke-evt-1",
        "node.invoke.request",
        10,
    )
    .expect("node.invoke response and event should arrive");
    assert!(node_invoke_res.contains("\"command\":\"canvas.snapshot\""));
    assert!(node_invoke_evt.contains("\"command\":\"canvas.snapshot\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-pair-list-evt-1","method":"device.pair.list"}"#,
    );
    let (device_pair_list_res, device_pair_requested_evt) = read_response_and_event(
        &mut client,
        "device-pair-list-evt-1",
        "device.pair.requested",
        10,
    )
    .expect("device.pair.list response and event should arrive");
    assert!(device_pair_list_res.contains("\"deviceId\":\"device-shadow-iphone\""));
    assert!(device_pair_requested_evt.contains("\"requestId\":\"pair-req-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-pair-approve-evt-1","method":"device.pair.approve","params":{"requestId":"pair-req-1"}}"#,
    );
    let (device_pair_approve_res, device_pair_evt) = read_response_and_event(
        &mut client,
        "device-pair-approve-evt-1",
        "device.pair.resolved",
        10,
    )
    .expect("device.pair.approve response and event should arrive");
    assert!(device_pair_approve_res.contains("\"deviceId\":\"device-shadow-iphone\""));
    assert!(device_pair_evt.contains("\"decision\":\"approved\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"chat-send-evt-1","method":"chat.send","params":{"sessionKey":"main","message":"hello","idempotencyKey":"idem-status-1"}}"#,
    );
    let (chat_send_res, chat_send_evt) =
        read_response_and_event(&mut client, "chat-send-evt-1", "chat", 10)
            .expect("chat.send response and event should arrive");
    assert!(chat_send_res.contains("\"status\":\"started\""));
    assert!(chat_send_evt.contains("\"state\":\"final\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"agent-evt-1","method":"agent","params":{"message":"test","agentId":"main","sessionKey":"agent:main:main","idempotencyKey":"test-idem"}}"#,
    );
    let (agent_res, agent_evt) =
        read_response_and_event(&mut client, "agent-evt-1", "agent", 10)
            .expect("agent response and event should arrive");
    assert!(agent_res.contains("\"status\":\"queued\""));
    assert!(agent_evt.contains("\"runId\":\"test-idem\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-add-evt-1","method":"cron.add","params":{"name":"daily","enabled":true,"schedule":{"kind":"every","everyMs":60000},"sessionTarget":"main","wakeMode":"next-heartbeat","payload":{"kind":"systemEvent","text":"hello"}}}"#,
    );
    let (cron_add_res, cron_evt) =
        read_response_and_event(&mut client, "cron-add-evt-1", "cron", 10)
            .expect("cron.add response and event should arrive");
    assert!(cron_add_res.contains("\"name\":\"daily\""));
    assert!(cron_evt.contains("\"action\":\"added\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_channels_and_wizard_status_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"channels-1","method":"channels.status"}"#);
    let channels = read_server_text(&mut client).expect("channels.status response should arrive");
    assert!(channels.contains("\"id\":\"channels-1\""));
    assert!(channels.contains("\"channelOrder\""));
    assert!(channels.contains("\"whatsapp\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"wizard-1","method":"wizard.status","params":{"sessionId":"shadow-wizard"}}"#,
    );
    let wizard = read_server_text(&mut client).expect("wizard.status response should arrive");
    assert!(wizard.contains("\"id\":\"wizard-1\""));
    assert!(wizard.contains("\"status\":\"running\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_sessions_list_and_preview_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"sessions-1","method":"sessions.list"}"#);
    let list = read_server_text(&mut client).expect("sessions.list response should arrive");
    assert!(list.contains("\"id\":\"sessions-1\""));
    assert!(list.contains("\"sessions\""));
    assert!(list.contains("\"count\":1"));
    assert!(list.contains("\"agent:argent:main\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"preview-1","method":"sessions.preview","params":{"keys":["main"],"limit":3,"maxChars":120}}"#,
    );
    let preview = read_server_text(&mut client).expect("sessions.preview response should arrive");
    assert!(preview.contains("\"id\":\"preview-1\""));
    assert!(preview.contains("\"previews\""));
    assert!(preview.contains("\"call weather\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_sessions_resolve_and_search_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"resolve-1","method":"sessions.resolve","params":{"key":"main"}}"#,
    );
    let resolved =
        read_response_for_id(&mut client, "resolve-1", 10).expect("sessions.resolve response should arrive");
    assert!(resolved.contains("\"id\":\"resolve-1\""));
    assert!(resolved.contains("\"key\":\"agent:argent:main\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"search-1","method":"sessions.search","params":{"query":"forecast","limit":10,"snippetChars":120}}"#,
    );
    let search =
        read_response_for_id(&mut client, "search-1", 10).expect("sessions.search response should arrive");
    assert!(search.contains("\"id\":\"search-1\""));
    assert!(search.contains("\"hits\""));
    assert!(search.contains("\"Forecast ready\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_agents_files_methods_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"files-list-1","method":"agents.files.list","params":{"agentId":"argent"}}"#,
    );
    let files_list =
        read_server_text(&mut client).expect("agents.files.list response should arrive");
    assert!(files_list.contains("\"id\":\"files-list-1\""));
    assert!(files_list.contains("\"files\""));
    assert!(files_list.contains("\"IDENTITY.md\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"files-get-1","method":"agents.files.get","params":{"agentId":"argent","name":"IDENTITY.md"}}"#,
    );
    let file_get = read_server_text(&mut client).expect("agents.files.get response should arrive");
    assert!(file_get.contains("\"id\":\"files-get-1\""));
    assert!(file_get.contains("\"content\""));
    assert!(file_get.contains("\"IDENTITY.md\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_config_and_runtime_reads_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"config-get-1","method":"config.get"}"#);
    let config_get = read_server_text(&mut client).expect("config.get response should arrive");
    assert!(config_get.contains("\"id\":\"config-get-1\""));
    assert!(config_get.contains("\"path\":\"/Users/shadow/.argentos/argent.json\""));
    assert!(config_get.contains("\"hash\":\"shadow-config-hash\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"config-schema-1","method":"config.schema"}"#,
    );
    let config_schema =
        read_server_text(&mut client).expect("config.schema response should arrive");
    assert!(config_schema.contains("\"id\":\"config-schema-1\""));
    assert!(config_schema.contains("\"version\":\"shadow-schema-v1\""));
    assert!(config_schema.contains("\"gateway.auth.token\":{\"sensitive\":true}"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"worker-status-1","method":"execution.worker.status","params":{"agentId":"argent"}}"#,
    );
    let worker_status =
        read_server_text(&mut client).expect("execution.worker.status should arrive");
    assert!(worker_status.contains("\"id\":\"worker-status-1\""));
    assert!(worker_status.contains("\"agentCount\":1"));
    assert!(worker_status.contains("\"agentId\":\"argent\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approvals-1","method":"exec.approvals.get"}"#,
    );
    let exec_approvals =
        read_server_text(&mut client).expect("exec.approvals.get response should arrive");
    assert!(exec_approvals.contains("\"id\":\"exec-approvals-1\""));
    assert!(exec_approvals.contains("\"hash\":\"shadow-exec-approvals-hash\""));
    assert!(exec_approvals.contains("\"security\":\"deny\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-overview-1","method":"copilot.overview"}"#,
    );
    let copilot_overview =
        read_server_text(&mut client).expect("copilot.overview response should arrive");
    assert!(copilot_overview.contains("\"id\":\"copilot-overview-1\""));
    assert!(copilot_overview.contains("\"intentHistoryCount\":1"));
    assert!(copilot_overview.contains("\"domain\":\"workforce\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-workforce-1","method":"copilot.workforce.overview"}"#,
    );
    let copilot_workforce = read_server_text(&mut client)
        .expect("copilot.workforce.overview response should arrive");
    assert!(copilot_workforce.contains("\"id\":\"copilot-workforce-1\""));
    assert!(copilot_workforce.contains("\"templatesCount\":2"));
    assert!(copilot_workforce.contains("\"workersCount\":2"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-observability-1","method":"copilot.observability.overview","params":{"horizonDays":7}}"#,
    );
    let copilot_observability = read_server_text(&mut client)
        .expect("copilot.observability.overview response should arrive");
    assert!(copilot_observability.contains("\"id\":\"copilot-observability-1\""));
    assert!(copilot_observability.contains("\"horizonDays\":7"));
    assert!(copilot_observability.contains("\"totalRuns\":12"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-mode-1","method":"copilot.mode.get","params":{"domain":"workforce"}}"#,
    );
    let copilot_mode =
        read_server_text(&mut client).expect("copilot.mode.get response should arrive");
    assert!(copilot_mode.contains("\"id\":\"copilot-mode-1\""));
    assert!(copilot_mode.contains("\"domain\":\"workforce\""));
    assert!(copilot_mode.contains("\"mode\":\"assist-draft\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-status-1","method":"cron.status"}"#,
    );
    let cron_status =
        read_server_text(&mut client).expect("cron.status response should arrive");
    assert!(cron_status.contains("\"id\":\"cron-status-1\""));
    assert!(cron_status.contains("\"enabled\":true"));
    assert!(cron_status.contains("\"jobs\":3"));
    assert!(cron_status.contains("\"storePath\":\"/Users/shadow/.argentos/cron/jobs.json\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-pair-list-1","method":"device.pair.list"}"#,
    );
    let device_pair_list =
        read_server_text(&mut client).expect("device.pair.list response should arrive");
    assert!(device_pair_list.contains("\"id\":\"device-pair-list-1\""));
    assert!(device_pair_list.contains("\"pending\""));
    assert!(device_pair_list.contains("\"paired\""));
    assert!(device_pair_list.contains("\"device-shadow-iphone\""));
    let _device_pair_requested = read_until(
        &mut client,
        |msg| msg.contains("\"event\":\"device.pair.requested\""),
        5,
    )
    .expect("device.pair.requested event should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"agent-identity-1","method":"agent.identity.get","params":{"agentId":"argent"}}"#,
    );
    let agent_identity = read_response_for_id(&mut client, "agent-identity-1", 10)
        .expect("agent.identity.get response should arrive");
    assert!(agent_identity.contains("\"id\":\"agent-identity-1\""));
    assert!(agent_identity.contains("\"agentId\":\"argent\""));
    assert!(agent_identity.contains("\"name\":\"Argent\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-collections-1","method":"knowledge.collections.list","params":{"options":{"agentId":"argent"}}}"#,
    );
    let knowledge_collections = read_server_text(&mut client)
        .expect("knowledge.collections.list response should arrive");
    assert!(knowledge_collections.contains("\"id\":\"knowledge-collections-1\""));
    assert!(knowledge_collections.contains("\"success\":true"));
    assert!(knowledge_collections.contains("\"collections\""));
    assert!(knowledge_collections.contains("\"operator-notes\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-list-1","method":"node.pair.list"}"#,
    );
    let node_pair_list =
        read_server_text(&mut client).expect("node.pair.list response should arrive");
    assert!(node_pair_list.contains("\"id\":\"node-pair-list-1\""));
    assert!(node_pair_list.contains("\"pending\""));
    assert!(node_pair_list.contains("\"paired\""));
    assert!(node_pair_list.contains("\"node-shadow-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-list-1","method":"cron.list","params":{"includeDisabled":true}}"#,
    );
    let cron_list = read_server_text(&mut client).expect("cron.list response should arrive");
    assert!(cron_list.contains("\"id\":\"cron-list-1\""));
    assert!(cron_list.contains("\"jobs\""));
    assert!(cron_list.contains("\"name\":\"daily\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-library-1","method":"knowledge.library.list","params":{"options":{"limit":10}}}"#,
    );
    let knowledge_library =
        read_server_text(&mut client).expect("knowledge.library.list response should arrive");
    assert!(knowledge_library.contains("\"id\":\"knowledge-library-1\""));
    assert!(knowledge_library.contains("\"results\""));
    assert!(knowledge_library.contains("\"Shadow Runbook\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-overview-1","method":"jobs.overview"}"#,
    );
    let jobs_overview =
        read_server_text(&mut client).expect("jobs.overview response should arrive");
    assert!(jobs_overview.contains("\"id\":\"jobs-overview-1\""));
    assert!(jobs_overview.contains("\"templatesCount\":2"));
    assert!(jobs_overview.contains("\"agents\""));
    assert!(jobs_overview.contains("\"agentId\":\"argent\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"contemplation-1","method":"contemplation.runOnce","params":{"agentId":"argent"}}"#,
    );
    let contemplation =
        read_server_text(&mut client).expect("contemplation.runOnce response should arrive");
    assert!(contemplation.contains("\"id\":\"contemplation-1\""));
    assert!(contemplation.contains("\"agentId\":\"argent\""));
    assert!(contemplation.contains("\"status\":\"ran\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"agent-wait-1","method":"agent.wait","params":{"runId":"run-wait-1","timeoutMs":1000}}"#,
    );
    let agent_wait = read_server_text(&mut client).expect("agent.wait response should arrive");
    assert!(agent_wait.contains("\"id\":\"agent-wait-1\""));
    assert!(agent_wait.contains("\"runId\":\"run-wait-1\""));
    assert!(agent_wait.contains("\"status\":\"ok\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-event-1","method":"node.event","params":{"event":"test","payload":{"ok":true}}}"#,
    );
    let node_event = read_server_text(&mut client).expect("node.event response should arrive");
    assert!(node_event.contains("\"id\":\"node-event-1\""));
    assert!(node_event.contains("\"ok\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-mode-set-1","method":"copilot.mode.set","params":{"domain":"workforce","mode":"assist-live-limited"}}"#,
    );
    let copilot_mode_set =
        read_server_text(&mut client).expect("copilot.mode.set response should arrive");
    assert!(copilot_mode_set.contains("\"id\":\"copilot-mode-set-1\""));
    assert!(copilot_mode_set.contains("\"domain\":\"workforce\""));
    assert!(copilot_mode_set.contains("\"mode\":\"assist-live-limited\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"config-set-1","method":"config.set","params":{"raw":"{\"gateway\":{\"mode\":\"local\"},\"channels\":{\"telegram\":{\"botToken\":\"token-1\"}}}"}}"#,
    );
    let config_set = read_server_text(&mut client).expect("config.set response should arrive");
    assert!(config_set.contains("\"id\":\"config-set-1\""));
    assert!(config_set.contains("\"ok\":true"));
    assert!(config_set.contains("\"path\":\"/Users/shadow/.argentos/argent.json\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"family-register-1","method":"family.register","params":{"id":"relay","name":"Relay","role":"tier_1_support_specialist","team":"Support Team"}}"#,
    );
    let family_register =
        read_server_text(&mut client).expect("family.register response should arrive");
    assert!(family_register.contains("\"id\":\"family-register-1\""));
    assert!(family_register.contains("\"worker\""));
    assert!(family_register.contains("\"id\":\"relay\""));
    assert!(family_register.contains("\"team\":\"Support Team\""));

    send_masked_text(
        &mut client,
        r##"{"type":"req","id":"agents-files-set-1","method":"agents.files.set","params":{"agentId":"argent","name":"IDENTITY.md","content":"# IDENTITY\nShadow edit\n"}}"##,
    );
    let agents_files_set =
        read_server_text(&mut client).expect("agents.files.set response should arrive");
    assert!(agents_files_set.contains("\"id\":\"agents-files-set-1\""));
    assert!(agents_files_set.contains("\"ok\":true"));
    assert!(agents_files_set.contains("\"name\":\"IDENTITY.md\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"sessions-compact-1","method":"sessions.compact","params":{"key":"agent:main:main","maxLines":3}}"#,
    );
    let sessions_compact =
        read_server_text(&mut client).expect("sessions.compact response should arrive");
    assert!(sessions_compact.contains("\"id\":\"sessions-compact-1\""));
    assert!(sessions_compact.contains("\"ok\":true"));
    assert!(sessions_compact.contains("\"compacted\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-run-1","method":"cron.run","params":{"id":"cron-shadow-1","mode":"force"}}"#,
    );
    let cron_run =
        read_response_for_id(&mut client, "cron-run-1", 10).expect("cron.run response should arrive");
    assert!(cron_run.contains("\"id\":\"cron-run-1\""));
    assert!(cron_run.contains("\"ok\":true"));
    assert!(cron_run.contains("\"ran\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-runs-1","method":"cron.runs","params":{"id":"cron-shadow-1","limit":50}}"#,
    );
    let cron_runs =
        read_response_for_id(&mut client, "cron-runs-1", 10).expect("cron.runs response should arrive");
    assert!(cron_runs.contains("\"id\":\"cron-runs-1\""));
    assert!(cron_runs.contains("\"entries\""));
    assert!(cron_runs.contains("\"jobId\":\"cron-shadow-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"commands-compact-1","method":"commands.compact","params":{"sessionKey":"agent:argent:main"}}"#,
    );
    let commands_compact =
        read_server_text(&mut client).expect("commands.compact response should arrive");
    assert!(commands_compact.contains("\"id\":\"commands-compact-1\""));
    assert!(commands_compact.contains("\"compacted\":true"));
    assert!(commands_compact.contains("\"tokensBefore\":4000"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"channels-logout-1","method":"channels.logout","params":{"channel":"telegram"}}"#,
    );
    let channels_logout =
        read_server_text(&mut client).expect("channels.logout response should arrive");
    assert!(channels_logout.contains("\"id\":\"channels-logout-1\""));
    assert!(channels_logout.contains("\"channel\":\"telegram\""));
    assert!(channels_logout.contains("\"cleared\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"config-patch-1","method":"config.patch","params":{"raw":"{\"channels\":{\"telegram\":{\"groups\":{\"*\":{\"requireMention\":false}}}}}","baseHash":"shadow-config-hash","sessionKey":"agent:main:whatsapp:dm:+15555550123","note":"test patch","restartDelayMs":0}}"#,
    );
    let config_patch = read_server_text(&mut client).expect("config.patch response should arrive");
    assert!(config_patch.contains("\"id\":\"config-patch-1\""));
    assert!(config_patch.contains("\"ok\":true"));
    assert!(config_patch.contains("\"reason\":\"config.patch\""));
    assert!(config_patch.contains("\"kind\":\"config-apply\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"config-apply-1","method":"config.apply","params":{"raw":"{ \"agents\": { \"list\": [{ \"id\": \"main\", \"workspace\": \"~/argent\" }] } }","sessionKey":"agent:main:whatsapp:dm:+15555550123","restartDelayMs":0}}"#,
    );
    let config_apply = read_server_text(&mut client).expect("config.apply response should arrive");
    assert!(config_apply.contains("\"id\":\"config-apply-1\""));
    assert!(config_apply.contains("\"ok\":true"));
    assert!(config_apply.contains("\"reason\":\"config.apply\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-add-1","method":"cron.add","params":{"name":"daily","enabled":true,"schedule":{"kind":"every","everyMs":60000},"sessionTarget":"main","wakeMode":"next-heartbeat","payload":{"kind":"systemEvent","text":"hello"}}}"#,
    );
    let cron_add =
        read_response_for_id(&mut client, "cron-add-1", 10).expect("cron.add response should arrive");
    assert!(cron_add.contains("\"id\":\"cron-add-1\""));
    assert!(cron_add.contains("\"name\":\"daily\""));
    assert!(cron_add.contains("\"sessionTarget\":\"main\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-remove-1","method":"cron.remove","params":{"id":"cron-shadow-new"}}"#,
    );
    let cron_remove =
        read_response_for_id(&mut client, "cron-remove-1", 10).expect("cron.remove response should arrive");
    assert!(cron_remove.contains("\"id\":\"cron-remove-1\""));
    assert!(cron_remove.contains("\"ok\":true"));
    assert!(cron_remove.contains("\"removed\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"copilot-run-story-1","method":"copilot.run.story","params":{"runId":"run-shadow-1"}}"#,
    );
    let copilot_run_story = read_response_for_id(&mut client, "copilot-run-story-1", 10)
        .expect("copilot.run.story response should arrive");
    assert!(copilot_run_story.contains("\"id\":\"copilot-run-story-1\""));
    assert!(copilot_run_story.contains("\"run\""));
    assert!(copilot_run_story.contains("\"assignmentRuns\""));
    assert!(copilot_run_story.contains("\"run-shadow-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-pair-approve-1","method":"device.pair.approve","params":{"requestId":"pair-req-1"}}"#,
    );
    let device_pair_approve = read_response_for_id(&mut client, "device-pair-approve-1", 10)
        .expect("device.pair.approve response should arrive");
    assert!(device_pair_approve.contains("\"id\":\"device-pair-approve-1\""));
    assert!(device_pair_approve.contains("\"requestId\":\"pair-req-1\""));
    assert!(device_pair_approve.contains("\"deviceId\":\"device-shadow-iphone\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-pair-reject-1","method":"device.pair.reject","params":{"requestId":"pair-req-1"}}"#,
    );
    let device_pair_reject = read_response_for_id(&mut client, "device-pair-reject-1", 10)
        .expect("device.pair.reject response should arrive");
    assert!(device_pair_reject.contains("\"id\":\"device-pair-reject-1\""));
    assert!(device_pair_reject.contains("\"rejected\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-token-rotate-1","method":"device.token.rotate","params":{"deviceId":"device-shadow-mac","role":"desktop","scopes":["gateway.connect"]}}"#,
    );
    let device_token_rotate = read_response_for_id(&mut client, "device-token-rotate-1", 10)
        .expect("device.token.rotate response should arrive");
    assert!(device_token_rotate.contains("\"id\":\"device-token-rotate-1\""));
    assert!(device_token_rotate.contains("\"token\":\"shadow-token-rotated\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"device-token-revoke-1","method":"device.token.revoke","params":{"deviceId":"device-shadow-mac","role":"desktop"}}"#,
    );
    let device_token_revoke = read_response_for_id(&mut client, "device-token-revoke-1", 10)
        .expect("device.token.revoke response should arrive");
    assert!(device_token_revoke.contains("\"id\":\"device-token-revoke-1\""));
    assert!(device_token_revoke.contains("\"revokedAtMs\":1776600000000"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approval-request-1","method":"exec.approval.request","params":{"command":"echo ok","cwd":"/tmp","host":"node","timeoutMs":2000}}"#,
    );
    let exec_approval_request = read_response_for_id(&mut client, "exec-approval-request-1", 10)
        .expect("exec.approval.request response should arrive");
    assert!(exec_approval_request.contains("\"id\":\"exec-approval-request-1\""));
    assert!(exec_approval_request.contains("\"decision\":\"allow-once\""));
    assert!(exec_approval_request.contains("\"expiresAtMs\":1776600120000"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approval-resolve-1","method":"exec.approval.resolve","params":{"id":"approval-123","decision":"allow-once"}}"#,
    );
    let exec_approval_resolve = read_response_for_id(&mut client, "exec-approval-resolve-1", 10)
        .expect("exec.approval.resolve response should arrive");
    assert!(exec_approval_resolve.contains("\"id\":\"exec-approval-resolve-1\""));
    assert!(exec_approval_resolve.contains("\"ok\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approvals-node-get-1","method":"exec.approvals.node.get","params":{"nodeId":"node-shadow-1"}}"#,
    );
    let exec_approvals_node_get = read_response_for_id(&mut client, "exec-approvals-node-get-1", 10)
        .expect("exec.approvals.node.get response should arrive");
    assert!(exec_approvals_node_get.contains("\"id\":\"exec-approvals-node-get-1\""));
    assert!(exec_approvals_node_get.contains("\"path\":\"/Users/shadow/.argentos/node-exec-approvals.json\""));
    assert!(exec_approvals_node_get.contains("\"hash\":\"shadow-node-exec-approvals-hash\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approvals-node-set-1","method":"exec.approvals.node.set","params":{"nodeId":"node-shadow-1","file":{"version":1},"baseHash":"shadow-node-exec-approvals-hash"}}"#,
    );
    let exec_approvals_node_set = read_response_for_id(&mut client, "exec-approvals-node-set-1", 10)
        .expect("exec.approvals.node.set response should arrive");
    assert!(exec_approvals_node_set.contains("\"id\":\"exec-approvals-node-set-1\""));
    assert!(exec_approvals_node_set.contains("\"hash\":\"shadow-node-exec-approvals-hash-next\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"exec-approvals-set-1","method":"exec.approvals.set","params":{"file":{"version":1},"baseHash":"shadow-exec-approvals-hash"}}"#,
    );
    let exec_approvals_set =
        read_server_text(&mut client).expect("exec.approvals.set response should arrive");
    assert!(exec_approvals_set.contains("\"id\":\"exec-approvals-set-1\""));
    assert!(exec_approvals_set.contains("\"hash\":\"shadow-exec-approvals-hash-next\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"execution-worker-pause-1","method":"execution.worker.pause","params":{"agentId":"relay"}}"#,
    );
    let execution_worker_pause =
        read_server_text(&mut client).expect("execution.worker.pause response should arrive");
    assert!(execution_worker_pause.contains("\"id\":\"execution-worker-pause-1\""));
    assert!(execution_worker_pause.contains("\"kind\":\"pause\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"execution-worker-resume-1","method":"execution.worker.resume","params":{"agentId":"relay"}}"#,
    );
    let execution_worker_resume =
        read_server_text(&mut client).expect("execution.worker.resume response should arrive");
    assert!(execution_worker_resume.contains("\"id\":\"execution-worker-resume-1\""));
    assert!(execution_worker_resume.contains("\"kind\":\"resume\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"execution-worker-reset-1","method":"execution.worker.metrics.reset","params":{"agentId":"relay"}}"#,
    );
    let execution_worker_reset = read_server_text(&mut client)
        .expect("execution.worker.metrics.reset response should arrive");
    assert!(execution_worker_reset.contains("\"id\":\"execution-worker-reset-1\""));
    assert!(execution_worker_reset.contains("\"kind\":\"metrics.reset\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"execution-worker-run-now-1","method":"execution.worker.runNow","params":{"agentId":"relay","reason":"operator-test"}}"#,
    );
    let execution_worker_run_now = read_server_text(&mut client)
        .expect("execution.worker.runNow response should arrive");
    assert!(execution_worker_run_now.contains("\"id\":\"execution-worker-run-now-1\""));
    assert!(execution_worker_run_now.contains("\"dispatch\""));
    assert!(execution_worker_run_now.contains("\"agentId\":\"relay\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-assignments-list-1","method":"jobs.assignments.list","params":{"agentId":"relay"}}"#,
    );
    let jobs_assignments_list = read_server_text(&mut client)
        .expect("jobs.assignments.list response should arrive");
    assert!(jobs_assignments_list.contains("\"id\":\"jobs-assignments-list-1\""));
    assert!(jobs_assignments_list.contains("\"assignments\""));
    assert!(jobs_assignments_list.contains("\"asn-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-assignments-create-1","method":"jobs.assignments.create","params":{"templateId":"tpl-pg-1","agentId":"relay","title":"Tier 1 Support Simulation","cadenceMinutes":1440,"executionMode":"simulate","deploymentStage":"simulate"}}"#,
    );
    let jobs_assignments_create = read_server_text(&mut client)
        .expect("jobs.assignments.create response should arrive");
    assert!(jobs_assignments_create.contains("\"id\":\"jobs-assignments-create-1\""));
    assert!(jobs_assignments_create.contains("\"assignment\""));
    assert!(jobs_assignments_create.contains("\"asn-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-assignments-update-1","method":"jobs.assignments.update","params":{"assignmentId":"asn-pg-1","title":"Tier 1 Support Updated","cadenceMinutes":60,"executionMode":"live","deploymentStage":"hold"}}"#,
    );
    let jobs_assignments_update = read_server_text(&mut client)
        .expect("jobs.assignments.update response should arrive");
    assert!(jobs_assignments_update.contains("\"id\":\"jobs-assignments-update-1\""));
    assert!(jobs_assignments_update.contains("\"Tier 1 Support Updated\""));
    assert!(jobs_assignments_update.contains("\"executionMode\":\"live\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-assignments-retire-1","method":"jobs.assignments.retire","params":{"assignmentId":"asn-1","force":true}}"#,
    );
    let jobs_assignments_retire = read_server_text(&mut client)
        .expect("jobs.assignments.retire response should arrive");
    assert!(jobs_assignments_retire.contains("\"id\":\"jobs-assignments-retire-1\""));
    assert!(jobs_assignments_retire.contains("\"runningRuns\":1"));
    assert!(jobs_assignments_retire.contains("\"assignment\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-assignments-run-now-1","method":"jobs.assignments.runNow","params":{"assignmentId":"asn-pg-1"}}"#,
    );
    let jobs_assignments_run_now = read_server_text(&mut client)
        .expect("jobs.assignments.runNow response should arrive");
    assert!(jobs_assignments_run_now.contains("\"id\":\"jobs-assignments-run-now-1\""));
    assert!(jobs_assignments_run_now.contains("\"queuedTasks\":1"));
    assert!(jobs_assignments_run_now.contains("\"assignmentId\":\"asn-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-runs-list-1","method":"jobs.runs.list","params":{"assignmentId":"asn-pg-1"}}"#,
    );
    let jobs_runs_list =
        read_server_text(&mut client).expect("jobs.runs.list response should arrive");
    assert!(jobs_runs_list.contains("\"id\":\"jobs-runs-list-1\""));
    assert!(jobs_runs_list.contains("\"runs\""));
    assert!(jobs_runs_list.contains("\"run-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-events-list-1","method":"jobs.events.list","params":{"source":"system","runId":"run-1"}}"#,
    );
    let jobs_events_list =
        read_server_text(&mut client).expect("jobs.events.list response should arrive");
    assert!(jobs_events_list.contains("\"id\":\"jobs-events-list-1\""));
    assert!(jobs_events_list.contains("\"events\""));
    assert!(jobs_events_list.contains("\"evt-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-runs-trace-1","method":"jobs.runs.trace","params":{"runId":"run-1"}}"#,
    );
    let jobs_runs_trace =
        read_server_text(&mut client).expect("jobs.runs.trace response should arrive");
    assert!(jobs_runs_trace.contains("\"id\":\"jobs-runs-trace-1\""));
    assert!(jobs_runs_trace.contains("\"assignmentRuns\""));
    assert!(jobs_runs_trace.contains("\"task\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-runs-review-1","method":"jobs.runs.review","params":{"runId":"run-pg-1","reviewStatus":"approved","reviewedBy":"operator","action":"promote"}}"#,
    );
    let jobs_runs_review =
        read_server_text(&mut client).expect("jobs.runs.review response should arrive");
    assert!(jobs_runs_review.contains("\"id\":\"jobs-runs-review-1\""));
    assert!(jobs_runs_review.contains("\"reviewStatus\":\"approved\""));
    assert!(jobs_runs_review.contains("\"run\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-runs-retry-1","method":"jobs.runs.retry","params":{"runId":"run-pg-1"}}"#,
    );
    let jobs_runs_retry =
        read_server_text(&mut client).expect("jobs.runs.retry response should arrive");
    assert!(jobs_runs_retry.contains("\"id\":\"jobs-runs-retry-1\""));
    assert!(jobs_runs_retry.contains("\"queuedTasks\":1"));
    assert!(jobs_runs_retry.contains("\"dispatched\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-orchestrator-status-1","method":"jobs.orchestrator.status"}"#,
    );
    let jobs_orchestrator_status = read_server_text(&mut client)
        .expect("jobs.orchestrator.status response should arrive");
    assert!(jobs_orchestrator_status.contains("\"id\":\"jobs-orchestrator-status-1\""));
    assert!(jobs_orchestrator_status.contains("\"enabled\":true"));
    assert!(jobs_orchestrator_status.contains("\"queued\":1"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-orchestrator-event-1","method":"jobs.orchestrator.event","params":{"eventType":"task.completed","source":"manual","targetAgentId":"relay","payload":{"ok":true}}}"#,
    );
    let jobs_orchestrator_event = read_server_text(&mut client)
        .expect("jobs.orchestrator.event response should arrive");
    assert!(jobs_orchestrator_event.contains("\"id\":\"jobs-orchestrator-event-1\""));
    assert!(jobs_orchestrator_event.contains("\"accepted\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-runs-advance-1","method":"jobs.runs.advance","params":{"runId":"run-pg-1","outcomeStatus":"completed","summary":"done","queueNext":true}}"#,
    );
    let jobs_runs_advance =
        read_server_text(&mut client).expect("jobs.runs.advance response should arrive");
    assert!(jobs_runs_advance.contains("\"id\":\"jobs-runs-advance-1\""));
    assert!(jobs_runs_advance.contains("\"queuedNext\":true"));
    assert!(jobs_runs_advance.contains("\"run\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-templates-list-1","method":"jobs.templates.list"}"#,
    );
    let jobs_templates_list =
        read_server_text(&mut client).expect("jobs.templates.list response should arrive");
    assert!(jobs_templates_list.contains("\"id\":\"jobs-templates-list-1\""));
    assert!(jobs_templates_list.contains("\"templates\""));
    assert!(jobs_templates_list.contains("\"tpl-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-templates-create-1","method":"jobs.templates.create","params":{"name":"Tier 1 Support","rolePrompt":"Handle tier 1 only","defaultMode":"simulate"}}"#,
    );
    let jobs_templates_create =
        read_server_text(&mut client).expect("jobs.templates.create response should arrive");
    assert!(jobs_templates_create.contains("\"id\":\"jobs-templates-create-1\""));
    assert!(jobs_templates_create.contains("\"template\""));
    assert!(jobs_templates_create.contains("\"tpl-pg-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-templates-update-1","method":"jobs.templates.update","params":{"templateId":"tpl-pg-1","name":"Tier 1 Support Updated"}}"#,
    );
    let jobs_templates_update =
        read_server_text(&mut client).expect("jobs.templates.update response should arrive");
    assert!(jobs_templates_update.contains("\"id\":\"jobs-templates-update-1\""));
    assert!(jobs_templates_update.contains("\"Tier 1 Support Updated\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"jobs-templates-retire-1","method":"jobs.templates.retire","params":{"templateId":"tpl-1","force":true,"disableLinkedAssignments":true}}"#,
    );
    let jobs_templates_retire =
        read_server_text(&mut client).expect("jobs.templates.retire response should arrive");
    assert!(jobs_templates_retire.contains("\"id\":\"jobs-templates-retire-1\""));
    assert!(jobs_templates_retire.contains("\"disabledAssignments\":1"));
    assert!(jobs_templates_retire.contains("\"linkedAssignments\":2"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-collections-grant-1","method":"knowledge.collections.grant","params":{"options":{"collection":"operator-notes","agentId":"relay","canRead":true,"canWrite":true}}}"#,
    );
    let knowledge_collections_grant = read_server_text(&mut client)
        .expect("knowledge.collections.grant response should arrive");
    assert!(knowledge_collections_grant.contains("\"id\":\"knowledge-collections-grant-1\""));
    assert!(knowledge_collections_grant.contains("\"success\":true"));
    assert!(knowledge_collections_grant.contains("\"targetAgentId\":\"relay\""));

    send_masked_text(
        &mut client,
        r##"{"type":"req","id":"knowledge-ingest-1","method":"knowledge.ingest","params":{"files":[{"fileName":"runbook.md","content":"# Runbook"}]}}"##,
    );
    let knowledge_ingest =
        read_server_text(&mut client).expect("knowledge.ingest response should arrive");
    assert!(knowledge_ingest.contains("\"id\":\"knowledge-ingest-1\""));
    assert!(knowledge_ingest.contains("\"success\":true"));
    assert!(knowledge_ingest.contains("\"processed\":1"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-vault-ingest-1","method":"knowledge.vault.ingest","params":{"options":{"limitFiles":10}}}"#,
    );
    let knowledge_vault_ingest =
        read_server_text(&mut client).expect("knowledge.vault.ingest response should arrive");
    assert!(knowledge_vault_ingest.contains("\"id\":\"knowledge-vault-ingest-1\""));
    assert!(knowledge_vault_ingest.contains("\"source\":\"vault\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-search-1","method":"knowledge.search","params":{"query":"shadow"}}"#,
    );
    let knowledge_search =
        read_server_text(&mut client).expect("knowledge.search response should arrive");
    assert!(knowledge_search.contains("\"id\":\"knowledge-search-1\""));
    assert!(knowledge_search.contains("\"results\""));
    assert!(knowledge_search.contains("\"Shadow Runbook\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-library-delete-1","method":"knowledge.library.delete","params":{"options":{"ids":["item-1"]}}}"#,
    );
    let knowledge_library_delete = read_server_text(&mut client)
        .expect("knowledge.library.delete response should arrive");
    assert!(knowledge_library_delete.contains("\"id\":\"knowledge-library-delete-1\""));
    assert!(knowledge_library_delete.contains("\"deleted\":1"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"knowledge-library-reindex-1","method":"knowledge.library.reindex","params":{"options":{"limit":1}}}"#,
    );
    let knowledge_library_reindex = read_server_text(&mut client)
        .expect("knowledge.library.reindex response should arrive");
    assert!(knowledge_library_reindex.contains("\"id\":\"knowledge-library-reindex-1\""));
    assert!(knowledge_library_reindex.contains("\"embedded\":1"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-request-1","method":"node.pair.request","params":{"nodeId":"node-shadow-1","displayName":"Shadow Node","platform":"macos","version":"0.1.0","deviceFamily":"Mac","commands":["canvas.snapshot"]}}"#,
    );
    let node_pair_request = read_response_for_id(&mut client, "node-pair-request-1", 10)
        .expect("node.pair.request response should arrive");
    assert!(node_pair_request.contains("\"id\":\"node-pair-request-1\""));
    assert!(node_pair_request.contains("\"status\":\"pending\""));
    assert!(node_pair_request.contains("\"requestId\":\"node-pair-req-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-approve-1","method":"node.pair.approve","params":{"requestId":"node-pair-req-1"}}"#,
    );
    let node_pair_approve = read_response_for_id(&mut client, "node-pair-approve-1", 10)
        .expect("node.pair.approve response should arrive");
    assert!(node_pair_approve.contains("\"id\":\"node-pair-approve-1\""));
    assert!(node_pair_approve.contains("\"requestId\":\"node-pair-req-1\""));
    assert!(node_pair_approve.contains("\"paired\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-reject-1","method":"node.pair.reject","params":{"requestId":"node-pair-req-1"}}"#,
    );
    let node_pair_reject = read_response_for_id(&mut client, "node-pair-reject-1", 10)
        .expect("node.pair.reject response should arrive");
    assert!(node_pair_reject.contains("\"id\":\"node-pair-reject-1\""));
    assert!(node_pair_reject.contains("\"rejected\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-pair-verify-1","method":"node.pair.verify","params":{"nodeId":"node-shadow-1","token":"verify-token"}}"#,
    );
    let node_pair_verify = read_response_for_id(&mut client, "node-pair-verify-1", 10)
        .expect("node.pair.verify response should arrive");
    assert!(node_pair_verify.contains("\"id\":\"node-pair-verify-1\""));
    assert!(node_pair_verify.contains("\"verified\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-rename-1","method":"node.rename","params":{"nodeId":"node-shadow-1","displayName":"Shadow Node Renamed"}}"#,
    );
    let node_rename =
        read_response_for_id(&mut client, "node-rename-1", 10).expect("node.rename response should arrive");
    assert!(node_rename.contains("\"id\":\"node-rename-1\""));
    assert!(node_rename.contains("\"displayName\":\"Shadow Node Renamed\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-invoke-1","method":"node.invoke","params":{"nodeId":"node-shadow-1","command":"canvas.snapshot","params":{"format":"png"},"idempotencyKey":"allowlist-3"}}"#,
    );
    let node_invoke =
        read_response_for_id(&mut client, "node-invoke-1", 10).expect("node.invoke response should arrive");
    assert!(node_invoke.contains("\"id\":\"node-invoke-1\""));
    assert!(node_invoke.contains("\"command\":\"canvas.snapshot\""));
    assert!(node_invoke.contains("\"payload\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-invoke-result-1","method":"node.invoke.result","params":{"id":"unknown-invoke-id-12345","nodeId":"node-shadow-1","ok":true,"payloadJSON":"{\"result\":\"late\"}"}}"#,
    );
    let node_invoke_result = read_response_for_id(&mut client, "node-invoke-result-1", 10)
        .expect("node.invoke.result response should arrive");
    assert!(node_invoke_result.contains("\"id\":\"node-invoke-result-1\""));
    assert!(node_invoke_result.contains("\"ignored\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"sessions-patch-1","method":"sessions.patch","params":{"key":"agent:main:main","thinkingLevel":"medium","verboseLevel":"off"}}"#,
    );
    let sessions_patch =
        read_server_text(&mut client).expect("sessions.patch response should arrive");
    assert!(sessions_patch.contains("\"id\":\"sessions-patch-1\""));
    assert!(sessions_patch.contains("\"key\":\"agent:main:main\""));
    assert!(sessions_patch.contains("\"thinkingLevel\":\"medium\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"sessions-reset-1","method":"sessions.reset","params":{"key":"agent:main:main"}}"#,
    );
    let sessions_reset =
        read_server_text(&mut client).expect("sessions.reset response should arrive");
    assert!(sessions_reset.contains("\"id\":\"sessions-reset-1\""));
    assert!(sessions_reset.contains("\"key\":\"agent:main:main\""));
    assert!(sessions_reset.contains("\"sessionId\":\"sess-main-reset\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"sessions-delete-1","method":"sessions.delete","params":{"key":"agent:main:discord:group:dev"}}"#,
    );
    let sessions_delete =
        read_server_text(&mut client).expect("sessions.delete response should arrive");
    assert!(sessions_delete.contains("\"id\":\"sessions-delete-1\""));
    assert!(sessions_delete.contains("\"deleted\":true"));
    assert!(sessions_delete.contains("\"key\":\"agent:main:discord:group:dev\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-install-1","method":"skills.install","params":{"name":"shadow-routing","installId":"shadow-install-1"}}"#,
    );
    let skills_install =
        read_server_text(&mut client).expect("skills.install response should arrive");
    assert!(skills_install.contains("\"id\":\"skills-install-1\""));
    assert!(skills_install.contains("\"ok\":true"));
    assert!(skills_install.contains("\"installId\":\"shadow-install-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-update-1","method":"skills.update","params":{"skillKey":"shadow-routing","enabled":true,"apiKey":"shadow-key","env":{"OPENAI_API_KEY":"set"}}}"#,
    );
    let skills_update =
        read_server_text(&mut client).expect("skills.update response should arrive");
    assert!(skills_update.contains("\"id\":\"skills-update-1\""));
    assert!(skills_update.contains("\"skillKey\":\"shadow-routing\""));
    assert!(skills_update.contains("\"enabled\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-personal-1","method":"skills.personal","params":{"agentId":"argent"}}"#,
    );
    let skills_personal =
        read_server_text(&mut client).expect("skills.personal response should arrive");
    assert!(skills_personal.contains("\"id\":\"skills-personal-1\""));
    assert!(skills_personal.contains("\"rows\""));
    assert!(skills_personal.contains("\"ps-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-personal-update-1","method":"skills.personal.update","params":{"id":"ps-1","state":"promoted","agentId":"argent"}}"#,
    );
    let skills_personal_update = read_server_text(&mut client)
        .expect("skills.personal.update response should arrive");
    assert!(skills_personal_update.contains("\"id\":\"skills-personal-update-1\""));
    assert!(skills_personal_update.contains("\"state\":\"promoted\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-personal-resolve-1","method":"skills.personal.resolveConflict","params":{"winnerId":"ps-1","loserId":"ps-2","agentId":"argent"}}"#,
    );
    let skills_personal_resolve = read_server_text(&mut client)
        .expect("skills.personal.resolveConflict response should arrive");
    assert!(skills_personal_resolve.contains("\"id\":\"skills-personal-resolve-1\""));
    assert!(skills_personal_resolve.contains("\"winnerId\":\"ps-1\""));
    assert!(skills_personal_resolve.contains("\"loserId\":\"ps-2\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"skills-personal-delete-1","method":"skills.personal.delete","params":{"id":"ps-1","agentId":"argent"}}"#,
    );
    let skills_personal_delete = read_server_text(&mut client)
        .expect("skills.personal.delete response should arrive");
    assert!(skills_personal_delete.contains("\"id\":\"skills-personal-delete-1\""));
    assert!(skills_personal_delete.contains("\"ok\":true"));
    assert!(skills_personal_delete.contains("\"id\":\"ps-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"wizard-start-1","method":"wizard.start","params":{"mode":"local"}}"#,
    );
    let wizard_start = read_server_text(&mut client).expect("wizard.start response should arrive");
    assert!(wizard_start.contains("\"id\":\"wizard-start-1\""));
    assert!(wizard_start.contains("\"sessionId\":\"wizard-shadow-1\""));
    assert!(wizard_start.contains("\"status\":\"running\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"wizard-next-1","method":"wizard.next","params":{"sessionId":"wizard-shadow-1","answer":{"stepId":"wizard-step-1","value":"shadow-token"}}}"#,
    );
    let wizard_next = read_server_text(&mut client).expect("wizard.next response should arrive");
    assert!(wizard_next.contains("\"id\":\"wizard-next-1\""));
    assert!(wizard_next.contains("\"done\":true"));
    assert!(wizard_next.contains("\"status\":\"done\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"wizard-cancel-1","method":"wizard.cancel","params":{"sessionId":"wizard-shadow-1"}}"#,
    );
    let wizard_cancel =
        read_server_text(&mut client).expect("wizard.cancel response should arrive");
    assert!(wizard_cancel.contains("\"id\":\"wizard-cancel-1\""));
    assert!(wizard_cancel.contains("\"status\":\"cancelled\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"update-run-1","method":"update.run","params":{"restartDelayMs":0}}"#,
    );
    let update_run = read_server_text(&mut client).expect("update.run response should arrive");
    assert!(update_run.contains("\"id\":\"update-run-1\""));
    assert!(update_run.contains("\"kind\":\"update\""));
    assert!(update_run.contains("\"reason\":\"update.run\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"specforge-suggest-1","method":"specforge.suggest","params":{"field":"problem","currentData":{"title":"Test Project"}}}"#,
    );
    let specforge_suggest =
        read_server_text(&mut client).expect("specforge.suggest response should arrive");
    assert!(specforge_suggest.contains("\"id\":\"specforge-suggest-1\""));
    assert!(specforge_suggest.contains("\"suggestion\":\"This is a great suggestion.\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"specforge-kickoff-1","method":"specforge.kickoff","params":{"data":{"title":"New Project","problem":"Issue"},"sessionKey":"test-session"}}"#,
    );
    let specforge_kickoff =
        read_server_text(&mut client).expect("specforge.kickoff response should arrive");
    assert!(specforge_kickoff.contains("\"id\":\"specforge-kickoff-1\""));
    assert!(specforge_kickoff.contains("\"triggered\":true"));
    assert!(specforge_kickoff.contains("\"started\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"intent-simulate-1","method":"intent.simulate","params":{"agentId":"main"}}"#,
    );
    let intent_simulate = read_response_for_id(&mut client, "intent-simulate-1", 10)
        .expect("intent.simulate response should arrive");
    assert!(intent_simulate.contains("\"id\":\"intent-simulate-1\""));
    assert!(intent_simulate.contains("\"ok\":false"));
    assert!(intent_simulate.contains("Intent simulation is unavailable in ArgentOS Core"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"tts-convert-1","method":"tts.convert","params":{"text":"Hello shadow"}}"#,
    );
    let tts_convert = read_server_text(&mut client).expect("tts.convert response should arrive");
    assert!(tts_convert.contains("\"id\":\"tts-convert-1\""));
    assert!(tts_convert.contains("\"provider\":\"openai\""));
    assert!(tts_convert.contains("\"audioPath\":\"/Users/shadow/.argentos/tts/shadow.wav\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"send-1","method":"send","params":{"to":"+15550000000","message":"hi","idempotencyKey":"same-key"}}"#,
    );
    let send = read_server_text(&mut client).expect("send response should arrive");
    assert!(send.contains("\"id\":\"send-1\""));
    assert!(send.contains("\"runId\":\"same-key\""));
    assert!(send.contains("\"messageId\":\"m1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"cron-update-1","method":"cron.update","params":{"id":"cron-shadow-new","patch":{"schedule":{"at":"2026-04-19T17:00:00.000Z"},"payload":{"kind":"systemEvent","text":"updated"}}}}"#,
    );
    let cron_update =
        read_response_for_id(&mut client, "cron-update-1", 10).expect("cron.update response should arrive");
    assert!(cron_update.contains("\"id\":\"cron-update-1\""));
    assert!(cron_update.contains("\"schedule\":{\"kind\":\"at\"}"));
    assert!(cron_update.contains("\"payload\":{\"kind\":\"systemEvent\",\"text\":\"updated\"}"));

    send_masked_text(
        &mut client,
        r##"{"type":"req","id":"canvas-push-1","method":"dashboard.canvas.push","params":{"title":"Shadow Doc","content":"# Shadow","type":"markdown"}}"##,
    );
    let canvas_push = read_response_for_id(&mut client, "canvas-push-1", 10)
        .expect("dashboard.canvas.push response should arrive");
    assert!(canvas_push.contains("\"id\":\"canvas-push-1\""));
    assert!(canvas_push.contains("\"success\":true"));
    assert!(canvas_push.contains("Canvas event broadcast"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"browser-request-1","method":"browser.request","params":{"method":"GET","path":"/json/version"}}"#,
    );
    let browser_request = read_response_for_id(&mut client, "browser-request-1", 10)
        .expect("browser.request response should arrive");
    assert!(browser_request.contains("\"id\":\"browser-request-1\""));
    assert!(browser_request.contains("\"browser\":\"Shadow Chromium\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"chat-history-1","method":"chat.history","params":{"sessionKey":"main"}}"#,
    );
    let chat_history = read_response_for_id(&mut client, "chat-history-1", 10)
        .expect("chat.history response should arrive");
    assert!(chat_history.contains("\"id\":\"chat-history-1\""));
    assert!(chat_history.contains("\"sessionId\":\"sess-main\""));
    assert!(chat_history.contains("\"messages\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"chat-abort-1","method":"chat.abort","params":{"sessionKey":"main"}}"#,
    );
    let chat_abort = read_response_for_id(&mut client, "chat-abort-1", 10)
        .expect("chat.abort response should arrive");
    assert!(chat_abort.contains("\"id\":\"chat-abort-1\""));
    assert!(chat_abort.contains("\"aborted\":true"));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"chat-send-1","method":"chat.send","params":{"sessionKey":"main","message":"hello","idempotencyKey":"idem-status-1"}}"#,
    );
    let chat_send = read_response_for_id(&mut client, "chat-send-1", 10)
        .expect("chat.send response should arrive");
    assert!(chat_send.contains("\"id\":\"chat-send-1\""));
    assert!(chat_send.contains("\"runId\":\"idem-status-1\""));
    assert!(chat_send.contains("\"status\":\"started\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"agent-1","method":"agent","params":{"message":"test","agentId":"main","sessionKey":"agent:main:main","idempotencyKey":"test-idem"}}"#,
    );
    let agent = read_response_for_id(&mut client, "agent-1", 10)
        .expect("agent response should arrive");
    assert!(agent.contains("\"id\":\"agent-1\""));
    assert!(agent.contains("\"runId\":\"test-idem\""));
    assert!(agent.contains("\"status\":\"queued\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_node_list_and_describe_return_payloads() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(&mut client, r#"{"type":"req","id":"nodes-1","method":"node.list"}"#);
    let list = read_server_text(&mut client).expect("node.list response should arrive");
    assert!(list.contains("\"id\":\"nodes-1\""));
    assert!(list.contains("\"nodes\""));
    assert!(list.contains("\"node-shadow-1\""));

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"node-desc-1","method":"node.describe","params":{"nodeId":"node-shadow-1"}}"#,
    );
    let describe = read_server_text(&mut client).expect("node.describe response should arrive");
    assert!(describe.contains("\"id\":\"node-desc-1\""));
    assert!(describe.contains("\"nodeId\":\"node-shadow-1\""));
    assert!(describe.contains("\"voice.speak\""));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_terminal_round_trips_and_emits_events() {
    let (addr, handle) = spawn_server("shadow-token");

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"shadow-token"},"subscriptions":["agent."]}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"term-create","method":"terminal.create","params":{"cwd":"/tmp"}}"#,
    );
    let created = read_server_text(&mut client).expect("terminal.create response should arrive");
    assert!(created.contains("\"id\":\"term-create\""));
    assert!(created.contains("\"shell\""));
    let term_id = created
        .split("\"payload\":{\"id\":\"term-")
        .nth(1)
        .and_then(|tail| tail.split('"').next())
        .map(|suffix| format!("term-{}", suffix))
        .expect("terminal id should be present");

    send_masked_text(
        &mut client,
        &format!(
            "{{\"type\":\"req\",\"id\":\"term-write\",\"method\":\"terminal.write\",\"params\":{{\"id\":\"{}\",\"data\":\"printf __RUST_TERM__\\\\n\"}}}}",
            term_id
        ),
    );
    let write_res = read_until(
        &mut client,
        |message| message.contains("\"type\":\"res\"") && message.contains("\"id\":\"term-write\""),
        5,
    )
    .expect("terminal.write response should arrive");
    assert!(write_res.contains("\"id\":\"term-write\""), "{write_res}");
    assert!(write_res.contains("\"ok\":true"), "{write_res}");

    let data_evt = read_until(
        &mut client,
        |message| {
            message.contains("\"event\":\"terminal\"")
                && message.contains("\"stream\":\"data\"")
                && message.contains("printf __RUST_TERM__")
        },
        20,
    )
    .expect("terminal data event should arrive");
    assert!(data_evt.contains("\"event\":\"terminal\""));
    assert!(data_evt.contains("\"stream\":\"data\""));
    assert!(data_evt.contains("printf __RUST_TERM__"));

    send_masked_text(
        &mut client,
        &format!(
            "{{\"type\":\"req\",\"id\":\"term-kill\",\"method\":\"terminal.kill\",\"params\":{{\"id\":\"{}\"}}}}",
            term_id
        ),
    );
    let exit_evt = read_until(
        &mut client,
        |message| message.contains("\"event\":\"terminal\"") && message.contains("\"stream\":\"exit\""),
        10,
    )
    .expect("terminal exit event should arrive");
    assert!(exit_evt.contains("\"event\":\"terminal\""));
    assert!(exit_evt.contains("\"stream\":\"exit\""));

    let kill_res = read_until(
        &mut client,
        |message| message.contains("\"type\":\"res\"") && message.contains("\"id\":\"term-kill\""),
        5,
    )
    .expect("terminal.kill response should arrive");
    assert!(kill_res.contains("\"id\":\"term-kill\""));
    assert!(kill_res.contains("\"ok\":true"));

    drop(client);
    join_server(handle);
}

#[test]
fn websocket_shutdown_event_is_broadcast_on_stop() {
    let (addr, stop, handle) = spawn_server_with_stop(
        "shadow-token",
        1,
        MaintenanceConfig {
            tick_interval_ms: 60_000,
            health_interval_ms: 60_000,
            heartbeat_interval_ms: 60_000,
        },
    );

    let mut client = open_ws(addr);
    let _challenge = read_server_text(&mut client).expect("challenge should arrive");

    send_masked_text(
        &mut client,
        r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"client-a","version":"1.0.0","platform":"macos","mode":"operator","instanceId":"instance-a"},"auth":{"token":"shadow-token"}}}"#,
    );
    let _connect = read_server_text(&mut client).expect("connect should arrive");

    stop.request(Some("service restart"), Some(1_500));

    let shutdown = read_server_text(&mut client).expect("shutdown event should arrive");
    assert!(shutdown.contains("\"type\":\"event\""));
    assert!(shutdown.contains("\"event\":\"shutdown\""));
    assert!(shutdown.contains("\"reason\":\"service restart\""));
    assert!(shutdown.contains("\"restartExpectedMs\":1500"));
    assert!(read_close(&mut client));

    drop(client);
    join_server(handle);
}
