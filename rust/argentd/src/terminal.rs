use std::collections::HashMap;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

const MAX_BUFFER_BYTES: usize = 50 * 1024;
static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);
static TERMINAL_REGISTRY: OnceLock<Mutex<HashMap<String, TerminalSession>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, TerminalSession>> {
    TERMINAL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Default)]
pub struct TerminalSession {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub owner_hub_id: Option<u64>,
    pub owner_client_id: Option<u64>,
    pub output_buffer: String,
    pub output_offset: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

pub fn create_terminal_session(
    cwd: Option<String>,
    owner_hub_id: Option<u64>,
    owner_client_id: Option<u64>,
) -> (String, String, String) {
    let shell = env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
    let cwd = cwd
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()));
    let id = format!("term-{:08x}", TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed));

    let session = TerminalSession {
        id: id.clone(),
        shell: shell.clone(),
        cwd: cwd.clone(),
        owner_hub_id,
        owner_client_id,
        output_buffer: String::new(),
        output_offset: 0,
        exited: false,
        exit_code: None,
    };
    registry()
        .lock()
        .expect("terminal registry lock should not poison")
        .insert(id.clone(), session);

    (id, shell, cwd)
}

pub fn write_terminal(id: &str, data: &str) -> Result<(String, u64), String> {
    let mut registry = registry()
        .lock()
        .expect("terminal registry lock should not poison");
    let session = registry
        .get_mut(id)
        .ok_or_else(|| format!("terminal {id} not found"))?;
    if session.exited {
        return Err(format!("terminal {id} has exited"));
    }
    let offset = session.output_offset;
    session.output_buffer.push_str(data);
    session.output_offset += data.len() as u64;
    if session.output_buffer.len() > MAX_BUFFER_BYTES {
        let drain = session.output_buffer.len() - MAX_BUFFER_BYTES;
        session.output_buffer.drain(..drain);
    }
    Ok((data.to_string(), offset))
}

pub fn resize_terminal(id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
    let registry = registry()
        .lock()
        .expect("terminal registry lock should not poison");
    if registry.contains_key(id) {
        Ok(())
    } else {
        Err(format!("terminal {id} not found"))
    }
}

pub fn kill_terminal(id: &str) -> Option<i32> {
    let mut registry = registry()
        .lock()
        .expect("terminal registry lock should not poison");
    let mut session = registry.remove(id)?;
    session.exited = true;
    session.exit_code = Some(0);
    Some(0)
}

pub fn cleanup_terminals_for_client(owner_hub_id: u64, owner_client_id: u64) -> Vec<String> {
    let ids = registry()
        .lock()
        .expect("terminal registry lock should not poison")
        .values()
        .filter(|session| {
            session.owner_hub_id == Some(owner_hub_id)
                && session.owner_client_id == Some(owner_client_id)
        })
        .map(|session| session.id.clone())
        .collect::<Vec<_>>();
    for id in &ids {
        let _ = kill_terminal(id);
    }
    ids
}

pub fn terminal_create_payload_json(id: &str, shell: &str, cwd: &str) -> String {
    format!(
        "{{\"id\":\"{}\",\"shell\":{},\"cwd\":{}}}",
        id,
        json_string(shell),
        json_string(cwd)
    )
}

pub fn terminal_ok_payload_json() -> String {
    "{\"ok\":true}".to_string()
}

fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}
