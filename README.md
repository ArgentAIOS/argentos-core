# ArgentOS Core Staging

This repo is the staging mirror for the eventual public `argentos-core` release.

Current status:

- private
- generated from `/Users/sem/code/argentos`
- synced by manifest, not by day-to-day development

Workflow:

1. make changes in the private source repo
2. update `/Users/sem/code/argentos-core/public-core.manifest.json`
3. update `/Users/sem/code/argentos/docs/argent/public-core-denylist.json` when the public-safe boundary changes
4. run the exporter from the private repo
5. review the staged mirror here
6. only make this repo public after the boundary audit is complete

Exporter:

```bash
cd /Users/sem/code/argentos
node --import tsx scripts/export-public-core.ts --manifest /Users/sem/code/argentos-core/public-core.manifest.json
node --import tsx scripts/export-public-core.ts --manifest /Users/sem/code/argentos-core/public-core.manifest.json --apply
```

Current boundary model:

- `include` captures the broad Core staging surface
- `exclude` removes local junk and obviously private artifacts
- `denylistFiles` enforces the conservative public-safe denylist from the private repo

Boundary references in the private repo:

- `/Users/sem/code/argentos/docs/argent/public-core-denylist.json`
- `/Users/sem/code/argentos/docs/argent/public-core-surface-contract.json`
- `/Users/sem/code/argentos/docs/argent/PUBLIC_CORE_SURFACE_CONTRACT.md`
