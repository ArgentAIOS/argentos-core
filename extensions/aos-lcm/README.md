# aos-lcm — Lossless Context Management

DAG-based context compression for ArgentOS. Never loses a message.

Adapted from [Voltropy PBC / Martian Engineering's LCM architecture](https://github.com/Martian-Engineering/lossless-claw) (MIT license).

## What It Does

Replaces flat compaction with a hierarchical summarization DAG:

- **Every message is persisted** in an immutable SQLite store
- **Old messages are summarized** into leaf nodes (~1200 tokens each)
- **Leaf summaries are condensed** into higher-depth nodes as they accumulate
- **Any summary can be expanded** back to its original messages
- **Three-level escalation** guarantees compaction always converges
- **Large files** (>25K tokens) are stored externally with exploration summaries

## Agent Tools

| Tool                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `aos_lcm_grep`         | Full-text search across entire conversation history |
| `aos_lcm_describe`     | Inspect a specific message or summary by ID         |
| `aos_lcm_expand_query` | Expand a summary back to its source messages        |

## Configuration

In `argent.json`:

```json
{
  "plugins": {
    "config": {
      "aos-lcm": {
        "enabled": true,
        "freshTailCount": 32,
        "contextThreshold": 0.75,
        "summaryModel": "auto"
      }
    }
  }
}
```

## Status

**Phase 1 (Scaffold)** — complete. Core data structures, stores, compaction engine, tools, and plugin hooks are implemented.

**Phase 2 (Integration)** — pending. Completion bridge needs wiring to ArgentOS model router. Message pipeline ingestion hooks need gateway integration.

## Attribution

LCM is the work of Clint Ehrlich and Theodore Blackman at Voltropy PBC. The lossless-claw OpenClaw plugin is MIT licensed. This port maintains full attribution. The ArgentOS adaptation adds integration with our gateway, model router, tool system, and plugin architecture.

Paper: https://voltropy.com/LCM
Original: https://github.com/Martian-Engineering/lossless-claw
