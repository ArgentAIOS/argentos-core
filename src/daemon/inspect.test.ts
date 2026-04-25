import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findExtraGatewayServices } from "./inspect.js";

const tempHomes: string[] = [];

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })));
});

async function writeLaunchAgent(
  home: string,
  label: string,
  body = "argent gateway",
): Promise<void> {
  const dir = path.join(home, "Library", "LaunchAgents");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${label}.plist`),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${body}</string>
  </array>
</dict>
</plist>
`,
  );
}

describe("findExtraGatewayServices", () => {
  it("does not flag intentional Rust shadow services as extra gateways", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "argent-inspect-"));
    tempHomes.push(home);
    await writeLaunchAgent(home, "ai.argent.rust-gateway-shadow");
    await writeLaunchAgent(home, "ai.argent.rust-executive-shadow");
    await writeLaunchAgent(home, "ai.argent.unexpected-shadow", "argent substrate");

    const services = await findExtraGatewayServices({ HOME: home });

    expect(services.map((service) => service.label)).toEqual(["ai.argent.unexpected-shadow"]);
  });
});
