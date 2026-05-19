import type { Command } from "commander";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { theme } from "../terminal/theme.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PKG_EXT = ".argent-pkg";
const MANIFEST_FILE = "argent.plugin.json";
const REQUIRED_MANIFEST_FIELDS = ["id", "version"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PackageManifest {
  id: string;
  name?: string;
  version: string;
  description?: string;
  author?: { name?: string; publicKey?: string };
  category?: string;
  tags?: string[];
  license?: string;
  pricing?: string;
  price_cents?: number;
  compatibility?: Record<string, string>;
  entry?: string;
  tools?: string[];
  permissions?: string[];
  configSchema?: unknown;
  [key: string]: unknown;
}

function readManifest(extensionDir: string): PackageManifest {
  const manifestPath = path.join(extensionDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No ${MANIFEST_FILE} found in ${extensionDir}`);
  }
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as PackageManifest;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) {
      throw new Error(`Manifest missing required field: ${field}`);
    }
  }
  // Validate semver-ish format
  if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
    throw new Error(`Invalid version format: ${manifest.version} (expected semver X.Y.Z)`);
  }
  return manifest;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Bytes(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

function collectFiles(dir: string, base = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Skip common non-distributable directories
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Package command
// ---------------------------------------------------------------------------

async function packageExtension(extensionPath: string, opts: { output?: string; sign?: string }) {
  const extensionDir = path.resolve(extensionPath);
  if (!fs.existsSync(extensionDir) || !fs.statSync(extensionDir).isDirectory()) {
    console.error(theme.error(`Not a directory: ${extensionDir}`));
    process.exit(1);
  }

  // Read and validate manifest
  const manifest = readManifest(extensionDir);
  const pkgName = manifest.id;
  const pkgVersion = manifest.version;
  console.log(theme.info(`Packaging ${theme.command(pkgName)} v${pkgVersion}`));

  // Collect files
  const files = collectFiles(extensionDir);
  if (!files.includes(MANIFEST_FILE)) {
    console.error(theme.error(`${MANIFEST_FILE} not found in collected files`));
    process.exit(1);
  }
  console.log(theme.muted(`  ${files.length} files found`));

  // Generate SHA256SUMS
  const checksums: string[] = [];
  for (const file of files) {
    const fullPath = path.join(extensionDir, file);
    const buf = fs.readFileSync(fullPath);
    checksums.push(`${sha256Hex(buf)}  ${file}`);
  }

  // Write SHA256SUMS to a temp location inside the extension dir
  const sha256sumsPath = path.join(extensionDir, "SHA256SUMS");
  const sha256sumsExisted = fs.existsSync(sha256sumsPath);
  fs.writeFileSync(sha256sumsPath, checksums.join("\n") + "\n");

  // Determine output filename
  const outputFile = opts.output ?? `${pkgName}-${pkgVersion}${PKG_EXT}`;
  const outputPath = path.resolve(outputFile);

  // Create tar.gz using system tar (most reliable, avoids npm dep)
  try {
    execSync(`tar -czf "${outputPath}" -C "${extensionDir}" .`, { stdio: "pipe" });
  } finally {
    // Clean up SHA256SUMS if we created it
    if (!sha256sumsExisted) {
      fs.unlinkSync(sha256sumsPath);
    }
  }

  const tarBuf = fs.readFileSync(outputPath);
  const tarHash = sha256Hex(tarBuf);
  const tarSize = tarBuf.length;

  console.log(theme.success(`Created ${outputFile}`));
  console.log(theme.muted(`  Size: ${(tarSize / 1024).toFixed(1)} KB`));
  console.log(theme.muted(`  SHA-256: ${tarHash}`));

  // Sign if requested
  if (opts.sign) {
    const keyPath = path.resolve(opts.sign);
    if (!fs.existsSync(keyPath)) {
      console.error(theme.error(`Signing key not found: ${keyPath}`));
      process.exit(1);
    }

    const nacl = await import("tweetnacl");
    const keyData = fs.readFileSync(keyPath);

    // Support raw 64-byte secret key or base64-encoded
    let secretKey: Uint8Array;
    if (keyData.length === 64) {
      secretKey = new Uint8Array(keyData);
    } else {
      // Try base64
      secretKey = new Uint8Array(Buffer.from(keyData.toString("utf-8").trim(), "base64"));
    }

    if (secretKey.length !== 64) {
      console.error(theme.error(`Invalid key length: expected 64 bytes, got ${secretKey.length}`));
      process.exit(1);
    }

    const fileHash = sha256Bytes(tarBuf);
    const signature = nacl.sign.detached(new Uint8Array(fileHash), secretKey);
    const signatureB64 = Buffer.from(signature).toString("base64");
    const publicKeyB64 = Buffer.from(secretKey.slice(32)).toString("base64");

    // Write signature file next to the package
    const sigPath = outputPath.replace(PKG_EXT, ".sig");
    fs.writeFileSync(sigPath, signatureB64);

    console.log(theme.success(`Signed with Ed25519`));
    console.log(theme.muted(`  Signature: ${sigPath}`));
    console.log(theme.muted(`  Public key: ${publicKeyB64}`));
  }

  // Print summary
  console.log("");
  console.log(theme.info("Package contents:"));
  for (const file of files) {
    console.log(theme.muted(`  ${file}`));
  }
  console.log("");
  console.log(theme.info(`To publish: ${theme.command(`argent extension publish ${outputFile}`)}`));
}

// ---------------------------------------------------------------------------
// Publish command
// ---------------------------------------------------------------------------

async function publishExtension(
  pkgFile: string,
  opts: { url?: string; apiKey?: string; sign?: string; changelog?: string },
) {
  const pkgPath = path.resolve(pkgFile);
  if (!fs.existsSync(pkgPath)) {
    console.error(theme.error(`Package not found: ${pkgPath}`));
    process.exit(1);
  }

  const tarBuf = fs.readFileSync(pkgPath);

  // Verify gzip magic bytes
  if (tarBuf[0] !== 0x1f || tarBuf[1] !== 0x8b) {
    console.error(theme.error(`Not a valid .argent-pkg (gzip) file`));
    process.exit(1);
  }

  const apiKey = opts.apiKey ?? process.env.ARGENT_MARKETPLACE_API_KEY ?? process.env.ADMIN_API_KEY;
  if (!apiKey) {
    console.error(
      theme.error(
        `No API key. Set --api-key, ARGENT_MARKETPLACE_API_KEY, or ADMIN_API_KEY env var`,
      ),
    );
    process.exit(1);
  }

  const baseUrl =
    opts.url ?? process.env.ARGENT_MARKETPLACE_URL ?? "https://marketplace.argentos.ai";

  // Build metadata
  const metadata: Record<string, string> = {};
  if (opts.changelog) metadata.changelog = opts.changelog;

  // Load signature if available
  const sigPath = pkgPath.replace(PKG_EXT, ".sig");
  if (opts.sign) {
    // Sign on-the-fly
    const keyPath = path.resolve(opts.sign);
    const keyData = fs.readFileSync(keyPath);
    let secretKey: Uint8Array;
    if (keyData.length === 64) {
      secretKey = new Uint8Array(keyData);
    } else {
      secretKey = new Uint8Array(Buffer.from(keyData.toString("utf-8").trim(), "base64"));
    }
    const nacl = await import("tweetnacl");
    const fileHash = sha256Bytes(tarBuf);
    const signature = nacl.sign.detached(new Uint8Array(fileHash), secretKey);
    metadata.signature = Buffer.from(signature).toString("base64");
    metadata.authorPublicKey = Buffer.from(secretKey.slice(32)).toString("base64");
  } else if (fs.existsSync(sigPath)) {
    metadata.signature = fs.readFileSync(sigPath, "utf-8").trim();
  }

  console.log(theme.info(`Publishing to ${baseUrl}...`));

  // Build multipart form data manually
  const boundary = `----ArgentPkg${Date.now()}`;
  const parts: Buffer[] = [];

  // Package file part
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="package"; filename="${path.basename(pkgPath)}"\r\nContent-Type: application/gzip\r\n\r\n`,
    ),
  );
  parts.push(tarBuf);
  parts.push(Buffer.from("\r\n"));

  // Metadata part
  if (Object.keys(metadata).length > 0) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n`,
      ),
    );
    parts.push(Buffer.from(JSON.stringify(metadata)));
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const res = await fetch(`${baseUrl}/api/v1/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(theme.error(`Publish failed (${res.status}): ${text}`));
    process.exit(1);
  }

  const result = (await res.json()) as {
    ok: boolean;
    packageId: string;
    version: string;
    fileHash: string;
  };
  console.log(theme.success(`Published successfully!`));
  console.log(theme.muted(`  Package ID: ${result.packageId}`));
  console.log(theme.muted(`  Version: ${result.version}`));
  console.log(theme.muted(`  Hash: ${result.fileHash}`));
}

// ---------------------------------------------------------------------------
// Keygen command
// ---------------------------------------------------------------------------

async function generateSigningKey(opts: { output?: string }) {
  const nacl = await import("tweetnacl");
  const keypair = nacl.sign.keyPair();
  const secretB64 = Buffer.from(keypair.secretKey).toString("base64");
  const publicB64 = Buffer.from(keypair.publicKey).toString("base64");

  const outFile = opts.output ?? "argent-signing.key";
  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, secretB64, { mode: 0o600 });

  console.log(theme.success(`Generated Ed25519 signing keypair`));
  console.log(theme.muted(`  Private key: ${outFile} (keep secret!)`));
  console.log(theme.muted(`  Public key:  ${publicB64}`));
  console.log("");
  console.log(theme.info(`Add the public key to your manifest's author.publicKey field.`));
  console.log(
    theme.info(
      `Sign packages with: ${theme.command(`argent extension package <dir> --sign ${outFile}`)}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// List command
// ---------------------------------------------------------------------------

function listExtensions(opts: { path?: string }) {
  const extDir = opts.path ?? path.join(process.env.HOME ?? "~", ".argentos", "extensions");
  if (!fs.existsSync(extDir)) {
    console.log(theme.muted("No extensions directory found."));
    return;
  }

  const entries = fs.readdirSync(extDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 0) {
    console.log(theme.muted("No extensions installed."));
    return;
  }

  console.log(theme.info(`Extensions in ${extDir}:\n`));
  for (const entry of entries) {
    const manifestPath = path.join(extDir, entry.name, MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PackageManifest;
        const name = theme.command(manifest.name ?? manifest.id);
        const ver = theme.muted(`v${manifest.version}`);
        const desc = manifest.description
          ? theme.muted(
              manifest.description.length > 60
                ? `${manifest.description.slice(0, 57)}...`
                : manifest.description,
            )
          : "";
        console.log(`  ${name} ${ver}  ${desc}`);
      } catch {
        console.log(`  ${theme.command(entry.name)} ${theme.error("(invalid manifest)")}`);
      }
    } else {
      console.log(`  ${theme.command(entry.name)} ${theme.warn("(no manifest)")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Register CLI
// ---------------------------------------------------------------------------

export function registerExtensionCli(program: Command) {
  const ext = program.command("extension").description("Extension packaging and publishing");

  ext
    .command("package")
    .description("Create a .argent-pkg from an extension directory")
    .argument("<path>", "Path to extension directory")
    .option("-o, --output <file>", "Output filename (default: <id>-<version>.argent-pkg)")
    .option("--sign <keyfile>", "Sign package with Ed25519 private key")
    .action(async (extPath: string, opts: { output?: string; sign?: string }) => {
      await packageExtension(extPath, opts);
    });

  ext
    .command("publish")
    .description("Publish a .argent-pkg to the marketplace")
    .argument("<package>", "Path to .argent-pkg file")
    .option("--api-key <key>", "Marketplace API key")
    .option("--url <url>", "Marketplace API URL")
    .option("--sign <keyfile>", "Sign on-the-fly with Ed25519 private key")
    .option("--changelog <text>", "Changelog for this version")
    .action(
      async (
        pkgFile: string,
        opts: { url?: string; apiKey?: string; sign?: string; changelog?: string },
      ) => {
        await publishExtension(pkgFile, opts);
      },
    );

  ext
    .command("keygen")
    .description("Generate Ed25519 signing keypair for package publishing")
    .option("-o, --output <file>", "Output filename (default: argent-signing.key)")
    .action(async (opts: { output?: string }) => {
      await generateSigningKey(opts);
    });

  ext
    .command("list")
    .description("List installed extensions")
    .option("--path <dir>", "Extensions directory (default: ~/.argentos/extensions)")
    .action((opts: { path?: string }) => {
      listExtensions(opts);
    });
}
