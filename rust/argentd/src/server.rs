use crate::contracts::{DEFAULT_BIND_ADDR, PROTOCOL_VERSION};
use crate::error::GatewayErrorCode;
use crate::hub::{HubState, SharedHub};
use crate::http::{
    connect_success_response, error_response, gateway_health_payload_json, health_response,
    parse_connect_request,
};
use crate::ws::{
    close_stream, handshake_response, is_websocket_upgrade, send_text_frame,
    serve_websocket_session,
};
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_HEALTH_BROADCAST_INTERVAL_MS: u64 = 5_000;

#[derive(Clone, Copy)]
pub struct MaintenanceConfig {
    pub tick_interval_ms: u64,
    pub health_interval_ms: u64,
    pub heartbeat_interval_ms: u64,
}

impl MaintenanceConfig {
    pub fn from_env() -> Self {
        Self {
            tick_interval_ms: env::var("ARGENTD_TICK_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(crate::contracts::TICK_INTERVAL_MS),
            health_interval_ms: env::var("ARGENTD_HEALTH_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_HEALTH_BROADCAST_INTERVAL_MS),
            heartbeat_interval_ms: env::var("ARGENTD_HEARTBEAT_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(60_000),
        }
    }
}

pub struct ShutdownSignal {
    stop: AtomicBool,
    reason: Mutex<String>,
    restart_expected_ms: Mutex<Option<u64>>,
}

impl ShutdownSignal {
    pub fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
            reason: Mutex::new("server stopping".to_string()),
            restart_expected_ms: Mutex::new(None),
        }
    }

    pub fn request(&self, reason: Option<&str>, restart_expected_ms: Option<u64>) {
        if let Some(reason) = reason {
            *self.reason.lock().expect("shutdown reason lock should not poison") = reason.to_string();
        }
        *self
            .restart_expected_ms
            .lock()
            .expect("shutdown restart lock should not poison") = restart_expected_ms;
        self.stop.store(true, Ordering::Relaxed);
    }

    pub fn is_set(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    pub fn payload(&self) -> (String, Option<u64>) {
        (
            self.reason
                .lock()
                .expect("shutdown reason lock should not poison")
                .clone(),
            *self
                .restart_expected_ms
                .lock()
                .expect("shutdown restart lock should not poison"),
        )
    }
}

pub fn bind_listener(bind_addr: &str) -> std::io::Result<TcpListener> {
    TcpListener::bind(bind_addr)
}

pub fn resolve_bind_addr() -> String {
    env::var("ARGENTD_BIND").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
}

pub fn resolve_expected_token() -> String {
    env::var("ARGENTD_AUTH_TOKEN").unwrap_or_default()
}

pub fn build_http_response(request: &str, started_at: Instant, expected_token: &str) -> String {
    let first_line = request.lines().next().unwrap_or_default();
    if first_line.starts_with("GET /health ") {
        let body = health_response(started_at);
        return format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
    }

    if first_line.starts_with("POST /v1/connect ") {
        let request_body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
        let (status_line, body) = match parse_connect_request(request_body) {
            Ok(connect) => {
                if connect.max_protocol < PROTOCOL_VERSION || connect.min_protocol > PROTOCOL_VERSION
                {
                    (
                        "HTTP/1.1 400 Bad Request",
                        error_response(
                            Some(&connect.id),
                            GatewayErrorCode::InvalidRequest,
                            "protocol mismatch",
                        ),
                    )
                } else if !expected_token.is_empty() && connect.token != expected_token {
                    (
                        "HTTP/1.1 400 Bad Request",
                        error_response(
                            Some(&connect.id),
                            GatewayErrorCode::InvalidRequest,
                            "unauthorized: gateway token mismatch (provide gateway auth token)",
                        ),
                    )
                } else {
                    (
                        "HTTP/1.1 200 OK",
                        connect_success_response(
                            &connect,
                            "[]",
                            &gateway_health_payload_json(started_at),
                            started_at,
                            1,
                            1,
                        ),
                    )
                }
            }
            Err(code) => (
                "HTTP/1.1 400 Bad Request",
                error_response(None, code, "invalid connect params"),
            ),
        };
        return format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
    }

    let body = "{\"status\":\"not_found\"}";
    format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

pub fn handle_connection(
    mut stream: TcpStream,
    started_at: Instant,
    expected_token: &str,
    hub: SharedHub,
) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    let mut buffer = [0_u8; 2048];
    let bytes_read = stream.read(&mut buffer)?;
    if bytes_read == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    if is_websocket_upgrade(&request) {
        match handshake_response(&request) {
            Ok(response) => {
                stream.write_all(response.as_bytes())?;
                stream.flush()?;
                return serve_websocket_session(stream, started_at, expected_token, hub);
            }
            Err(code) => {
                let body = error_response(None, code, "invalid websocket upgrade");
                let response = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes())?;
                stream.flush()?;
                return Ok(());
            }
        }
    }

    let response = build_http_response(&request, started_at, expected_token);
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}

pub fn serve(
    listener: TcpListener,
    started_at: Instant,
    expected_token: &str,
    max_connections: Option<usize>,
) -> std::io::Result<()> {
    serve_with_config(
        listener,
        started_at,
        expected_token,
        max_connections,
        MaintenanceConfig::from_env(),
    )
}

pub fn serve_with_config(
    listener: TcpListener,
    started_at: Instant,
    expected_token: &str,
    max_connections: Option<usize>,
    maintenance: MaintenanceConfig,
) -> std::io::Result<()> {
    let stop = Arc::new(ShutdownSignal::new());
    serve_with_config_and_stop(
        listener,
        started_at,
        expected_token,
        max_connections,
        maintenance,
        stop,
    )
}

pub fn serve_with_config_and_stop(
    listener: TcpListener,
    started_at: Instant,
    expected_token: &str,
    max_connections: Option<usize>,
    maintenance: MaintenanceConfig,
    stop: Arc<ShutdownSignal>,
) -> std::io::Result<()> {
    let hub: SharedHub = Arc::new(Mutex::new(HubState::new()));
    listener.set_nonblocking(true)?;
    let maintenance_worker =
        start_maintenance_loop(hub.clone(), started_at, stop.clone(), maintenance);
    let mut handled = 0_usize;
    let mut workers: Vec<thread::JoinHandle<std::io::Result<()>>> = Vec::new();
    let mut shutdown_broadcasted = false;
    loop {
        let mut index = 0_usize;
        while index < workers.len() {
            if workers[index].is_finished() {
                let worker = workers.remove(index);
                let result = worker
                    .join()
                    .map_err(|_| std::io::Error::other("worker thread panicked"))?;
                if let Err(error) = result {
                    if !is_expected_disconnect_error(&error) {
                        return Err(error);
                    }
                }
            } else {
                index += 1;
            }
        }

        let accepting = max_connections.is_none_or(|limit| handled < limit);
        let stopping = stop.is_set();

        if stopping && !shutdown_broadcasted {
            let (reason, restart_expected_ms) = stop.payload();
            broadcast_shutdown(&hub, &reason, restart_expected_ms);
            shutdown_broadcasted = true;
        }

        if !accepting {
            if workers.is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
            continue;
        }

        if stopping && workers.is_empty() {
            break;
        }

        match listener.accept() {
            Ok((stream, _)) => {
                let hub = hub.clone();
                let expected_token = expected_token.to_string();
                workers.push(thread::spawn(move || {
                    handle_connection(stream, started_at, &expected_token, hub)
                }));
                handled += 1;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error),
        }
    }
    stop.request(None, None);
    maintenance_worker
        .join()
        .map_err(|_| std::io::Error::other("maintenance thread panicked"))?;
    Ok(())
}

fn is_expected_disconnect_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::UnexpectedEof
            | std::io::ErrorKind::ConnectionAborted
    )
}

fn start_maintenance_loop(
    hub: SharedHub,
    started_at: Instant,
    stop: Arc<ShutdownSignal>,
    maintenance: MaintenanceConfig,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let tick_interval = Duration::from_millis(maintenance.tick_interval_ms.max(1));
        let health_interval = Duration::from_millis(maintenance.health_interval_ms.max(1));
        let heartbeat_interval = Duration::from_millis(maintenance.heartbeat_interval_ms.max(1));
        let mut next_tick = Instant::now() + tick_interval;
        let mut next_health = Instant::now() + health_interval;
        let mut next_heartbeat = Instant::now() + heartbeat_interval;

        while !stop.is_set() {
            let now = Instant::now();
            if now >= next_tick {
                broadcast_tick(&hub);
                next_tick = now + tick_interval;
            }
            if now >= next_health {
                broadcast_health(&hub, started_at);
                next_health = now + health_interval;
            }
            if now >= next_heartbeat {
                broadcast_heartbeat(&hub);
                next_heartbeat = now + heartbeat_interval;
            }
            thread::sleep(Duration::from_millis(10));
        }
    })
}

fn broadcast_tick(hub: &SharedHub) {
    let (seq, writers) = {
        let mut hub_state = hub.lock().expect("hub lock should not poison");
        if !hub_state.has_clients() {
            return;
        }
        (hub_state.next_seq(), hub_state.writers())
    };
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let payload = format!("{{\"ts\":{}}}", ts);
    let frame = format!(
        "{{\"type\":\"event\",\"event\":\"tick\",\"payload\":{},\"seq\":{}}}",
        payload, seq
    );
    for writer in writers {
        let _ = send_text_frame(&writer, &frame);
    }
}

fn broadcast_health(hub: &SharedHub, started_at: Instant) {
    let (seq, presence_version, health_version, writers) = {
        let mut hub_state = hub.lock().expect("hub lock should not poison");
        if !hub_state.has_clients() {
            return;
        }
        (
            hub_state.next_seq(),
            hub_state.presence_version(),
            hub_state.health_version(),
            hub_state.writers(),
        )
    };
    let frame = format!(
        "{{\"type\":\"event\",\"event\":\"health\",\"payload\":{},\"seq\":{},\"stateVersion\":{{\"presence\":{},\"health\":{}}}}}",
        gateway_health_payload_json(started_at),
        seq,
        presence_version,
        health_version
    );
    for writer in writers {
        let _ = send_text_frame(&writer, &frame);
    }
}

fn broadcast_heartbeat(hub: &SharedHub) {
    let (seq, writers, payload_json) = {
        let mut hub_state = hub.lock().expect("hub lock should not poison");
        if !hub_state.has_clients() || !hub_state.heartbeats_enabled() {
            return;
        }
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        let payload_json = crate::http::heartbeat_event_payload_json(ts);
        hub_state.set_last_heartbeat_json(payload_json.clone());
        (hub_state.next_seq(), hub_state.writers(), payload_json)
    };
    let frame = format!(
        "{{\"type\":\"event\",\"event\":\"heartbeat\",\"payload\":{},\"seq\":{}}}",
        payload_json, seq
    );
    for writer in writers {
        let _ = send_text_frame(&writer, &frame);
    }
}

fn broadcast_shutdown(hub: &SharedHub, reason: &str, restart_expected_ms: Option<u64>) {
    let writers = {
        let hub_state = hub.lock().expect("hub lock should not poison");
        hub_state.writers()
    };
    if writers.is_empty() {
        return;
    }
    let restart_json = restart_expected_ms
        .map(|value| format!(",\"restartExpectedMs\":{}", value))
        .unwrap_or_default();
    let frame = format!(
        "{{\"type\":\"event\",\"event\":\"shutdown\",\"payload\":{{\"reason\":\"{}\"{}}}}}",
        reason.replace('\\', "\\\\").replace('"', "\\\""),
        restart_json
    );
    for writer in writers {
        let _ = send_text_frame(&writer, &frame);
        let _ = close_stream(&writer);
    }
}
