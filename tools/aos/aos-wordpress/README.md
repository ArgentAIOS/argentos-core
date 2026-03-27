# aos-wordpress

Agent-native WordPress connector with full CRUD, comment moderation, and form submission support.

## Generated From ArgentOS

- System: WordPress
- Category: marketing-publishing
- Backend: wordpress-rest-api

## Actions

### Posts

| Action        | Mode     | Description                                            |
| ------------- | -------- | ------------------------------------------------------ |
| `post.list`   | readonly | List posts with optional category/tag/search filtering |
| `post.get`    | readonly | Get a single post by ID                                |
| `post.create` | write    | Create a new post (draft or published)                 |
| `post.update` | write    | Update an existing post by ID                          |
| `post.delete` | write    | Delete a post by ID (moves to trash)                   |

### Pages

| Action        | Mode     | Description                               |
| ------------- | -------- | ----------------------------------------- |
| `page.list`   | readonly | List pages with optional search filtering |
| `page.get`    | readonly | Get a single page by ID                   |
| `page.create` | write    | Create a new page (draft or published)    |
| `page.update` | write    | Update an existing page by ID             |

### Media

| Action         | Mode     | Description                        |
| -------------- | -------- | ---------------------------------- |
| `media.list`   | readonly | List media library items           |
| `media.upload` | write    | Upload a file to the media library |

### Comments

| Action             | Mode     | Description                                       |
| ------------------ | -------- | ------------------------------------------------- |
| `comment.list`     | readonly | List comments with optional post/status filtering |
| `comment.create`   | write    | Create a new comment on a post                    |
| `comment.moderate` | write    | Moderate a comment (approve, hold, spam, trash)   |

### Taxonomy

| Action          | Mode     | Description         |
| --------------- | -------- | ------------------- |
| `category.list` | readonly | List all categories |
| `tag.list`      | readonly | List all tags       |

### Users

| Action      | Mode     | Description             |
| ----------- | -------- | ----------------------- |
| `user.list` | readonly | List WordPress users    |
| `user.get`  | readonly | Get a single user by ID |

### Forms (WPForms / GravityForms / CF7)

| Action             | Mode     | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `form.list`        | readonly | List available forms from the configured form plugin |
| `form.submissions` | readonly | Get form submissions by form ID                      |

Form integration requires one of these plugins with REST API access enabled:

- **WPForms** (default) -- REST API available in Pro/Elite
- **GravityForms** -- REST API v2 built-in
- **Contact Form 7** (CF7) -- requires the [CF7 REST API](https://wordpress.org/plugins/contact-form-7-rest-api/) add-on

### Site

| Action        | Mode     | Description                                     |
| ------------- | -------- | ----------------------------------------------- |
| `site.info`   | readonly | Read site name, description, URL, and version   |
| `health`      | readonly | Check WordPress connectivity and auth readiness |
| `doctor`      | readonly | Run a detailed WordPress runtime diagnosis      |
| `config.show` | readonly | Show redacted connector config                  |

## Fields

| Field             | Type   | Description                                                            |
| ----------------- | ------ | ---------------------------------------------------------------------- |
| `site_url`        | string | WordPress site URL                                                     |
| `post_id`         | number | Post ID for single-item operations                                     |
| `page_id`         | number | Page ID for single-item operations                                     |
| `title`           | string | Title for posts or pages                                               |
| `content`         | string | HTML or block content body                                             |
| `status`          | string | Publication status: `draft`, `publish`, `pending`, `future`, `private` |
| `form_id`         | string | Form ID for submission retrieval                                       |
| `form_provider`   | string | Form plugin: `wpforms`, `gravityforms`, or `cf7`                       |
| `category`        | string | Category slug or ID for filtering                                      |
| `tag`             | string | Tag slug or ID for filtering                                           |
| `media_file`      | string | File path or URL for media upload                                      |
| `search_query`    | string | Search term for listing/filtering                                      |
| `per_page`        | number | Results per page (max 100, default 10)                                 |
| `comment_content` | string | Comment body text                                                      |
| `comment_status`  | string | Moderation status: `approved`, `hold`, `spam`, `trash`                 |

## Auth

- Kind: service-key
- Required: yes
- Service keys:
  - `WORDPRESS_BASE_URL` -- Full site URL (e.g. `https://example.com`)
  - `WORDPRESS_USERNAME` -- WordPress user with appropriate permissions
  - `WORDPRESS_APPLICATION_PASSWORD` -- Application Password (not the user's login password)
- Setup:
  1. Create a dedicated WordPress service user on the target site.
  2. Generate an Application Password for that user (Users > Profile > Application Passwords).
  3. Add `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, and `WORDPRESS_APPLICATION_PASSWORD` in API Keys.
  4. For form submissions, install the appropriate form plugin with REST API support.
  5. Restrict post types, status transitions, taxonomy scope, and media usage before going live.

## Quick Start

```bash
# Install
python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'

# Set credentials
export WORDPRESS_BASE_URL="https://example.com"
export WORDPRESS_USERNAME="service-bot"
export WORDPRESS_APPLICATION_PASSWORD="xxxx xxxx xxxx xxxx"

# Verify connectivity
aos-wordpress --json health
aos-wordpress --json doctor

# List posts
aos-wordpress --json post list

# Create a draft post
aos-wordpress --json post create --title "My Post" --content "<p>Hello</p>" --status draft

# Get form submissions
aos-wordpress --json form submissions --form-id 5 --form-provider wpforms
```
