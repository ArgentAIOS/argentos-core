use crate::contracts::{
    LaneReleasePayload, LaneRequestPayload, ShutdownPayload, TickPayload, ACCEPT_LOOP_IDLE_MS,
    COMPONENT_VERSION, DEFAULT_BIND_ADDR,
};
use crate::runtime::{ExecutiveRuntime, RuntimeConfig};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Default)]
pub struct ShutdownSignal {
    stop: AtomicBool,
}

impl ShutdownSignal {
    pub fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
        }
    }

    pub fn request(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    pub fn is_set(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}

pub fn resolve_bind_addr() -> String {
    std::env::var("ARGENT_EXECD_BIND").unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
}

pub fn bind_listener(bind_addr: &str) -> std::io::Result<TcpListener> {
    TcpListener::bind(bind_addr)
}

pub fn serve(
    listener: TcpListener,
    runtime: Arc<Mutex<ExecutiveRuntime>>,
    shutdown: Arc<ShutdownSignal>,
) -> std::io::Result<()> {
    listener.set_nonblocking(true)?;
    while !shutdown.is_set() {
        match listener.accept() {
            Ok((stream, _addr)) => {
                let runtime = runtime.clone();
                let shutdown = shutdown.clone();
                thread::spawn(move || {
                    let _ = handle_connection(stream, runtime, shutdown);
                });
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(ACCEPT_LOOP_IDLE_MS));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

pub fn start_tick_loop(runtime: Arc<Mutex<ExecutiveRuntime>>, shutdown: Arc<ShutdownSignal>) {
    thread::spawn(move || loop {
        if shutdown.is_set() {
            break;
        }
        let sleep_for = {
            let mut runtime = runtime.lock().expect("runtime lock should not poison");
            let _ = runtime.tick();
            runtime.tick_sleep_duration()
        };
        thread::sleep(sleep_for);
    });
}

fn handle_connection(
    mut stream: TcpStream,
    runtime: Arc<Mutex<ExecutiveRuntime>>,
    shutdown: Arc<ShutdownSignal>,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 4096];
    let read = stream.read(&mut buffer)?;
    if read == 0 {
        return Ok(());
    }
    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
    let response = build_response(&request, runtime, shutdown);
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}

fn build_response(
    request: &str,
    runtime: Arc<Mutex<ExecutiveRuntime>>,
    shutdown: Arc<ShutdownSignal>,
) -> String {
    let first_line = request.lines().next().unwrap_or_default();
    let (method, target) = parse_request_line(first_line);
    let (path, query) = split_target(target);
    let query_params = parse_query(query);
    let request_body = request.split("\r\n\r\n").nth(1).unwrap_or("").trim();

    match (method, path) {
        ("GET", "/health") => {
            let runtime = runtime.lock().expect("runtime lock should not poison");
            let body = serde_json::to_string(&runtime.health_payload()).unwrap_or_else(|_| {
                format!(
                    "{{\"status\":\"error\",\"version\":\"{}\"}}",
                    COMPONENT_VERSION
                )
            });
            json_response(200, &body)
        }
        ("GET", "/v1/executive/state") => {
            let runtime = runtime.lock().expect("runtime lock should not poison");
            let body =
                serde_json::to_string_pretty(&runtime.state_payload()).unwrap_or_else(|_| {
                    format!(
                        "{{\"status\":\"error\",\"version\":\"{}\"}}",
                        COMPONENT_VERSION
                    )
                });
            json_response(200, &body)
        }
        ("GET", "/v1/executive/metrics") => {
            let runtime = runtime.lock().expect("runtime lock should not poison");
            let body = serde_json::to_string_pretty(&runtime.metrics_payload())
                .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string());
            json_response(200, &body)
        }
        ("GET", "/v1/executive/journal") => {
            let limit = query_params
                .get("limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(20);
            let runtime = runtime.lock().expect("runtime lock should not poison");
            match runtime.recent_records(limit) {
                Ok(records) => {
                    let body =
                        serde_json::to_string_pretty(&records).unwrap_or_else(|_| "[]".to_string());
                    json_response(200, &body)
                }
                Err(error) => json_response(
                    500,
                    &format!("{{\"error\":{}}}", json_string(&error.to_string())),
                ),
            }
        }
        ("GET", "/v1/executive/timeline") => {
            let limit = query_params
                .get("limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(20);
            let runtime = runtime.lock().expect("runtime lock should not poison");
            match runtime.timeline_summary(limit) {
                Ok(summary) => {
                    let body = serde_json::to_string_pretty(&summary)
                        .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string());
                    json_response(200, &body)
                }
                Err(error) => json_response(
                    500,
                    &format!("{{\"error\":{}}}", json_string(&error.to_string())),
                ),
            }
        }
        ("POST", "/v1/lanes/request") => {
            let mut payload =
                parse_json_body::<LaneRequestPayload>(request_body).unwrap_or_default();
            if payload.lane.trim().is_empty() {
                payload.lane = query_params.get("lane").cloned().unwrap_or_default();
            }
            if payload.priority.is_none() {
                payload.priority = query_params
                    .get("priority")
                    .and_then(|value| value.parse::<u32>().ok());
            }
            if payload.reason.is_none() {
                payload.reason = query_params.get("reason").cloned();
            }
            if payload.lease_ms.is_none() {
                payload.lease_ms = query_params
                    .get("leaseMs")
                    .and_then(|value| value.parse::<u64>().ok());
            }
            let lane = payload.lane;
            if lane.trim().is_empty() {
                return json_response(400, "{\"error\":\"missing lane\"}");
            }
            let priority = payload.priority.unwrap_or(50);
            let lease_ms = payload.lease_ms;
            let reason = payload.reason;
            let mut runtime = runtime.lock().expect("runtime lock should not poison");
            match runtime.request_lane(&lane, priority, reason, lease_ms) {
                Ok(()) => json_response(200, "{\"ok\":true}"),
                Err(error) => json_response(
                    500,
                    &format!("{{\"error\":{}}}", json_string(&error.to_string())),
                ),
            }
        }
        ("POST", "/v1/lanes/release") => {
            let mut payload =
                parse_json_body::<LaneReleasePayload>(request_body).unwrap_or_default();
            if payload.lane.trim().is_empty() {
                payload.lane = query_params.get("lane").cloned().unwrap_or_default();
            }
            if payload.outcome.is_none() {
                payload.outcome = query_params.get("outcome").cloned();
            }
            let lane = payload.lane;
            if lane.trim().is_empty() {
                return json_response(400, "{\"error\":\"missing lane\"}");
            }
            let outcome = payload.outcome.unwrap_or_else(|| "released".to_string());
            let mut runtime = runtime.lock().expect("runtime lock should not poison");
            match runtime.release_lane(&lane, &outcome) {
                Ok(()) => json_response(200, "{\"ok\":true}"),
                Err(error) => json_response(
                    500,
                    &format!("{{\"error\":{}}}", json_string(&error.to_string())),
                ),
            }
        }
        ("POST", "/v1/executive/tick") => {
            let payload = parse_json_body::<TickPayload>(request_body).unwrap_or_default();
            let count = payload.count.unwrap_or(1).max(1);
            let mut runtime = runtime.lock().expect("runtime lock should not poison");
            for _ in 0..count {
                if let Err(error) = runtime.tick() {
                    return json_response(
                        500,
                        &format!("{{\"error\":{}}}", json_string(&error.to_string())),
                    );
                }
            }
            let body = serde_json::to_string(&runtime.health_payload())
                .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string());
            json_response(200, &body)
        }
        ("POST", "/v1/executive/shutdown") => {
            let _payload = parse_json_body::<ShutdownPayload>(request_body).unwrap_or_default();
            shutdown.request();
            json_response(200, "{\"ok\":true}")
        }
        _ => json_response(404, "{\"status\":\"not_found\"}"),
    }
}

pub fn bootstrap_runtime(bind_addr: &str) -> std::io::Result<Arc<Mutex<ExecutiveRuntime>>> {
    let config = RuntimeConfig::from_env(bind_addr);
    let runtime = ExecutiveRuntime::load_or_boot(config)?;
    Ok(Arc::new(Mutex::new(runtime)))
}

fn parse_request_line(line: &str) -> (&str, &str) {
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    (method, target)
}

fn split_target(target: &str) -> (&str, &str) {
    match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    }
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some(parts) => parts,
            None => (pair, ""),
        };
        out.insert(percent_decode(key), percent_decode(value));
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = String::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(num) = u8::from_str_radix(hex, 16) {
                    out.push(num as char);
                    index += 3;
                } else {
                    out.push('%');
                    index += 1;
                }
            }
            byte => {
                out.push(byte as char);
                index += 1;
            }
        }
    }
    out
}

fn parse_json_body<T>(body: &str) -> Option<T>
where
    T: serde::de::DeserializeOwned,
{
    if body.is_empty() {
        return None;
    }
    serde_json::from_str(body).ok()
}

fn json_response(status: u16, body: &str) -> String {
    let status_line = match status {
        200 => "HTTP/1.1 200 OK",
        400 => "HTTP/1.1 400 Bad Request",
        404 => "HTTP/1.1 404 Not Found",
        _ => "HTTP/1.1 500 Internal Server Error",
    };
    format!(
        "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"json-error\"".to_string())
}
