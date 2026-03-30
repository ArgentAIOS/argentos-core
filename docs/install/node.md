---
title: "Node.js + PATH sanity"
summary: "Node.js runtime sanity for hosted installs and source checkouts"
read_when:
  - "You installed ArgentOS but `argent` is “command not found”"
  - "You’re setting up Node.js on a new machine"
---

# Node.js + PATH sanity

ArgentOS’s runtime baseline is **Node 22+**.

If you ran the hosted installer and later see `argent: command not found`, it’s almost always a **PATH** issue: the installer’s wrapper directory is not on your shell’s PATH.

## Quick diagnosis

Run:

```bash
node -v
printf '%s\n' "$HOME/bin"
echo "$PATH"
```

If `$HOME/bin` is **not** present inside `echo "$PATH"`, your shell can’t find the hosted installer’s `argent` wrapper.

## Fix: put the hosted installer bin dir on PATH

1. Use the default wrapper location:

```bash
printf '%s\n' "$HOME/bin"
```

2. Add that directory to your shell startup file:

- zsh: `~/.zshrc`
- bash: `~/.bashrc`

Example:

```bash
# macOS / Linux
export PATH="$HOME/bin:$PATH"
```

Then open a **new terminal** (or run `rehash` in zsh / `hash -r` in bash).

## Recommended Node install options

You’ll have the fewest surprises if Node is installed in a way that:

- keeps Node updated (22+)
- keeps your shell PATH stable in new terminals

Common choices:

- macOS: Homebrew (`brew install node`) or a version manager
- Linux: your preferred version manager, or a distro-supported install that provides Node 22+
- Windows: official Node installer, `winget`, or a Windows Node version manager

If you use a version manager (nvm/fnm/asdf/etc), ensure it’s initialized in the shell you use day-to-day (zsh vs bash) so the PATH it sets is present when you run installers.
