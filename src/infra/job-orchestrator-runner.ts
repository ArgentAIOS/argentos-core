// Core stub — job orchestrator is Business-tier only
export function startJobOrchestratorRunner(_opts: unknown) {
  return {
    stop: () => {},
    updateConfig: () => {},
    getStatus: () => ({
      enabled: false,
      pollMs: 0,
      running: false,
      lastCycleAt: null,
      lastCycleMs: null,
      metrics: {
        cycles: 0,
        eventsAccepted: 0,
        eventsDeduped: 0,
        timeTasksCreated: 0,
        eventTasksCreated: 0,
        eventsProcessed: 0,
      },
    }),
  };
}
export type JobOrchestratorRunner = ReturnType<typeof startJobOrchestratorRunner>;
