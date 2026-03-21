# Experimental Curiosity Queue Monitor

## What it is

The service at [http://127.0.0.1:19427/](http://127.0.0.1:19427/) is the **Curiosity Queue Monitor**.

It is an experimental web dashboard used during kernel-memory / curiosity-loop work. It is **not**
part of the normal Argent chat surface, and it is **not** a required production service.

On macOS it is typically installed as a LaunchAgent:

- label: `ai.argent.curiosity-monitor`
- plist: `~/Library/LaunchAgents/ai.argent.curiosity-monitor.plist`
- port: `19427`

## Why it can be confusing

This service can continue running even when the main repo focus has moved on, because it is managed
separately from the gateway and dashboard UI.

It may also still point at an older workspace if it was installed from a previous experimental branch
or worktree. The Gateway tab now exposes the service's workspace and launch command so you can verify
what it is actually running.

## How to control it

### From the Config Panel

Open:

- `Settings`
- `Gateway`
- `Services`

Look for:

- `Curiosity Queue Monitor`

Use:

- `Start`
- `Stop`
- `Restart`

The Config Panel also shows:

- the local URL
- the LaunchAgent label
- the workspace path
- the exact command from the installed plist

If the workspace path is not the current repo, the UI marks it as an external experimental service.

### From the terminal

Start:

```bash
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/ai.argent.curiosity-monitor.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/ai.argent.curiosity-monitor
```

Stop:

```bash
launchctl bootout gui/$(id -u)/ai.argent.curiosity-monitor
```

Restart:

```bash
launchctl kickstart -k gui/$(id -u)/ai.argent.curiosity-monitor
```

Inspect runtime:

```bash
launchctl print gui/$(id -u)/ai.argent.curiosity-monitor
```

Inspect the installed plist:

```bash
plutil -p "$HOME/Library/LaunchAgents/ai.argent.curiosity-monitor.plist"
```

## Current boundary

This monitor belongs to experimental kernel-memory work. It should not be treated as part of:

- normal operator chat
- installable public-core product surface
- worker-agent runtime

If it remains useful later, it should be re-homed into the active repo intentionally rather than
carried forward implicitly from an old workspace.
