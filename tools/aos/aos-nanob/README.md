# aos-nanob

Agent-native CLI for Google Gemini image generation (Imagen 3 + Gemini Flash).

Part of the `aos-*` agent CLI tools family.

## Quick Start

```bash
export GEMINI_API_KEY="your-key"
cd agent-harness
pip install -e .
aos-nanob --json --mode write generate "a sunset over the ocean"
```

## Features

- Text-to-image generation via Gemini Flash or Imagen 3
- Image editing with natural language instructions
- Interactive prompt builder with 5 preset templates
- Batch generation from JSON prompt directories
- Session tracking for related generations
- JSON envelope output for agent integration
- Permission mode enforcement (readonly/write/full/admin)

## Documentation

See [CLAUDE.md](./CLAUDE.md) for full command reference and integration details.
