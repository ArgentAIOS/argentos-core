---
name: argentos-repo-inventory
description: Complete inventory of ArgentOS repos, databases, services, and infrastructure. Use when asking "which repo", "where does X live", "what database", "what table", "which service", "what port", "what env var", or when needing to understand the relationship between repos, services, and data.
---

# ArgentOS Repository & Infrastructure Inventory

## Repos

| Repo               | GitHub                            | Agent  | Stack                           | Deploy          |
| ------------------ | --------------------------------- | ------ | ------------------------------- | --------------- |
| argentos           | ArgentAIOS/argentos (private)     | Codex  | TypeScript, 90K+ LOC            | Local gateway   |
| argentos-core      | ArgentAIOS/argentos-core (public) | Codex  | Exported from argentos          | npm / installer |
| argentos.ai        | ArgentAIOS/argentos.ai            | Claude | React + Vite + Express          | Railway         |
| argent-marketplace | ArgentAIOS/Marketplace            | Claude | React + Vite + Express monorepo | Railway         |
| argent-docs        | ArgentAIOS/docs                   | Claude | Fumadocs + Next.js 15           | Railway         |

## Database — Railway PostgreSQL

**Host:** `caboose.proxy.rlwy.net:53346`
**Shared by:** argentos.ai + argent-marketplace (same Railway DB)

### argentos.ai tables

| Table                 | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `blog_articles`       | Blog posts (Prisma)                                                 |
| `edu_*` (7 tables)    | Education LMS — modules, lessons, questions, progress, certificates |
| `analytics_sessions`  | Custom analytics sessions                                           |
| `analytics_events`    | Page views, durations                                               |
| `analytics_downloads` | Tracked install.sh downloads                                        |
| `contacts`            | Newsletter/waitlist signups — email, name, source, tags, status     |
| `email_campaigns`     | Newsletter sends                                                    |
| `email_sends`         | Per-recipient send records                                          |

### argent-marketplace tables

| Table                    | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `packages`               | 54+ marketplace packages — name, description, VT scan, badges |
| `package_versions`       | Semver versions per package                                   |
| `submissions`            | User-submitted packages with scan results                     |
| `licenses`               | License keys for paid packages                                |
| `license_activations`    | Activation records                                            |
| `organizations`          | Enterprise orgs                                               |
| `organization_packages`  | Org-scoped private packages                                   |
| `organization_secrets`   | Encrypted org secrets                                         |
| `organization_instances` | Instance-to-org membership                                    |
| `registered_instances`   | ArgentOS instance registry                                    |
| `package_reports`        | Community reports on packages                                 |

### argentos local (SQLite)

| Database     | Path                          | Purpose                             |
| ------------ | ----------------------------- | ----------------------------------- |
| memory.db    | ~/.argentos/memory.db         | MemU persistent memory (12.5K+ LOC) |
| dashboard.db | ~/.argentos/data/dashboard.db | Tasks, projects, canvas docs        |

## Cloudflare R2

**Bucket:** `argentos-licensing-marketplace`
**Prefixes:**

- `packages/` — marketplace .argent-pkg files
- `blog/` — blog post images
- `submissions/` — uploaded submission files

## Railway Services

| Service               | Domain                  | Port |
| --------------------- | ----------------------- | ---- |
| argentos.ai           | argentos.ai             | 3000 |
| marketplace API + web | marketplace.argentos.ai | 8080 |
| docs                  | docs.argentos.ai        | 3000 |

## Key Environment Variables

### argentos.ai (Railway)

```
DATABASE_URL, RESEND_API_KEY, ADMIN_PASSWORD, ADMIN_API_KEY,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME,
GEMINI_API_KEY, GOOGLE_ANALYTICS_ID
```

### argent-marketplace (Railway)

```
DATABASE_URL, JWT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
VIRUSTOTAL_API_KEY, AUTO_APPROVE_ON_SCAN_PASS, RESEND_API_KEY,
ADMIN_API_KEY, ADMIN_EMAIL, R2_ACCOUNT_ID (triggers R2 storage mode)
```

## External Services

| Service      | Purpose                          | Key Location               |
| ------------ | -------------------------------- | -------------------------- |
| Resend       | Transactional email              | Railway env                |
| VirusTotal   | Package scanning (free, 500/day) | Railway env                |
| GitHub OAuth | Marketplace login                | Railway env                |
| Context7     | Docs AI indexing                 | context7.json in docs repo |
| Linear       | Project tracking                 | Claude MCP config          |
| CodeRabbit   | PR review                        | GitHub org level           |
| Blacksmith   | CI runners                       | GitHub Actions             |

## Ports (Local Development)

| Service             | Port  |
| ------------------- | ----- |
| ArgentOS Gateway    | 18789 |
| PostgreSQL (local)  | 5433  |
| Redis (local)       | 6380  |
| argentos.ai dev     | 3000  |
| marketplace web dev | 5173  |
| marketplace API dev | 3100  |
| docs dev            | 3000  |

## DNS

| Domain                  | Points To                          |
| ----------------------- | ---------------------------------- |
| argentos.ai             | Railway                            |
| marketplace.argentos.ai | Railway                            |
| docs.argentos.ai        | Railway                            |
| argentos.ai/install.sh  | Express route → scripts/install.sh |
