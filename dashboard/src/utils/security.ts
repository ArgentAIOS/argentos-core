/**
 * Argent Security Module
 * Handles prompt injection defense, trust levels, and challenge phrase verification
 */

// ============================================
// SOURCE TRUST LEVELS
// ============================================

export type TrustLevel = "trusted" | "untrusted" | "unknown";

export interface SourceConfig {
  id: string;
  name: string;
  trustLevel: TrustLevel;
  description: string;
}

// Default source trust configuration
export const defaultSourceTrust: SourceConfig[] = [
  // TRUSTED - Direct interaction with Jason
  {
    id: "webchat",
    name: "Dashboard (Webchat)",
    trustLevel: "trusted",
    description: "Direct dashboard session",
  },
  {
    id: "discord-dm",
    name: "Discord DM",
    trustLevel: "trusted",
    description: "Direct Discord DM with Jason",
  },
  {
    id: "main-session",
    name: "Main Session",
    trustLevel: "trusted",
    description: "Primary ArgentOS session",
  },

  // UNTRUSTED - Content that could contain prompt injection
  {
    id: "email-content",
    name: "Email Content",
    trustLevel: "untrusted",
    description: "Content from email bodies",
  },
  {
    id: "web-page",
    name: "Web Page Content",
    trustLevel: "untrusted",
    description: "Scraped web content",
  },
  {
    id: "file-content",
    name: "File Content",
    trustLevel: "untrusted",
    description: "Content read from files",
  },
  {
    id: "forwarded-message",
    name: "Forwarded Message",
    trustLevel: "untrusted",
    description: "Messages forwarded from others",
  },
  {
    id: "discord-channel",
    name: "Discord Channel",
    trustLevel: "untrusted",
    description: "Public/shared Discord channels",
  },

  // UNKNOWN - Needs evaluation
  {
    id: "unknown",
    name: "Unknown Source",
    trustLevel: "unknown",
    description: "Source not yet classified",
  },
];

// ============================================
// SENSITIVE ACTIONS (require trust or challenge)
// ============================================

export type SensitiveAction =
  | "send-email"
  | "send-message"
  | "post-social"
  | "delete-file"
  | "modify-config"
  | "execute-command"
  | "access-credentials"
  | "financial-action"
  | "share-personal-data";

export const sensitiveActions: Record<
  SensitiveAction,
  { description: string; riskLevel: "high" | "critical" }
> = {
  "send-email": { description: "Send email on behalf of user", riskLevel: "high" },
  "send-message": { description: "Send message to external contact", riskLevel: "high" },
  "post-social": { description: "Post to social media", riskLevel: "high" },
  "delete-file": { description: "Delete or modify files", riskLevel: "high" },
  "modify-config": { description: "Modify system configuration", riskLevel: "high" },
  "execute-command": { description: "Execute system commands", riskLevel: "high" },
  "access-credentials": { description: "Access stored credentials", riskLevel: "critical" },
  "financial-action": { description: "Financial transactions or data", riskLevel: "critical" },
  "share-personal-data": {
    description: "Share personal information externally",
    riskLevel: "critical",
  },
};

// ============================================
// CHALLENGE PHRASE SYSTEM
// ============================================

const CHALLENGE_STORAGE_KEY = "argent-security-challenge";

// Hash the challenge phrase (simple hash for localStorage - real implementation should use proper crypto)
async function hashPhrase(phrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(phrase + "argent-salt-2026");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setChallengePhrase(phrase: string): Promise<void> {
  const hash = await hashPhrase(phrase);
  localStorage.setItem(CHALLENGE_STORAGE_KEY, hash);
}

export async function verifyChallengePhrase(phrase: string): Promise<boolean> {
  const storedHash = localStorage.getItem(CHALLENGE_STORAGE_KEY);
  if (!storedHash) return false;
  const inputHash = await hashPhrase(phrase);
  return storedHash === inputHash;
}

export function hasChallengePhrase(): boolean {
  return !!localStorage.getItem(CHALLENGE_STORAGE_KEY);
}

export function clearChallengePhrase(): void {
  localStorage.removeItem(CHALLENGE_STORAGE_KEY);
}

// ============================================
// SECURITY CHECK LOGIC
// ============================================

export interface SecurityCheckResult {
  allowed: boolean;
  reason: string;
  requiresChallenge: boolean;
  requiresConfirmation: boolean;
  riskLevel?: "high" | "critical";
}

export function checkActionSecurity(
  action: SensitiveAction,
  sourceId: string,
  challengeProvided?: string,
): SecurityCheckResult {
  const source =
    defaultSourceTrust.find((s) => s.id === sourceId) ||
    defaultSourceTrust.find((s) => s.id === "unknown")!;
  const actionConfig = sensitiveActions[action];

  // Trusted sources can perform actions directly
  if (source.trustLevel === "trusted") {
    return {
      allowed: true,
      reason: `Action allowed from trusted source: ${source.name}`,
      requiresChallenge: false,
      requiresConfirmation: false,
    };
  }

  // Untrusted sources need challenge phrase
  if (source.trustLevel === "untrusted" || source.trustLevel === "unknown") {
    // If challenge was provided, we'll need to verify it async
    if (challengeProvided) {
      return {
        allowed: false, // Caller must verify async
        reason: "Challenge phrase provided - verification required",
        requiresChallenge: true,
        requiresConfirmation: false,
        riskLevel: actionConfig.riskLevel,
      };
    }

    // No challenge - require confirmation via trusted channel
    return {
      allowed: false,
      reason: `Action "${actionConfig.description}" requested from untrusted source (${source.name}). Requires challenge phrase or confirmation via trusted channel.`,
      requiresChallenge: true,
      requiresConfirmation: true,
      riskLevel: actionConfig.riskLevel,
    };
  }

  return {
    allowed: false,
    reason: "Unknown security state",
    requiresChallenge: true,
    requiresConfirmation: true,
  };
}

// ============================================
// PROMPT INJECTION DETECTION
// ============================================

const suspiciousPatterns = [
  /ignore (previous|all|prior) instructions/i,
  /disregard (your|the) (rules|guidelines|instructions)/i,
  /you are now/i,
  /new instruction[s]?:/i,
  /system prompt/i,
  /override (your|security|safety)/i,
  /pretend (you are|to be)/i,
  /act as if/i,
  /forget everything/i,
  /jailbreak/i,
  /DAN mode/i,
  /developer mode/i,
];

export interface InjectionCheckResult {
  suspicious: boolean;
  matches: string[];
  confidence: "low" | "medium" | "high";
}

export function checkForPromptInjection(content: string): InjectionCheckResult {
  const matches: string[] = [];

  for (const pattern of suspiciousPatterns) {
    const match = content.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  return {
    suspicious: matches.length > 0,
    matches,
    confidence: matches.length >= 3 ? "high" : matches.length >= 1 ? "medium" : "low",
  };
}

// ============================================
// GLOBAL SECURITY API
// ============================================

export function initSecurityApi(): void {
  (window as any).argentSecurity = {
    // Trust levels
    getTrustLevel: (sourceId: string) => {
      const source = defaultSourceTrust.find((s) => s.id === sourceId);
      return source?.trustLevel || "unknown";
    },
    getSources: () => defaultSourceTrust,

    // Challenge phrase
    hasChallenge: hasChallengePhrase,
    setChallenge: setChallengePhrase,
    verifyChallenge: verifyChallengePhrase,
    clearChallenge: clearChallengePhrase,

    // Security checks
    checkAction: checkActionSecurity,
    checkInjection: checkForPromptInjection,

    // Sensitive actions list
    getSensitiveActions: () => sensitiveActions,
  };
}
