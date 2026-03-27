# aos-nanob — Agent-Native Gemini Image Generation CLI

## What It Does

aos-nanob is a Click-based Python CLI for generating and editing images using Google Gemini (Imagen 3 and Gemini Flash). It follows the aos-\* agent harness pattern with JSON envelope output, permission modes, and structured error handling.

## Required Environment

```bash
export GEMINI_API_KEY="your-api-key"
```

## Installation

```bash
cd agent-harness
pip install -e .
```

## Commands

### Health & Discovery

```bash
# Check API key and connectivity
aos-nanob --json health

# List all commands and required permission modes
aos-nanob --json capabilities

# List available image models
aos-nanob --json --mode readonly models
```

### Image Generation

```bash
# Basic text-to-image (Gemini Flash, default)
aos-nanob --json --mode write generate "a photorealistic cat on a windowsill"

# With options
aos-nanob --json --mode write generate "mountain landscape" \
  --aspect 16:9 --size 2K --model pro --seed 42 \
  --negative "blurry, watermark" --save-prompt

# Multiple images
aos-nanob --json --mode write generate "abstract art" --number-of-images 4

# Custom output path
aos-nanob --json --mode write generate "logo design" --output ./my-logo.png
```

### Image Editing

```bash
# Edit an existing image with an instruction
aos-nanob --json --mode write edit ./photo.png "make the sky more dramatic"
```

### Prompt Builder (Interactive)

```bash
# Generic prompt builder
aos-nanob --json prompt

# With preset questionnaire
aos-nanob --json prompt --type influencer
aos-nanob --json prompt --type product
aos-nanob --json prompt --type thumbnail
aos-nanob --json prompt --type scene
aos-nanob --json prompt --type motion

# Save prompt to file
aos-nanob --json prompt --type product --save my-product-shot
```

### Batch Generation

```bash
# Generate from a directory of JSON prompt files
aos-nanob --json --mode write batch ./prompts/ --model pro --aspect 16:9
```

### Session Management

```bash
# Create a session to track related generations
aos-nanob --json --mode write sessions create "brand-shoot"

# List sessions
aos-nanob --json sessions list

# Generate with session tracking
aos-nanob --json --mode write generate "product photo" --session brand-shoot
```

## Models

| Flag                      | Model                                     | API              | Best For                                 |
| ------------------------- | ----------------------------------------- | ---------------- | ---------------------------------------- |
| `--model flash` (default) | gemini-2.0-flash-preview-image-generation | generate_content | Fast generation, text+image mixed output |
| `--model pro`             | imagen-3.0-generate-002                   | generate_images  | Highest quality, native negative prompts |

## Presets

| Preset       | Use Case                          | Key Fields                                |
| ------------ | --------------------------------- | ----------------------------------------- |
| `influencer` | Social media content              | person, setting, aesthetic, platform      |
| `product`    | Product photography               | item, surface, lighting, angle, lifestyle |
| `thumbnail`  | YouTube/video thumbnails          | topic, emotion, text overlay, style       |
| `scene`      | Cinematic landscapes/environments | location, time, weather, mood, subjects   |
| `motion`     | Action/dynamic shots              | subject, action, speed, blur, perspective |

## Output Paths

- Images: `~/.argentos/nanob/output/nanob_YYYYMMDD_HHMMSS_<hash>.png`
- Prompts: `~/.argentos/nanob/prompts/<name>.json`
- Sessions: `~/.argentos/nanob/sessions/<name>.json`

## Permission Modes

| Mode       | Allows                                                   |
| ---------- | -------------------------------------------------------- |
| `readonly` | health, capabilities, models, prompt, sessions list/show |
| `write`    | generate, edit, batch, sessions create                   |
| `full`     | all write + future admin features                        |
| `admin`    | everything                                               |

## JSON Envelope

All `--json` output follows the standard envelope:

```json
{
  "ok": true,
  "tool": "aos-nanob",
  "command": "generate",
  "data": { ... },
  "meta": {
    "mode": "write",
    "duration_ms": 3421,
    "timestamp": "2026-03-15T...",
    "version": "0.1.0"
  }
}
```
