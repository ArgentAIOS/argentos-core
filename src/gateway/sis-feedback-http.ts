/**
 * Internal HTTP endpoint for SIS (Self-Improving System) feedback.
 * Called by the dashboard API server when a user gives thumbs up/down.
 * Reinforces or decays confidence on lessons that were active in the session.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { getActiveLessons } from "../infra/sis-active-lessons.js";

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 65536) {
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const CONFIDENCE_BOOST = 0.1;
const CONFIDENCE_DECAY = 0.05;

/**
 * Handle POST /api/internal/sis-feedback
 * Body: { sessionKey: string, feedbackType: "up" | "down" }
 * Returns true if the request was handled, false if the path didn't match.
 */
export async function handleSisFeedbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/internal/sis-feedback") {
    return false;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }

  let body: { sessionKey?: string; feedbackType?: string };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as { sessionKey?: string; feedbackType?: string };
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid JSON" });
    return true;
  }

  const { sessionKey, feedbackType } = body;
  if (!sessionKey || !feedbackType || !["up", "down"].includes(feedbackType)) {
    sendJson(res, 400, {
      ok: false,
      error: 'sessionKey and feedbackType ("up"|"down") are required',
    });
    return true;
  }

  const lessonIds = getActiveLessons(sessionKey);
  if (lessonIds.length === 0) {
    sendJson(res, 200, { ok: true, lessonsUpdated: 0 });
    return true;
  }

  try {
    const store = await getMemoryAdapter();
    let updated = 0;
    for (const id of lessonIds) {
      if (feedbackType === "up") {
        await store.reinforceLesson(id);
      } else {
        await store.decayLesson(id, CONFIDENCE_DECAY);
      }
      updated++;
    }

    // Also tag model_feedback records for this session with user feedback
    const fb = feedbackType as "up" | "down";
    const modelUpdated = await store.updateModelFeedbackUserRating(sessionKey, fb);

    console.log(
      `[SIS] Feedback ${feedbackType} applied to ${updated} lesson(s), ${modelUpdated} model record(s) for session ${sessionKey}`,
    );
    sendJson(res, 200, {
      ok: true,
      lessonsUpdated: updated,
      modelFeedbackUpdated: modelUpdated,
      lessonIds,
    });
  } catch (err) {
    console.error("[SIS] Error applying feedback to lessons:", err);
    sendJson(res, 500, { ok: false, error: "Failed to update lessons" });
  }
  return true;
}
