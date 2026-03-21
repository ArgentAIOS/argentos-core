/**
 * MemU Workflow Executor
 *
 * A lightweight DAG-based workflow executor for running extraction and
 * retrieval pipelines. Each step declares what it requires and produces.
 * The executor validates dependencies and runs steps in order.
 *
 * Ported from MemU's Python workflow system.
 */

export interface WorkflowStep<TState extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique step identifier */
  id: string;
  /** Human-readable description */
  description?: string;
  /** State keys this step requires (must exist before running) */
  requires?: string[];
  /** State keys this step produces (will exist after running) */
  produces?: string[];
  /** The handler function — receives state, returns updated state */
  handler: (state: TState) => TState | Promise<TState>;
}

export interface WorkflowResult<TState extends Record<string, unknown> = Record<string, unknown>> {
  /** Final state after all steps complete */
  state: TState;
  /** Steps that were executed successfully */
  completed: string[];
  /** Step that failed (if any) */
  failedStep?: string;
  /** Error from failed step */
  error?: Error;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Execute a sequence of workflow steps.
 *
 * Steps run in order. Each step receives the accumulated state from
 * all prior steps. If a step fails, execution stops and the partial
 * result is returned.
 */
export async function runWorkflow<TState extends Record<string, unknown> = Record<string, unknown>>(
  steps: WorkflowStep<TState>[],
  initialState: TState,
): Promise<WorkflowResult<TState>> {
  const start = Date.now();
  let state = { ...initialState };
  const completed: string[] = [];

  for (const step of steps) {
    // Validate requires
    if (step.requires) {
      const missing = step.requires.filter((key) => !(key in state));
      if (missing.length > 0) {
        return {
          state,
          completed,
          failedStep: step.id,
          error: new Error(`Step "${step.id}" requires missing state keys: ${missing.join(", ")}`),
          durationMs: Date.now() - start,
        };
      }
    }

    // Run handler
    try {
      state = await Promise.resolve(step.handler(state));
      completed.push(step.id);
    } catch (err) {
      return {
        state,
        completed,
        failedStep: step.id,
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs: Date.now() - start,
      };
    }

    // Validate produces
    if (step.produces) {
      const missing = step.produces.filter((key) => !(key in state));
      if (missing.length > 0) {
        return {
          state,
          completed,
          failedStep: step.id,
          error: new Error(
            `Step "${step.id}" did not produce required keys: ${missing.join(", ")}`,
          ),
          durationMs: Date.now() - start,
        };
      }
    }
  }

  return {
    state,
    completed,
    durationMs: Date.now() - start,
  };
}

/**
 * Validate a workflow definition without executing it.
 * Checks that all step dependencies can be satisfied.
 */
export function validateWorkflow<TState extends Record<string, unknown> = Record<string, unknown>>(
  steps: WorkflowStep<TState>[],
  initialStateKeys: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const available = new Set(initialStateKeys);
  const stepIds = new Set<string>();

  for (const step of steps) {
    // Check for duplicate IDs
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step ID: "${step.id}"`);
    }
    stepIds.add(step.id);

    // Check requires
    if (step.requires) {
      for (const key of step.requires) {
        if (!available.has(key)) {
          errors.push(`Step "${step.id}" requires "${key}" which is not available`);
        }
      }
    }

    // Add produces to available
    if (step.produces) {
      for (const key of step.produces) {
        available.add(key);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
