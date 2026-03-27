# aos-wordpress

Agent-native WordPress publishing connector with live REST connectivity.

## Generated From ArgentOS

- System: WordPress
- Category: marketing-publishing
- Backend: wordpress-rest-api
- Target root: /Users/sem/code/argentos-connector-runtime-pack-20260318/tools/aos

## Commands

- `health` (readonly)
- `doctor` (readonly)
- `config.show` (readonly)
- `site.read` (readonly)
- `post.list` (readonly)
- `post.search` (readonly)
- `post.read` (readonly)
- `post.create_draft` (write)
- `post.update_draft` (write)
- `post.schedule` (write)
- `post.publish` (write)
- `page.list` (readonly)
- `page.search` (readonly)
- `page.read` (readonly)
- `page.create_draft` (write)
- `page.update_draft` (write)
- `page.publish` (write)
- `media.list` (readonly)
- `media.upload` (write)
- `taxonomy.list` (readonly)
- `taxonomy.assign_terms` (write)

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - WORDPRESS_BASE_URL
  - WORDPRESS_USERNAME
  - WORDPRESS_APPLICATION_PASSWORD
- Interactive setup:
  - Create a dedicated WordPress service user on the target site.
  - Generate an Application Password for that user.
  - Add WORDPRESS_BASE_URL, WORDPRESS_USERNAME, and WORDPRESS_APPLICATION_PASSWORD in API Keys.
  - Restrict post types, status transitions, taxonomy scope, and media usage before going live.

## Next Steps

1. Install dependencies with `python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'`.
2. Set `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, and `WORDPRESS_APPLICATION_PASSWORD`.
3. Verify `aos-wordpress --json health`, `aos-wordpress --json config show`, and `aos-wordpress --json doctor`.
4. Use the live post path: `post list`, `post search`, `post read`, `post create_draft`, `post update_draft`, `post schedule`, and `post publish`.
