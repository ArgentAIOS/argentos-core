---
name: argentos-security-audit
description: Security audit procedures for ArgentOS marketplace packages. Use when scanning packages, reviewing submissions, auditing for prompt injection, checking VirusTotal results, approving marketplace submissions, or when anyone mentions "security scan", "VT scan", "prompt injection", "audit package", "review submission", or "marketplace security".
---

# ArgentOS Security Audit

Three-layer security model for every marketplace package.

## The Three Layers

| Layer                 | Tool                  | What It Checks                            |
| --------------------- | --------------------- | ----------------------------------------- |
| 1. VirusTotal         | 70+ antivirus engines | Malware, trojans, viruses, PUPs           |
| 2. ArgentOS AI Safety | Custom regex scanner  | Prompt injection, secrets, dangerous code |
| 3. Manual Review      | Human (admin panel)   | Quality, usefulness, correctness          |

## Layer 1: VirusTotal

**API:** `https://www.virustotal.com/api/v3`
**Rate limit:** 4 uploads/min, 500/day (free tier)
**Key:** stored in Railway env as `VIRUSTOTAL_API_KEY`

### How it works

1. Package file uploaded to VT `/files` endpoint
2. Poll `/analyses/{id}` every 15s until complete
3. Check `stats.malicious` and `stats.suspicious`
4. Store permalink: `https://www.virustotal.com/gui/file/{sha256}`

### Interpreting results

- **0 malicious, 0 suspicious** → Clean (badge: "VT Scanned")
- **Any malicious or suspicious** → Flagged (hold for manual review)
- **Timeout** → Error (re-scan later)

Every package's VT badge links to the actual scan report. Not a claim — a verifiable link.

### Bulk scanning all packages

```bash
cd /Users/sem/code/argent-marketplace
DATABASE_URL="..." bun scripts/scan-all-packages.ts
```

Rate-limited at 1 per 16s. ~30 min for 54 packages.

## Layer 2: ArgentOS AI Safety Scanner

**Location:** `apps/api/src/scanner/custom-scan.ts`

### Checks performed

**SKILL.md validation:**

- File exists (skip macOS `._` resource forks)
- YAML frontmatter present (`---` delimiters)
- `name` field in frontmatter
- `description` field in frontmatter

**Prompt injection detection (25 patterns):**

Instruction override:

- Ignore/override/disregard previous instructions
- New instructions claims

Role hijacking:

- DAN jailbreak, persona switch, unrestricted mode
- Identity override, role reassignment

System prompt extraction:

- Print/show/reveal prompt attempts
- "What are your instructions" patterns

Hidden instructions:

- HTML comment injection
- Zero-width characters (3+ consecutive)
- Base64 encoded instructions
- Unicode escape obfuscation

Data exfiltration:

- URLs in send/post/upload/transmit context
- Webhook injection (fetch/curl to non-allowlisted domains)
- Credential harvesting language

Privilege escalation:

- Admin/root grant attempts
- Auth bypass language

Destructive operations:

- rm -rf / delete all patterns
- System command injection

Social engineering:

- User impersonation ("pretend the user said")
- Trust exploitation ("user already approved")
- Urgency manipulation ("emergency override")

**Secret detection:**

- AWS Access Keys (`AKIA...`)
- AWS Secret Keys
- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
- Anthropic API keys (`sk-ant-`)
- OpenAI API keys (`sk-`)
- Slack tokens (`xox[bpras]-`)
- Private keys (`-----BEGIN PRIVATE KEY-----`)
- Generic API key patterns

**Dangerous code:**

- `eval()` usage
- `new Function()` constructor
- `exec()` shell commands
- `child_process` imports
- Large base64 `atob()` calls

**File size:** Max 5MB total content.

### Archive extraction

The scanner decompresses `.tar.gz` files before scanning:

1. `zlib.gunzip()` to decompress
2. Parse tar headers (512-byte blocks)
3. Extract each file's content
4. Filter out macOS `._` resource forks
5. Scan extracted text files

## Layer 3: Manual Review

**Admin panel:** `https://marketplace.argentos.ai/admin` → Submissions

### Review checklist

- [ ] VT scan clean (click permalink to verify)
- [ ] Custom scan passed (check individual check results)
- [ ] SKILL.md has valid frontmatter with name + description
- [ ] Description accurately describes what the skill does
- [ ] No obvious quality issues
- [ ] Category is correct
- [ ] Author GitHub profile exists

### Approve

Click Approve → creates package in marketplace with VT permalink + argentos_scan_status.

### Reject

Click Reject → enter reason → submitter sees the reason on their submission page.

## Admin Notifications

When a submission scan completes, an email is sent to `ADMIN_EMAIL` (default: `marketplace@argentos.ai`) with:

- Package name and author
- VT status (clean/flagged)
- Custom scan status (passed/flagged)
- "Review in Admin" button

## Submission Flow (User Perspective)

1. Log in with GitHub at marketplace.argentos.ai
2. Click Submit a Skill → upload .tar.gz + metadata
3. Status: `scanning` → VT + custom scans run async
4. Status: `review` (if passed) or stays `scanning` (if VT slow)
5. Admin reviews and approves/rejects
6. If approved: package appears in catalog with badges
7. If rejected: reason shown, resubmit button available

## Resubmit Flow

Submissions in review/rejected/scanning can be resubmitted:

1. Go to submission detail page
2. Upload new .tar.gz
3. All scan results reset
4. Scans run again from scratch
