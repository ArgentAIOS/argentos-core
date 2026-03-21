const fs = require("fs");
const os = require("os");
const path = require("path");

const MODE_ORDER = ["readonly", "write", "full", "admin"];
const CATEGORY_OPTIONS = new Set([
  "general",
  "inbox",
  "ticket-queue",
  "table",
  "accounting",
  "alert-stream",
  "files-docs",
  "calendar",
  "crm",
  "social-publishing",
]);

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitList(value) {
  if (Array.isArray(value)) {
    return unique(
      value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean),
    );
  }
  if (typeof value !== "string") return [];
  return unique(
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function slugifyConnectorName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Connector slug cannot be empty.");
  }
  return normalized;
}

function pythonModuleNameFromSlug(slug) {
  return slug.replace(/-/g, "_");
}

function pythonFunctionName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]/, "_$&");
}

function connectorToolNameFromSlug(slug) {
  return `aos-${slug}`;
}

function detectConnectorRoots(projectRoot) {
  const envRoots = String(process.env.ARGENT_CONNECTOR_REPOS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const home = process.env.HOME || os.homedir();
  const roots = unique([
    ...envRoots,
    path.join(home, "code", "agent-cli-tools"),
    path.resolve(projectRoot, "..", "agent-cli-tools"),
    path.join(home, ".argentos", "connectors"),
    path.join(projectRoot, "tools", "aos"),
  ]);
  return roots.map((rootPath) => {
    const resolved = path.resolve(rootPath);
    const exists = fs.existsSync(resolved);
    let writable = false;
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    const kind = resolved === path.join(projectRoot, "tools", "aos") ? "vendored" : "external";
    return {
      path: resolved,
      exists,
      writable,
      kind,
      label:
        kind === "vendored"
          ? `Vendored tools (${resolved})`
          : exists
            ? `Connector repo (${resolved})`
            : `Connector root (${resolved})`,
    };
  });
}

function chooseDefaultConnectorRoot(roots) {
  return (
    roots.find((entry) => entry.writable && entry.kind === "external") ||
    roots.find((entry) => entry.writable) ||
    roots[0] ||
    null
  );
}

function normalizeActionRows(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const resource = String(entry.resource || "")
        .trim()
        .toLowerCase();
      const action = String(entry.action || "")
        .trim()
        .toLowerCase();
      if (!resource || !action) return null;
      const requiredMode = String(entry.requiredMode || "readonly")
        .trim()
        .toLowerCase();
      if (!MODE_ORDER.includes(requiredMode)) {
        throw new Error(`Invalid mode \"${requiredMode}\" for ${resource}.${action}.`);
      }
      const summary = String(entry.summary || "").trim() || `${action} ${resource}`;
      return {
        id: `${resource}.${action}`,
        resource,
        action,
        summary,
        requiredMode,
        actionClass:
          action.includes("list") || action.includes("read") || action.includes("search")
            ? "read"
            : action.includes("delete") || action.includes("remove")
              ? "destructive"
              : "write",
      };
    })
    .filter(Boolean);
}

function renderConnectorReadme(params) {
  const serviceKeys = Array.isArray(params.auth.service_keys) ? params.auth.service_keys : [];
  const interactiveSetup = Array.isArray(params.auth.interactive_setup)
    ? params.auth.interactive_setup
    : [];
  const actionLines = params.actions
    .map((action) => `- \`${action.id}\` (${action.requiredMode})`)
    .join("\n");
  return [
    `# ${params.toolName}`,
    "",
    `${params.description}`,
    "",
    "## Generated From ArgentOS",
    "",
    `- System: ${params.systemName}`,
    `- Category: ${params.category}`,
    `- Backend: ${params.backend}`,
    `- Target root: ${params.rootDir}`,
    "",
    "## Planned Commands",
    "",
    actionLines || "- No commands defined yet",
    "",
    "## Auth",
    "",
    `- Kind: ${params.auth.kind || "none"}`,
    `- Required: ${params.auth.required ? "yes" : "no"}`,
    ...(serviceKeys.length > 0
      ? ["- Service keys:", ...serviceKeys.map((key) => `  - ${key}`)]
      : ["- Service keys: none declared"]),
    ...(interactiveSetup.length > 0
      ? ["- Interactive setup:", ...interactiveSetup.map((step) => `  - ${step}`)]
      : []),
    "",
    "## Next Steps",
    "",
    "1. Implement backend calls in `agent-harness/cli_aos/<module>/cli.py`.",
    "2. Add real auth/config wiring.",
    "3. Create integration tests against the target system.",
    "4. Create a venv and install with `pip install -e '.[dev]'`.",
    "5. Verify `capabilities` and `health` before assigning the connector to a worker.",
    "",
  ].join("\n");
}

function renderHarnessReadme(params) {
  return [
    `# ${params.toolName} agent harness`,
    "",
    `Python Click harness for ${params.systemName}.`,
    "",
    "## Install",
    "",
    "```bash",
    "python3 -m venv .venv",
    "source .venv/bin/activate",
    "pip install -e '.[dev]'",
    `${params.toolName} --json capabilities`,
    `${params.toolName} --json health`,
    "```",
    "",
    "## Notes",
    "",
    "This scaffold intentionally starts in a `needs_setup` state until real backend calls are implemented.",
    "",
  ].join("\n");
}

function renderPyproject(params) {
  return [
    "[build-system]",
    'requires = ["setuptools>=68", "wheel"]',
    'build-backend = "setuptools.build_meta"',
    "",
    "[project]",
    `name = "${params.toolName}"`,
    'version = "0.1.0"',
    `description = "${params.description}"`,
    'readme = "README.md"',
    'requires-python = ">=3.10"',
    'dependencies = ["click>=8.1"]',
    "",
    "[project.optional-dependencies]",
    'dev = ["pytest>=8.0"]',
    "",
    "[project.scripts]",
    `${params.toolName} = "cli_aos.${params.moduleName}.cli:cli"`,
    "",
    "[tool.setuptools]",
    'package-dir = { "" = "." }',
    "",
    "[tool.setuptools.packages.find]",
    'where = ["."]',
    'include = ["cli_aos*"]',
    "",
  ].join("\n");
}

function renderPermissions(params) {
  const permissions = {};
  for (const action of params.actions) {
    permissions[action.id] = action.requiredMode;
  }
  permissions.health = "readonly";
  permissions["config.show"] = "readonly";
  return (
    JSON.stringify(
      {
        tool: params.toolName,
        backend: params.backend,
        permissions,
      },
      null,
      2,
    ) + "\n"
  );
}

function renderConnectorMeta(params) {
  return (
    JSON.stringify(
      {
        connector: {
          label: params.systemName,
          category: params.category,
          categories: unique([params.category]),
          resources: params.resources,
        },
        auth: params.auth,
        commands: params.actions.map((action) => ({
          id: action.id,
          summary: action.summary,
          required_mode: action.requiredMode,
          supports_json: true,
          resource: action.resource,
          action_class: action.actionClass,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

function renderCliModule(params) {
  const groupMap = new Map();
  for (const action of params.actions) {
    if (!groupMap.has(action.resource)) groupMap.set(action.resource, []);
    groupMap.get(action.resource).push(action);
  }
  const lines = [];
  lines.push("from __future__ import annotations");
  lines.push("");
  lines.push("import json");
  lines.push("import time");
  lines.push("from datetime import datetime, timezone");
  lines.push("from pathlib import Path");
  lines.push("");
  lines.push("import click");
  lines.push("");
  lines.push(`from . import __version__`);
  lines.push("");
  lines.push(`TOOL_NAME = ${JSON.stringify(params.toolName)}`);
  lines.push(`CONNECTOR_LABEL = ${JSON.stringify(params.systemName)}`);
  lines.push(`CONNECTOR_CATEGORY = ${JSON.stringify(params.category)}`);
  lines.push(`CONNECTOR_RESOURCES = ${JSON.stringify(params.resources)}`);
  lines.push(`CONNECTOR_AUTH = ${JSON.stringify(params.auth)}`);
  lines.push(
    `COMMAND_SPECS = ${JSON.stringify(
      params.actions.map((action) => ({
        id: action.id,
        summary: action.summary,
        required_mode: action.requiredMode,
        supports_json: true,
        resource: action.resource,
        action_class: action.actionClass,
      })),
      null,
      2,
    )}`,
  );
  lines.push('MODE_ORDER = ["readonly", "write", "full", "admin"]');
  lines.push('PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"');
  lines.push("");
  lines.push("def _mode_allows(actual: str, required: str) -> bool:");
  lines.push("    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)");
  lines.push("");
  lines.push("def _load_permissions() -> dict[str, str]:");
  lines.push("    payload = json.loads(PERMISSIONS_PATH.read_text())");
  lines.push('    return payload.get("permissions", {})');
  lines.push("");
  lines.push("def _emit(payload: dict, as_json: bool) -> None:");
  lines.push("    if as_json:");
  lines.push("        click.echo(json.dumps(payload, indent=2, sort_keys=True))");
  lines.push("        return");
  lines.push('    if payload.get("ok"):');
  lines.push('        click.echo("OK")');
  lines.push("    else:");
  lines.push("        click.echo(f\"ERROR: {payload['error']['message']}\")");
  lines.push("");
  lines.push(
    "def _result(*, ok: bool, command: str, mode: str, started: float, data: dict | None = None, error: dict | None = None) -> dict:",
  );
  lines.push("    base = {");
  lines.push('        "ok": ok,');
  lines.push('        "tool": TOOL_NAME,');
  lines.push('        "command": command,');
  lines.push('        "meta": {');
  lines.push('            "mode": mode,');
  lines.push('            "duration_ms": int((time.time() - started) * 1000),');
  lines.push('            "timestamp": datetime.now(timezone.utc).isoformat(),');
  lines.push('            "version": __version__,');
  lines.push("        },");
  lines.push("    }");
  lines.push("    if ok:");
  lines.push('        base["data"] = data or {}');
  lines.push("    else:");
  lines.push(
    '        base["error"] = error or {"code": "INTERNAL_ERROR", "message": "Unknown error"}',
  );
  lines.push("    return base");
  lines.push("");
  lines.push("def require_mode(ctx: click.Context, command_id: str) -> None:");
  lines.push('    required = _load_permissions().get(command_id, "admin")');
  lines.push('    mode = ctx.obj["mode"]');
  lines.push("    if _mode_allows(mode, required):");
  lines.push("        return");
  lines.push("    payload = _result(");
  lines.push("        ok=False,");
  lines.push("        command=command_id,");
  lines.push("        mode=mode,");
  lines.push('        started=ctx.obj["started"],');
  lines.push("        error={");
  lines.push('            "code": "PERMISSION_DENIED",');
  lines.push('            "message": f"Command requires mode={required}",');
  lines.push('            "details": {"required_mode": required, "actual_mode": mode},');
  lines.push("        },");
  lines.push("    )");
  lines.push('    _emit(payload, ctx.obj["json"])');
  lines.push("    raise SystemExit(3)");
  lines.push("");
  lines.push("@click.group()");
  lines.push('@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")');
  lines.push(
    '@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)',
  );
  lines.push('@click.option("--verbose", is_flag=True, help="Verbose diagnostic output")');
  lines.push("@click.version_option(__version__)");
  lines.push("@click.pass_context");
  lines.push("def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:");
  lines.push("    ctx.ensure_object(dict)");
  lines.push(
    '    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time()})',
  );
  lines.push("");
  lines.push('@cli.command("capabilities")');
  lines.push("@click.pass_context");
  lines.push("def capabilities(ctx: click.Context) -> None:");
  lines.push("    payload = {");
  lines.push('        "tool": TOOL_NAME,');
  lines.push('        "version": __version__,');
  lines.push('        "manifest_schema_version": "1.0.0",');
  lines.push('        "modes": MODE_ORDER,');
  lines.push('        "connector": {');
  lines.push('            "label": CONNECTOR_LABEL,');
  lines.push('            "category": CONNECTOR_CATEGORY,');
  lines.push('            "categories": [CONNECTOR_CATEGORY],');
  lines.push('            "resources": CONNECTOR_RESOURCES,');
  lines.push("        },");
  lines.push('        "auth": CONNECTOR_AUTH,');
  lines.push('        "commands": COMMAND_SPECS,');
  lines.push("    }");
  lines.push('    _emit(payload, True if ctx.obj["json"] else True)');
  lines.push("");
  lines.push('@cli.group("config")');
  lines.push("def config_group() -> None:");
  lines.push("    pass");
  lines.push("");
  lines.push('@config_group.command("show")');
  lines.push("@click.pass_context");
  lines.push("def config_show(ctx: click.Context) -> None:");
  lines.push(
    '    payload = _result(ok=True, command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"auth": CONNECTOR_AUTH, "implemented": False})',
  );
  lines.push('    _emit(payload, ctx.obj["json"])');
  lines.push("");
  lines.push('@cli.command("health")');
  lines.push("@click.pass_context");
  lines.push("def health(ctx: click.Context) -> None:");
  lines.push(
    '    payload = _result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"status": "needs_setup", "summary": "Connector scaffold generated. Implement backend commands and auth before production use."})',
  );
  lines.push('    _emit(payload, ctx.obj["json"])');
  lines.push("");

  for (const [resource, actions] of groupMap.entries()) {
    const groupFn = `${pythonFunctionName(resource)}_group`;
    lines.push(`@cli.group(${JSON.stringify(resource)})`);
    lines.push(`def ${groupFn}() -> None:`);
    lines.push("    pass");
    lines.push("");
    for (const action of actions) {
      const fnName = `${pythonFunctionName(resource)}_${pythonFunctionName(action.action)}`;
      lines.push(`@${groupFn}.command(${JSON.stringify(action.action)})`);
      lines.push('@click.argument("items", nargs=-1)');
      lines.push("@click.pass_context");
      lines.push(`def ${fnName}(ctx: click.Context, items: tuple[str, ...]) -> None:`);
      lines.push(`    require_mode(ctx, ${JSON.stringify(action.id)})`);
      lines.push(
        `    payload = _result(ok=False, command=${JSON.stringify(action.id)}, mode=ctx.obj["mode"], started=ctx.obj["started"], error={"code": "NOT_IMPLEMENTED", "message": ${JSON.stringify(`${action.id} is scaffolded but not implemented yet`)}, "details": {"items": list(items)}})`,
      );
      lines.push('    _emit(payload, ctx.obj["json"])');
      lines.push("    raise SystemExit(10)");
      lines.push("");
    }
  }

  lines.push('if __name__ == "__main__":');
  lines.push("    cli()");
  lines.push("");
  return lines.join("\n");
}

function renderInitPy() {
  return '__all__ = ["__version__"]\n__version__ = "0.1.0"\n';
}

function renderTests(params) {
  const firstAction = params.actions[0] || {
    resource: "example",
    action: "delete",
    id: "example.delete",
  };
  return [
    "from click.testing import CliRunner",
    "",
    `from cli_aos.${params.moduleName}.cli import cli`,
    "",
    "",
    "def test_capabilities_json():",
    '    result = CliRunner().invoke(cli, ["--json", "capabilities"])',
    "    assert result.exit_code == 0",
    `    assert '\"tool\": \"${params.toolName}\"' in result.output`,
    "",
    "",
    "def test_permission_denied_for_write_path_in_readonly():",
    `    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", ${JSON.stringify(firstAction.resource)}, ${JSON.stringify(firstAction.action)}])`,
    "    assert result.exit_code in (3, 10)",
    "    assert 'PERMISSION_DENIED' in result.output or 'NOT_IMPLEMENTED' in result.output",
    "",
  ].join("\n");
}

function scaffoldConnector(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const roots = detectConnectorRoots(projectRoot);
  const allowedRootPaths = new Set(roots.map((entry) => entry.path));
  const selectedRoot = path.resolve(String(options.rootDir || ""));
  if (!allowedRootPaths.has(selectedRoot)) {
    throw new Error("Selected connector root is not allowed.");
  }
  const systemName = String(options.systemName || "").trim();
  if (!systemName) {
    throw new Error("System name is required.");
  }
  const slug = slugifyConnectorName(options.slug || systemName);
  const toolName = connectorToolNameFromSlug(slug);
  const moduleName = pythonModuleNameFromSlug(slug);
  const targetDir = path.join(selectedRoot, toolName);
  if (fs.existsSync(targetDir)) {
    throw new Error(`${toolName} already exists at ${targetDir}.`);
  }
  const categoryRaw = String(options.category || "general")
    .trim()
    .toLowerCase();
  const category = CATEGORY_OPTIONS.has(categoryRaw) ? categoryRaw : "general";
  const backend = String(options.backend || `${slug}-backend`).trim() || `${slug}-backend`;
  const description =
    String(options.description || "").trim() || `Agent-native ${systemName} connector`;
  const resources = unique(
    splitList(options.resources).concat(
      Array.isArray(options.actions)
        ? options.actions
            .map((entry) =>
              entry && typeof entry === "object" ? String(entry.resource || "") : "",
            )
            .filter(Boolean)
        : [],
    ),
  );
  const actions = normalizeActionRows(options.actions);
  if (actions.length === 0) {
    throw new Error("At least one connector action is required.");
  }
  const authKindRaw = String(options.authKind || "none")
    .trim()
    .toLowerCase();
  const auth = {
    kind: authKindRaw === "none" ? undefined : authKindRaw,
    required: authKindRaw !== "none",
    service_keys: splitList(options.serviceKeys),
    interactive_setup: splitList(options.interactiveSetup),
  };
  const params = {
    rootDir: selectedRoot,
    targetDir,
    systemName,
    slug,
    toolName,
    moduleName,
    category,
    backend,
    description,
    resources,
    actions,
    auth,
  };

  fs.mkdirSync(path.join(targetDir, "agent-harness", "cli_aos", moduleName), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "agent-harness", "tests"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "README.md"), renderConnectorReadme(params), "utf8");
  fs.writeFileSync(path.join(targetDir, "connector.json"), renderConnectorMeta(params), "utf8");
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "README.md"),
    renderHarnessReadme(params),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", ".gitignore"),
    ".venv/\n.pytest_cache/\n__pycache__/\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "pyproject.toml"),
    renderPyproject(params),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "permissions.json"),
    renderPermissions(params),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "cli_aos", moduleName, "__init__.py"),
    renderInitPy(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "cli_aos", moduleName, "cli.py"),
    renderCliModule(params),
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "agent-harness", "tests", "test_cli.py"),
    renderTests(params),
    "utf8",
  );

  return {
    ok: true,
    tool: toolName,
    targetDir,
    rootDir: selectedRoot,
    files: [
      "README.md",
      "connector.json",
      "agent-harness/README.md",
      "agent-harness/pyproject.toml",
      "agent-harness/permissions.json",
      `agent-harness/cli_aos/${moduleName}/__init__.py`,
      `agent-harness/cli_aos/${moduleName}/cli.py`,
      "agent-harness/tests/test_cli.py",
    ],
    nextSteps: [
      `Create a venv in ${toolName}/agent-harness and install the package with pip install -e '.[dev]'.`,
      "Implement real backend/API calls inside cli.py.",
      "Add required service keys in ArgentOS API Keys.",
      "Run capabilities and health before assigning the connector to a worker.",
    ],
  };
}

module.exports = {
  detectConnectorRoots,
  chooseDefaultConnectorRoot,
  scaffoldConnector,
};
