use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};

pub type SharedWriter = Arc<Mutex<TcpStream>>;
static HUB_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct PresenceMatch {
    pub instance_id: Option<String>,
    pub client_id: String,
}

#[derive(Clone)]
pub struct HubClient {
    pub id: u64,
    pub writer: SharedWriter,
    pub presence_match: PresenceMatch,
}

pub struct HubState {
    hub_id: u64,
    next_client_id: u64,
    seq: u64,
    presence_version: u64,
    health_version: u64,
    presence_json: String,
    last_heartbeat_json: Option<String>,
    heartbeats_enabled: bool,
    talk_mode_json: Option<String>,
    voicewake_triggers: Vec<String>,
    tts_enabled: bool,
    tts_provider: String,
    queued_system_events: Vec<String>,
    clients: Vec<HubClient>,
}

impl HubState {
    pub fn new() -> Self {
        let self_presence = build_gateway_self_presence_json();
        Self {
            hub_id: HUB_COUNTER.fetch_add(1, Ordering::Relaxed),
            next_client_id: 1,
            seq: 0,
            presence_version: 0,
            health_version: 1,
            presence_json: self_presence,
            last_heartbeat_json: None,
            heartbeats_enabled: true,
            talk_mode_json: None,
            voicewake_triggers: vec![
                "argent".to_string(),
                "claude".to_string(),
                "computer".to_string(),
            ],
            tts_enabled: false,
            tts_provider: "openai".to_string(),
            queued_system_events: Vec::new(),
            clients: Vec::new(),
        }
    }

    pub fn register_client(&mut self, writer: SharedWriter, presence_match: PresenceMatch) -> u64 {
        let id = self.next_client_id;
        self.next_client_id += 1;
        self.clients.push(HubClient {
            id,
            writer,
            presence_match,
        });
        id
    }

    pub fn remove_client(&mut self, id: u64) -> Option<PresenceMatch> {
        let index = self.clients.iter().position(|client| client.id == id)?;
        Some(self.clients.remove(index).presence_match)
    }

    pub fn presence_json(&self) -> String {
        self.presence_json.clone()
    }

    pub fn hub_id(&self) -> u64 {
        self.hub_id
    }

    pub fn health_version(&self) -> u64 {
        self.health_version
    }

    pub fn presence_version(&self) -> u64 {
        self.presence_version
    }

    pub fn set_presence_json(&mut self, presence_json: String) -> u64 {
        self.presence_json = presence_json;
        self.presence_version += 1;
        self.presence_version
    }

    pub fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    pub fn writers(&self) -> Vec<SharedWriter> {
        self.clients.iter().map(|client| client.writer.clone()).collect()
    }

    pub fn has_clients(&self) -> bool {
        !self.clients.is_empty()
    }

    pub fn heartbeats_enabled(&self) -> bool {
        self.heartbeats_enabled
    }

    pub fn set_heartbeats_enabled(&mut self, enabled: bool) {
        self.heartbeats_enabled = enabled;
    }

    pub fn last_heartbeat_json(&self) -> Option<String> {
        self.last_heartbeat_json.clone()
    }

    pub fn set_last_heartbeat_json(&mut self, heartbeat_json: String) {
        self.last_heartbeat_json = Some(heartbeat_json);
    }

    pub fn talk_mode_json(&self) -> Option<String> {
        self.talk_mode_json.clone()
    }

    pub fn set_talk_mode_json(&mut self, talk_mode_json: String) {
        self.talk_mode_json = Some(talk_mode_json);
    }

    pub fn voicewake_triggers(&self) -> Vec<String> {
        self.voicewake_triggers.clone()
    }

    pub fn set_voicewake_triggers(&mut self, triggers: Vec<String>) {
        self.voicewake_triggers = triggers;
    }

    pub fn tts_enabled(&self) -> bool {
        self.tts_enabled
    }

    pub fn set_tts_enabled(&mut self, enabled: bool) {
        self.tts_enabled = enabled;
    }

    pub fn tts_provider(&self) -> String {
        self.tts_provider.clone()
    }

    pub fn set_tts_provider(&mut self, provider: String) {
        self.tts_provider = provider;
    }

    pub fn queued_system_events(&self) -> Vec<String> {
        self.queued_system_events.clone()
    }

    pub fn enqueue_system_event(&mut self, text: String) {
        self.queued_system_events.push(text);
        if self.queued_system_events.len() > 25 {
            let drain = self.queued_system_events.len() - 25;
            self.queued_system_events.drain(0..drain);
        }
    }

    pub fn prune_presence_for_match(
        &mut self,
        presence_match: &PresenceMatch,
    ) -> Option<(String, u64, u64, Vec<SharedWriter>)> {
        let next_presence =
            remove_presence_entry(&self.presence_json, presence_match.instance_id.as_deref(), &presence_match.client_id)?;
        self.presence_json = next_presence;
        self.presence_version += 1;
        self.seq += 1;
        Some((
            self.presence_json.clone(),
            self.presence_version,
            self.seq,
            self.writers(),
        ))
    }
}

pub type SharedHub = Arc<Mutex<HubState>>;

fn build_gateway_self_presence_json() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let host = env::var("HOSTNAME")
        .ok()
        .or_else(|| env::var("COMPUTERNAME").ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "shadow-gateway".to_string());
    let platform = format!("{} {}", env::consts::OS, env::consts::ARCH);
    let device_family = match env::consts::OS {
        "macos" => "Mac",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    let version = env!("CARGO_PKG_VERSION");
    let text = format!("Gateway: {} (127.0.0.1) · app {} · mode gateway · reason self", host, version);
    format!(
        "[{{\"host\":\"{}\",\"ip\":\"127.0.0.1\",\"version\":\"{}\",\"platform\":\"{}\",\"deviceFamily\":\"{}\",\"mode\":\"gateway\",\"reason\":\"self\",\"text\":\"{}\",\"ts\":{}}}]",
        escape_json(&host),
        escape_json(version),
        escape_json(&platform),
        escape_json(device_family),
        escape_json(&text),
        ts
    )
}

fn remove_presence_entry(
    current_presence_json: &str,
    instance_id: Option<&str>,
    client_id: &str,
) -> Option<String> {
    let objects = split_presence_objects(current_presence_json);
    let before = objects.len();
    let retained = objects
        .into_iter()
        .filter(|entry| !matches_presence_entry(entry, instance_id, client_id))
        .collect::<Vec<_>>();
    if retained.len() == before {
        return None;
    }
    Some(format!("[{}]", retained.join(",")))
}

fn split_presence_objects(current_presence_json: &str) -> Vec<String> {
    let source = current_presence_json.trim();
    let inner = source
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or("")
        .trim();
    if inner.is_empty() {
        return Vec::new();
    }

    let mut objects = Vec::new();
    let mut start = None;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in inner.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(object_start) = start.take() {
                        objects.push(inner[object_start..=index].to_string());
                    }
                }
            }
            _ => {}
        }
    }

    objects
}

fn matches_presence_entry(entry: &str, instance_id: Option<&str>, client_id: &str) -> bool {
    if let Some(instance_id) = instance_id {
        if entry.contains(&format!("\"instanceId\":\"{}\"", escape_json(instance_id))) {
            return true;
        }
    }
    entry.contains(&format!("\"clientId\":\"{}\"", escape_json(client_id)))
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
