import {
  confirm as clackConfirm,
  intro as clackIntro,
  outro as clackOutro,
  select as clackSelect,
  text as clackText,
} from "@clack/prompts";
import {
  stylePromptHint,
  stylePromptMessage,
  stylePromptOption,
  stylePromptTitle,
} from "../terminal/prompt-style.js";

export const CONFIGURE_WIZARD_SECTIONS = [
  "workspace",
  "model",
  "web",
  "gateway",
  "daemon",
  "channels",
  "skills",
  "health",
] as const;

export type WizardSection = (typeof CONFIGURE_WIZARD_SECTIONS)[number];

export type ChannelsWizardMode = "configure" | "remove";

export type ConfigureWizardParams = {
  command: "configure" | "update";
  sections?: WizardSection[];
};

export const CONFIGURE_SECTION_OPTIONS: Array<{
  value: WizardSection;
  label: string;
  hint: string;
}> = [
  { value: "workspace", label: "Workspace", hint: "Set Argent's home, memory, and session path" },
  { value: "model", label: "Brain", hint: "Choose runtime, provider, and credentials" },
  { value: "web", label: "Web", hint: "Configure Brave search and keyless fetch" },
  { value: "gateway", label: "Gateway", hint: "Tune port, bind, auth, and Tailscale" },
  {
    value: "daemon",
    label: "Service",
    hint: "Install or manage Argent's background service",
  },
  {
    value: "channels",
    label: "Channels",
    hint: "Link WhatsApp, Telegram, and other delivery surfaces",
  },
  { value: "skills", label: "Skills", hint: "Install and enable workspace skills" },
  {
    value: "health",
    label: "Systems check",
    hint: "Run gateway and channel diagnostics",
  },
];

export const intro = (message: string) => clackIntro(stylePromptTitle(message) ?? message);
export const outro = (message: string) => clackOutro(stylePromptTitle(message) ?? message);
export const text = (params: Parameters<typeof clackText>[0]) =>
  clackText({
    ...params,
    message: stylePromptMessage(params.message),
  });
export const confirm = (params: Parameters<typeof clackConfirm>[0]) =>
  clackConfirm({
    ...params,
    message: stylePromptMessage(params.message),
  });
export const select = <T>(params: Parameters<typeof clackSelect<T>>[0]) =>
  clackSelect({
    ...params,
    message: stylePromptMessage(params.message),
    options: params.options.map((opt) => ({
      ...opt,
      label: stylePromptOption(String(opt.label)),
      ...(opt.hint === undefined ? {} : { hint: stylePromptHint(opt.hint) }),
    })),
  });
