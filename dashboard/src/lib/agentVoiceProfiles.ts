export type AgentTtsProvider = "elevenlabs" | "fish";

export type AgentTtsProfile = {
  provider: AgentTtsProvider;
  voiceId: string;
  label: string;
  modelId?: string;
  outputFormat?: string;
  lockVoiceSelection?: boolean;
};

const AGENT_TTS_PROFILES: Record<string, AgentTtsProfile> = {
  elon: {
    provider: "fish",
    voiceId: "fe9f05b9f1454b43bff5875f9bcc803f",
    label: "Elon Fish Clone",
    outputFormat: "mp3",
    lockVoiceSelection: true,
  },
  sam: {
    provider: "fish",
    voiceId: "51ea20dc23e04f73a84b69d9f612af5f",
    label: "Sam Fish Clone",
    outputFormat: "mp3",
    lockVoiceSelection: true,
  },
  dario: {
    provider: "fish",
    voiceId: "db311afeb0d94ed88b6e2ef658867c74",
    label: "Dario Fish Clone",
    outputFormat: "mp3",
    lockVoiceSelection: true,
  },
  jensen: {
    provider: "fish",
    voiceId: "13d0b8becb574f4eb2913437e50d93c4",
    label: "Jensen Fish Clone",
    outputFormat: "mp3",
    lockVoiceSelection: true,
  },
};

export function resolveAgentTtsProfile(agentId: string | null | undefined): AgentTtsProfile | null {
  const normalized = agentId?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return AGENT_TTS_PROFILES[normalized] ?? null;
}
