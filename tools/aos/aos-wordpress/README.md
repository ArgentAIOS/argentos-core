# aos-wordpress

`aos-wordpress` is a first-pass agent-native WordPress connector scaffold.

- Backend: `wordpress-rest`
- Interface: stable `aos-*` CLI contract
- Security: permission-gated operations by `--mode`
- Output: structured JSON envelopes

This scaffold is intentionally limited to the new vendored connector directory.
It establishes the manifest, harness, and initial publishing-domain command
shape without wiring shared registries elsewhere in ArgentOS.

## Planned Connector Surface

Resources:

- `site`
- `post`
- `page`
- `media`
- `comment`

Worker-facing patterns:

- draft-to-publish post workflows
- editorial page updates
- media library inspection
- comment queue review and reply

## Auth Model

The first pass targets the WordPress REST API using:

- site URL
- username + application password

Optional bearer-token auth is also scaffolded for sites that use a JWT or
plugin-backed token flow.

## Install (development)

```bash
cd tools/aos/aos-wordpress/agent-harness
python3 -m pip install -e '.[dev]'
aos-wordpress --help
```

## Examples

```bash
aos-wordpress --json capabilities
aos-wordpress --json health
aos-wordpress --json --site-url https://example.com config show
aos-wordpress --json --site-url https://example.com site info
aos-wordpress --json --site-url https://example.com post list --status draft
```

## Scope Notes

The expected operator scope for this connector is:

- site / tenant
- content type
- status filter
- author or editorial subset where relevant

Publishing and moderation actions exist in the scaffold, but operators should
keep them review-gated in worker policy.
