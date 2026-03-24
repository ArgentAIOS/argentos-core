import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Args = {
  baseUrl: string;
  bundleId: string;
  channel: string;
  distDir: string;
  out: string;
  version: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: "",
    bundleId: "ai.argent.mac",
    channel: "stable",
    distDir: path.resolve("dist"),
    out: path.resolve("dist/macos-release-manifest.json"),
    version: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--base-url":
        args.baseUrl = String(next ?? "");
        i += 1;
        break;
      case "--bundle-id":
        args.bundleId = String(next ?? "");
        i += 1;
        break;
      case "--channel":
        args.channel = String(next ?? "");
        i += 1;
        break;
      case "--dist-dir":
        args.distDir = path.resolve(String(next ?? ""));
        i += 1;
        break;
      case "--out":
        args.out = path.resolve(String(next ?? ""));
        i += 1;
        break;
      case "--version":
        args.version = String(next ?? "");
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.baseUrl) {
    throw new Error("Missing required --base-url");
  }
  if (!args.version) {
    throw new Error("Missing required --version");
  }
  return args;
}

function sha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function statArtifact(filePath: string, url: string) {
  const stats = fs.statSync(filePath);
  return {
    filename: path.basename(filePath),
    sha256: sha256(filePath),
    sizeBytes: stats.size,
    url,
  };
}

function requiredArtifact(distDir: string, filename: string): string {
  const filePath = path.join(distDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required artifact: ${filePath}`);
  }
  return filePath;
}

function optionalArtifact(distDir: string, filename: string): string | null {
  const filePath = path.join(distDir, filename);
  return fs.existsSync(filePath) ? filePath : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const zipName = `Argent-${args.version}.zip`;
  const dmgName = `Argent-${args.version}.dmg`;
  const dSYMName = `Argent-${args.version}.dSYM.zip`;
  const zipPath = requiredArtifact(args.distDir, zipName);
  const dmgPath = requiredArtifact(args.distDir, dmgName);
  const dSYMPath = optionalArtifact(args.distDir, dSYMName);

  const manifest = {
    manifestVersion: 1,
    channel: args.channel,
    generatedAt: new Date().toISOString(),
    version: args.version,
    macos: {
      appName: "Argent.app",
      bundleId: args.bundleId,
      installTarget: "/Applications/Argent.app",
      artifacts: {
        zip: statArtifact(zipPath, `${baseUrl}/${zipName}`),
        dmg: statArtifact(dmgPath, `${baseUrl}/${dmgName}`),
        ...(dSYMPath ? { dSYM: statArtifact(dSYMPath, `${baseUrl}/${dSYMName}`) } : {}),
      },
    },
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${args.out}\n`);
}

await main();
