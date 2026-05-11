import net from "node:net";
import { sleep } from "../utils.js";

/**
 * Result of {@link waitForPortRelease}.
 *
 * - `released: true` when the port became bindable within the timeout (or was
 *   already free when the helper was first invoked).
 * - `released: false` when the timeout expired with the port still in use.
 *
 * `durationMs` is the wall-clock time spent polling (≈0 on the fast path), and
 * `attempts` is the number of bind attempts made.
 */
export type WaitForPortReleaseResult = {
  released: boolean;
  durationMs: number;
  attempts: number;
};

export type WaitForPortReleaseOptions = {
  /** TCP port to test for availability. */
  port: number;
  /**
   * Maximum total wait, in milliseconds. Defaults to 10_000 (10s) — long
   * enough for launchd to reap an orphaned gateway process plus TIME_WAIT,
   * short enough that a stuck restart still surfaces an error quickly.
   */
  timeoutMs?: number;
  /**
   * Poll interval between bind attempts. Defaults to 250ms. The first
   * attempt happens immediately; subsequent attempts back off by this
   * amount.
   */
  intervalMs?: number;
  /**
   * Hosts to bind-test. Defaults to ["127.0.0.1"]. We only need one
   * positive result to consider the port released — the new gateway will
   * still hit EADDRINUSE if any host is occupied, but in practice gateway
   * collisions are always on loopback.
   */
  hosts?: string[];
  /**
   * Override for the underlying probe. Exposed for tests so we can simulate
   * a port that's busy then becomes free without actually opening sockets.
   */
  probe?: (port: number, host: string) => Promise<PortProbeResult>;
};

export type PortProbeResult = "free" | "busy" | "unknown";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_HOSTS = ["127.0.0.1"];

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err && typeof err === "object" && "code" in err);
}

/**
 * Attempt a one-shot bind to `host:port`. If the bind succeeds the socket is
 * closed immediately. EADDRINUSE is mapped to "busy"; EADDRNOTAVAIL /
 * EAFNOSUPPORT (host stack missing for this family) is reported as "unknown"
 * so the caller can fall back to another host.
 */
export async function probePort(port: number, host: string): Promise<PortProbeResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (result: PortProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    server.once("error", (err) => {
      if (isErrno(err) && err.code === "EADDRINUSE") {
        finish("busy");
        return;
      }
      if (isErrno(err) && (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT")) {
        finish("unknown");
        return;
      }
      finish("unknown");
    });
    server.once("listening", () => {
      finish("free");
    });
    try {
      server.listen({ port, host, exclusive: true });
    } catch {
      finish("unknown");
    }
  });
}

/**
 * Poll until the given TCP port can be bound, or until the timeout elapses.
 *
 * Used by the gateway service installer to absorb the inevitable gap between
 * `launchctl bootout` (which sends SIGTERM to the previous gateway) and the
 * kernel actually releasing the listening socket. Without this wait, the
 * fresh `bootstrap` can race the dying process and the new gateway exits
 * immediately with EADDRINUSE — observed during `argent update` in #155.
 */
export async function waitForPortRelease(
  options: WaitForPortReleaseOptions,
): Promise<WaitForPortReleaseResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const hosts = options.hosts && options.hosts.length > 0 ? options.hosts : DEFAULT_HOSTS;
  const probe = options.probe ?? probePort;
  const start = Date.now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    let sawBusy = false;
    for (const host of hosts) {
      const result = await probe(options.port, host);
      if (result === "busy") {
        sawBusy = true;
        break;
      }
    }
    if (!sawBusy) {
      return {
        released: true,
        durationMs: Date.now() - start,
        attempts,
      };
    }
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) {
      return {
        released: false,
        durationMs: elapsed,
        attempts,
      };
    }
    const remaining = timeoutMs - elapsed;
    await sleep(Math.min(intervalMs, remaining));
  }
}

/**
 * Extract a `--port <num>` / `--port=<num>` argument from a program-arguments
 * vector. Returns `null` when no port flag is present or the value can't be
 * parsed.
 *
 * Centralised here so `installLaunchAgent` doesn't need to reach across to
 * the daemon-cli layer for a one-line helper.
 */
export function extractPortFromProgramArguments(
  programArguments: string[] | undefined,
): number | null {
  if (!programArguments || programArguments.length === 0) {
    return null;
  }
  for (let i = 0; i < programArguments.length; i += 1) {
    const arg = programArguments[i];
    if (arg === "--port") {
      const parsed = Number.parseInt(String(programArguments[i + 1] ?? ""), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } else if (typeof arg === "string" && arg.startsWith("--port=")) {
      const parsed = Number.parseInt(arg.slice("--port=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}
