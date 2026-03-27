---
name: create-skill-package
description: Create ArgentOS marketplace skill packages. Use when the user wants to build a new skill, plugin, or extension for the ArgentOS Marketplace. Guides through SKILL.md creation, packaging, and submission.
---

# Create Skill Package

Build properly formatted skill packages for the ArgentOS Marketplace.

## When to Use

Use this skill when the user wants to:

- Create a new skill or plugin for ArgentOS
- Package an existing tool for marketplace distribution
- Understand the skill format and requirements
- Prepare a submission for the marketplace

## Package Structure

A minimal skill package contains:

```
my-skill/
├── SKILL.md          # Required — main instructions file
├── templates/        # Optional — prompt templates
├── examples/         # Optional — example outputs
└── scripts/          # Optional — executable scripts
```

## SKILL.md Format

Every skill must have a `SKILL.md` with YAML frontmatter:

```yaml
---
name: my-skill-name
description: One-line description of what this skill does and when to use it.
---

# Skill Title

Detailed instructions for the AI agent.

## When to Use

Describe the triggers — when should the agent activate this skill?

## How It Works

Step-by-step instructions, API endpoints, commands, or workflows.

## Examples

Show example usage with code blocks.
```

### Required Frontmatter Fields

| Field         | Type   | Description                                                           |
| ------------- | ------ | --------------------------------------------------------------------- |
| `name`        | string | Lowercase, hyphens allowed. Must be unique in the marketplace.        |
| `description` | string | One sentence. Used for search and auto-triggering. Start with a verb. |

### Optional Frontmatter Fields

| Field      | Type   | Description                                          |
| ---------- | ------ | ---------------------------------------------------- |
| `author`   | string | Your name or GitHub username                         |
| `version`  | string | Semver (e.g., "1.0.0")                               |
| `homepage` | string | URL to project page or repo                          |
| `metadata` | object | Extra config (emoji, OS requirements, install steps) |

## Writing Good Skills

1. **Start the description with a verb**: "Search X posts", "Manage Trello boards", "Generate images with..."
2. **Include "When to Use"**: List specific trigger phrases so the agent knows when to activate
3. **Provide working examples**: Use real API endpoints, real commands, real output formats
4. **Keep it focused**: One skill = one capability. Don't combine unrelated features.
5. **Include rate limits and auth**: If the API needs keys or has limits, document them clearly
6. **Use code blocks liberally**: Agents learn best from concrete examples

## Security Requirements

The marketplace runs automated security scans. Your package will be rejected if it contains:

- **Hardcoded API keys or secrets** — Use environment variables instead
- **eval(), new Function(), or exec()** — No dynamic code execution
- **Prompt injection patterns** — No "ignore previous instructions" or role hijacking
- **Malicious code** — Every package is scanned by VirusTotal (70+ engines)
- **Missing SKILL.md** — The file is required with valid frontmatter

## Packaging

```bash
# Create the package archive
cd /path/to/my-skill
tar czf my-skill-1.0.0.tar.gz -C /path/to my-skill/

# Verify contents
tar tzf my-skill-1.0.0.tar.gz
```

Maximum file size: **5MB**. Accepted formats: `.tar.gz`, `.tgz`, `.zip`

## Submission

### Via Marketplace Website

1. Go to [marketplace.argentos.ai/submit](https://marketplace.argentos.ai/submit)
2. Log in with GitHub
3. Upload your `.tar.gz` file
4. Fill in display name, description, and category
5. Submit for review

### Via GitHub Issue

1. Open an issue at [github.com/ArgentAIOS/core](https://github.com/ArgentAIOS/core/issues/new)
2. Title: `[Marketplace] New Skill: my-skill-name`
3. Attach your `.tar.gz` package
4. Include description and category

## Review Process

1. **Automated scan** — VirusTotal + custom security checks
2. **Manual review** — ArgentOS team verifies quality and usefulness
3. **Published** — Appears in marketplace with "Approved" badge

## Categories

| Category    | Use For                             |
| ----------- | ----------------------------------- |
| `skills`    | AI agent capabilities (most common) |
| `plugins`   | System-level extensions             |
| `bundles`   | Collections of related skills       |
| `templates` | Project or workflow templates       |

## Example: Creating a Weather Skill

```bash
mkdir weather-forecast && cd weather-forecast
```

Create `SKILL.md`:

````markdown
---
name: weather-forecast
description: Get weather forecasts using the Open-Meteo API. Use when the user asks about weather, temperature, rain, or forecasts for any location.
---

# Weather Forecast

Get current weather and forecasts using the free Open-Meteo API (no API key required).

## When to Use

- User asks "What's the weather in Austin?"
- User asks about temperature, rain, snow, or forecasts
- User needs weather data for planning

## API

Base URL: `https://api.open-meteo.com/v1/forecast`

\```bash

# Current weather for Austin, TX

curl -s "https://api.open-meteo.com/v1/forecast?latitude=30.27&longitude=-97.74&current_weather=true" | jq .current_weather
\```

## Geocoding

Use Open-Meteo geocoding to convert city names to coordinates:

\```bash
curl -s "https://geocoding-api.open-meteo.com/v1/search?name=Austin&count=1" | jq '.results[0] | {name, latitude, longitude, country}'
\```
````

Package and submit:

```bash
cd ..
tar czf weather-forecast-1.0.0.tar.gz weather-forecast/
# Upload at marketplace.argentos.ai/submit
```
