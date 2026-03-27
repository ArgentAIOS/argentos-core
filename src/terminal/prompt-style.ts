import { isRich, theme } from "./theme.js";

export const stylePromptMessage = (message: string): string =>
  isRich() ? `${theme.accent("◈")} ${theme.accentBright(message)}` : message;

export const stylePromptTitle = (title?: string): string | undefined =>
  title && isRich() ? `${theme.heading("◇")} ${theme.heading(title)}` : title;

export const stylePromptHint = (hint?: string): string | undefined =>
  hint && isRich() ? theme.muted(hint) : hint;

export const stylePromptOption = (label: string): string => (isRich() ? theme.info(label) : label);

export const stylePromptNoteTitle = (title?: string): string | undefined =>
  title && isRich() ? `${theme.accentDim("▣")} ${theme.heading(title)}` : title;
