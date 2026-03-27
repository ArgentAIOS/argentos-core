import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_DIR = resolve(REPO_ROOT, "dist/hosted-installers");
const DEFAULT_SITE_PUBLIC_DIR = resolve(REPO_ROOT, "..", "argentos.ai", "public");
const targetArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const TARGET_DIR = targetArg ? resolve(targetArg) : DEFAULT_SITE_PUBLIC_DIR;

const FILES = [
  "install.sh",
  "install-cli.sh",
  "install.ps1",
  "manifest.json",
  "README.md",
] as const;

if (!existsSync(SOURCE_DIR)) {
  throw new Error(
    `Hosted installer export not found at ${SOURCE_DIR}. Run \`pnpm export:hosted-installers\` first.`,
  );
}

if (!existsSync(TARGET_DIR)) {
  throw new Error(`Target site public directory does not exist: ${TARGET_DIR}`);
}

mkdirSync(TARGET_DIR, { recursive: true });

for (const name of FILES) {
  const sourcePath = join(SOURCE_DIR, name);
  const targetPath = join(TARGET_DIR, basename(name));
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing exported installer file: ${sourcePath}`);
  }
  copyFileSync(sourcePath, targetPath);
  if (name.endsWith(".sh")) {
    chmodSync(targetPath, 0o755);
  }
}

const manifestPath = join(TARGET_DIR, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  files?: Array<{ name: string; sha256: string; size: number }>;
};

console.log(`synced hosted installers to ${TARGET_DIR}`);
for (const name of FILES) {
  const targetPath = join(TARGET_DIR, name);
  const details = manifest.files?.find((file) => file.name === name);
  const size = statSync(targetPath).size;
  const sha = details?.sha256 ? ` sha256=${details.sha256}` : "";
  console.log(`- ${targetPath} ${size} bytes${sha}`);
}
