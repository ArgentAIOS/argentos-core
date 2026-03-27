# aos-supabase

Agent-native Supabase connector for table storage, RPC, and file storage.

This connector provides live read and write access to Supabase projects via the PostgREST and Storage APIs:

- `table.select` queries rows from any table with optional filters.
- `table.insert`, `table.update`, `table.delete` perform row mutations.
- `rpc.call` invokes server-side Postgres functions.
- `storage.list`, `storage.upload`, `storage.download` manage files in storage buckets.
- `project.info` reads project health metadata.

## Auth

The connector requires two environment variables:

- `SUPABASE_URL` — the project URL (e.g. `https://xxx.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY` — the service role secret from Settings > API.

Optional scope hints:

- `SUPABASE_ANON_KEY` — use anon-level access instead of service role.
- `SUPABASE_TABLE` — default table for table operations.
- `SUPABASE_BUCKET` — default bucket for storage operations.

## Live Reads

The harness uses Supabase PostgREST endpoints for table queries and the Storage API for bucket listing and file downloads. If credentials are present but the backend rejects requests, `health` and `doctor` report the API failure.

## Writes

Write commands (`table.insert`, `table.update`, `table.delete`, `rpc.call`, `storage.upload`) perform live mutations when mode is set to `write` or higher. Use `readonly` mode to restrict to read-only operations.
