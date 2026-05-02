use crate::contracts::PROTOCOL_VERSION;
use crate::error::GatewayErrorCode;
use crate::hub::{PresenceMatch, SharedHub, SharedWriter};
use crate::http::{
    agents_list_payload_json, commands_list_payload_json, connectors_catalog_payload_json,
    channels_status_payload_json, connect_success_response, error_response, gateway_health_payload_json, gateway_health_response, gateway_status_response,
    config_get_payload_json, config_schema_payload_json, exec_approvals_get_payload_json,
    copilot_mode_get_payload_json, cron_status_payload_json, device_pair_list_payload_json,
    knowledge_collections_list_payload_json, node_pair_list_payload_json,
    agent_identity_get_payload_json,
    knowledge_library_list_payload_json, cron_list_payload_json, workflows_list_payload_json,
    jobs_overview_payload_json,
    contemplation_run_once_payload_json, agent_wait_payload_json, node_event_payload_json,
    copilot_mode_set_payload_json, config_set_payload_json, family_register_payload_json,
    commands_compact_payload_json, channels_logout_payload_json, config_patch_payload_json,
    agents_files_set_payload_json, sessions_compact_payload_json, cron_run_payload_json,
    cron_runs_payload_json,
    config_apply_payload_json, cron_add_payload_json, cron_remove_payload_json,
    copilot_run_story_payload_json,
    device_pair_approve_payload_json, device_pair_reject_payload_json,
    device_token_rotate_payload_json, device_token_revoke_payload_json,
    exec_approval_request_payload_json, exec_approval_resolve_payload_json,
    exec_approvals_node_get_payload_json, exec_approvals_node_set_payload_json,
    exec_approvals_set_payload_json, execution_worker_control_payload_json,
    execution_worker_run_now_payload_json,
    jobs_assignments_list_payload_json, jobs_assignments_create_payload_json,
    jobs_assignments_update_payload_json, jobs_assignments_retire_payload_json,
    jobs_assignments_run_now_payload_json,
    jobs_runs_list_payload_json, jobs_events_list_payload_json, jobs_runs_trace_payload_json,
    jobs_runs_review_payload_json, jobs_runs_retry_payload_json,
    jobs_orchestrator_status_payload_json, jobs_orchestrator_event_payload_json,
    jobs_templates_list_payload_json, jobs_templates_create_payload_json,
    jobs_templates_update_payload_json, jobs_templates_retire_payload_json,
    jobs_runs_advance_payload_json,
    knowledge_collections_grant_payload_json, knowledge_ingest_payload_json,
    knowledge_vault_ingest_payload_json, knowledge_search_payload_json,
    knowledge_library_delete_payload_json, knowledge_library_reindex_payload_json,
    node_pair_request_payload_json, node_pair_approve_payload_json,
    node_pair_reject_payload_json, node_pair_verify_payload_json,
    node_rename_payload_json, node_invoke_payload_json, node_invoke_result_payload_json,
    sessions_patch_payload_json, sessions_reset_payload_json, sessions_delete_payload_json,
    skills_install_payload_json, skills_update_payload_json, skills_personal_payload_json,
    skills_personal_update_payload_json, skills_personal_resolve_conflict_payload_json,
    skills_personal_delete_payload_json,
    wizard_start_payload_json, wizard_next_payload_json, wizard_cancel_payload_json,
    update_run_payload_json, specforge_suggest_payload_json, specforge_kickoff_payload_json,
    tts_convert_payload_json, send_payload_json,
    cron_update_payload_json, dashboard_canvas_push_payload_json,
    browser_request_payload_json, chat_history_payload_json, chat_abort_payload_json,
    chat_send_payload_json, agent_payload_json,
    copilot_observability_overview_payload_json, copilot_overview_payload_json,
    copilot_workforce_overview_payload_json,
    execution_worker_status_payload_json,
    family_members_payload_json, heartbeat_event_payload_json, logs_tail_payload_json,
    models_list_payload_json, ok_response, parse_connect_request,
    parse_request_frame_meta, parse_set_heartbeats_params, parse_system_event_params,
    parse_talk_mode_params, parse_voicewake_set_params, parse_wake_params,
    parse_terminal_id_params, parse_terminal_resize_params, parse_terminal_write_params,
    providers_status_payload_json, skills_bins_payload_json, talk_mode_payload_json, tools_status_payload_json,
    tts_providers_payload_json, tts_status_payload_json, usage_cost_payload_json,
    usage_status_payload_json, voicewake_payload_json, wake_payload_json, skills_status_payload_json,
    wizard_status_payload_json, sessions_list_payload_json, sessions_preview_payload_json,
    sessions_resolve_payload_json, sessions_search_payload_json,
    node_list_payload_json, node_describe_payload_json,
    agents_files_list_payload_json, agents_files_get_payload_json,
};
use crate::terminal::{
    cleanup_terminals_for_client, create_terminal_session, kill_terminal, resize_terminal,
    terminal_create_payload_json, terminal_ok_payload_json, write_terminal,
};
use std::env;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const WS_MAGIC: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

fn event_frame(event: &str, payload_json: &str, seq: u64) -> String {
    format!(
        "{{\"type\":\"event\",\"event\":\"{}\",\"payload\":{},\"seq\":{}}}",
        event, payload_json, seq
    )
}

fn broadcast_event(
    hub: &SharedHub,
    event: &str,
    payload_json: &str,
) -> std::io::Result<()> {
    let (seq, writers) = {
        let mut hub_state = hub.lock().expect("hub lock should not poison");
        (hub_state.next_seq(), hub_state.writers())
    };
    let frame = event_frame(event, payload_json, seq);
    for target in writers {
        send_text_frame(&target, &frame)?;
    }
    Ok(())
}

pub fn is_websocket_upgrade(request: &str) -> bool {
    request.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("upgrade:") && lower.contains("websocket")
    })
}

pub fn handshake_response(request: &str) -> Result<String, GatewayErrorCode> {
    let key = header_value(request, "sec-websocket-key").ok_or(GatewayErrorCode::InvalidRequest)?;
    let accept = websocket_accept(&key);
    Ok(format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        accept
    ))
}

pub fn serve_websocket_session(
    stream: TcpStream,
    started_at: Instant,
    expected_token: &str,
    hub: SharedHub,
) -> std::io::Result<()> {
    let writer: SharedWriter = Arc::new(Mutex::new(stream.try_clone()?));
    let mut reader = stream;
    let mut client_id: Option<u64> = None;
    send_text_frame(&writer, &connect_challenge_event())?;
    let mut is_connected = false;

    loop {
        let Some(message) = read_text_frame(&mut reader)? else {
            break;
        };
        let meta = match parse_request_frame_meta(&message) {
            Ok(meta) => meta,
            Err(code) => {
                send_text_frame(&writer, &error_response(None, code, "invalid request frame"))?;
                close_stream(&writer)?;
                break;
            }
        };

        let replay_trace =
            env::var("ARGENTD_TRACE_REPLAY").ok().as_deref() == Some("1")
                && message.contains("\"__shadowReplay\"");
        if replay_trace {
            println!("replay-recv method={}", meta.method);
        }

        if !is_connected {
            if meta.method != "connect" {
                send_text_frame(
                    &writer,
                    &error_response(
                        Some(&meta.id),
                        GatewayErrorCode::InvalidRequest,
                        "first request must be connect",
                    ),
                )?;
                close_stream(&writer)?;
                break;
            }

            match parse_connect_request(&message) {
                Ok(connect) => {
                    if connect.max_protocol < PROTOCOL_VERSION
                        || connect.min_protocol > PROTOCOL_VERSION
                    {
                        send_text_frame(
                            &writer,
                            &error_response(
                                Some(&connect.id),
                                GatewayErrorCode::InvalidRequest,
                                "protocol mismatch",
                            ),
                        )?;
                        close_stream(&writer)?;
                        break;
                    }
                    if !expected_token.is_empty() && connect.token != expected_token {
                        send_text_frame(
                            &writer,
                            &error_response(
                                Some(&connect.id),
                                GatewayErrorCode::InvalidRequest,
                                "unauthorized: gateway token mismatch (provide gateway auth token)",
                            ),
                        )?;
                        close_stream(&writer)?;
                        break;
                    }

                    let (presence_json, presence_version, health_version, assigned_id) = {
                        let mut hub_state = hub.lock().expect("hub lock should not poison");
                        let updated_presence = merge_presence_payload(
                            &hub_state.presence_json(),
                            connect.client_display_name.as_deref(),
                            connect.client_instance_id.as_deref(),
                            Some(&connect.client_id),
                            Some("shadow-gateway"),
                            Some("127.0.0.1"),
                            Some(&connect.client_version),
                            Some(&connect.client_platform),
                            Some(&connect.client_mode),
                            Some("connect"),
                            connect
                                .client_display_name
                                .as_deref()
                                .unwrap_or(&connect.client_id),
                        );
                        let presence_version = hub_state.set_presence_json(updated_presence);
                        let assigned_id = hub_state.register_client(
                            writer.clone(),
                            PresenceMatch {
                                instance_id: connect.client_instance_id.clone(),
                                client_id: connect.client_id.clone(),
                            },
                        );
                        (
                            hub_state.presence_json(),
                            presence_version,
                            hub_state.health_version(),
                            assigned_id,
                        )
                    };
                    client_id = Some(assigned_id);
                    let health_json = gateway_health_payload_json(started_at);
                    send_text_frame(
                        &writer,
                        &connect_success_response(
                            &connect,
                            &presence_json,
                            &health_json,
                            started_at,
                            presence_version,
                            health_version,
                        ),
                    )?;
                    is_connected = true;
                }
                Err(code) => {
                    send_text_frame(
                        &writer,
                        &error_response(Some(&meta.id), code, "invalid connect params"),
                    )?;
                    close_stream(&writer)?;
                    break;
                }
            }
            continue;
        }

        match meta.method.as_str() {
            "health" => {
                send_text_frame(&writer, &gateway_health_response(&meta.id, started_at))?;
            }
            "agent.identity.get" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agent_identity_get_payload_json()),
                )?;
            }
            "agent.wait" => {
                let run_id = find_optional_param_string(&message, "runId")
                    .unwrap_or_else(|| "run-shadow-1".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agent_wait_payload_json(&run_id)),
                )?;
            }
            "system-presence" => {
                let presence_json = hub.lock().expect("hub lock should not poison").presence_json();
                send_text_frame(&writer, &presence_response(&meta.id, &presence_json))?;
            }
            "status" => {
                let queued = hub
                    .lock()
                    .expect("hub lock should not poison")
                    .queued_system_events();
                send_text_frame(&writer, &gateway_status_response(&meta.id, &queued))?;
            }
            "last-heartbeat" => {
                let payload = hub
                    .lock()
                    .expect("hub lock should not poison")
                    .last_heartbeat_json()
                    .unwrap_or_else(|| "null".to_string());
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
            }
            "models.list" => {
                send_text_frame(&writer, &ok_response(&meta.id, &models_list_payload_json()))?;
            }
            "node.list" => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0);
                send_text_frame(&writer, &ok_response(&meta.id, &node_list_payload_json(ts)))?;
            }
            "node.describe" => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0);
                send_text_frame(&writer, &ok_response(&meta.id, &node_describe_payload_json(ts)))?;
            }
            "node.pair.request" => {
                let payload = node_pair_request_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "node.pair.requested",
                    "{\"requestId\":\"node-pair-req-1\",\"nodeId\":\"node-shadow-1\",\"displayName\":\"Shadow Node\",\"platform\":\"macos\",\"version\":\"0.1.0\",\"deviceFamily\":\"Mac\",\"commands\":[\"canvas.snapshot\"]}",
                )?;
            }
            "node.pair.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &node_pair_list_payload_json()),
                )?;
            }
            "node.pair.approve" => {
                let payload = node_pair_approve_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "node.pair.resolved",
                    "{\"requestId\":\"node-pair-req-1\",\"nodeId\":\"node-shadow-1\",\"decision\":\"approved\",\"ts\":1776600000000}",
                )?;
            }
            "node.pair.reject" => {
                let payload = node_pair_reject_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "node.pair.resolved",
                    "{\"requestId\":\"node-pair-req-1\",\"nodeId\":\"node-shadow-1\",\"decision\":\"rejected\",\"ts\":1776600000000}",
                )?;
            }
            "node.pair.verify" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &node_pair_verify_payload_json()),
                )?;
            }
            "node.rename" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &node_rename_payload_json()),
                )?;
            }
            "node.invoke" => {
                let payload = node_invoke_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "node.invoke.request",
                    "{\"id\":\"invoke-shadow-1\",\"nodeId\":\"node-shadow-1\",\"command\":\"canvas.snapshot\",\"params\":{\"format\":\"png\"}}",
                )?;
            }
            "node.invoke.result" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &node_invoke_result_payload_json()),
                )?;
            }
            "sessions.list" => {
                send_text_frame(&writer, &ok_response(&meta.id, &sessions_list_payload_json()))?;
            }
            "sessions.preview" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_preview_payload_json()),
                )?;
            }
            "sessions.resolve" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_resolve_payload_json()),
                )?;
            }
            "sessions.search" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_search_payload_json()),
                )?;
            }
            "connectors.catalog" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &connectors_catalog_payload_json()),
                )?;
            }
            "family.members" => {
                send_text_frame(&writer, &ok_response(&meta.id, &family_members_payload_json()))?;
            }
            "family.register" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &family_register_payload_json()),
                )?;
            }
            "agents.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agents_list_payload_json("argent")),
                )?;
            }
            "agents.files.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agents_files_list_payload_json("argent")),
                )?;
            }
            "agents.files.get" => {
                let name =
                    find_optional_param_string(&message, "name").unwrap_or_else(|| "IDENTITY.md".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agents_files_get_payload_json("argent", &name)),
                )?;
            }
            "agents.files.set" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &agents_files_set_payload_json()),
                )?;
            }
            "commands.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &commands_list_payload_json()),
                )?;
            }
            "commands.compact" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &commands_compact_payload_json()),
                )?;
            }
            "channels.logout" => {
                let channel = find_optional_param_string(&message, "channel")
                    .unwrap_or_else(|| "whatsapp".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &channels_logout_payload_json(&channel)),
                )?;
            }
            "config.get" => {
                send_text_frame(&writer, &ok_response(&meta.id, &config_get_payload_json()))?;
            }
            "config.apply" => {
                send_text_frame(&writer, &ok_response(&meta.id, &config_apply_payload_json()))?;
            }
            "config.patch" => {
                send_text_frame(&writer, &ok_response(&meta.id, &config_patch_payload_json()))?;
            }
            "config.schema" => {
                send_text_frame(&writer, &ok_response(&meta.id, &config_schema_payload_json()))?;
            }
            "config.set" => {
                send_text_frame(&writer, &ok_response(&meta.id, &config_set_payload_json()))?;
            }
            "copilot.overview" => {
                send_text_frame(&writer, &ok_response(&meta.id, &copilot_overview_payload_json()))?;
            }
            "copilot.run.story" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &copilot_run_story_payload_json()),
                )?;
            }
            "copilot.mode.get" => {
                let domain = find_optional_param_string(&message, "domain")
                    .unwrap_or_else(|| "intent".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &copilot_mode_get_payload_json(&domain)),
                )?;
            }
            "copilot.mode.set" => {
                let domain = find_optional_param_string(&message, "domain")
                    .unwrap_or_else(|| "intent".to_string());
                let mode = find_optional_param_string(&message, "mode")
                    .unwrap_or_else(|| "assist-live-limited".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &copilot_mode_set_payload_json(&domain, &mode)),
                )?;
            }
            "copilot.workforce.overview" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &copilot_workforce_overview_payload_json()),
                )?;
            }
            "copilot.observability.overview" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &copilot_observability_overview_payload_json()),
                )?;
            }
            "contemplation.runOnce" => {
                let agent_id = find_optional_param_string(&message, "agentId")
                    .unwrap_or_else(|| "argent".to_string());
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &contemplation_run_once_payload_json(&agent_id)),
                )?;
            }
            "exec.approvals.get" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &exec_approvals_get_payload_json()),
                )?;
            }
            "exec.approval.request" => {
                let payload = exec_approval_request_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "exec.approval.requested",
                    "{\"id\":\"approval-123\",\"request\":{\"command\":\"echo ok\",\"cwd\":\"/tmp\",\"host\":\"node\",\"security\":null,\"ask\":null,\"agentId\":null,\"resolvedPath\":null,\"sessionKey\":null},\"createdAtMs\":1776600000000,\"expiresAtMs\":1776600120000}",
                )?;
            }
            "exec.approval.resolve" => {
                let payload = exec_approval_resolve_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "exec.approval.resolved",
                    "{\"id\":\"approval-123\",\"decision\":\"allow-once\",\"resolvedBy\":\"Interop Harness\",\"ts\":1776600000000}",
                )?;
            }
            "exec.approvals.node.get" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &exec_approvals_node_get_payload_json()),
                )?;
            }
            "exec.approvals.node.set" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &exec_approvals_node_set_payload_json()),
                )?;
            }
            "exec.approvals.set" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &exec_approvals_set_payload_json()),
                )?;
            }
            "cron.list" => {
                send_text_frame(&writer, &ok_response(&meta.id, &cron_list_payload_json()))?;
            }
            "workflows.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &workflows_list_payload_json()),
                )?;
            }
            "cron.add" => {
                let payload = cron_add_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "cron",
                    "{\"action\":\"added\",\"jobId\":\"cron-shadow-new\",\"payload\":{\"kind\":\"systemEvent\",\"text\":\"hello\"}}",
                )?;
                if replay_trace {
                    println!("replay-emit event=cron");
                }
            }
            "cron.remove" => {
                let payload = cron_remove_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "cron",
                    "{\"action\":\"removed\",\"jobId\":\"cron-shadow-new\"}",
                )?;
                if replay_trace {
                    println!("replay-emit event=cron");
                }
            }
            "cron.run" => {
                let payload = cron_run_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "cron",
                    "{\"action\":\"run\",\"jobId\":\"cron-shadow-1\",\"status\":\"ok\"}",
                )?;
                if replay_trace {
                    println!("replay-emit event=cron");
                }
            }
            "cron.runs" => {
                send_text_frame(&writer, &ok_response(&meta.id, &cron_runs_payload_json()))?;
            }
            "cron.status" => {
                send_text_frame(&writer, &ok_response(&meta.id, &cron_status_payload_json()))?;
            }
            "cron.update" => {
                let payload = cron_update_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "cron",
                    "{\"action\":\"updated\",\"jobId\":\"cron-shadow-new\"}",
                )?;
                if replay_trace {
                    println!("replay-emit event=cron");
                }
            }
            "device.pair.list" => {
                let payload = device_pair_list_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "device.pair.requested",
                    "{\"requestId\":\"pair-req-1\",\"deviceName\":\"Shadow iPhone\",\"deviceId\":\"device-shadow-iphone\",\"platform\":\"ios\",\"role\":\"mobile\",\"requestedAtMs\":1776600000000}",
                )?;
            }
            "device.pair.approve" => {
                let payload = device_pair_approve_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "device.pair.resolved",
                    "{\"requestId\":\"pair-req-1\",\"deviceId\":\"device-shadow-iphone\",\"decision\":\"approved\",\"ts\":1776600000000}",
                )?;
            }
            "device.pair.reject" => {
                let payload = device_pair_reject_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "device.pair.resolved",
                    "{\"requestId\":\"pair-req-1\",\"deviceId\":\"device-shadow-iphone\",\"decision\":\"rejected\",\"ts\":1776600000000}",
                )?;
            }
            "device.token.rotate" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &device_token_rotate_payload_json()),
                )?;
            }
            "device.token.revoke" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &device_token_revoke_payload_json()),
                )?;
            }
            "knowledge.collections.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_collections_list_payload_json()),
                )?;
            }
            "knowledge.collections.grant" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_collections_grant_payload_json()),
                )?;
            }
            "knowledge.ingest" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_ingest_payload_json()),
                )?;
            }
            "knowledge.vault.ingest" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_vault_ingest_payload_json()),
                )?;
            }
            "knowledge.search" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_search_payload_json()),
                )?;
            }
            "knowledge.library.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_library_list_payload_json()),
                )?;
            }
            "knowledge.library.delete" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_library_delete_payload_json()),
                )?;
            }
            "knowledge.library.reindex" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &knowledge_library_reindex_payload_json()),
                )?;
            }
            "jobs.overview" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_overview_payload_json()),
                )?;
            }
            "jobs.assignments.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_assignments_list_payload_json()),
                )?;
            }
            "jobs.assignments.create" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_assignments_create_payload_json()),
                )?;
            }
            "jobs.assignments.update" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_assignments_update_payload_json()),
                )?;
            }
            "jobs.assignments.retire" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_assignments_retire_payload_json()),
                )?;
            }
            "jobs.assignments.runNow" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_assignments_run_now_payload_json()),
                )?;
            }
            "jobs.runs.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_runs_list_payload_json()),
                )?;
            }
            "jobs.runs.advance" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_runs_advance_payload_json()),
                )?;
            }
            "jobs.events.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_events_list_payload_json()),
                )?;
            }
            "jobs.runs.trace" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_runs_trace_payload_json()),
                )?;
            }
            "jobs.runs.review" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_runs_review_payload_json()),
                )?;
            }
            "jobs.runs.retry" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_runs_retry_payload_json()),
                )?;
            }
            "jobs.orchestrator.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_orchestrator_status_payload_json()),
                )?;
            }
            "jobs.orchestrator.event" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_orchestrator_event_payload_json()),
                )?;
            }
            "jobs.templates.list" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_templates_list_payload_json()),
                )?;
            }
            "jobs.templates.create" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_templates_create_payload_json()),
                )?;
            }
            "jobs.templates.update" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_templates_update_payload_json()),
                )?;
            }
            "jobs.templates.retire" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &jobs_templates_retire_payload_json()),
                )?;
            }
            "sessions.compact" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_compact_payload_json()),
                )?;
            }
            "sessions.patch" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_patch_payload_json()),
                )?;
            }
            "sessions.reset" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_reset_payload_json()),
                )?;
            }
            "sessions.delete" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &sessions_delete_payload_json()),
                )?;
            }
            "skills.install" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_install_payload_json()),
                )?;
            }
            "skills.update" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_update_payload_json()),
                )?;
            }
            "skills.personal" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_personal_payload_json()),
                )?;
            }
            "skills.personal.update" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_personal_update_payload_json()),
                )?;
            }
            "skills.personal.resolveConflict" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_personal_resolve_conflict_payload_json()),
                )?;
            }
            "skills.personal.delete" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_personal_delete_payload_json()),
                )?;
            }
            "wizard.start" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &wizard_start_payload_json()),
                )?;
            }
            "wizard.next" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &wizard_next_payload_json()),
                )?;
            }
            "wizard.cancel" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &wizard_cancel_payload_json()),
                )?;
            }
            "update.run" => {
                send_text_frame(&writer, &ok_response(&meta.id, &update_run_payload_json()))?;
            }
            "specforge.suggest" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &specforge_suggest_payload_json()),
                )?;
            }
            "specforge.kickoff" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &specforge_kickoff_payload_json()),
                )?;
            }
            "dashboard.canvas.push" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &dashboard_canvas_push_payload_json()),
                )?;
            }
            "browser.request" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &browser_request_payload_json()),
                )?;
            }
            "intent.simulate" => {
                broadcast_event(
                    &hub,
                    "intent.simulation",
                    "{\"agentId\":\"main\",\"status\":\"error\",\"error\":\"Intent simulation is unavailable in ArgentOS Core. Simulation runners and built-in scenario packs remain Business-only.\",\"timestamp\":\"2026-04-19T16:00:00.000Z\"}",
                )?;
                send_text_frame(
                    &writer,
                    &error_response(
                        Some(&meta.id),
                        GatewayErrorCode::Internal,
                        "Intent simulation is unavailable in ArgentOS Core. Simulation runners and built-in scenario packs remain Business-only.",
                    ),
                )?;
            }
            "tts.convert" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &tts_convert_payload_json()),
                )?;
            }
            "chat.history" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &chat_history_payload_json()),
                )?;
            }
            "chat.abort" => {
                let payload = chat_abort_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "chat",
                    "{\"runId\":\"idem-abort-all-1\",\"state\":\"aborted\",\"sessionKey\":\"main\"}",
                )?;
                if replay_trace {
                    println!("replay-emit event=chat");
                }
            }
            "chat.send" => {
                let payload = chat_send_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "chat",
                    "{\"runId\":\"idem-status-1\",\"state\":\"final\",\"sessionKey\":\"main\"}",
                )?;
                if replay_trace {
                    println!("replay-emit event=chat");
                }
            }
            "send" => {
                send_text_frame(&writer, &ok_response(&meta.id, &send_payload_json()))?;
            }
            "agent" => {
                let payload = agent_payload_json();
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
                broadcast_event(
                    &hub,
                    "agent",
                    "{\"runId\":\"test-idem\",\"stream\":\"assistant\",\"sessionKey\":\"agent:main:main\"}",
                )?;
            }
            "node.event" => {
                send_text_frame(&writer, &ok_response(&meta.id, &node_event_payload_json()))?;
            }
            "execution.worker.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &execution_worker_status_payload_json()),
                )?;
            }
            "execution.worker.pause" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &execution_worker_control_payload_json("pause")),
                )?;
            }
            "execution.worker.resume" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &execution_worker_control_payload_json("resume")),
                )?;
            }
            "execution.worker.metrics.reset" => {
                send_text_frame(
                    &writer,
                    &ok_response(
                        &meta.id,
                        &execution_worker_control_payload_json("metrics.reset"),
                    ),
                )?;
            }
            "execution.worker.runNow" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &execution_worker_run_now_payload_json()),
                )?;
            }
            "channels.status" => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0);
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &channels_status_payload_json(ts)),
                )?;
            }
            "skills.bins" => {
                send_text_frame(&writer, &ok_response(&meta.id, &skills_bins_payload_json()))?;
            }
            "skills.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &skills_status_payload_json("argent")),
                )?;
            }
            "tools.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &tools_status_payload_json("argent")),
                )?;
            }
            "providers.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &providers_status_payload_json()),
                )?;
            }
            "wizard.status" => {
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &wizard_status_payload_json()),
                )?;
            }
            "logs.tail" => {
                send_text_frame(&writer, &ok_response(&meta.id, &logs_tail_payload_json()))?;
            }
            "tts.status" => {
                let (enabled, provider) = {
                    let hub_state = hub.lock().expect("hub lock should not poison");
                    (hub_state.tts_enabled(), hub_state.tts_provider())
                };
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &tts_status_payload_json(enabled, &provider)),
                )?;
            }
            "tts.providers" => {
                let active = hub.lock().expect("hub lock should not poison").tts_provider();
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, &tts_providers_payload_json(&active)),
                )?;
            }
            "tts.enable" => {
                hub.lock()
                    .expect("hub lock should not poison")
                    .set_tts_enabled(true);
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, "{\"enabled\":true}"),
                )?;
            }
            "tts.disable" => {
                hub.lock()
                    .expect("hub lock should not poison")
                    .set_tts_enabled(false);
                send_text_frame(
                    &writer,
                    &ok_response(&meta.id, "{\"enabled\":false}"),
                )?;
            }
            "tts.setProvider" => {
                let provider =
                    find_optional_param_string(&message, "provider").unwrap_or_default();
                if !matches!(provider.as_str(), "openai" | "elevenlabs" | "edge") {
                    send_text_frame(
                        &writer,
                        &error_response(
                            Some(&meta.id),
                            GatewayErrorCode::InvalidRequest,
                            "Invalid provider. Use openai, elevenlabs, or edge.",
                        ),
                    )?;
                } else {
                    hub.lock()
                        .expect("hub lock should not poison")
                        .set_tts_provider(provider.clone());
                    send_text_frame(
                        &writer,
                        &ok_response(
                            &meta.id,
                            &format!("{{\"provider\":{}}}", json_string(&provider)),
                        ),
                    )?;
                }
            }
            "usage.status" => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0);
                send_text_frame(&writer, &ok_response(&meta.id, &usage_status_payload_json(ts)))?;
            }
            "usage.cost" => {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as u64)
                    .unwrap_or(0);
                send_text_frame(&writer, &ok_response(&meta.id, &usage_cost_payload_json(30, ts)))?;
            }
            "set-heartbeats" => match parse_set_heartbeats_params(&message) {
                Ok(params) => {
                    hub.lock()
                        .expect("hub lock should not poison")
                        .set_heartbeats_enabled(params.enabled);
                    send_text_frame(
                        &writer,
                        &ok_response(
                            &meta.id,
                            &format!("{{\"ok\":true,\"enabled\":{}}}", params.enabled),
                        ),
                    )?;
                }
                Err(code) => {
                    send_text_frame(
                        &writer,
                        &error_response(
                            Some(&meta.id),
                            code,
                            "invalid set-heartbeats params: enabled (boolean) required",
                        ),
                    )?;
                }
            },
            "talk.mode" => match parse_talk_mode_params(&message) {
                Ok(params) => {
                    let (payload_json, seq, writers) = {
                        let mut hub_state = hub.lock().expect("hub lock should not poison");
                        let ts = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|duration| duration.as_millis() as u64)
                            .unwrap_or(0);
                        let payload_json =
                            talk_mode_payload_json(params.enabled, params.phase.as_deref(), ts);
                        hub_state.set_talk_mode_json(payload_json.clone());
                        (payload_json, hub_state.next_seq(), hub_state.writers())
                    };
                    send_text_frame(&writer, &ok_response(&meta.id, &payload_json))?;
                    let frame = format!(
                        "{{\"type\":\"event\",\"event\":\"talk.mode\",\"payload\":{},\"seq\":{}}}",
                        payload_json, seq
                    );
                    for target in writers {
                        send_text_frame(&target, &frame)?;
                    }
                    if replay_trace {
                        println!("replay-emit event=talk.mode");
                    }
                }
                Err(code) => {
                    send_text_frame(
                        &writer,
                        &error_response(
                            Some(&meta.id),
                            code,
                            "invalid talk.mode params: enabled (boolean) required",
                        ),
                    )?;
                }
            },
            "voicewake.get" => {
                let triggers = hub
                    .lock()
                    .expect("hub lock should not poison")
                    .voicewake_triggers();
                send_text_frame(&writer, &ok_response(&meta.id, &voicewake_payload_json(&triggers)))?;
            }
            "voicewake.set" => match parse_voicewake_set_params(&message) {
                Ok(params) => {
                    let (payload_json, seq, writers) = {
                        let mut hub_state = hub.lock().expect("hub lock should not poison");
                        hub_state.set_voicewake_triggers(params.triggers.clone());
                        let payload_json = voicewake_payload_json(&params.triggers);
                        (payload_json, hub_state.next_seq(), hub_state.writers())
                    };
                    send_text_frame(&writer, &ok_response(&meta.id, &payload_json))?;
                    let frame = format!(
                        "{{\"type\":\"event\",\"event\":\"voicewake.changed\",\"payload\":{},\"seq\":{}}}",
                        payload_json, seq
                    );
                    for target in writers {
                        send_text_frame(&target, &frame)?;
                    }
                    if replay_trace {
                        println!("replay-emit event=voicewake.changed");
                    }
                }
                Err(code) => {
                    send_text_frame(
                        &writer,
                        &error_response(
                            Some(&meta.id),
                            code,
                            "voicewake.set requires triggers: string[]",
                        ),
                    )?;
                }
            },
            "terminal.create" => {
                let cwd = find_optional_param_string(&message, "cwd");
                let owner_client_id = client_id;
                let owner_hub_id = Some(hub.lock().expect("hub lock should not poison").hub_id());
                let (id, shell, cwd) = create_terminal_session(cwd, owner_hub_id, owner_client_id);
                let payload = terminal_create_payload_json(&id, &shell, &cwd);
                send_text_frame(&writer, &ok_response(&meta.id, &payload))?;
            }
            "terminal.write" => {
                match parse_terminal_write_params(&message) {
                    Ok(params) => match write_terminal(&params.id, &params.data) {
                        Ok((chunk, offset)) => {
                            send_text_frame(
                                &writer,
                                &ok_response(&meta.id, &terminal_ok_payload_json()),
                            )?;
                            let seq = {
                                let mut hub_state = hub.lock().expect("hub lock should not poison");
                                hub_state.next_seq()
                            };
                            let frame = format!(
                                "{{\"type\":\"event\",\"event\":\"terminal\",\"payload\":{{\"id\":\"{}\",\"stream\":\"data\",\"chunk\":{},\"offset\":{}}},\"seq\":{}}}",
                                params.id,
                                json_string(&chunk),
                                offset,
                                seq
                            );
                            for target in hub.lock().expect("hub lock should not poison").writers() {
                                send_text_frame(&target, &frame)?;
                            }
                        }
                        Err(err) => {
                            send_text_frame(
                                &writer,
                                &error_response(Some(&meta.id), GatewayErrorCode::InvalidRequest, &err),
                            )?;
                        }
                    },
                    Err(code) => {
                        send_text_frame(
                            &writer,
                            &error_response(
                                Some(&meta.id),
                                code,
                                "id and data required",
                            ),
                        )?;
                    }
                }
            }
            "terminal.resize" => {
                match parse_terminal_resize_params(&message) {
                    Ok(params) => match resize_terminal(&params.id, params.cols, params.rows) {
                        Ok(()) => {
                            send_text_frame(
                                &writer,
                                &ok_response(&meta.id, &terminal_ok_payload_json()),
                            )?;
                        }
                        Err(err) => {
                            send_text_frame(
                                &writer,
                                &error_response(Some(&meta.id), GatewayErrorCode::InvalidRequest, &err),
                            )?;
                        }
                    },
                    Err(code) => {
                        send_text_frame(
                            &writer,
                            &error_response(
                                Some(&meta.id),
                                code,
                                "id, cols, and rows required",
                            ),
                        )?;
                    }
                }
            }
            "terminal.kill" => {
                match parse_terminal_id_params(&message, "terminal.kill") {
                    Ok(params) => {
                        let exit_code = kill_terminal(&params.id).unwrap_or(0);
                        let seq = {
                            let mut hub_state = hub.lock().expect("hub lock should not poison");
                            hub_state.next_seq()
                        };
                        let frame = format!(
                            "{{\"type\":\"event\",\"event\":\"terminal\",\"payload\":{{\"id\":\"{}\",\"stream\":\"exit\",\"code\":{}}},\"seq\":{}}}",
                            params.id,
                            exit_code,
                            seq
                        );
                        for target in hub.lock().expect("hub lock should not poison").writers() {
                            send_text_frame(&target, &frame)?;
                        }
                    }
                    Err(_) => {}
                }
                send_text_frame(&writer, &ok_response(&meta.id, &terminal_ok_payload_json()))?;
            }
            "wake" => match parse_wake_params(&message) {
                Ok(params) => {
                    let (heartbeat_frame, writers) = {
                        let mut hub_state = hub.lock().expect("hub lock should not poison");
                        hub_state.enqueue_system_event(params.text.clone());
                        if params.mode == "now" && hub_state.heartbeats_enabled() {
                            let ts = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|duration| duration.as_millis() as u64)
                                .unwrap_or(0);
                            let payload_json = heartbeat_event_payload_json(ts);
                            hub_state.set_last_heartbeat_json(payload_json.clone());
                            let seq = hub_state.next_seq();
                            (
                                Some(format!(
                                    "{{\"type\":\"event\",\"event\":\"heartbeat\",\"payload\":{},\"seq\":{}}}",
                                    payload_json, seq
                                )),
                                hub_state.writers(),
                            )
                        } else {
                            (None, hub_state.writers())
                        }
                    };
                    send_text_frame(&writer, &ok_response(&meta.id, &wake_payload_json(true)))?;
                    if let Some(frame) = heartbeat_frame {
                        for target in writers {
                            send_text_frame(&target, &frame)?;
                        }
                        if replay_trace {
                            println!("replay-emit event=heartbeat");
                        }
                    }
                }
                Err(code) => {
                    send_text_frame(
                        &writer,
                        &error_response(Some(&meta.id), code, "invalid wake params"),
                    )?;
                }
            },
            "system-event" => match parse_system_event_params(&message) {
                Ok(event) => {
                    let (presence_json, seq, presence_version, health_version, writers) = {
                        let mut hub_state = hub.lock().expect("hub lock should not poison");
                        let updated_presence = merge_presence_payload(
                            &hub_state.presence_json(),
                            Some(&event.text),
                            event.instance_id.as_deref(),
                            None,
                            event.host.as_deref(),
                            event.ip.as_deref(),
                            event.version.as_deref(),
                            event.platform.as_deref(),
                            event.mode.as_deref(),
                            event.reason.as_deref(),
                            &event.text,
                        );
                        let presence_version = hub_state.set_presence_json(updated_presence);
                        let seq = hub_state.next_seq();
                        (
                            hub_state.presence_json(),
                            seq,
                            presence_version,
                            hub_state.health_version(),
                            hub_state.writers(),
                        )
                    };
                    send_text_frame(&writer, &ok_response(&meta.id, "{\"ok\":true}"))?;
                    let frame =
                        presence_event(seq, presence_version, health_version, &presence_json);
                    for target in writers {
                        send_text_frame(&target, &frame)?;
                    }
                    if replay_trace {
                        println!("replay-emit event=presence");
                    }
                }
                Err(code) => {
                    send_text_frame(&writer, &error_response(Some(&meta.id), code, "text required"))?;
                }
            },
            _ => {
                send_text_frame(
                    &writer,
                    &error_response(
                        Some(&meta.id),
                        GatewayErrorCode::InvalidRequest,
                        "unknown method",
                    ),
                )?;
            }
        }
    }

    if let Some(client_id) = client_id {
        let hub_id = hub.lock().expect("hub lock should not poison").hub_id();
        let terminal_ids = cleanup_terminals_for_client(hub_id, client_id);
        if !terminal_ids.is_empty() {
            let seq = {
                let mut hub_state = hub.lock().expect("hub lock should not poison");
                hub_state.next_seq()
            };
            for terminal_id in terminal_ids {
                let frame = format!(
                    "{{\"type\":\"event\",\"event\":\"terminal\",\"payload\":{{\"id\":\"{}\",\"stream\":\"exit\",\"code\":0}},\"seq\":{}}}",
                    terminal_id,
                    seq
                );
                for target in hub.lock().expect("hub lock should not poison").writers() {
                    let _ = send_text_frame(&target, &frame);
                }
            }
        }
        let disconnect_broadcast = {
            let mut hub_state = hub.lock().expect("hub lock should not poison");
            let Some(presence_match) = hub_state.remove_client(client_id) else {
                return Ok(());
            };
            hub_state.prune_presence_for_match(&presence_match).map(
                |(presence_json, presence_version, seq, writers)| {
                    (presence_json, presence_version, seq, hub_state.health_version(), writers)
                },
            )
        };

        if let Some((presence_json, presence_version, seq, health_version, writers)) =
            disconnect_broadcast
        {
            let frame = presence_event(seq, presence_version, health_version, &presence_json);
            for target in writers {
                let _ = send_text_frame(&target, &frame);
            }
        }
    }
    Ok(())
}

fn header_value(request: &str, name: &str) -> Option<String> {
    request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn connect_challenge_event() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    format!(
        "{{\"type\":\"event\",\"event\":\"connect.challenge\",\"payload\":{{\"nonce\":\"shadow-nonce\",\"ts\":{}}}}}",
        ts
    )
}

fn presence_response(request_id: &str, presence_json: &str) -> String {
    format!(
        "{{\"type\":\"res\",\"id\":\"{}\",\"ok\":true,\"payload\":{}}}",
        request_id, presence_json
    )
}

fn presence_event(
    seq: u64,
    presence_version: u64,
    health_version: u64,
    presence_json: &str,
) -> String {
    format!(
        "{{\"type\":\"event\",\"event\":\"presence\",\"payload\":{{\"presence\":{}}},\"seq\":{},\"stateVersion\":{{\"presence\":{},\"health\":{}}}}}",
        presence_json, seq, presence_version, health_version
    )
}

fn merge_presence_payload(
    current_presence_json: &str,
    text_override: Option<&str>,
    instance_id: Option<&str>,
    client_id: Option<&str>,
    host: Option<&str>,
    ip: Option<&str>,
    version: Option<&str>,
    platform: Option<&str>,
    mode: Option<&str>,
    reason: Option<&str>,
    default_text: &str,
) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let existing = current_presence_json
        .trim()
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or("")
        .trim();

    let mut fields = vec![
        format!(
            "\"text\":\"{}\"",
            escape_json(text_override.unwrap_or(default_text))
        ),
        format!("\"ts\":{}", ts),
    ];
    if let Some(host) = host {
        fields.push(format!("\"host\":\"{}\"", escape_json(host)));
    }
    if let Some(ip) = ip {
        fields.push(format!("\"ip\":\"{}\"", escape_json(ip)));
    }
    if let Some(version) = version {
        fields.push(format!("\"version\":\"{}\"", escape_json(version)));
    }
    if let Some(platform) = platform {
        fields.push(format!("\"platform\":\"{}\"", escape_json(platform)));
    }
    if let Some(mode) = mode {
        fields.push(format!("\"mode\":\"{}\"", escape_json(mode)));
    }
    if let Some(reason) = reason {
        fields.push(format!("\"reason\":\"{}\"", escape_json(reason)));
    }
    if let Some(instance_id) = instance_id {
        fields.push(format!("\"instanceId\":\"{}\"", escape_json(instance_id)));
    }
    if let Some(client_id) = client_id {
        fields.push(format!("\"clientId\":\"{}\"", escape_json(client_id)));
    }
    let new_entry = format!("{{{}}}", fields.join(","));
    if existing.is_empty() {
        format!("[{}]", new_entry)
    } else {
        format!("[{},{}]", existing, new_entry)
    }
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", escape_json(value))
}

fn find_optional_param_string(body: &str, key: &str) -> Option<String> {
    let params_start = body.find("\"params\":")?;
    let params = &body[params_start..];
    let needle = format!("\"{}\":\"", key);
    let start = params.find(&needle)? + needle.len();
    let tail = &params[start..];
    let end = tail.find('"')?;
    Some(tail[..end].to_string())
}

fn websocket_accept(key: &str) -> String {
    let mut input = Vec::with_capacity(key.len() + WS_MAGIC.len());
    input.extend_from_slice(key.as_bytes());
    input.extend_from_slice(WS_MAGIC.as_bytes());
    base64_encode(&sha1_digest(&input))
}

fn read_text_frame(stream: &mut TcpStream) -> std::io::Result<Option<String>> {
    let mut header = [0_u8; 2];
    match stream.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }

    let opcode = header[0] & 0x0f;
    if opcode == 0x8 {
        return Ok(None);
    }
    if opcode != 0x1 {
        return Ok(None);
    }

    let masked = (header[1] & 0x80) != 0;
    let mut payload_len = (header[1] & 0x7f) as usize;
    if payload_len == 126 {
        let mut ext = [0_u8; 2];
        stream.read_exact(&mut ext)?;
        payload_len = u16::from_be_bytes(ext) as usize;
    } else if payload_len == 127 {
        let mut ext = [0_u8; 8];
        stream.read_exact(&mut ext)?;
        payload_len = u64::from_be_bytes(ext) as usize;
    }

    let mut mask = [0_u8; 4];
    if masked {
        stream.read_exact(&mut mask)?;
    }

    let mut payload = vec![0_u8; payload_len];
    stream.read_exact(&mut payload)?;
    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }

    Ok(Some(String::from_utf8_lossy(&payload).into_owned()))
}

pub fn send_text_frame(stream: &SharedWriter, payload: &str) -> std::io::Result<()> {
    let bytes = payload.as_bytes();
    let mut frame = Vec::with_capacity(bytes.len() + 10);
    frame.push(0x81);
    if bytes.len() < 126 {
        frame.push(bytes.len() as u8);
    } else if bytes.len() <= 65535 {
        frame.push(126);
        frame.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    }
    frame.extend_from_slice(bytes);
    let mut guard = stream.lock().expect("stream lock should not poison");
    guard.write_all(&frame)?;
    guard.flush()?;
    Ok(())
}

pub fn close_stream(stream: &SharedWriter) -> std::io::Result<()> {
    let mut guard = stream.lock().expect("stream lock should not poison");
    guard.write_all(&[0x88, 0x00])?;
    guard.flush()?;
    let _ = guard.shutdown(Shutdown::Both);
    Ok(())
}

fn sha1_digest(input: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (input.len() as u64) * 8;
    let mut message = input.to_vec();
    message.push(0x80);
    while (message.len() % 64) != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in message.chunks(64) {
        let mut words = [0_u32; 80];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            let base = index * 4;
            *word = u32::from_be_bytes([
                chunk[base],
                chunk[base + 1],
                chunk[base + 2],
                chunk[base + 3],
            ]);
        }
        for index in 16..80 {
            words[index] = (words[index - 3]
                ^ words[index - 8]
                ^ words[index - 14]
                ^ words[index - 16])
                .rotate_left(1);
        }

        let mut a = h0;
        let mut b = h1;
        let mut c = h2;
        let mut d = h3;
        let mut e = h4;

        for (index, word) in words.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => (((b & c) | ((!b) & d)), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => (((b & c) | (b & d) | (c & d)), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut digest = [0_u8; 20];
    digest[0..4].copy_from_slice(&h0.to_be_bytes());
    digest[4..8].copy_from_slice(&h1.to_be_bytes());
    digest[8..12].copy_from_slice(&h2.to_be_bytes());
    digest[12..16].copy_from_slice(&h3.to_be_bytes());
    digest[16..20].copy_from_slice(&h4.to_be_bytes());
    digest
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let value = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        output.push(TABLE[((value >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((value >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[((value >> 6) & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(value & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_known_websocket_accept_value() {
        let accept = websocket_accept("dGhlIHNhbXBsZSBub25jZQ==");
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn detects_websocket_upgrade_request() {
        let request = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
        assert!(is_websocket_upgrade(request));
    }
}
