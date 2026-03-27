#!/usr/bin/env -S node --import tsx

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type ExportedFile = {
  source: string;
  target: string;
  bytes: number;
  sha256: string;
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.join(root, "dist", "hosted-installers");

const installerFiles = [
  {
    source: path.join(root, "scripts", "install-hosted.sh"),
    target: "install.sh",
    description: "Hosted shell installer served at https://argentos.ai/install.sh",
  },
  {
    source: path.join(root, "install-cli.sh"),
    target: "install-cli.sh",
    description: "Prefix-scoped CLI installer served at https://argentos.ai/install-cli.sh",
  },
  {
    source: path.join(root, "install.ps1"),
    target: "install.ps1",
    description: "Windows PowerShell installer served at https://argentos.ai/install.ps1",
  },
] as const;

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function exportInstallers() {
  await fs.mkdir(outDir, { recursive: true });
  const exported: ExportedFile[] = [];

  for (const file of installerFiles) {
    const contents = await fs.readFile(file.source);
    const targetPath = path.join(outDir, file.target);
    await fs.writeFile(targetPath, contents);
    exported.push({
      source: path.relative(root, file.source),
      target: path.relative(root, targetPath),
      bytes: contents.byteLength,
      sha256: sha256(contents),
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceRepoRoot: root,
    exportRoot: outDir,
    files: exported,
  };
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const readme = [
    "# Hosted Installer Export",
    "",
    "This directory is the publish-ready installer payload for `argentos.ai`.",
    "",
    "Files:",
    ...installerFiles.map((file) => `- \`${file.target}\` — ${file.description}`),
    "",
    "Recommended publish targets:",
    "- `install.sh`",
    "- `install-cli.sh`",
    "- `install.ps1`",
    "",
    "Integrity metadata is in `manifest.json`.",
  ].join("\n");
  await fs.writeFile(path.join(outDir, "README.md"), readme + "\n");

  console.log(`exported hosted installers to ${outDir}`);
  for (const file of exported) {
    console.log(`- ${file.target} ${file.bytes} bytes sha256=${file.sha256}`);
  }
}

await exportInstallers();
