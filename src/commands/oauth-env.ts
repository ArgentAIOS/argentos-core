import { isWSLEnv } from "../infra/wsl.js";

export function isRemoteEnvironment(): boolean {
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return true;
  }

  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return true;
  }

  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    !isWSLEnv()
  ) {
    return true;
  }

  return false;
}

/**
 * Detect a headless / no-browser session for OpenAI Codex auth purposes.
 *
 * Returns true when we should NOT try to open a local browser and instead
 * lean on the device-code flow (URL + short code that the user can open
 * anywhere). Mirrors the detection block in subctl's
 * `providers/openai/auth.sh` (see Jason's handoff 2026-05-10).
 *
 * Triggers (any of):
 *   - SSH session: `SSH_CONNECTION` or `SSH_CLIENT` set by sshd.
 *   - Manual override: `ARGENT_CODEX_DEVICE_AUTH=1` — lets users force the
 *     headless path from a GUI host (e.g. tmux on a Mac that misdetects).
 *   - Linux/non-Darwin with no `DISPLAY` and no `WAYLAND_DISPLAY`. macOS is
 *     deliberately excluded: it doesn't set `DISPLAY` but always has a
 *     browser, so flipping on that signal alone would force headless on
 *     every Mac.
 *
 * Accepts an injected env / platform for tests; defaults to live process.
 */
export function isHeadlessSession(opts?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): boolean {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;

  if (env.SSH_CONNECTION || env.SSH_CLIENT) {
    return true;
  }

  if (env.ARGENT_CODEX_DEVICE_AUTH === "1") {
    return true;
  }

  if (platform !== "darwin" && platform !== "win32" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return true;
  }

  return false;
}
