# aos-wordpress

Agent-native WordPress REST connector for site checks, posts, pages, media, and taxonomy.

## Generated From ArgentOS

- System: WordPress
- Category: marketing-publishing
- Backend: wordpress-rest-api

## Actions

### Site

| Action        | Mode     | Description                                     |
| ------------- | -------- | ----------------------------------------------- |
| `health`      | readonly | Check WordPress connectivity and auth readiness |
| `doctor`      | readonly | Run a detailed WordPress runtime diagnosis      |
| `config.show` | readonly | Show redacted connector config                  |
| `site.read`   | readonly | Read site metadata and authenticated user       |

### Posts

| Action              | Mode     | Description                       |
| ------------------- | -------- | --------------------------------- |
| `post.list`         | readonly | List posts                        |
| `post.search`       | readonly | Search posts                      |
| `post.read`         | readonly | Read a post by ID                 |
| `post.create_draft` | write    | Create a draft post               |
| `post.update_draft` | write    | Update a draft post               |
| `post.schedule`     | write    | Create or update a scheduled post |
| `post.publish`      | write    | Publish an approved post by ID    |

### Pages

| Action              | Mode     | Description                    |
| ------------------- | -------- | ------------------------------ |
| `page.list`         | readonly | List pages                     |
| `page.search`       | readonly | Search pages                   |
| `page.read`         | readonly | Read a page by ID              |
| `page.create_draft` | write    | Create a draft page            |
| `page.update_draft` | write    | Update a draft page            |
| `page.publish`      | write    | Publish an approved page by ID |

### Media

| Action         | Mode     | Description                  |
| -------------- | -------- | ---------------------------- |
| `media.list`   | readonly | List media library items     |
| `media.upload` | write    | Upload a local file to media |

### Taxonomy

| Action                  | Mode     | Description                           |
| ----------------------- | -------- | ------------------------------------- |
| `taxonomy.list`         | readonly | List categories and tags              |
| `taxonomy.assign_terms` | write    | Assign category or tag IDs to content |

## Fields

| Field          | Type   | Description                                           |
| -------------- | ------ | ----------------------------------------------------- |
| `site_url`     | string | WordPress site URL                                    |
| `post_id`      | number | Post ID for read, update, schedule, publish, taxonomy |
| `page_id`      | number | Page ID for read, update, publish, taxonomy           |
| `title`        | string | Title for draft or scheduled content                  |
| `content`      | string | HTML or block content body                            |
| `excerpt`      | string | Optional excerpt                                      |
| `slug`         | string | Optional URL slug                                     |
| `publish_at`   | string | RFC3339 date/time for scheduled posts                 |
| `search_query` | string | Search term for listing/searching                     |
| `status`       | string | Optional post/page status filter                      |
| `per_page`     | number | Results per page                                      |
| `media_file`   | string | Local file path for media upload                      |
| `media_type`   | string | Optional media type filter such as `image`            |
| `mime_type`    | string | Optional MIME type filter or upload content type      |
| `category_ids` | string | Comma-separated category IDs                          |
| `tag_ids`      | string | Comma-separated tag IDs                               |

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - `WORDPRESS_BASE_URL` -- Full site URL, for example `https://example.com`
  - `WORDPRESS_USERNAME` -- dedicated WordPress service user
  - `WORDPRESS_APPLICATION_PASSWORD` -- WordPress Application Password
- Setup:
  1. Create a dedicated WordPress service user on the target site.
  2. Generate an Application Password for that user from Users > Profile > Application Passwords.
  3. Add `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, and `WORDPRESS_APPLICATION_PASSWORD` in operator-controlled service keys.
  4. Restrict post types, status transitions, taxonomy scope, and media usage before going live.

This connector has real REST read and write paths, but production live-write smoke is not claimed until tested against an operator WordPress site.

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

aos-wordpress --json health
aos-wordpress --json doctor
aos-wordpress --json site read
aos-wordpress --json post list
aos-wordpress --json --mode write post create_draft --title "My Post" --content "<p>Hello</p>"
aos-wordpress --json --mode write media upload /path/to/image.jpg title=Hero alt_text="Hero image"
aos-wordpress --json --mode write taxonomy assign_terms post_id=123 categories=3,4 tags=8
```
