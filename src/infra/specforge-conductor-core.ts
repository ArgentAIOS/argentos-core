/**
 * Public Core override for SpecForge conductor.
 *
 * SpecForge remains on the Business side of the product boundary, so Core only
 * exposes inert helpers that keep the gateway buildable without invoking the
 * intake workflow.
 */

export async function shouldInvokeSpecforgeToolForMessage(_params: {
  sessionKey: string;
  message: string;
}): Promise<boolean> {
  return false;
}

export async function maybeKickoffSpecforgeFromMessage(_params: {
  message: string;
  sessionKey: string;
  agentId: string;
}): Promise<{
  triggered: boolean;
  started: boolean;
  reused: boolean;
  reason: string;
}> {
  return {
    triggered: false,
    started: false,
    reused: false,
    reason: "SpecForge is unavailable in ArgentOS Core.",
  };
}
