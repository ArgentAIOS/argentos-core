import { isWSLEnv } from "../infra/wsl.js";

/**
 * Options accepted by the environment-probe helpers for test injection.
 * Live callers (everything outside vitest) pass nothing and the helpers
 * fall back to `process.env` / `process.platform`.
 */
export interface EnvProbeOpts {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/**
 * Detect a non-GUI / remote environment.
 *
 * Returns true when:
 *   - An SSH session is active (`SSH_CLIENT`, `SSH_TTY`, or `SSH_CONNECTION`
 *     set by sshd on remote login shells).
 *   - The shell is inside a remote container (VS Code Remote-Containers,
 *     GitHub Codespaces).
 *   - Linux with no `DISPLAY` and no `WAYLAND_DISPLAY` (and not WSL, which
 *     has its own GUI integration via WSLg).
 *
 * Single source of truth for "this environment cannot pop a local browser
 * window for the user." `isHeadlessSession` builds on top of this with an
 * additional manual-override knob for the Codex device-auth flow.
 */
export function isRemoteEnvironment(opts?: EnvProbeOpts): boolean {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;

  if (env.SSH_CLIENT || env.SSH_TTY || env.SSH_CONNECTION) {
    return true;
  }

  if (env.REMOTE_CONTAINERS || env.CODESPACES) {
    return true;
  }

  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY && !isWSLEnv()) {
    return true;
  }

  return false;
}

/**
 * Detect a headless / no-browser session for OpenAI Codex auth purposes.
 *
 * Returns true when we should NOT try to open a local browser and instead
 * lean on the device-code flow (URL + short code that the user can open
 * anywhere).
 *
 * Triggers (any of):
 *   - The manual override `ARGENT_CODEX_DEVICE_AUTH=1` is set — lets users
 *     force the device-auth path from a GUI host (e.g. tmux on a Mac that
 *     misdetects, or any other "I know better than the autodetect" case).
 *   - Anything `isRemoteEnvironment()` flags: SSH session, remote container
 *     (Codespaces, Remote-Containers), Linux without DISPLAY/WAYLAND_DISPLAY.
 *     macOS / Windows are intentionally excluded from the DISPLAY fallback
 *     (they don't set DISPLAY but always have a browser).
 *
 * Single source of truth for "is this a non-GUI environment we shouldn't
 * try to `openUrl()` on" — `isRemoteEnvironment` covers the autodetection,
 * this wrapper adds the per-call override on top. See GH #206.
 *
 * Accepts an injected env / platform for tests; defaults to live process.
 */
export function isHeadlessSession(opts?: EnvProbeOpts): boolean {
  const env = opts?.env ?? process.env;

  // Manual override beats autodetection — must be checked first so a user
  // on a GUI host can still force device-auth by exporting the var.
  if (env.ARGENT_CODEX_DEVICE_AUTH === "1") {
    return true;
  }

  return isRemoteEnvironment(opts);
}
