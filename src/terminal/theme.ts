import chalk, { Chalk } from "chalk";
import { ARGENT_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(ARGENT_PALETTE.accent),
  accentBright: hex(ARGENT_PALETTE.accentBright),
  accentDim: hex(ARGENT_PALETTE.accentDim),
  info: hex(ARGENT_PALETTE.info),
  success: hex(ARGENT_PALETTE.success),
  warn: hex(ARGENT_PALETTE.warn),
  error: hex(ARGENT_PALETTE.error),
  muted: hex(ARGENT_PALETTE.muted),
  heading: baseChalk.bold.hex(ARGENT_PALETTE.accentBright),
  command: hex(ARGENT_PALETTE.accentBright),
  option: hex(ARGENT_PALETTE.info),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
