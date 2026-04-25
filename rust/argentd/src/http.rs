use crate::contracts::{
    ConnectRequest, HealthStatus, COMPONENT_VERSION, MAX_BUFFERED_BYTES, MAX_PAYLOAD_BYTES,
    PROTOCOL_VERSION, TICK_INTERVAL_MS,
};
use crate::error::GatewayErrorCode;
use std::env;
use std::time::Instant;

fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestFrameMeta {
    pub id: String,
    pub method: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemEventParams {
    pub text: String,
    pub host: Option<String>,
    pub ip: Option<String>,
    pub version: Option<String>,
    pub platform: Option<String>,
    pub mode: Option<String>,
    pub reason: Option<String>,
    pub instance_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetHeartbeatsParams {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TalkModeParams {
    pub enabled: bool,
    pub phase: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoicewakeSetParams {
    pub triggers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WakeParams {
    pub mode: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalWriteParams {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalIdParams {
    pub id: String,
}

fn find_json_string(source: &str, needle: &str) -> Option<String> {
    let start = source.find(needle)? + needle.len();
    parse_json_string_content(&source[start..]).map(|(value, _)| value)
}

fn find_object_slice<'a>(source: &'a str, needle: &str) -> Option<&'a str> {
    let start = source.find(needle)? + needle.len();
    let tail = &source[start..];
    let object_start = tail.find('{')?;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in tail[object_start..].char_indices() {
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
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = object_start + offset + ch.len_utf8();
                    return Some(&tail[object_start..end]);
                }
            }
            _ => {}
        }
    }
    None
}

fn find_array_slice<'a>(source: &'a str, needle: &str) -> Option<&'a str> {
    let start = source.find(needle)? + needle.len();
    let tail = &source[start..];
    let array_start = tail.find('[')?;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in tail[array_start..].char_indices() {
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
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    let end = array_start + offset + ch.len_utf8();
                    return Some(&tail[array_start..end]);
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_json_string_content(source: &str) -> Option<(String, usize)> {
    let mut out = String::new();
    let mut iter = source.char_indices();
    while let Some((index, ch)) = iter.next() {
        match ch {
            '"' => return Some((out, index + ch.len_utf8())),
            '\\' => {
                let (_, escaped) = iter.next()?;
                match escaped {
                    '"' => out.push('"'),
                    '\\' => out.push('\\'),
                    '/' => out.push('/'),
                    'b' => out.push('\u{0008}'),
                    'f' => out.push('\u{000C}'),
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    'u' => {
                        let mut hex = String::new();
                        for _ in 0..4 {
                            let (_, digit) = iter.next()?;
                            hex.push(digit);
                        }
                        let codepoint = u32::from_str_radix(&hex, 16).ok()?;
                        out.push(char::from_u32(codepoint)?);
                    }
                    _ => return None,
                }
            }
            _ => out.push(ch),
        }
    }
    None
}

fn find_json_u64(source: &str, needle: &str) -> Option<u64> {
    let start = source.find(needle)? + needle.len();
    let tail = &source[start..];
    let digits: String = tail
        .chars()
        .skip_while(|ch| ch.is_whitespace())
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u64>().ok()
}

fn parse_string_array(source: &str, needle: &str) -> Vec<String> {
    let Some(array) = find_array_slice(source, needle) else {
        return Vec::new();
    };
    let mut values = Vec::new();
    let mut rest = array
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or("")
        .trim();
    while !rest.is_empty() {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        if !rest.starts_with('"') {
            return Vec::new();
        }
        let Some((value, consumed)) = parse_json_string_content(&rest[1..]) else {
            return Vec::new();
        };
        values.push(value);
        rest = &rest[consumed + 1..];
        rest = rest.trim_start();
        if rest.starts_with(',') {
            rest = &rest[1..];
        } else if !rest.is_empty() {
            return Vec::new();
        }
    }
    values
}

pub fn parse_connect_request(body: &str) -> Result<ConnectRequest, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "connect" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params =
        find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client =
        find_object_slice(params, "\"client\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let auth = find_object_slice(params, "\"auth\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client_id = find_json_string(client, "\"id\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client_display_name = find_json_string(client, "\"displayName\":\"");
    let client_version =
        find_json_string(client, "\"version\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client_platform =
        find_json_string(client, "\"platform\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client_mode =
        find_json_string(client, "\"mode\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let client_instance_id = find_json_string(client, "\"instanceId\":\"");
    let min_protocol = find_json_u64(params, "\"minProtocol\":").unwrap_or(PROTOCOL_VERSION);
    let max_protocol = find_json_u64(params, "\"maxProtocol\":").unwrap_or(PROTOCOL_VERSION);
    let token = find_json_string(auth, "\"token\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let subscriptions = parse_string_array(params, "\"subscriptions\":");

    Ok(ConnectRequest {
        id: meta.id,
        token,
        subscriptions,
        min_protocol,
        max_protocol,
        client_id,
        client_display_name,
        client_mode,
        client_version,
        client_platform,
        client_instance_id,
    })
}

pub fn parse_request_frame_meta(body: &str) -> Result<RequestFrameMeta, GatewayErrorCode> {
    let frame_type =
        find_json_string(body, "\"type\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    if frame_type != "req" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let method =
        find_json_string(body, "\"method\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let frame_id = find_json_string(body, "\"id\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    Ok(RequestFrameMeta {
        id: frame_id,
        method,
    })
}

pub fn parse_system_event_params(body: &str) -> Result<SystemEventParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "system-event" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let text = find_json_string(params, "\"text\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    if text.trim().is_empty() {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    Ok(SystemEventParams {
        text,
        host: find_json_string(params, "\"host\":\""),
        ip: find_json_string(params, "\"ip\":\""),
        version: find_json_string(params, "\"version\":\""),
        platform: find_json_string(params, "\"platform\":\""),
        mode: find_json_string(params, "\"mode\":\""),
        reason: find_json_string(params, "\"reason\":\""),
        instance_id: find_json_string(params, "\"instanceId\":\""),
    })
}

pub fn parse_set_heartbeats_params(body: &str) -> Result<SetHeartbeatsParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "set-heartbeats" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let start = params
        .find("\"enabled\":")
        .map(|index| index + "\"enabled\":".len())
        .ok_or(GatewayErrorCode::InvalidRequest)?;
    let rest = params[start..].trim_start();
    if let Some(rest) = rest.strip_prefix("true") {
        if rest.is_empty() || rest.starts_with([',', '}', ' ']) {
            return Ok(SetHeartbeatsParams { enabled: true });
        }
    }
    if let Some(rest) = rest.strip_prefix("false") {
        if rest.is_empty() || rest.starts_with([',', '}', ' ']) {
            return Ok(SetHeartbeatsParams { enabled: false });
        }
    }
    Err(GatewayErrorCode::InvalidRequest)
}

pub fn parse_talk_mode_params(body: &str) -> Result<TalkModeParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "talk.mode" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let start = params
        .find("\"enabled\":")
        .map(|index| index + "\"enabled\":".len())
        .ok_or(GatewayErrorCode::InvalidRequest)?;
    let rest = params[start..].trim_start();
    let enabled = if let Some(rest) = rest.strip_prefix("true") {
        if rest.is_empty() || rest.starts_with([',', '}', ' ']) {
            true
        } else {
            return Err(GatewayErrorCode::InvalidRequest);
        }
    } else if let Some(rest) = rest.strip_prefix("false") {
        if rest.is_empty() || rest.starts_with([',', '}', ' ']) {
            false
        } else {
            return Err(GatewayErrorCode::InvalidRequest);
        }
    } else {
        return Err(GatewayErrorCode::InvalidRequest);
    };
    Ok(TalkModeParams {
        enabled,
        phase: find_json_string(params, "\"phase\":\""),
    })
}

pub fn parse_voicewake_set_params(body: &str) -> Result<VoicewakeSetParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "voicewake.set" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let triggers = parse_string_array(params, "\"triggers\":");
    if triggers.is_empty() {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    Ok(VoicewakeSetParams {
        triggers: normalize_voicewake_triggers(triggers),
    })
}

pub fn parse_wake_params(body: &str) -> Result<WakeParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "wake" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let mode = find_json_string(params, "\"mode\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    if mode != "now" && mode != "next-heartbeat" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let text = find_json_string(params, "\"text\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    if text.trim().is_empty() {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    Ok(WakeParams { mode, text })
}

pub fn parse_terminal_write_params(body: &str) -> Result<TerminalWriteParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "terminal.write" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let id = find_json_string(params, "\"id\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let data = find_json_string(params, "\"data\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    Ok(TerminalWriteParams { id, data })
}

pub fn parse_terminal_resize_params(body: &str) -> Result<TerminalResizeParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != "terminal.resize" {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let id = find_json_string(params, "\"id\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    let cols = find_json_u64(params, "\"cols\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let rows = find_json_u64(params, "\"rows\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    Ok(TerminalResizeParams {
        id,
        cols: cols as u16,
        rows: rows as u16,
    })
}

pub fn parse_terminal_id_params(body: &str, expected_method: &str) -> Result<TerminalIdParams, GatewayErrorCode> {
    let meta = parse_request_frame_meta(body)?;
    if meta.method != expected_method {
        return Err(GatewayErrorCode::InvalidRequest);
    }
    let params = find_object_slice(body, "\"params\":").ok_or(GatewayErrorCode::InvalidRequest)?;
    let id = find_json_string(params, "\"id\":\"").ok_or(GatewayErrorCode::InvalidRequest)?;
    Ok(TerminalIdParams { id })
}

pub fn health_response(started_at: Instant) -> String {
    HealthStatus {
        uptime_seconds: started_at.elapsed().as_secs(),
    }
    .to_json()
}

pub fn gateway_health_payload_json(started_at: Instant) -> String {
    let now = started_at.elapsed().as_millis() as u64;
    format!(
        "{{\"ok\":true,\"ts\":{},\"durationMs\":0,\"channels\":{{}},\"channelOrder\":[],\"channelLabels\":{{}},\"heartbeatSeconds\":0,\"defaultAgentId\":\"{}\",\"agents\":[],\"authProviders\":[],\"sessions\":{{\"path\":\"shadow\",\"count\":0,\"recent\":[]}},\"kernel\":null,\"memoryHealth\":null,\"criticalAlerts\":[]}}",
        now,
        resolve_default_agent_id()
    )
}

pub fn gateway_health_response(request_id: &str, started_at: Instant) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":{},\"ok\":true,\"payload\":{}}}",
        json_string(request_id),
        gateway_health_payload_json(started_at)
    )
}

pub fn gateway_status_payload_json(queued_system_events: &[String]) -> String {
    format!(
        "{{\"heartbeat\":{{\"defaultAgentId\":\"{}\",\"agents\":[]}},\"channelSummary\":[],\"queuedSystemEvents\":[{}],\"sessions\":{{\"paths\":[\"shadow\"],\"count\":0,\"defaults\":{{\"model\":null,\"contextTokens\":null}},\"recent\":[],\"byAgent\":[]}}}}",
        resolve_default_agent_id()
        ,
        queued_system_events
            .iter()
            .map(|event| json_string(event))
            .collect::<Vec<_>>()
            .join(",")
    )
}

pub fn gateway_status_response(request_id: &str, queued_system_events: &[String]) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":{},\"ok\":true,\"payload\":{}}}",
        json_string(request_id),
        gateway_status_payload_json(queued_system_events)
    )
}

pub fn ok_response(request_id: &str, payload_json: &str) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":{},\"ok\":true,\"payload\":{}}}",
        json_string(request_id),
        payload_json
    )
}

pub fn heartbeat_event_payload_json(ts: u64) -> String {
    format!(
        "{{\"ts\":{},\"status\":\"ok-empty\",\"reason\":\"shadow\"}}",
        ts
    )
}

pub fn talk_mode_payload_json(enabled: bool, phase: Option<&str>, ts: u64) -> String {
    let phase_json = phase
        .map(json_string)
        .unwrap_or_else(|| "null".to_string());
    format!(
        "{{\"enabled\":{},\"phase\":{},\"ts\":{}}}",
        enabled, phase_json, ts
    )
}

pub fn voicewake_payload_json(triggers: &[String]) -> String {
    format!(
        "{{\"triggers\":[{}]}}",
        triggers
            .iter()
            .map(|trigger| json_string(trigger))
            .collect::<Vec<_>>()
            .join(",")
    )
}

pub fn wake_payload_json(ok: bool) -> String {
    format!("{{\"ok\":{}}}", ok)
}

pub fn models_list_payload_json() -> String {
    "{\"models\":[{\"id\":\"shadow-gpt-mini\",\"name\":\"Shadow GPT Mini\",\"provider\":\"openai\",\"contextWindow\":32768},{\"id\":\"shadow-claude-fast\",\"name\":\"Shadow Claude Fast\",\"provider\":\"anthropic\",\"contextWindow\":200000,\"reasoning\":true}]}".to_string()
}

pub fn connectors_catalog_payload_json() -> String {
    "{\"total\":1,\"connectors\":[{\"tool\":\"aos-shadow\",\"label\":\"Shadow Connector\",\"description\":\"Shadow connector surface for Rust gateway parity.\",\"backend\":\"rust-shadow\",\"version\":\"0.1.0\",\"manifestSchemaVersion\":\"1\",\"category\":\"shadow\",\"categories\":[\"shadow\"],\"resources\":[],\"modes\":[\"readonly\"],\"commands\":[],\"installState\":\"ready\",\"status\":{\"ok\":true,\"label\":\"ready\"},\"discovery\":{\"sources\":[\"path\"]}}]}".to_string()
}

pub fn usage_status_payload_json(ts: u64) -> String {
    format!(
        "{{\"updatedAt\":{},\"providers\":[{{\"provider\":\"openai-codex\",\"displayName\":\"OpenAI Codex\",\"windows\":[{{\"label\":\"Current cycle\",\"usedPercent\":12.5}}]}}]}}",
        ts
    )
}

pub fn usage_cost_payload_json(days: u64, ts: u64) -> String {
    format!(
        "{{\"updatedAt\":{},\"days\":{},\"daily\":[{{\"date\":\"2026-04-19\",\"input\":120,\"output\":45,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":165,\"totalCost\":0.0021,\"missingCostEntries\":0}}],\"totals\":{{\"input\":120,\"output\":45,\"cacheRead\":0,\"cacheWrite\":0,\"totalTokens\":165,\"totalCost\":0.0021,\"missingCostEntries\":0}}}}",
        ts, days
    )
}

pub fn providers_status_payload_json() -> String {
    "{\"providers\":[{\"id\":\"openai\",\"profileCount\":1,\"profiles\":[\"openai:shadow\"],\"status\":\"connected\",\"active\":true},{\"id\":\"anthropic\",\"profileCount\":1,\"profiles\":[\"anthropic:shadow\"],\"status\":\"connected\",\"active\":false}],\"activeProfile\":\"shadow-default\"}".to_string()
}

pub fn commands_list_payload_json() -> String {
    "{\"commands\":[{\"key\":\"status\",\"description\":\"Show gateway status\",\"aliases\":[\"/status\"],\"category\":\"system\",\"acceptsArgs\":false},{\"key\":\"health\",\"description\":\"Show health summary\",\"aliases\":[\"/health\"],\"category\":\"system\",\"acceptsArgs\":false},{\"key\":\"wake\",\"description\":\"Request immediate wake\",\"aliases\":[\"/wake\"],\"category\":\"automation\",\"acceptsArgs\":true}]}".to_string()
}

pub fn config_get_payload_json() -> String {
    let raw = "{\"gateway\":{\"mode\":\"local\"},\"agents\":{\"defaults\":{\"model\":\"shadow-gpt-mini\"}},\"channels\":{\"telegram\":{\"botToken\":\"***redacted***\"}}}";
    format!(
        "{{\"path\":\"/Users/shadow/.argentos/argent.json\",\"exists\":true,\"raw\":{},\"parsed\":{{\"gateway\":{{\"mode\":\"local\"}},\"agents\":{{\"defaults\":{{\"model\":\"shadow-gpt-mini\"}}}},\"channels\":{{\"telegram\":{{\"botToken\":\"***redacted***\"}}}}}},\"valid\":true,\"config\":{{\"gateway\":{{\"mode\":\"local\"}},\"agents\":{{\"defaults\":{{\"model\":\"shadow-gpt-mini\"}}}},\"channels\":{{\"telegram\":{{\"botToken\":\"***redacted***\"}}}}}},\"hash\":\"shadow-config-hash\",\"issues\":[],\"warnings\":[],\"legacyIssues\":[]}}",
        json_string(raw)
    )
}

pub fn config_schema_payload_json() -> String {
    "{\"version\":\"shadow-schema-v1\",\"generatedAt\":\"2026-04-19T13:20:00.000Z\",\"schema\":{\"type\":\"object\",\"properties\":{\"gateway\":{\"type\":\"object\"},\"agents\":{\"type\":\"object\"},\"channels\":{\"type\":\"object\"}}},\"uiHints\":{\"gateway\":{\"label\":\"Gateway\"},\"agents\":{\"label\":\"Agents\"},\"channels\":{\"label\":\"Channels\"},\"gateway.auth.token\":{\"sensitive\":true}}}".to_string()
}

pub fn execution_worker_status_payload_json() -> String {
    "{\"enabled\":true,\"globalPaused\":false,\"agentCount\":1,\"agents\":[{\"agentId\":\"argent\",\"enabled\":true,\"paused\":false,\"running\":false,\"rerunRequested\":false,\"nextDueAt\":1776603600000,\"lastRunAt\":1776600000000,\"lastDispatchRequestedAt\":null,\"lastDispatchReason\":null,\"config\":{\"every\":\"20m\",\"model\":\"shadow-gpt-mini\",\"sessionMainKey\":\"agent:argent:main\",\"maxRunMinutes\":20,\"maxTasksPerCycle\":3,\"scope\":\"agent\",\"requireEvidence\":true,\"maxNoProgressAttempts\":2},\"metrics\":{\"totalRuns\":4,\"totalSkips\":1,\"totalAttempted\":3,\"totalProgressed\":2,\"totalCompleted\":2,\"totalBlocked\":0,\"lastStatus\":\"ran\",\"lastReason\":\"manual\",\"lastAttempted\":1,\"lastProgressed\":1,\"lastCompleted\":1,\"lastBlocked\":0,\"lastFinishedAt\":1776600000000}}]}".to_string()
}

pub fn exec_approvals_get_payload_json() -> String {
    "{\"path\":\"/Users/shadow/.argentos/exec-approvals.json\",\"exists\":true,\"hash\":\"shadow-exec-approvals-hash\",\"file\":{\"version\":1,\"socket\":{\"path\":\"/Users/shadow/.argentos/exec-approvals.sock\"},\"defaults\":{\"security\":\"deny\",\"ask\":\"on-miss\",\"askFallback\":\"deny\",\"autoAllowSkills\":false},\"agents\":{\"argent\":{\"allowlist\":[{\"id\":\"shadow-safe-read\",\"pattern\":\"rg\"}]}}}}".to_string()
}

pub fn copilot_overview_payload_json() -> String {
    "{\"domains\":[{\"domain\":\"intent\",\"mode\":\"assist-draft\"},{\"domain\":\"workforce\",\"mode\":\"assist-propose\"},{\"domain\":\"observability\",\"mode\":\"assist-draft\"}],\"intentHistoryCount\":1}".to_string()
}

pub fn copilot_workforce_overview_payload_json() -> String {
    "{\"templatesCount\":2,\"assignmentsCount\":3,\"enabledAssignmentsCount\":2,\"dueNowCount\":1,\"runningCount\":1,\"blockedCount\":0,\"workersCount\":2}".to_string()
}

pub fn copilot_observability_overview_payload_json() -> String {
    "{\"horizonDays\":7,\"totalRuns\":12,\"running\":1,\"completed\":10,\"blocked\":1,\"failed\":0}".to_string()
}

pub fn copilot_mode_get_payload_json(domain: &str) -> String {
    format!(
        "{{\"domain\":{},\"mode\":\"assist-draft\"}}",
        json_string(domain)
    )
}

pub fn cron_status_payload_json() -> String {
    "{\"enabled\":true,\"storePath\":\"/Users/shadow/.argentos/cron/jobs.json\",\"jobs\":3,\"nextWakeAtMs\":1776603600000}".to_string()
}

pub fn device_pair_list_payload_json() -> String {
    "{\"pending\":[{\"requestId\":\"pair-req-1\",\"deviceName\":\"Shadow iPhone\",\"deviceId\":\"device-shadow-iphone\",\"platform\":\"ios\",\"role\":\"mobile\",\"requestedAtMs\":1776600000000}],\"paired\":[{\"deviceId\":\"device-shadow-mac\",\"deviceName\":\"Shadow MacBook\",\"platform\":\"macos\",\"role\":\"desktop\",\"pairedAtMs\":1776500000000,\"tokens\":[{\"role\":\"desktop\",\"scopes\":[\"gateway.connect\"],\"createdAtMs\":1776500000000,\"rotatedAtMs\":1776500000000,\"revokedAtMs\":null}]}]}".to_string()
}

pub fn node_pair_list_payload_json() -> String {
    "{\"pending\":[{\"requestId\":\"node-pair-req-1\",\"displayName\":\"Shadow Node\",\"nodeId\":\"node-shadow-1\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"requestedAtMs\":1776600000000}],\"paired\":[{\"nodeId\":\"node-shadow-paired\",\"displayName\":\"Shadow Node 2\",\"platform\":\"linux\",\"version\":\"0.1.0\",\"pairedAtMs\":1776500000000,\"connected\":true}]}".to_string()
}

pub fn knowledge_collections_list_payload_json() -> String {
    "{\"success\":true,\"agentId\":\"argent\",\"actorAgentId\":\"argent\",\"aclEnforced\":true,\"collections\":[{\"name\":\"public\",\"canRead\":true,\"canWrite\":false,\"isOwner\":false,\"documentCount\":12},{\"name\":\"operator-notes\",\"canRead\":true,\"canWrite\":true,\"isOwner\":true,\"documentCount\":4}]}".to_string()
}

pub fn agent_identity_get_payload_json() -> String {
    "{\"agentId\":\"argent\",\"name\":\"Argent\",\"avatar\":\"A\",\"emoji\":\"🜂\"}".to_string()
}

pub fn knowledge_library_list_payload_json() -> String {
    "{\"success\":true,\"agentId\":\"argent\",\"actorAgentId\":\"argent\",\"ingestedOnly\":true,\"aclEnforced\":true,\"results\":[{\"id\":\"knowledge-doc-1\",\"title\":\"Shadow Runbook\",\"type\":\"document\",\"savedAt\":1776600000000,\"sourceFile\":\"runbook.md\",\"collection\":\"operator-notes\"},{\"id\":\"knowledge-doc-2\",\"title\":\"Public FAQ\",\"type\":\"document\",\"savedAt\":1776500000000,\"sourceFile\":\"faq.md\",\"collection\":\"public\"}]}".to_string()
}

pub fn cron_list_payload_json() -> String {
    "{\"jobs\":[{\"id\":\"cron-shadow-1\",\"name\":\"daily\",\"enabled\":true,\"schedule\":{\"kind\":\"every\",\"everyMs\":60000},\"sessionTarget\":\"main\",\"wakeMode\":\"next-heartbeat\",\"payload\":{\"kind\":\"systemEvent\",\"text\":\"hello\"},\"nextRunAt\":1776603600000}]}".to_string()
}

pub fn jobs_overview_payload_json() -> String {
    "{\"templatesCount\":2,\"assignmentsCount\":3,\"enabledAssignmentsCount\":2,\"runningJobsCount\":1,\"blockedRunsCount\":0,\"dueNowCount\":1,\"agents\":[{\"agentId\":\"argent\",\"total\":2,\"enabled\":2,\"blockedTasks\":0,\"dueNow\":1,\"nextDueAt\":1776603600000},{\"agentId\":\"main\",\"total\":1,\"enabled\":0,\"blockedTasks\":1,\"dueNow\":0,\"nextDueAt\":1776607200000}]}".to_string()
}

pub fn contemplation_run_once_payload_json(agent_id: &str) -> String {
    format!(
        "{{\"agentId\":{},\"status\":\"ran\",\"isOk\":true,\"lastRunMs\":1776600000000,\"nextDueMs\":1776603600000}}",
        json_string(agent_id)
    )
}

pub fn agent_wait_payload_json(run_id: &str) -> String {
    if run_id.contains("timeout") {
        format!("{{\"runId\":{},\"status\":\"timeout\"}}", json_string(run_id))
    } else if run_id.contains("err") {
        format!(
            "{{\"runId\":{},\"status\":\"error\",\"startedAt\":1776600000100,\"endedAt\":1776600000200,\"error\":\"boom\"}}",
            json_string(run_id)
        )
    } else {
        format!(
            "{{\"runId\":{},\"status\":\"ok\",\"startedAt\":1776600000100,\"endedAt\":1776600000200,\"error\":null}}",
            json_string(run_id)
        )
    }
}

pub fn node_event_payload_json() -> String {
    "{\"ok\":true}".to_string()
}

pub fn copilot_mode_set_payload_json(domain: &str, mode: &str) -> String {
    format!(
        "{{\"domain\":{},\"mode\":{}}}",
        json_string(domain),
        json_string(mode)
    )
}

pub fn config_set_payload_json() -> String {
    "{\"ok\":true,\"path\":\"/Users/shadow/.argentos/argent.json\",\"config\":{\"gateway\":{\"mode\":\"local\"},\"channels\":{\"telegram\":{\"botToken\":\"token-1\"}}}}".to_string()
}

pub fn family_register_payload_json() -> String {
    "{\"worker\":{\"id\":\"relay\",\"name\":\"Relay\",\"role\":\"tier_1_support_specialist\",\"team\":\"Support Team\",\"workspaceDir\":\"/Users/shadow/family/relay\",\"identityDir\":\"/Users/shadow/family/relay/agent\",\"rootDir\":\"/Users/shadow/family/relay\",\"redis\":true}}".to_string()
}

pub fn commands_compact_payload_json() -> String {
    "{\"ok\":true,\"compacted\":true,\"reason\":null,\"tokensBefore\":4000,\"tokensAfter\":1200}".to_string()
}

pub fn channels_logout_payload_json(channel: &str) -> String {
    if channel == "telegram" {
        "{\"channel\":\"telegram\",\"cleared\":true,\"envToken\":false}".to_string()
    } else {
        format!("{{\"channel\":{},\"cleared\":false}}", json_string(channel))
    }
}

pub fn config_patch_payload_json() -> String {
    "{\"ok\":true,\"path\":\"/Users/shadow/.argentos/argent.json\",\"config\":{\"gateway\":{\"mode\":\"local\"},\"channels\":{\"telegram\":{\"botToken\":\"token-1\",\"groups\":{\"*\":{\"requireMention\":false}}}}},\"restart\":{\"scheduled\":true,\"delayMs\":0,\"signal\":\"SIGUSR1\",\"reason\":\"config.patch\"},\"sentinel\":{\"path\":\"/Users/shadow/.argent/restart-sentinel.json\",\"payload\":{\"kind\":\"config-apply\",\"status\":\"ok\",\"ts\":1776600000000,\"sessionKey\":\"agent:main:whatsapp:dm:+15555550123\",\"message\":\"test patch\",\"doctorHint\":\"Run argent doctor --non-interactive if restart fails.\",\"stats\":{\"mode\":\"config.patch\",\"root\":\"/Users/shadow/.argentos/argent.json\"}}}}".to_string()
}

pub fn agents_files_set_payload_json() -> String {
    "{\"ok\":true,\"agentId\":\"argent\",\"workspace\":\"shadow-workspace-argent\",\"file\":{\"name\":\"IDENTITY.md\",\"path\":\"shadow-workspace-argent/IDENTITY.md\",\"missing\":false,\"size\":21,\"updatedAtMs\":1776600000000,\"content\":\"# IDENTITY\\nShadow edit\\n\"}}".to_string()
}

pub fn sessions_compact_payload_json() -> String {
    "{\"ok\":true,\"key\":\"agent:main:main\",\"compacted\":true}".to_string()
}

pub fn cron_run_payload_json() -> String {
    "{\"ok\":true,\"ran\":true}".to_string()
}

pub fn cron_runs_payload_json() -> String {
    "{\"entries\":[{\"jobId\":\"cron-shadow-1\",\"action\":\"finished\",\"status\":\"ok\",\"summary\":\"hello\"}]}".to_string()
}

pub fn config_apply_payload_json() -> String {
    "{\"ok\":true,\"path\":\"/Users/shadow/.argentos/argent.json\",\"config\":{\"agents\":{\"list\":[{\"id\":\"main\",\"workspace\":\"~/argent\"}]}},\"restart\":{\"scheduled\":true,\"delayMs\":0,\"signal\":\"SIGUSR1\",\"reason\":\"config.apply\"},\"sentinel\":{\"path\":\"/Users/shadow/.argent/restart-sentinel.json\",\"payload\":{\"kind\":\"config-apply\",\"status\":\"ok\",\"ts\":1776600000000,\"sessionKey\":\"agent:main:whatsapp:dm:+15555550123\",\"message\":null,\"doctorHint\":\"Run argent doctor --non-interactive if restart fails.\",\"stats\":{\"mode\":\"config.apply\",\"root\":\"/Users/shadow/.argentos/argent.json\"}}}}".to_string()
}

pub fn cron_add_payload_json() -> String {
    "{\"id\":\"cron-shadow-new\",\"name\":\"daily\",\"enabled\":true,\"schedule\":{\"kind\":\"every\",\"everyMs\":60000},\"sessionTarget\":\"main\",\"wakeMode\":\"next-heartbeat\",\"payload\":{\"kind\":\"systemEvent\",\"text\":\"hello\"},\"nextRunAt\":1776603600000}".to_string()
}

pub fn cron_remove_payload_json() -> String {
    "{\"ok\":true,\"removed\":true}".to_string()
}

pub fn copilot_run_story_payload_json() -> String {
    "{\"run\":{\"id\":\"run-shadow-1\",\"assignmentId\":\"assign-shadow-1\",\"templateId\":\"tmpl-shadow-1\",\"taskId\":\"task-shadow-1\",\"status\":\"completed\"},\"assignment\":{\"id\":\"assign-shadow-1\",\"agentId\":\"argent\",\"enabled\":true},\"template\":{\"id\":\"tmpl-shadow-1\",\"name\":\"Shadow Template\"},\"task\":{\"id\":\"task-shadow-1\",\"status\":\"completed\"},\"assignmentRuns\":[{\"id\":\"run-shadow-1\",\"status\":\"completed\"}],\"events\":[{\"id\":\"event-shadow-1\",\"kind\":\"run.completed\",\"payload\":{\"runId\":\"run-shadow-1\"}}]}".to_string()
}

pub fn device_pair_approve_payload_json() -> String {
    "{\"requestId\":\"pair-req-1\",\"device\":{\"deviceId\":\"device-shadow-iphone\",\"deviceName\":\"Shadow iPhone\",\"platform\":\"ios\",\"role\":\"mobile\",\"pairedAtMs\":1776600000000,\"tokens\":[{\"role\":\"mobile\",\"scopes\":[\"gateway.connect\"],\"createdAtMs\":1776600000000,\"rotatedAtMs\":1776600000000,\"revokedAtMs\":null}]}}".to_string()
}

pub fn device_pair_reject_payload_json() -> String {
    "{\"requestId\":\"pair-req-1\",\"deviceId\":\"device-shadow-iphone\",\"rejected\":true}".to_string()
}

pub fn device_token_rotate_payload_json() -> String {
    "{\"deviceId\":\"device-shadow-mac\",\"role\":\"desktop\",\"token\":\"shadow-token-rotated\",\"scopes\":[\"gateway.connect\"],\"rotatedAtMs\":1776600000000}".to_string()
}

pub fn device_token_revoke_payload_json() -> String {
    "{\"deviceId\":\"device-shadow-mac\",\"role\":\"desktop\",\"revokedAtMs\":1776600000000}".to_string()
}

pub fn exec_approval_request_payload_json() -> String {
    "{\"id\":\"approval-123\",\"decision\":\"allow-once\",\"createdAtMs\":1776600000000,\"expiresAtMs\":1776600120000}".to_string()
}

pub fn exec_approval_resolve_payload_json() -> String {
    "{\"ok\":true}".to_string()
}

pub fn exec_approvals_node_get_payload_json() -> String {
    "{\"path\":\"/Users/shadow/.argentos/node-exec-approvals.json\",\"exists\":true,\"hash\":\"shadow-node-exec-approvals-hash\",\"file\":{\"version\":1,\"socket\":{\"path\":\"/Users/shadow/.argentos/exec-approvals.sock\"},\"defaults\":{\"security\":\"deny\",\"ask\":\"on-miss\",\"askFallback\":\"deny\",\"autoAllowSkills\":false}}}".to_string()
}

pub fn exec_approvals_node_set_payload_json() -> String {
    "{\"path\":\"/Users/shadow/.argentos/node-exec-approvals.json\",\"exists\":true,\"hash\":\"shadow-node-exec-approvals-hash-next\",\"file\":{\"version\":1,\"socket\":{\"path\":\"/Users/shadow/.argentos/exec-approvals.sock\"},\"defaults\":{\"security\":\"deny\",\"ask\":\"on-miss\",\"askFallback\":\"deny\",\"autoAllowSkills\":false}}}".to_string()
}

pub fn exec_approvals_set_payload_json() -> String {
    "{\"path\":\"/Users/shadow/.argentos/exec-approvals.json\",\"exists\":true,\"hash\":\"shadow-exec-approvals-hash-next\",\"file\":{\"version\":1,\"socket\":{\"path\":\"/Users/shadow/.argentos/exec-approvals.sock\"},\"defaults\":{\"security\":\"deny\",\"ask\":\"on-miss\",\"askFallback\":\"deny\",\"autoAllowSkills\":false}}}".to_string()
}

pub fn execution_worker_control_payload_json(control_kind: &str) -> String {
    format!(
        "{{\"control\":{{\"ok\":true,\"scope\":\"agent\",\"agentId\":\"relay\",\"kind\":{}}},\"status\":{{\"enabled\":true,\"globalPaused\":false,\"agentCount\":1,\"agents\":[{{\"agentId\":\"relay\",\"enabled\":true,\"paused\":false,\"running\":false,\"rerunRequested\":false,\"nextDueAt\":1776603600000,\"lastRunAt\":1776600000000,\"lastDispatchRequestedAt\":null,\"lastDispatchReason\":null,\"config\":{{\"every\":\"20m\",\"model\":\"shadow-gpt-mini\",\"sessionMainKey\":\"agent:relay:main\",\"maxRunMinutes\":20,\"maxTasksPerCycle\":3,\"scope\":\"agent\",\"requireEvidence\":true,\"maxNoProgressAttempts\":2}},\"metrics\":{{\"totalRuns\":4,\"totalSkips\":1,\"totalAttempted\":3,\"totalProgressed\":2,\"totalCompleted\":2,\"totalBlocked\":0,\"lastStatus\":\"ran\",\"lastReason\":\"manual\",\"lastAttempted\":1,\"lastProgressed\":1,\"lastCompleted\":1,\"lastBlocked\":0,\"lastFinishedAt\":1776600000000}}}}]}}}}",
        json_string(control_kind)
    )
}

pub fn execution_worker_run_now_payload_json() -> String {
    "{\"dispatch\":{\"ok\":true,\"scope\":\"agent\",\"agentId\":\"relay\",\"dispatched\":1,\"paused\":false,\"running\":false,\"reason\":\"operator-test\"},\"status\":{\"enabled\":true,\"globalPaused\":false,\"agentCount\":1,\"agents\":[]}}".to_string()
}

pub fn jobs_assignments_list_payload_json() -> String {
    "{\"assignments\":[{\"id\":\"asn-pg-1\",\"templateId\":\"tpl-pg-1\",\"agentId\":\"relay\",\"title\":\"Tier 1 Support Simulation\",\"enabled\":true,\"cadenceMinutes\":1440,\"executionMode\":\"simulate\",\"deploymentStage\":\"simulate\"}]}".to_string()
}

pub fn jobs_assignments_create_payload_json() -> String {
    "{\"assignment\":{\"id\":\"asn-pg-1\",\"templateId\":\"tpl-pg-1\",\"agentId\":\"relay\",\"title\":\"Tier 1 Support Simulation\",\"enabled\":true,\"cadenceMinutes\":1440,\"executionMode\":\"simulate\",\"deploymentStage\":\"simulate\"}}".to_string()
}

pub fn jobs_assignments_update_payload_json() -> String {
    "{\"assignment\":{\"id\":\"asn-pg-1\",\"templateId\":\"tpl-pg-1\",\"agentId\":\"relay\",\"title\":\"Tier 1 Support Updated\",\"enabled\":true,\"cadenceMinutes\":60,\"executionMode\":\"live\",\"deploymentStage\":\"hold\"}}".to_string()
}

pub fn jobs_assignments_retire_payload_json() -> String {
    "{\"assignment\":{\"id\":\"asn-1\",\"enabled\":false,\"metadata\":{\"retired\":{\"retiredAt\":\"2026-04-19T16:00:00.000Z\",\"retiredBy\":\"operator\",\"reason\":\"retired by operator\",\"runningRuns\":1}}},\"runningRuns\":1}".to_string()
}

pub fn jobs_assignments_run_now_payload_json() -> String {
    "{\"ok\":true,\"assignmentId\":\"asn-pg-1\",\"queuedTasks\":1}".to_string()
}

pub fn jobs_runs_list_payload_json() -> String {
    "{\"runs\":[{\"id\":\"run-pg-1\",\"assignmentId\":\"asn-pg-1\",\"templateId\":\"tpl-pg-1\",\"taskId\":\"task-pg-1\",\"agentId\":\"relay\",\"status\":\"completed\",\"executionMode\":\"simulate\",\"startedAt\":1776600000000}]}".to_string()
}

pub fn jobs_events_list_payload_json() -> String {
    "{\"events\":[{\"id\":\"evt-1\",\"eventType\":\"run.completed\",\"source\":\"system\",\"targetAgentId\":\"relay\",\"createdAt\":1776600000000,\"metadata\":{\"runId\":\"run-1\",\"assignmentId\":\"asn-1\",\"taskId\":\"task-1\"}}]}".to_string()
}

pub fn jobs_runs_trace_payload_json() -> String {
    "{\"run\":{\"id\":\"run-1\",\"assignmentId\":\"asn-1\",\"templateId\":\"tpl-1\",\"taskId\":\"task-1\",\"agentId\":\"relay\",\"status\":\"completed\",\"executionMode\":\"simulate\",\"startedAt\":1776600000000},\"assignment\":{\"id\":\"asn-1\",\"title\":\"Tier 1 Support\"},\"template\":{\"id\":\"tpl-1\",\"name\":\"Tier 1 Template\"},\"task\":{\"id\":\"task-1\",\"status\":\"completed\"},\"assignmentRuns\":[{\"id\":\"run-1\",\"status\":\"completed\"}],\"events\":[{\"id\":\"evt-1\",\"eventType\":\"run.completed\"}]}".to_string()
}

pub fn jobs_runs_review_payload_json() -> String {
    "{\"run\":{\"id\":\"run-pg-1\",\"assignmentId\":\"asn-pg-1\",\"templateId\":\"tpl-pg-1\",\"status\":\"completed\",\"reviewStatus\":\"approved\",\"deploymentStage\":\"simulate\"}}".to_string()
}

pub fn jobs_runs_retry_payload_json() -> String {
    "{\"ok\":true,\"runId\":\"run-pg-1\",\"assignmentId\":\"asn-pg-1\",\"queuedTasks\":1,\"dispatched\":true}".to_string()
}

pub fn jobs_orchestrator_status_payload_json() -> String {
    "{\"enabled\":true,\"running\":false,\"queued\":1,\"lastTickAt\":1776600000000}".to_string()
}

pub fn jobs_orchestrator_event_payload_json() -> String {
    "{\"ok\":true,\"eventId\":\"orchestrator-event-1\",\"accepted\":true}".to_string()
}

pub fn jobs_templates_list_payload_json() -> String {
    "{\"templates\":[{\"id\":\"tpl-pg-1\",\"name\":\"Tier 1 Support\",\"rolePrompt\":\"Handle tier 1 only\"}]}".to_string()
}

pub fn jobs_templates_create_payload_json() -> String {
    "{\"template\":{\"id\":\"tpl-pg-1\",\"name\":\"Tier 1 Support\",\"rolePrompt\":\"Handle tier 1 only\",\"defaultMode\":\"simulate\"}}".to_string()
}

pub fn jobs_templates_update_payload_json() -> String {
    "{\"template\":{\"id\":\"tpl-pg-1\",\"name\":\"Tier 1 Support Updated\",\"rolePrompt\":\"Handle tier 1 only\",\"defaultMode\":\"simulate\",\"metadata\":{}}}".to_string()
}

pub fn jobs_templates_retire_payload_json() -> String {
    "{\"template\":{\"id\":\"tpl-1\",\"name\":\"Tier 1\",\"metadata\":{\"lifecycleStatus\":\"retired\"}},\"disabledAssignments\":1,\"linkedAssignments\":2}".to_string()
}

pub fn jobs_runs_advance_payload_json() -> String {
    "{\"run\":{\"id\":\"run-pg-1\",\"status\":\"completed\"},\"assignment\":{\"id\":\"asn-pg-1\",\"enabled\":true},\"queuedNext\":true}".to_string()
}

pub fn knowledge_collections_grant_payload_json() -> String {
    "{\"success\":true,\"actorAgentId\":\"argent\",\"targetAgentId\":\"relay\",\"collection\":\"operator-notes\",\"collectionTag\":\"operator-notes\",\"aclEnforced\":true,\"updated\":true,\"granted\":{\"canRead\":true,\"canWrite\":true,\"isOwner\":false}}".to_string()
}

pub fn knowledge_ingest_payload_json() -> String {
    "{\"success\":true,\"processed\":1,\"embedded\":1,\"skipped\":0,\"failed\":[],\"items\":[{\"id\":\"item-1\",\"source\":\"knowledge_ingest\"}]}".to_string()
}

pub fn knowledge_vault_ingest_payload_json() -> String {
    "{\"success\":true,\"rootPath\":\"/Users/shadow/Vault\",\"source\":\"vault\",\"processed\":1,\"embedded\":1,\"skipped\":0,\"failed\":[]}".to_string()
}

pub fn knowledge_search_payload_json() -> String {
    "{\"success\":true,\"query\":\"shadow\",\"agentId\":\"argent\",\"results\":[{\"id\":\"item-1\",\"title\":\"Shadow Runbook\",\"summary\":\"Shadow runbook summary\",\"score\":0.98,\"collection\":\"operator-notes\",\"sourceFile\":\"runbook.md\"}]}".to_string()
}

pub fn knowledge_library_delete_payload_json() -> String {
    "{\"success\":true,\"matched\":1,\"deleted\":1,\"failed\":[]}".to_string()
}

pub fn knowledge_library_reindex_payload_json() -> String {
    "{\"success\":true,\"processed\":1,\"embedded\":1,\"skipped\":0,\"failed\":[]}".to_string()
}

pub fn sessions_patch_payload_json() -> String {
    "{\"ok\":true,\"path\":\"/Users/shadow/.argentos/sessions.json\",\"key\":\"agent:main:main\",\"entry\":{\"thinkingLevel\":\"medium\",\"verboseLevel\":\"off\",\"sendPolicy\":\"deny\",\"label\":\"Briefing\",\"spawnedBy\":\"agent:main:main\",\"modelOverride\":\"gpt-test-a\",\"providerOverride\":\"openai\"},\"resolved\":{\"modelProvider\":\"openai\",\"model\":\"gpt-test-a\"}}".to_string()
}

pub fn sessions_reset_payload_json() -> String {
    "{\"ok\":true,\"key\":\"agent:main:main\",\"entry\":{\"sessionId\":\"sess-main-reset\"}}".to_string()
}

pub fn sessions_delete_payload_json() -> String {
    "{\"ok\":true,\"key\":\"agent:main:discord:group:dev\",\"deleted\":true,\"archived\":[]}".to_string()
}

pub fn skills_install_payload_json() -> String {
    "{\"ok\":true,\"installId\":\"shadow-install-1\",\"message\":\"installed shadow skill\"}".to_string()
}

pub fn skills_update_payload_json() -> String {
    "{\"ok\":true,\"skillKey\":\"shadow-routing\",\"config\":{\"enabled\":true,\"apiKey\":\"shadow-key\",\"env\":{\"OPENAI_API_KEY\":\"set\"}}}".to_string()
}

pub fn skills_personal_payload_json() -> String {
    "{\"agentId\":\"argent\",\"generatedAt\":\"2026-04-19T16:45:00.000Z\",\"rows\":[{\"id\":\"ps-1\",\"title\":\"Shadow Triage\",\"summary\":\"Handle first-line triage\",\"scope\":\"operator\",\"state\":\"promoted\",\"confidence\":0.92,\"strength\":0.88,\"usageCount\":12,\"successCount\":10,\"failureCount\":1,\"contradictionCount\":0,\"createdAt\":\"2026-04-18T00:00:00.000Z\",\"updatedAt\":\"2026-04-19T00:00:00.000Z\",\"operatorNotes\":\"Keep active\",\"lastUsedAt\":\"2026-04-19T00:00:00.000Z\",\"lastReviewedAt\":\"2026-04-19T00:00:00.000Z\",\"lastReinforcedAt\":\"2026-04-19T00:00:00.000Z\",\"lastContradictedAt\":null,\"executionReady\":true,\"demotionRisk\":\"low\",\"preconditions\":[],\"executionSteps\":[\"Inspect context\",\"Choose route\"],\"expectedOutcomes\":[\"Issue classified\"],\"relatedTools\":[\"status\"],\"supersedes\":[],\"supersedesEntries\":[],\"supersededBy\":null,\"supersededByEntry\":null,\"conflicts\":[],\"conflictEntries\":[],\"reviewHistory\":[]}]}".to_string()
}

pub fn skills_personal_update_payload_json() -> String {
    "{\"ok\":true,\"id\":\"ps-1\",\"state\":\"promoted\"}".to_string()
}

pub fn skills_personal_resolve_conflict_payload_json() -> String {
    "{\"ok\":true,\"winnerId\":\"ps-1\",\"loserId\":\"ps-2\"}".to_string()
}

pub fn skills_personal_delete_payload_json() -> String {
    "{\"ok\":true,\"id\":\"ps-1\"}".to_string()
}

pub fn wizard_start_payload_json() -> String {
    "{\"sessionId\":\"wizard-shadow-1\",\"done\":false,\"status\":\"running\",\"step\":{\"id\":\"wizard-step-1\",\"type\":\"text\"}}".to_string()
}

pub fn wizard_next_payload_json() -> String {
    "{\"done\":true,\"status\":\"done\"}".to_string()
}

pub fn wizard_cancel_payload_json() -> String {
    "{\"status\":\"cancelled\",\"error\":null}".to_string()
}

pub fn update_run_payload_json() -> String {
    "{\"ok\":true,\"result\":{\"status\":\"ok\",\"mode\":\"git\",\"root\":\"/repo\",\"steps\":[],\"durationMs\":12},\"restart\":{\"scheduled\":true,\"delayMs\":0,\"signal\":\"SIGUSR1\",\"reason\":\"update.run\"},\"sentinel\":{\"path\":\"/Users/shadow/.argent/restart-sentinel.json\",\"payload\":{\"kind\":\"update\",\"status\":\"ok\",\"ts\":1776600000000,\"sessionKey\":null,\"message\":null,\"doctorHint\":\"Run argent doctor --non-interactive if restart fails.\",\"stats\":{\"mode\":\"git\",\"root\":\"/repo\",\"before\":null,\"after\":null,\"steps\":[],\"reason\":null,\"durationMs\":12}}}}".to_string()
}

pub fn specforge_suggest_payload_json() -> String {
    "{\"suggestion\":\"This is a great suggestion.\"}".to_string()
}

pub fn specforge_kickoff_payload_json() -> String {
    "{\"triggered\":true,\"started\":true,\"reused\":false,\"summary\":\"Project kicked off.\"}".to_string()
}

pub fn tts_convert_payload_json() -> String {
    "{\"audio\":\"c2hhZG93LWF1ZGlv\",\"audioPath\":\"/Users/shadow/.argentos/tts/shadow.wav\",\"provider\":\"openai\",\"outputFormat\":\"wav\",\"voiceCompatible\":true}".to_string()
}

pub fn send_payload_json() -> String {
    "{\"runId\":\"same-key\",\"messageId\":\"m1\",\"channel\":\"whatsapp\"}".to_string()
}

pub fn cron_update_payload_json() -> String {
    "{\"id\":\"cron-shadow-new\",\"schedule\":{\"kind\":\"at\"},\"payload\":{\"kind\":\"systemEvent\",\"text\":\"updated\"},\"delivery\":{\"mode\":\"announce\",\"channel\":\"telegram\",\"to\":\"19098680\"},\"enabled\":false}".to_string()
}

pub fn dashboard_canvas_push_payload_json() -> String {
    "{\"success\":true,\"message\":\"Canvas event broadcast to all connected clients\"}".to_string()
}

pub fn browser_request_payload_json() -> String {
    "{\"ok\":true,\"url\":\"http://127.0.0.1:9222/json/version\",\"browser\":\"Shadow Chromium\",\"version\":\"1.0.0\"}".to_string()
}

pub fn chat_history_payload_json() -> String {
    "{\"sessionKey\":\"main\",\"sessionId\":\"sess-main\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"m100\"}],\"timestamp\":1776600000000}],\"thinkingLevel\":\"medium\",\"verboseLevel\":\"off\"}".to_string()
}

pub fn chat_abort_payload_json() -> String {
    "{\"ok\":true,\"aborted\":true,\"runIds\":[\"idem-abort-all-1\"]}".to_string()
}

pub fn chat_send_payload_json() -> String {
    "{\"runId\":\"idem-status-1\",\"status\":\"started\"}".to_string()
}

pub fn agent_payload_json() -> String {
    "{\"runId\":\"test-idem\",\"status\":\"queued\"}".to_string()
}

pub fn node_pair_request_payload_json() -> String {
    "{\"status\":\"pending\",\"created\":true,\"request\":{\"requestId\":\"node-pair-req-1\",\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"deviceFamily\":\"Mac\",\"commands\":[\"canvas.snapshot\"]}}".to_string()
}

pub fn node_pair_approve_payload_json() -> String {
    "{\"requestId\":\"node-pair-req-1\",\"node\":{\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"paired\":true}}".to_string()
}

pub fn node_pair_reject_payload_json() -> String {
    "{\"requestId\":\"node-pair-req-1\",\"nodeId\":\"node-shadow-1\",\"rejected\":true}".to_string()
}

pub fn node_pair_verify_payload_json() -> String {
    "{\"ok\":true,\"nodeId\":\"node-shadow-1\",\"verified\":true}".to_string()
}

pub fn node_rename_payload_json() -> String {
    "{\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node Renamed\"}".to_string()
}

pub fn node_invoke_payload_json() -> String {
    "{\"ok\":true,\"nodeId\":\"node-shadow-1\",\"command\":\"canvas.snapshot\",\"payload\":{\"ok\":true},\"payloadJSON\":\"{\\\"ok\\\":true}\"}".to_string()
}

pub fn node_invoke_result_payload_json() -> String {
    "{\"ok\":true,\"ignored\":true}".to_string()
}

pub fn tts_status_payload_json(enabled: bool, provider: &str) -> String {
    format!(
        "{{\"enabled\":{},\"auto\":false,\"provider\":{},\"fallbackProvider\":null,\"fallbackProviders\":[],\"prefsPath\":\"shadow-tts.json\",\"hasOpenAIKey\":false,\"hasElevenLabsKey\":false,\"edgeEnabled\":true}}",
        enabled,
        json_string(provider)
    )
}

pub fn tts_providers_payload_json(active: &str) -> String {
    format!(
        "{{\"providers\":[{{\"id\":\"openai\",\"name\":\"OpenAI\",\"configured\":false,\"models\":[\"gpt-4o-mini-tts\",\"gpt-4o-tts\"],\"voices\":[\"alloy\",\"ash\",\"ballad\",\"coral\",\"echo\",\"fable\",\"nova\",\"onyx\",\"sage\",\"shimmer\"]}},{{\"id\":\"elevenlabs\",\"name\":\"ElevenLabs\",\"configured\":false,\"models\":[\"eleven_multilingual_v2\",\"eleven_turbo_v2_5\",\"eleven_monolingual_v1\"]}},{{\"id\":\"edge\",\"name\":\"Edge TTS\",\"configured\":true,\"models\":[]}}],\"active\":{}}}",
        json_string(active)
    )
}

pub fn skills_bins_payload_json() -> String {
    "{\"bins\":[\"git\",\"node\",\"pnpm\",\"cargo\"]}".to_string()
}

pub fn tools_status_payload_json(default_agent_id: &str) -> String {
    format!(
        "{{\"agentId\":\"{}\",\"sessionKey\":\"agent:{}:main\",\"total\":3,\"tools\":[{{\"name\":\"health\",\"label\":\"Health\",\"description\":\"Read gateway health.\",\"source\":\"core\"}},{{\"name\":\"status\",\"label\":\"Status\",\"description\":\"Read gateway status.\",\"source\":\"core\"}},{{\"name\":\"system-event\",\"label\":\"System Event\",\"description\":\"Post a system event.\",\"source\":\"core\"}}]}}",
        default_agent_id, default_agent_id
    )
}

pub fn family_members_payload_json() -> String {
    "{\"members\":[{\"id\":\"argent\",\"name\":\"Argent\",\"role\":\"leader\",\"status\":\"active\",\"alive\":true},{\"id\":\"main\",\"name\":\"Main\",\"role\":\"operator\",\"status\":\"active\",\"alive\":true}]}".to_string()
}

pub fn logs_tail_payload_json() -> String {
    "{\"file\":\"shadow.log\",\"cursor\":42,\"size\":42,\"lines\":[\"[shadow] gateway boot\",\"[shadow] ready\"],\"truncated\":false,\"reset\":false}".to_string()
}

pub fn wizard_status_payload_json() -> String {
    "{\"status\":\"running\"}".to_string()
}

pub fn channels_status_payload_json(ts: u64) -> String {
    format!(
        "{{\"ts\":{},\"channelOrder\":[\"whatsapp\",\"telegram\"],\"channelLabels\":{{\"whatsapp\":\"WhatsApp\",\"telegram\":\"Telegram\"}},\"channelDetailLabels\":{{\"whatsapp\":\"WhatsApp\",\"telegram\":\"Telegram\"}},\"channelSystemImages\":{{\"whatsapp\":\"message.circle\",\"telegram\":\"paperplane\"}},\"channelMeta\":[{{\"id\":\"whatsapp\",\"label\":\"WhatsApp\",\"detailLabel\":\"WhatsApp\",\"systemImage\":\"message.circle\"}},{{\"id\":\"telegram\",\"label\":\"Telegram\",\"detailLabel\":\"Telegram\",\"systemImage\":\"paperplane\"}}],\"channels\":{{\"whatsapp\":{{\"configured\":false}},\"telegram\":{{\"configured\":false}}}},\"channelAccounts\":{{\"whatsapp\":[],\"telegram\":[]}},\"channelDefaultAccountId\":{{\"whatsapp\":\"default\",\"telegram\":\"default\"}}}}",
        ts
    )
}

pub fn sessions_list_payload_json() -> String {
    "{\"path\":\"shadow-sessions.json\",\"defaults\":{\"model\":\"shadow-gpt-mini\",\"modelProvider\":\"openai\"},\"sessions\":[{\"key\":\"agent:argent:main\",\"kind\":\"direct\",\"updatedAt\":1776600000000,\"totalTokens\":165,\"thinkingLevel\":\"low\",\"verboseLevel\":\"on\",\"lastAccountId\":\"shadow\",\"deliveryContext\":{\"channel\":\"whatsapp\",\"to\":\"+10000000000\",\"accountId\":\"shadow\"}}]}".to_string()
}

pub fn sessions_preview_payload_json() -> String {
    "{\"ts\":1776600000000,\"previews\":[{\"key\":\"main\",\"status\":\"ok\",\"items\":[{\"role\":\"assistant\",\"text\":\"Hello\"},{\"role\":\"tool\",\"text\":\"call weather\"},{\"role\":\"assistant\",\"text\":\"Forecast ready\"}]}]}".to_string()
}

pub fn sessions_resolve_payload_json() -> String {
    "{\"ok\":true,\"key\":\"agent:argent:main\"}".to_string()
}

pub fn sessions_search_payload_json() -> String {
    "{\"hits\":[{\"sessionKey\":\"agent:argent:main\",\"role\":\"assistant\",\"text\":\"Forecast ready\",\"snippet\":\"Forecast ready\",\"timestamp\":1776600000000,\"sessionUpdatedAt\":1776600000000}]}".to_string()
}

pub fn node_list_payload_json(ts: u64) -> String {
    format!(
        "{{\"ts\":{},\"nodes\":[{{\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"deviceFamily\":\"Mac\",\"modelIdentifier\":\"ShadowMac1,1\",\"remoteIp\":\"127.0.0.1\",\"caps\":[\"canvas\",\"voice\"],\"commands\":[\"canvas.navigate\",\"voice.speak\"],\"pathEnv\":\"/usr/bin\",\"permissions\":{{\"voice.speak\":true}},\"connectedAtMs\":1776600000000,\"paired\":true,\"connected\":true}}]}}",
        ts
    )
}

pub fn node_describe_payload_json(ts: u64) -> String {
    format!(
        "{{\"ts\":{},\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"deviceFamily\":\"Mac\",\"modelIdentifier\":\"ShadowMac1,1\",\"remoteIp\":\"127.0.0.1\",\"caps\":[\"canvas\",\"voice\"],\"commands\":[\"canvas.navigate\",\"voice.speak\"],\"pathEnv\":\"/usr/bin\",\"permissions\":{{\"voice.speak\":true}},\"connectedAtMs\":1776600000000,\"paired\":true,\"connected\":true}}",
        ts
    )
}

pub fn agents_list_payload_json(default_agent_id: &str) -> String {
    format!(
        "{{\"defaultId\":\"{}\",\"mainKey\":\"agent:{}:main\",\"scope\":\"per-sender\",\"agents\":[{{\"id\":\"{}\",\"name\":\"Argent\"}},{{\"id\":\"main\",\"name\":\"Main\"}}]}}",
        default_agent_id, default_agent_id, default_agent_id
    )
}

pub fn skills_status_payload_json(default_agent_id: &str) -> String {
    format!(
        "{{\"workspaceDir\":\"shadow-workspace-{}\",\"managedSkillsDir\":\"shadow-workspace-{}/skills\",\"skills\":[{{\"name\":\"shadow-routing\",\"description\":\"Shadow routing helper\",\"source\":\"shadow\",\"bundled\":false,\"filePath\":\"shadow-workspace-{}/skills/shadow-routing.md\",\"baseDir\":\"shadow-workspace-{}/skills\",\"skillKey\":\"shadow-routing\",\"always\":false,\"disabled\":false,\"blockedByAllowlist\":false,\"eligible\":true,\"requirements\":{{\"bins\":[\"git\"],\"anyBins\":[],\"env\":[],\"config\":[],\"os\":[]}},\"missing\":{{\"bins\":[],\"anyBins\":[],\"env\":[],\"config\":[],\"os\":[]}},\"configChecks\":[],\"install\":[]}}]}}",
        default_agent_id, default_agent_id, default_agent_id, default_agent_id
    )
}

pub fn agents_files_list_payload_json(default_agent_id: &str) -> String {
    format!(
        "{{\"agentId\":\"{}\",\"workspace\":\"shadow-workspace-{}\",\"files\":[{{\"name\":\"IDENTITY.md\",\"path\":\"shadow-workspace-{}/IDENTITY.md\",\"missing\":false,\"size\":64,\"updatedAtMs\":1776600000000}},{{\"name\":\"SOUL.md\",\"path\":\"shadow-workspace-{}/SOUL.md\",\"missing\":false,\"size\":72,\"updatedAtMs\":1776600000000}}]}}",
        default_agent_id, default_agent_id, default_agent_id, default_agent_id
    )
}

pub fn agents_files_get_payload_json(default_agent_id: &str, name: &str) -> String {
    format!(
        "{{\"agentId\":\"{}\",\"workspace\":\"shadow-workspace-{}\",\"file\":{{\"name\":{},\"path\":\"shadow-workspace-{}/{}\",\"missing\":false,\"size\":64,\"updatedAtMs\":1776600000000,\"content\":\"# {}\\nShadow content\\n\"}}}}",
        default_agent_id,
        default_agent_id,
        json_string(name),
        default_agent_id,
        name,
        name
    )
}

fn normalize_voicewake_triggers(triggers: Vec<String>) -> Vec<String> {
    let cleaned = triggers
        .into_iter()
        .map(|trigger| trigger.trim().to_string())
        .filter(|trigger| !trigger.is_empty())
        .collect::<Vec<_>>();
    if cleaned.is_empty() {
        vec![
            "argent".to_string(),
            "claude".to_string(),
            "computer".to_string(),
        ]
    } else {
        cleaned
    }
}

pub fn connect_success_response(
    request: &ConnectRequest,
    presence_json: &str,
    health_json: &str,
    started_at: Instant,
    presence_version: u64,
    health_version: u64,
) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":\"{}\",\"ok\":true,\"payload\":{{\"type\":\"hello-ok\",\"protocol\":{},\"server\":{{\"version\":\"{}\",\"connId\":\"shadow-conn-1\"}},\"features\":{{\"methods\":[\"agent\",\"agent.identity.get\",\"agent.wait\",\"agents.files.get\",\"agents.files.list\",\"agents.files.set\",\"agents.list\",\"browser.request\",\"channels.logout\",\"channels.status\",\"chat.abort\",\"chat.history\",\"chat.send\",\"commands.compact\",\"commands.list\",\"config.apply\",\"config.get\",\"config.patch\",\"config.schema\",\"config.set\",\"connectors.catalog\",\"contemplation.runOnce\",\"copilot.mode.get\",\"copilot.mode.set\",\"copilot.observability.overview\",\"copilot.overview\",\"copilot.run.story\",\"copilot.workforce.overview\",\"cron.add\",\"cron.list\",\"cron.remove\",\"cron.run\",\"cron.runs\",\"cron.status\",\"cron.update\",\"dashboard.canvas.push\",\"device.pair.approve\",\"device.pair.list\",\"device.pair.reject\",\"device.token.revoke\",\"device.token.rotate\",\"exec.approval.request\",\"exec.approval.resolve\",\"exec.approvals.get\",\"exec.approvals.node.get\",\"exec.approvals.node.set\",\"exec.approvals.set\",\"execution.worker.metrics.reset\",\"execution.worker.pause\",\"execution.worker.resume\",\"execution.worker.runNow\",\"execution.worker.status\",\"family.members\",\"family.register\",\"health\",\"intent.simulate\",\"jobs.assignments.create\",\"jobs.assignments.list\",\"jobs.assignments.retire\",\"jobs.assignments.runNow\",\"jobs.assignments.update\",\"jobs.events.list\",\"jobs.orchestrator.event\",\"jobs.orchestrator.status\",\"jobs.overview\",\"jobs.runs.advance\",\"jobs.runs.list\",\"jobs.runs.retry\",\"jobs.runs.review\",\"jobs.runs.trace\",\"jobs.templates.create\",\"jobs.templates.list\",\"jobs.templates.retire\",\"jobs.templates.update\",\"knowledge.collections.grant\",\"knowledge.collections.list\",\"knowledge.ingest\",\"knowledge.library.delete\",\"knowledge.library.list\",\"knowledge.library.reindex\",\"knowledge.search\",\"knowledge.vault.ingest\",\"last-heartbeat\",\"logs.tail\",\"models.list\",\"node.describe\",\"node.event\",\"node.invoke\",\"node.invoke.result\",\"node.list\",\"node.pair.approve\",\"node.pair.list\",\"node.pair.reject\",\"node.pair.request\",\"node.pair.verify\",\"node.rename\",\"send\",\"sessions.compact\",\"sessions.delete\",\"sessions.list\",\"sessions.patch\",\"sessions.preview\",\"sessions.reset\",\"sessions.search\",\"set-heartbeats\",\"skills.bins\",\"skills.install\",\"skills.personal\",\"skills.personal.delete\",\"skills.personal.resolveConflict\",\"skills.personal.update\",\"skills.status\",\"skills.update\",\"specforge.kickoff\",\"specforge.suggest\",\"status\",\"system-event\",\"system-presence\",\"talk.mode\",\"terminal.create\",\"terminal.kill\",\"terminal.resize\",\"terminal.write\",\"tools.status\",\"tts.convert\",\"tts.disable\",\"tts.enable\",\"tts.providers\",\"tts.setProvider\",\"tts.status\",\"update.run\",\"usage.cost\",\"usage.status\",\"voicewake.get\",\"voicewake.set\",\"wake\",\"wizard.cancel\",\"wizard.next\",\"wizard.start\",\"wizard.status\"],\"events\":[\"agent\",\"chat\",\"connect.challenge\",\"cron\",\"device.pair.requested\",\"device.pair.resolved\",\"exec.approval.requested\",\"exec.approval.resolved\",\"health\",\"heartbeat\",\"intent.simulation\",\"node.invoke.request\",\"node.pair.requested\",\"node.pair.resolved\",\"presence\",\"shutdown\",\"talk.mode\",\"terminal\",\"tick\",\"voicewake.changed\"]}},\"snapshot\":{{\"presence\":{},\"health\":{},\"stateVersion\":{{\"presence\":{},\"health\":{}}},\"uptimeMs\":{}}},\"policy\":{{\"maxPayload\":{},\"maxBufferedBytes\":{},\"tickIntervalMs\":{}}},\"shadow\":{{\"subscriptions\":[{}]}}}}}}",
        request.id,
        PROTOCOL_VERSION,
        COMPONENT_VERSION,
        presence_json,
        health_json,
        presence_version,
        health_version,
        started_at.elapsed().as_millis() as u64,
        MAX_PAYLOAD_BYTES,
        MAX_BUFFERED_BYTES,
        TICK_INTERVAL_MS,
        request
            .subscriptions
            .iter()
            .map(|entry| format!("\"{}\"", entry.replace('\\', "\\\\").replace('"', "\\\"")))
            .collect::<Vec<_>>()
            .join(",")
    )
}

pub fn error_response(request_id: Option<&str>, code: GatewayErrorCode, message: &str) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":{},\"ok\":false,\"error\":{{\"code\":{},\"message\":{}}}}}",
        request_id.map(json_string).unwrap_or_else(|| "null".to_string()),
        json_string(code.as_str()),
        json_string(message)
    )
}

fn resolve_default_agent_id() -> String {
    env::var("ARGENTD_DEFAULT_AGENT_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "main".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_connect_request_token_and_subscriptions() {
        let body =
            r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"abc"},"subscriptions":["agent.","session."]}}"#;
        let parsed = parse_connect_request(body).expect("connect request should parse");
        assert_eq!(parsed.id, "req-1");
        assert_eq!(parsed.token, "abc");
        assert_eq!(parsed.min_protocol, 3);
        assert_eq!(parsed.max_protocol, 3);
        assert_eq!(parsed.client_id, "test-client");
        assert_eq!(parsed.subscriptions, vec!["agent.".to_string(), "session.".to_string()]);
        assert_eq!(parsed.client_display_name, None);
        assert_eq!(parsed.client_instance_id, None);
    }

    #[test]
    fn rejects_missing_token() {
        let body = r#"{"type":"req","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{}}}"#;
        assert_eq!(
            parse_connect_request(body).unwrap_err(),
            GatewayErrorCode::InvalidRequest
        );
    }

    #[test]
    fn rejects_invalid_frame_type() {
        let body = r#"{"type":"event","id":"req-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.0.0","platform":"macos","mode":"operator"},"auth":{"token":"abc"}}}"#;
        assert_eq!(
            parse_connect_request(body).unwrap_err(),
            GatewayErrorCode::InvalidRequest
        );
    }

    #[test]
    fn parses_health_request_meta() {
        let body = r#"{"type":"req","id":"health-1","method":"health","params":{"probe":true}}"#;
        let parsed = parse_request_frame_meta(body).expect("health request should parse");
        assert_eq!(parsed.id, "health-1");
        assert_eq!(parsed.method, "health");
    }

    #[test]
    fn encodes_error_response() {
        let body = error_response(
            Some("req-1"),
            GatewayErrorCode::InvalidRequest,
            "unauthorized: gateway token mismatch (provide gateway auth token)",
        );
        assert!(body.contains("INVALID_REQUEST"));
        assert!(body.contains("token mismatch"));
        assert!(body.contains("\"type\":\"res\""));
    }

    #[test]
    fn encodes_connect_success_with_observed_envelope_shape() {
        let request = ConnectRequest {
            id: "req-1".to_string(),
            token: "abc".to_string(),
            subscriptions: vec!["agent.".to_string(), "session.".to_string()],
            min_protocol: 3,
            max_protocol: 3,
            client_id: "test-client".to_string(),
            client_display_name: None,
            client_mode: "operator".to_string(),
            client_version: "1.0.0".to_string(),
            client_platform: "macos".to_string(),
            client_instance_id: None,
        };
        let started_at = Instant::now();
        let body = connect_success_response(
            &request,
            "[]",
            &gateway_health_payload_json(started_at),
            started_at,
            1,
            1,
        );
        assert!(body.contains("\"type\":\"res\""));
        assert!(body.contains("\"id\":\"req-1\""));
        assert!(body.contains("\"ok\":true"));
        assert!(body.contains("\"type\":\"hello-ok\""));
        assert!(body.contains("\"protocol\":3"));
        assert!(body.contains("\"connId\":\"shadow-conn-1\""));
        assert!(body.contains("\"defaultAgentId\":\"main\""));
        assert!(body.contains("\"system-event\""));
        assert!(body.contains("\"last-heartbeat\""));
        assert!(body.contains("\"set-heartbeats\""));
        assert!(body.contains("\"heartbeat\""));
        assert!(body.contains("\"talk.mode\""));
        assert!(body.contains("\"models.list\""));
        assert!(body.contains("\"connectors.catalog\""));
        assert!(body.contains("\"usage.status\""));
        assert!(body.contains("\"usage.cost\""));
        assert!(body.contains("\"skills.bins\""));
        assert!(body.contains("\"skills.status\""));
        assert!(body.contains("\"agents.list\""));
        assert!(body.contains("\"agents.files.list\""));
        assert!(body.contains("\"agents.files.get\""));
        assert!(body.contains("\"agents.files.set\""));
        assert!(body.contains("\"tools.status\""));
        assert!(body.contains("\"tts.enable\""));
        assert!(body.contains("\"tts.disable\""));
        assert!(body.contains("\"tts.providers\""));
        assert!(body.contains("\"tts.setProvider\""));
        assert!(body.contains("\"tts.status\""));
        assert!(body.contains("\"terminal.create\""));
        assert!(body.contains("\"terminal.write\""));
        assert!(body.contains("\"terminal.resize\""));
        assert!(body.contains("\"terminal.kill\""));
        assert!(body.contains("\"terminal\""));
        assert!(body.contains("\"channels.logout\""));
        assert!(body.contains("\"commands.compact\""));
        assert!(body.contains("\"commands.list\""));
        assert!(body.contains("\"config.apply\""));
        assert!(body.contains("\"config.get\""));
        assert!(body.contains("\"config.patch\""));
        assert!(body.contains("\"config.schema\""));
        assert!(body.contains("\"config.set\""));
        assert!(body.contains("\"agent.identity.get\""));
        assert!(body.contains("\"agent.wait\""));
        assert!(body.contains("\"copilot.mode.get\""));
        assert!(body.contains("\"copilot.mode.set\""));
        assert!(body.contains("\"copilot.overview\""));
        assert!(body.contains("\"copilot.workforce.overview\""));
        assert!(body.contains("\"copilot.observability.overview\""));
        assert!(body.contains("\"copilot.run.story\""));
        assert!(body.contains("\"contemplation.runOnce\""));
        assert!(body.contains("\"cron.add\""));
        assert!(body.contains("\"cron.list\""));
        assert!(body.contains("\"cron.remove\""));
        assert!(body.contains("\"cron.run\""));
        assert!(body.contains("\"cron.runs\""));
        assert!(body.contains("\"cron.status\""));
        assert!(body.contains("\"cron.update\""));
        assert!(body.contains("\"dashboard.canvas.push\""));
        assert!(body.contains("\"device.pair.approve\""));
        assert!(body.contains("\"device.pair.list\""));
        assert!(body.contains("\"device.pair.reject\""));
        assert!(body.contains("\"device.token.revoke\""));
        assert!(body.contains("\"device.token.rotate\""));
        assert!(body.contains("\"exec.approval.request\""));
        assert!(body.contains("\"exec.approval.resolve\""));
        assert!(body.contains("\"exec.approvals.get\""));
        assert!(body.contains("\"exec.approvals.node.get\""));
        assert!(body.contains("\"exec.approvals.node.set\""));
        assert!(body.contains("\"exec.approvals.set\""));
        assert!(body.contains("\"execution.worker.metrics.reset\""));
        assert!(body.contains("\"execution.worker.pause\""));
        assert!(body.contains("\"execution.worker.resume\""));
        assert!(body.contains("\"execution.worker.runNow\""));
        assert!(body.contains("\"execution.worker.status\""));
        assert!(body.contains("\"family.members\""));
        assert!(body.contains("\"family.register\""));
        assert!(body.contains("\"logs.tail\""));
        assert!(body.contains("\"jobs.overview\""));
        assert!(body.contains("\"knowledge.collections.list\""));
        assert!(body.contains("\"knowledge.library.list\""));
        assert!(body.contains("\"channels.status\""));
        assert!(body.contains("\"wizard.status\""));
        assert!(body.contains("\"node.list\""));
        assert!(body.contains("\"node.describe\""));
        assert!(body.contains("\"node.event\""));
        assert!(body.contains("\"node.pair.list\""));
        assert!(body.contains("\"sessions.compact\""));
        assert!(body.contains("\"sessions.delete\""));
        assert!(body.contains("\"sessions.list\""));
        assert!(body.contains("\"sessions.patch\""));
        assert!(body.contains("\"sessions.preview\""));
        assert!(body.contains("\"sessions.reset\""));
        assert!(body.contains("\"sessions.search\""));
        assert!(body.contains("\"skills.install\""));
        assert!(body.contains("\"skills.personal\""));
        assert!(body.contains("\"skills.personal.delete\""));
        assert!(body.contains("\"skills.personal.resolveConflict\""));
        assert!(body.contains("\"skills.personal.update\""));
        assert!(body.contains("\"skills.update\""));
        assert!(body.contains("\"specforge.kickoff\""));
        assert!(body.contains("\"specforge.suggest\""));
        assert!(body.contains("\"update.run\""));
        assert!(body.contains("\"tts.convert\""));
        assert!(body.contains("\"voicewake.get\""));
        assert!(body.contains("\"voicewake.set\""));
        assert!(body.contains("\"voicewake.changed\""));
        assert!(body.contains("\"wake\""));
        assert!(body.contains("\"send\""));
        assert!(body.contains("\"wizard.cancel\""));
        assert!(body.contains("\"wizard.next\""));
        assert!(body.contains("\"wizard.start\""));
        assert!(body.contains("\"tick\""));
        assert!(body.contains("\"health\""));
        assert!(body.contains("\"agent\""));
        assert!(body.contains("\"browser.request\""));
        assert!(body.contains("\"chat.abort\""));
        assert!(body.contains("\"chat.history\""));
        assert!(body.contains("\"chat.send\""));
        assert!(body.contains("\"jobs.assignments.create\""));
        assert!(body.contains("\"jobs.assignments.list\""));
        assert!(body.contains("\"jobs.assignments.retire\""));
        assert!(body.contains("\"jobs.assignments.runNow\""));
        assert!(body.contains("\"jobs.assignments.update\""));
        assert!(body.contains("\"jobs.events.list\""));
        assert!(body.contains("\"jobs.orchestrator.event\""));
        assert!(body.contains("\"jobs.orchestrator.status\""));
        assert!(body.contains("\"jobs.runs.list\""));
        assert!(body.contains("\"jobs.runs.advance\""));
        assert!(body.contains("\"jobs.runs.retry\""));
        assert!(body.contains("\"jobs.runs.review\""));
        assert!(body.contains("\"jobs.runs.trace\""));
        assert!(body.contains("\"jobs.templates.create\""));
        assert!(body.contains("\"jobs.templates.list\""));
        assert!(body.contains("\"jobs.templates.retire\""));
        assert!(body.contains("\"jobs.templates.update\""));
        assert!(body.contains("\"knowledge.collections.grant\""));
        assert!(body.contains("\"knowledge.ingest\""));
        assert!(body.contains("\"knowledge.library.delete\""));
        assert!(body.contains("\"knowledge.library.reindex\""));
        assert!(body.contains("\"knowledge.search\""));
        assert!(body.contains("\"knowledge.vault.ingest\""));
        assert!(body.contains("\"node.invoke\""));
        assert!(body.contains("\"node.invoke.result\""));
        assert!(body.contains("\"node.pair.approve\""));
        assert!(body.contains("\"node.pair.reject\""));
        assert!(body.contains("\"node.pair.request\""));
        assert!(body.contains("\"node.pair.verify\""));
        assert!(body.contains("\"node.rename\""));
    }

    #[test]
    fn encodes_gateway_health_response() {
        let body = gateway_health_response("health-1", Instant::now());
        assert!(body.contains("\"type\":\"res\""));
        assert!(body.contains("\"id\":\"health-1\""));
        assert!(body.contains("\"ok\":true"));
        assert!(body.contains("\"defaultAgentId\":\"main\""));
        assert!(body.contains("\"kernel\":null"));
        assert!(body.contains("\"memoryHealth\":null"));
    }

    #[test]
    fn encodes_gateway_status_response() {
        let body = gateway_status_response("status-1", &[]);
        assert!(body.contains("\"type\":\"res\""));
        assert!(body.contains("\"id\":\"status-1\""));
        assert!(body.contains("\"ok\":true"));
        assert!(body.contains("\"defaultAgentId\":\"main\""));
        assert!(body.contains("\"channelSummary\":[]"));
    }

    #[test]
    fn parses_connect_request_from_scoped_objects() {
        let body = r#"{"type":"req","id":"req-9","method":"connect","version":"wrong-scope","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","version":"1.2.3","platform":"macos","mode":"operator"},"auth":{"token":"abc"},"metadata":{"token":"wrong-scope"},"subscriptions":["agent."]}}"#;
        let parsed = parse_connect_request(body).expect("connect request should parse");
        assert_eq!(parsed.client_version, "1.2.3");
        assert_eq!(parsed.token, "abc");
    }

    #[test]
    fn parses_optional_client_identity_fields() {
        let body = r#"{"type":"req","id":"req-10","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","displayName":"Argent Mac","version":"1.2.3","platform":"macos","mode":"operator","instanceId":"instance-1"},"auth":{"token":"abc"}}}"#;
        let parsed = parse_connect_request(body).expect("connect request should parse");
        assert_eq!(parsed.client_display_name.as_deref(), Some("Argent Mac"));
        assert_eq!(parsed.client_instance_id.as_deref(), Some("instance-1"));
    }

    #[test]
    fn parses_system_event_params() {
        let body = r#"{"type":"req","id":"evt-1","method":"system-event","params":{"text":"Node: Studio","mode":"ui","reason":"periodic","instanceId":"instance-1"}}"#;
        let parsed = parse_system_event_params(body).expect("system-event should parse");
        assert_eq!(parsed.text, "Node: Studio");
        assert_eq!(parsed.mode.as_deref(), Some("ui"));
        assert_eq!(parsed.reason.as_deref(), Some("periodic"));
        assert_eq!(parsed.instance_id.as_deref(), Some("instance-1"));
    }

    #[test]
    fn parses_escaped_json_strings_and_arrays() {
        let body = r#"{"type":"req","id":"req-11","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"test-client","displayName":"Argent \"Mac\"","version":"1.2.3","platform":"macos","mode":"operator","instanceId":"instance-\u0031"},"auth":{"token":"abc\/123"},"subscriptions":["agent.","session,primary","path\\watch"]}}"#;
        let parsed = parse_connect_request(body).expect("escaped connect request should parse");
        assert_eq!(parsed.client_display_name.as_deref(), Some("Argent \"Mac\""));
        assert_eq!(parsed.client_instance_id.as_deref(), Some("instance-1"));
        assert_eq!(parsed.token, "abc/123");
        assert_eq!(
            parsed.subscriptions,
            vec![
                "agent.".to_string(),
                "session,primary".to_string(),
                "path\\watch".to_string()
            ]
        );
    }
}
