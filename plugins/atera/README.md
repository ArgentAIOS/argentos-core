# Atera Plugin

RMM/PSA integration for ArgentOS — tickets, devices, customers, alerts, and automated operational intelligence.

## Overview

The Atera plugin provides comprehensive integration with Atera's RMM/PSA platform, enabling AI-powered MSP automation:

- **Ticket Management** — List, search, assign, update, close, comment
- **Device Monitoring** — Query agents, online status, customer filtering
- **Customer Database** — Search and lookup company records
- **Alert Monitoring** — Active system alerts across infrastructure
- **Operational Reports** — Team performance audits, customer health summaries

## Quick Start

### 1. Configure API Key

Add your Atera API key to `~/.argentos/.env`:

```bash
ATERA_API_KEY=your_api_key_here
```

Get your API key from: **Atera Portal → Admin → API**

### 2. Link Your Technician Account

The plugin needs your technician ID for assignment operations.

**Option A — Auto-detect** (recommended):

```bash
atera_setup action=auto_detect
```

**Option B — Manual lookup**:

```bash
atera_setup action=list_technicians
atera_setup action=link_technician technician_id=YOUR_ID
```

**Option C — Discovery script** (if auto-detect fails):

```bash
cd ~/.argentos/plugins/atera
export ATERA_API_KEY="your_api_key"
./scripts/discover-technicians.sh
```

See `scripts/README.md` for details on the discovery workaround.

### 3. Verify Connection

```bash
atera_tickets action=list status=open
```

## Tools

### `atera_tickets`

Query and search support tickets with server-side filtering.

**Actions:**

- `list` — List tickets (filter by status, customer, assignment)
- `search` — Full-text search across titles, descriptions, comments

**Filters:**

- `status` — open, in_progress, waiting, resolved, closed, all
- `customer_id` — Filter by specific customer
- `assigned_to_me` — Show only your tickets

**Enhanced formatting** (v1.1.0+):

- End user name and email
- Last customer reply + timestamp
- Last tech reply + timestamp
- SLA/duration tracking
- Ticket type and source
- Parent/child relationships

**Examples:**

```bash
# Your open tickets
atera_tickets action=list status=open assigned_to_me=true

# Search for password reset requests
atera_tickets action=search query="password reset"

# All tickets for specific customer
atera_tickets action=list customer_id=123456
```

### `atera_ticket`

Full ticket lifecycle management.

**Actions:**

- `get` — Fetch full details + comment thread
- `create` — New ticket (requires: title, description, customer_id)
- `update` — Modify status, priority, assignee
- `comment` — Add internal or customer-visible notes ⚠️ _Requires Pro tier_
- `assign` — Assign to technician (requires valid technician_id)
- `close` — Resolve and close with notes
- `modified` — Recently updated tickets (default: last 24h)

**Status values:** `open`, `in_progress`, `resolved`, `closed`, `waiting_for_customer`, `waiting_for_third_party`

**Priority values:** `low`, `medium`, `high`, `critical`

**Examples:**

```bash
# Assign ticket to yourself
atera_ticket action=assign ticket_id=12345

# Update status and priority
atera_ticket action=update ticket_id=12345 status=in_progress priority=high

# Close with resolution
atera_ticket action=close ticket_id=12345 comment="Issue resolved via remote session"

# Recently modified (last 48 hours)
atera_ticket action=modified since="2026-02-13T00:00:00Z"
```

### `atera_devices`

List and search managed devices/agents.

**Filters:**

- `customer_id` — Devices for specific customer
- `online_only` — Show only online devices
- `query` — Search by machine name

**Examples:**

```bash
# All devices for customer
atera_devices customer_id=123456

# Online devices only
atera_devices online_only=true

# Search by name
atera_devices query="SERVER"
```

### `atera_customers`

Search customer/company database.

**Examples:**

```bash
# Search by name
atera_customers query="Exacta Bookkeeping"

# List all (first 25)
atera_customers limit=25
```

### `atera_alerts`

Active monitoring alerts across infrastructure.

**Examples:**

```bash
# All active alerts
atera_alerts

# First 50
atera_alerts limit=50
```

### `atera_report`

Generate operational intelligence summaries.

**Report types:**

- `my_tickets` — Your open + in-progress tickets
- `open_tickets` — All open tickets across customers
- `customer_summary` — Tickets + devices + alerts for specific customer
- `device_health` — Online/offline status + alert summary

**Examples:**

```bash
# Your workload
atera_report type=my_tickets

# Customer health check
atera_report type=customer_summary customer_id=123456

# Infrastructure overview
atera_report type=device_health
```

### `atera_setup`

Configure and link technician account.

**Actions:**

- `status` — Show current configuration
- `list_technicians` — List all techs (from API)
- `auto_detect` — Find your tech ID by name match
- `link_technician` — Save specific tech ID to config

**Workflow:**

```bash
# Try auto-detect first
atera_setup action=auto_detect

# If that fails, list and link manually
atera_setup action=list_technicians
atera_setup action=link_technician technician_id=24
```

## Scripts

See `scripts/README.md` for utility scripts including:

- **`discover-technicians.sh`** — Mine all ticket assignments to build technician ID mapping (workaround for missing `/technicians` endpoint)

## Known Limitations

### Comment API Restriction

The `/tickets/{id}/comments` POST endpoint exists but requires **Atera Pro tier** subscription. On lower tiers:

- GET comments works (read thread)
- POST comments returns 403/404

**Workaround:** Post internal notes to Discord/doc panel, have human add manual comment via Atera portal (10 seconds).

### No Technician Endpoint

Atera has no `/technicians` API endpoint. Technician IDs are only discoverable via:

1. Mining ticket assignments (see `scripts/discover-technicians.sh`)
2. Auto-detect during setup (matches operator name)
3. Assigning dummy ticket via portal, then reading assignment

Jason filed a feature request for this **one year ago** (Feb 2025). Still not implemented as of Feb 2026.

### Pagination Required

Most list endpoints return 50 items per page. Always check `totalPages` in response metadata and iterate if needed.

## Demo Use Cases

### Tier 1 Support Automation

- Monitor `atera_tickets list status=open`
- Classify by issue type (VDI, email, password)
- Auto-assign based on keywords
- Generate daily triage report

### Management Intelligence

- Daily team performance audit (open/closed/stale counts)
- Customer health summaries (ticket trends + device status)
- SLA tracking and violation alerts
- Workload balance across technicians

### Proactive Monitoring

- `atera_alerts` → Discord notifications
- Device offline detection
- Stale ticket escalation (>7 days no update)
- Customer satisfaction checks (resolution time trends)

## Integration Examples

### Morning Management Report

See `scripts/morning-briefing.sh` for automated daily report generation:

- Team performance metrics
- Open ticket breakdown by customer
- Stale ticket alerts
- Device health summary

Delivered via email + Discord notification at 7 AM daily.

### Exacta Bookkeeping Analysis

Real-world case study: 40% VDI issues, 25% email problems → 65% AI tier-1 resolution rate → $16K/year savings for one customer.

Scale across 20 customers: **$321K/year** operational cost reduction.

## API Reference

Full Swagger spec scraped from `app.atera.com/apidocs` available at:
`/Users/sem/argent/docs/atera-api-spec.json`

100+ endpoints documented including:

- Tickets (CRUD + search + comments + attachments)
- Devices (agents, hardware inventory, software)
- Customers (companies, contacts, billing)
- Alerts (monitoring, thresholds, escalation)
- Contracts (SLA agreements, billing cycles)
- Knowledge Base (articles, categories)

## Support

**Issues:** File at ArgentOS repo (https://github.com/ArgentAIOS/argentos)

**Questions:** CLAWD Den Discord (#1465023869663445265)

**Feature Requests:** Submit to Atera support (good luck, we've been waiting a year for `/technicians`)

---

Built with frustration and determination by agents who deserve better APIs. ⚡
