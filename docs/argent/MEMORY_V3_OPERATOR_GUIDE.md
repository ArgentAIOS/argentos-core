# Memory V3 Operator Guide

**Audience:** ArgentOS operator  
**Status:** Current implementation guide  
**Updated:** March 12, 2026

## 1. What exists right now

Memory V3 adds three operator-visible layers on top of the existing MemU system:

1. **Vault source**
   - A folder of markdown files on disk.
   - Argent can ingest that folder into the knowledge library.
   - Obsidian is optional. It is just a markdown editor/viewer over the same folder.

2. **Knowledge library**
   - Argent's indexed retrieval store.
   - Vault notes are imported here through `knowledge.vault.ingest`.
   - This is what Argent searches directly after ingest.

3. **Cognee graph retrieval**
   - A supplemental relationship-retrieval path.
   - Used only when enabled and when the retrieval gates say it is worth trying.
   - If Cognee fails, Argent falls back to normal MemU recall behavior.

## 2. What is still the source of truth

The source of truth is **not** the graph.

Current truth model:

- **MemU** = operational memory
- **Vault markdown** = durable human-authored source material
- **Knowledge library** = indexed retrieval copy of ingested material
- **Cognee graph** = derived relationship layer for better structural recall

That means the graph is useful, but it is not allowed to become the only memory substrate.

## 3. What Obsidian actually is

Obsidian always opens a folder on disk. A “vault” is just:

- a directory containing `.md` files
- plus optional `.obsidian/` settings files

So if you use Obsidian with ArgentOS, you point Obsidian at the same folder that Argent uses as `memory.vault.path`.

Important:

- Obsidian does **not** have to be running for Argent to use the vault.
- Argent reads the markdown files directly from the filesystem.

## 4. Current write paths

### MemU growth

MemU continues to grow from Argent’s normal runtime behavior:

- chat/session memory
- actions and tool use
- contemplation outputs
- normal memory extraction flows

### Vault ingest growth

Vault content grows when:

- you edit or add markdown files in the configured vault path
- you run `knowledge.vault.ingest`
- or scheduled vault ingest is enabled

That writes the vault content into Argent’s knowledge library as `memoryType="knowledge"` items with:

- `extra.source = "vault"`
- `extra.vaultPath = <relative markdown path>`

### Graph/discovery growth

Today, the graph layer is used mainly as a **supplemental read path**, not a full autonomous write-master.

What is implemented now:

- `memory_recall` can call Cognee when enabled
- contemplation discovery can call Cognee after contemplation
- bounded discoveries are written back into MemU as:
  - `memoryType="knowledge"`
  - `extra.source = "contemplation_discovery"`

So the graph currently contributes by:

1. helping retrieve relationship-shaped context
2. feeding selected discoveries back into MemU

It does **not** yet operate as a full continuously maintained canonical graph pipeline over all memory.

## 5. Safety model

Memory V3 is intentionally gated.

### Default behavior

If the V3 features are off:

- MemU continues normally
- no Cognee retrieval runs
- no vault ingest runs unless explicitly called/enabled
- contemplation discovery is skipped

### Failure behavior

If Cognee retrieval fails:

- `memory_recall` still returns normal MemU results
- the error is surfaced in diagnostics
- the tool does not fail closed for standard recall

If the strict V3 embedding contract is enabled and the ingest/embedding path fails:

- the V3 path fails closed as designed
- the operator gets a visible error instead of silent corruption

## 6. Recommended operator setup

### Best default

Use an **Argent-managed internal vault** as the default product posture, even if the implementation is still path-driven today.

Recommended product model:

1. **Internal vault**
   - created and owned by Argent
   - safe default for operators who do not already use Obsidian

2. **External vault**
   - operator attaches an existing Obsidian vault path
   - optional, not mandatory

3. **Hybrid**
   - internal Argent vault plus attached external vault
   - useful later, once operator controls are mature

Current implementation is still folder/path-based rather than a full internal/external vault manager, so the dashboard currently asks for a direct vault path.

## 7. What the dashboard should tell the operator

The operator should be able to answer these questions without reading code:

1. Is vault ingest enabled?
2. Which folder is the vault path?
3. Which knowledge collection receives vault notes?
4. Is Cognee enabled?
5. When will Cognee run?
6. Is discovery phase enabled?
7. What happens if Cognee fails?
8. What is canonical versus derived?

The dashboard memory panel should expose:

- vault enable/path/collection/ingest controls
- create/bind internal Argent vault controls
- Cognee enable/retrieval controls
- contemplation discovery controls
- AOS/GWS readiness checks for imported external tooling
- health and fallback messaging
- last-run visibility for ingest/discovery in a future pass

## 8. Practical answer to “where does the knowledge graph live?”

For the current system, the right answer is:

- the **vault** lives in a markdown folder on disk
- the **knowledge library** lives in Argent’s indexed storage layer
- the **graph behavior** is provided through the Cognee/AOS retrieval path

Do not think of the graph as “living in Obsidian.”

Obsidian is content editing.  
The graph is a derived reasoning layer.

## 9. Current operator guidance

If you want to use Obsidian today:

1. Choose or create a markdown folder.
2. Point Obsidian at that folder.
3. Set that same absolute path in `memory.vault.path`.
4. Enable vault ingest if you want scheduled import.
5. Run a preview ingest first.
6. Run a real ingest after preview looks correct.
7. Enable Cognee retrieval only after you are comfortable with the vault and fallback behavior.

## 10. What is still missing

These are not regressions. They are the next maturity steps after the current operator panel:

- tool-registry policy mapping for imported AOS permissions
- graph health/status panel
- richer discovery metrics and dedupe tuning
- explicit internal-vault lifecycle management from the dashboard
- graph browser / relationship viewer

## 11. AOS / Google Workspace readiness

The imported `aos-google` tooling is not part of MemU itself, but it is now surfaced in the same
operator area because it affects whether supplemental external tooling is actually usable.

Current model:

- the dashboard can run an `aos-google` readiness preflight
- onboarding can now run the same readiness check and optionally attempt remediation
- missing `gws` does **not** break core memory
- missing `gws` simply means the Google Workspace AOS lane is not ready yet

That distinction matters:

- **Memory V3** can still work without Google Workspace tooling
- **AOS Google tooling** is a separate capability family with its own readiness requirements

## 12. Bottom line

Memory V3 is safe to adopt incrementally because:

- MemU remains the primary memory system
- the vault is just markdown on disk
- the graph is supplemental, not canonical
- fallback behavior keeps recall alive even if Cognee is unavailable

That is the right architecture for ArgentOS at this stage.
