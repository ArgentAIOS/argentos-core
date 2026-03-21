import type { HeartbeatRunResult } from "../../infra/heartbeat-wake.js";
import type { CronJob } from "../types.js";
import type { CronExecutionMode, CronGateDecision, CronSimulationEvidence } from "../types.js";
import type { CronEvent, CronServiceState } from "./state.js";
import { computeJobNextRunAtMs, nextWakeAtMs, resolveJobPayloadTextForMain } from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist } from "./store.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function resolveExecutionMode(job: CronJob): CronExecutionMode {
  return job.executionMode === "paper_trade" ? "paper_trade" : "live";
}

function resolvePaperTradeEvidence(
  job: CronJob,
  nowMs: number,
  executionMode: CronExecutionMode,
): CronSimulationEvidence | undefined {
  if (executionMode !== "paper_trade") {
    return undefined;
  }
  const reason = "paper_trade mode blocks live external side-effect execution";
  if (job.payload.kind === "audioAlert") {
    return {
      mode: "paper_trade",
      policy: "external_side_effect_gate",
      simulatedAtMs: nowMs,
      payloadKind: "audioAlert",
      action: "audio_alert_dispatch",
      reason,
    };
  }
  if (job.sessionTarget !== "isolated") {
    return undefined;
  }
  if (job.payload.kind === "agentTurn") {
    return {
      mode: "paper_trade",
      policy: "external_side_effect_gate",
      simulatedAtMs: nowMs,
      payloadKind: "agentTurn",
      action: "isolated_agent_turn",
      reason,
    };
  }
  if (job.payload.kind === "nudge") {
    return {
      mode: "paper_trade",
      policy: "external_side_effect_gate",
      simulatedAtMs: nowMs,
      payloadKind: "nudge",
      action: "nudge_dispatch",
      reason,
    };
  }
  if (job.payload.kind === "vipEmailScan") {
    return {
      mode: "paper_trade",
      policy: "external_side_effect_gate",
      simulatedAtMs: nowMs,
      payloadKind: "vipEmailScan",
      action: "vip_email_scan",
      reason,
    };
  }
  if (job.payload.kind === "slackSignalScan") {
    return {
      mode: "paper_trade",
      policy: "external_side_effect_gate",
      simulatedAtMs: nowMs,
      payloadKind: "slackSignalScan",
      action: "slack_signal_scan",
      reason,
    };
  }
  return undefined;
}

export function armTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
  if (!state.deps.cronEnabled) {
    return;
  }
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    return;
  }
  const delay = Math.max(nextAt - state.deps.nowMs(), 0);
  // Avoid TimeoutOverflowWarning when a job is far in the future.
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS);
  state.timer = setTimeout(() => {
    void onTimer(state).catch((err) => {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    });
  }, clampedDelay);
  state.timer.unref?.();
}

export async function onTimer(state: CronServiceState) {
  if (state.running) {
    return;
  }
  state.running = true;
  try {
    await locked(state, async () => {
      await ensureLoaded(state, { forceReload: true });
      await runDueJobs(state);
      await persist(state);
      armTimer(state);
    });
  } finally {
    state.running = false;
  }
}

export async function runDueJobs(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const due = state.store.jobs.filter((j) => {
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    const next = j.state.nextRunAtMs;
    return typeof next === "number" && now >= next;
  });
  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}

export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
) {
  const startedAt = state.deps.nowMs();
  const executionMode = resolveExecutionMode(job);
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

  let deleted = false;

  const finish = async (
    status: "ok" | "error" | "skipped",
    err?: string,
    summary?: string,
    gate?: {
      decision: CronGateDecision;
      reason?: string;
      simulationEvidence?: CronSimulationEvidence;
    },
  ) => {
    const endedAt = state.deps.nowMs();
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    job.state.lastError = err;
    job.state.lastExecutionMode = executionMode;
    job.state.lastGateDecision = gate?.decision ?? "allow_live";
    job.state.lastGateReason = gate?.reason;
    job.state.lastSimulationEvidence = gate?.simulationEvidence;

    const isAtJob = job.schedule.kind === "at";
    const shouldDelete = isAtJob && status === "ok" && job.deleteAfterRun === true;
    const shouldRetireAfterAttempt = isAtJob && job.deleteAfterRun === true;

    if (!shouldDelete) {
      if (shouldRetireAfterAttempt || (isAtJob && status === "ok")) {
        // One-shot jobs should not run more than once.
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt);
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
      executionMode,
      gateDecision: job.state.lastGateDecision,
      gateReason: gate?.reason,
      simulationEvidence: gate?.simulationEvidence,
    });

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
      deleted = true;
      emit(state, { jobId: job.id, action: "removed" });
    }
  };

  try {
    const paperTradeEvidence = resolvePaperTradeEvidence(job, startedAt, executionMode);
    if (paperTradeEvidence) {
      const gateReason = paperTradeEvidence.reason;
      await finish("skipped", gateReason, `[paper_trade] Simulated ${paperTradeEvidence.action}`, {
        decision: "simulated_paper_trade",
        reason: gateReason,
        simulationEvidence: paperTradeEvidence,
      });
      return;
    }

    if (job.payload.kind === "audioAlert") {
      if (!state.deps.runAudioAlert) {
        await finish("skipped", "audio alert handler not configured");
        return;
      }
      const alertRes = await state.deps.runAudioAlert({
        job,
        message: job.payload.message,
        title: job.payload.title,
        voice: job.payload.voice,
        mood: job.payload.mood,
        urgency: job.payload.urgency,
      });
      if (alertRes.status === "ok") {
        await finish("ok", undefined, alertRes.summary ?? job.payload.message);
      } else if (alertRes.status === "skipped") {
        await finish("skipped", alertRes.error ?? "audio alert skipped", alertRes.summary);
      } else {
        await finish("error", alertRes.error ?? "audio alert failed", alertRes.summary);
      }
      return;
    }

    if (job.sessionTarget === "main") {
      const text = resolveJobPayloadTextForMain(job);
      if (!text) {
        const kind = job.payload.kind;
        await finish(
          "skipped",
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
        );
        return;
      }
      state.deps.enqueueSystemEvent(text, { agentId: job.agentId });
      if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
        const reason = `cron:${job.id}`;
        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const maxWaitMs = 2 * 60_000;
        const waitStartedAt = state.deps.nowMs();

        let heartbeatResult: HeartbeatRunResult;
        for (;;) {
          heartbeatResult = await state.deps.runHeartbeatOnce({ reason });
          if (
            heartbeatResult.status !== "skipped" ||
            heartbeatResult.reason !== "requests-in-flight"
          ) {
            break;
          }
          if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
            heartbeatResult = {
              status: "skipped",
              reason: "timeout waiting for main lane to become idle",
            };
            break;
          }
          await delay(250);
        }

        if (heartbeatResult.status === "ran") {
          await finish("ok", undefined, text);
        } else if (heartbeatResult.status === "skipped") {
          await finish("skipped", heartbeatResult.reason, text);
        } else {
          await finish("error", heartbeatResult.reason, text);
        }
      } else {
        // wakeMode is "next-heartbeat" or runHeartbeatOnce not available
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
        await finish("ok", undefined, text);
      }
      return;
    }

    // Handle nudge payloads — silent delivery through gateway
    if (job.payload.kind === "nudge") {
      if (!state.deps.runNudge) {
        await finish("skipped", "nudge handler not configured");
        return;
      }
      const nudgeRes = await state.deps.runNudge({
        job,
        text: job.payload.text,
        label: job.payload.label,
      });
      if (nudgeRes.status === "ok") {
        await finish(
          "ok",
          undefined,
          `Nudge: ${job.payload.label ?? job.payload.text.slice(0, 50)}`,
        );
      } else if (nudgeRes.status === "skipped") {
        await finish("skipped", nudgeRes.error ?? "nudge skipped");
      } else {
        await finish("error", nudgeRes.error ?? "nudge failed");
      }
      return;
    }

    if (job.payload.kind === "vipEmailScan") {
      if (!state.deps.runVipEmailScan) {
        await finish("skipped", "vipEmailScan handler not configured");
        return;
      }
      const scanRes = await state.deps.runVipEmailScan({
        job,
        emitAlerts: job.payload.emitAlerts,
        maxResults: job.payload.maxResults,
        lookbackDays: job.payload.lookbackDays,
        accounts: job.payload.accounts,
      });
      if (scanRes.status === "ok") {
        await finish("ok", undefined, scanRes.summary);
      } else if (scanRes.status === "skipped") {
        await finish("skipped", scanRes.error ?? "vipEmailScan skipped", scanRes.summary);
      } else {
        await finish("error", scanRes.error ?? "vipEmailScan failed", scanRes.summary);
      }
      return;
    }

    if (job.payload.kind === "slackSignalScan") {
      if (!state.deps.runSlackSignalScan) {
        await finish("skipped", "slackSignalScan handler not configured");
        return;
      }
      const scanRes = await state.deps.runSlackSignalScan({
        job,
        emitAlerts: job.payload.emitAlerts,
        createTasks: job.payload.createTasks,
        accountId: job.payload.accountId,
      });
      if (scanRes.status === "ok") {
        await finish("ok", undefined, scanRes.summary);
      } else if (scanRes.status === "skipped") {
        await finish("skipped", scanRes.error ?? "slackSignalScan skipped", scanRes.summary);
      } else {
        await finish("error", scanRes.error ?? "slackSignalScan failed", scanRes.summary);
      }
      return;
    }

    if (job.payload.kind !== "agentTurn") {
      await finish(
        "skipped",
        "isolated job requires payload.kind=agentTurn, nudge, vipEmailScan, or slackSignalScan",
      );
      return;
    }

    const res = await state.deps.runIsolatedAgentJob({
      job,
      message: job.payload.message,
    });

    // Post a short summary back to the main session so the user sees
    // the cron result without opening the isolated session.
    const summaryText = res.summary?.trim();
    const deliveryMode = job.delivery?.mode ?? "announce";
    if (summaryText && deliveryMode !== "none") {
      const prefix = "Cron";
      const label =
        res.status === "error" ? `${prefix} (error): ${summaryText}` : `${prefix}: ${summaryText}`;
      state.deps.enqueueSystemEvent(label, { agentId: job.agentId });
      if (job.wakeMode === "now") {
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
      }
    }

    if (res.status === "ok") {
      await finish("ok", undefined, res.summary);
    } else if (res.status === "skipped") {
      await finish("skipped", undefined, res.summary);
    } else {
      await finish("error", res.error ?? "cron job failed", res.summary);
    }
  } catch (err) {
    await finish("error", String(err));
  } finally {
    job.updatedAtMs = nowMs;
    if (!opts.forced && job.enabled && !deleted) {
      // Keep nextRunAtMs in sync in case the schedule advanced during a long run.
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs());
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false } as const;
  }
  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }
  return { ok: true } as const;
}

export function stopTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}

export function emit(state: CronServiceState, evt: CronEvent) {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
}
