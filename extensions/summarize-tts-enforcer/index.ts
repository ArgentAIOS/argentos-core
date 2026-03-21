export default function register(api: any) {
  const pluginConfig = api.pluginConfig as { voice?: string; enabled?: boolean } | undefined;

  const enabled = pluginConfig?.enabled !== false;
  if (!enabled) {
    api.logger.info("[summarize-tts-enforcer] Disabled via config");
    return;
  }

  const voice = pluginConfig?.voice || "cgSgspJ2msm6clMCkdW9"; // Jessica

  // Use the agent:bootstrap hook — the real active hook path in ArgentOS.
  // This fires via applyBootstrapHookOverrides → triggerInternalHook("agent:bootstrap")
  // which calls handlers registered here via api.registerHook("agent:bootstrap", ...).
  api.registerHook(
    "agent:bootstrap",
    (event: any) => {
      // Inline type guard (matching canvas-docs-enforcer pattern)
      if (event.type !== "agent" || event.action !== "bootstrap") return;
      const ctx = event.context;
      if (!ctx || !Array.isArray(ctx.bootstrapFiles)) return;

      // Only enforce when TTS is actually on
      const ttsAuto = ctx.cfg?.messages?.tts?.auto;
      const ttsEnabled = ctx.cfg?.messages?.tts?.enabled;
      if (ttsAuto === "off" || ttsEnabled === false) return;

      const content = [
        "## MANDATORY: Spoken Summary [TTS:] Required",
        "",
        "You MUST include a `[TTS:...]` spoken summary block at the end of EVERY response.",
        "This is not optional. If you omit it, the system speaks your raw text which sounds",
        "robotic and gets cut off.",
        "",
        `Voice ID: ${voice}`,
        "",
        "**Format:** Place at the very END of your response:",
        "`[TTS:your spoken summary here]`",
        "",
        "**Rules:**",
        "- Write it as natural speech, like explaining to a friend",
        "- Default length: 2–6 sentences, usually 40–140 words (unless user explicitly asks for short/brief)",
        "- Include the actual substance of the response, not just a reaction one-liner",
        "- Do NOT use ultra-short summaries like '[amused] Pretty good, right?' unless user asked for brevity",
        "- Skip code, file paths, and raw URLs; explain outcomes and meaning in plain speech",
        "- Always use ElevenLabs v3 audio tags: [excited], [sighs], [laughs], [pause], etc.",
        "- Lead with a reaction tag ([sighs], [excited], [thoughtful], etc.)",
        "",
        "**Examples:**",
        "- `[TTS:[satisfied] All done. I tracked the issue to the TTS request path, added a timeout so it can't hang silently, and wired a direct fallback endpoint in dev. The summary now renders, playback works, and replay/download controls appear correctly.]`",
        "- `[TTS:[excited] Found it. The browser freeze came from marker parsing on partial chunks, so I replaced that parser with a safe linear scan and cut noisy per-chunk logging. Now responses stream cleanly, the UI stays responsive, and voice playback starts reliably.]`",
        "- `[TTS:[thoughtful] Short answer: yes, you can do that. The main tradeoff is speed versus quality, so I'd keep the current model for live chat and use a heavier model only for long-form tasks where quality matters more than latency.]`",
        "",
        "**NEVER omit [TTS:].** Every response must end with one.",
      ].join("\n");

      ctx.bootstrapFiles.push({
        name: "TTS_ENFORCEMENT.md",
        content,
        path: "<summarize-tts-enforcer>",
        missing: false,
      });
    },
    { name: "summarize-tts-enforcer" },
  );

  api.logger.info(
    "[summarize-tts-enforcer] Registered agent:bootstrap hook — TTS enforcement active",
  );
}
