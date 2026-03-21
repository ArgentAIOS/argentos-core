# Thread D — Org Plugin Isolation

Branch: codex/thread-d-org-plugin-isolation

## Build

1. Separate core-global plugin load path from org-scoped plugin load path.
2. Mark Titanium MSP tools as org-scoped examples.
3. Add loader guard to prevent org plugins from auto-loading globally.
4. Document marketplace org policy and onboarding flow.

## Tests

- Core install does not load org-only plugins.
- Org license/config enables org plugin set.
- Missing org entitlement fails closed.

## Deliverable

- Commit SHA
- Files changed
- Test results
- Updated operator docs path
