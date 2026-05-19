/**
 * AlignmentDocs — pure helpers (separated for unit testability).
 *
 * The Settings → Alignment panel was crashing with
 *   `TypeError: undefined is not an object (evaluating 'be.agents.length')`
 * whenever `/api/settings/alignment` returned a non-OK response (e.g. 401)
 * or a malformed body. The component blindly called `setState(data)` and
 * later read `state.agents.length`, which threw if the API answered with
 * `{ error: "..." }`.
 *
 * `normalizeAlignmentState` defends against that by accepting any unknown
 * shape and either:
 *   - returning a safe `AlignmentState` with `agents` and `docs` arrays
 *     (filling in `[]` when the field is missing or non-array), or
 *   - returning `null` so the component falls through to its existing
 *     loading branch.
 */

export interface AgentEntry {
  id: string;
  label: string;
}

export interface AlignmentDoc {
  file: string;
  label: string;
  description: string;
}

export interface AlignmentState {
  agents: AgentEntry[];
  docs: AlignmentDoc[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceAgentEntry(value: unknown): AgentEntry | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const { id, label } = value;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return { id, label: typeof label === "string" && label.length > 0 ? label : id };
}

function coerceAlignmentDoc(value: unknown): AlignmentDoc | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const { file, label, description } = value;
  if (typeof file !== "string" || file.length === 0) {
    return null;
  }
  return {
    file,
    label: typeof label === "string" ? label : file,
    description: typeof description === "string" ? description : "",
  };
}

/**
 * Normalize an unknown API response into an `AlignmentState`.
 *
 * Returns `null` when the body is clearly not an alignment payload — the
 * caller should treat that as "still loading / failed" and render the
 * loading skeleton, not crash.
 *
 * Returns an `AlignmentState` (possibly with empty arrays) when the body
 * is at least a plain object. Missing or malformed `agents` / `docs`
 * fields collapse to `[]` so downstream `.length` / `.map` / `.find`
 * calls are safe.
 */
export function normalizeAlignmentState(data: unknown): AlignmentState | null {
  if (!isPlainObject(data)) {
    return null;
  }

  // If the body is purely an error envelope with no agents/docs hints,
  // surface it as `null` so the loading branch shows instead of an empty
  // "no agents found" message that misleads the operator.
  if ("error" in data && !("agents" in data) && !("docs" in data)) {
    return null;
  }

  const rawAgents = Array.isArray(data.agents) ? data.agents : [];
  const rawDocs = Array.isArray(data.docs) ? data.docs : [];

  const agents = rawAgents
    .map(coerceAgentEntry)
    .filter((entry): entry is AgentEntry => entry !== null);
  const docs = rawDocs
    .map(coerceAlignmentDoc)
    .filter((entry): entry is AlignmentDoc => entry !== null);

  return { agents, docs };
}
