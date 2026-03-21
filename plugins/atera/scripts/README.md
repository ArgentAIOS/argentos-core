# Atera Scripts

Workaround scripts for Atera API limitations and operational automation.

---

## discover-technicians.sh

**Problem:** Atera has no `/technicians` endpoint. The only way to discover technician IDs is to mine ticket assignments.

**What it does:**

- Iterates through ALL tickets in your Atera instance (handles pagination automatically)
- Extracts unique technician assignments from:
  - `TechnicianContactID` (current assignee)
  - `TicketResolvedTechnicianContactId` (resolver)
- Builds a mapping matrix: `technician_id → name`
- Outputs JSON to `docs/atera-technician-ids.json`

**When to run:**

- **Initial setup** — Run once to discover all active technicians
- **New technician onboarding** — When a new tech joins:
  1. Assign them one dummy ticket (from portal)
  2. Run this script to capture their ID
  3. Close the dummy ticket

**Usage:**

```bash
export ATERA_API_KEY="your_api_key_here"
./scripts/discover-technicians.sh
```

**Output:**

```json
{
  "technicians": [
    { "id": 7, "name": "Alex Courtney" },
    { "id": 8, "name": "Skylar Courtney" },
    { "id": 16, "name": "Barrett Tribe" },
    { "id": 24, "name": "Zane Zavala" }
  ],
  "last_updated": "2026-02-15T19:10:00+0000",
  "discovery_method": "ticket_assignment_mining",
  "total_found": 4
}
```

**Performance:**

- ~3-5 pages/second depending on network latency
- For 50,000 tickets (1,000 pages): ~5-8 minutes
- Script shows progress: "Processing page 42/1089..."

**Why this matters:**
Many Atera API endpoints require `technicianId` as input (assign tickets, filter by assignee, etc.). Without this mapping, you can't programmatically assign work to specific technicians.

The portal shows technician names but not IDs. The portal URL includes a UUID (not the technician ID). This script solves the discovery problem.

---

## Future Scripts

Ideas for additional automation:

- `ticket-health-check.sh` — Find stale tickets, unassigned high-priority, SLA violations
- `customer-activity-summary.sh` — Per-customer ticket volume and resolution time trends
- `technician-workload-balance.sh` — Identify workload imbalances across team
- `auto-triage.sh` — Rule-based ticket assignment based on keywords/customer/type

---

**Feature Request Status:**

Jason Brashear filed a request for a proper `/technicians` endpoint **one year ago** (Feb 2025). Still not implemented as of Feb 2026.

If Atera ever adds this endpoint, these workarounds can be deprecated. Until then, this is the only reliable way to discover technician IDs programmatically.
