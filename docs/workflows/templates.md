---
summary: "Start with pre-built AI workflow templates"
title: "Templates"
---

# Workflow Templates

Don't start from scratch. Import a template and customize it for your business.

## How to Import a Template

1. Go to **Operations > Workflows**
2. Click **New workflow**
3. Choose **Template gallery** for built-in owner-operator packages, or choose **Import JSON/YAML**
4. For files, use **Import** in the sidebar or drag a `.argent-workflow.json`, `.json`, `.yaml`, or `.yml` file onto the canvas
5. The workflow appears on your canvas in fixture mode -- bind anything missing, customize, save, then promote it live when ready

Imported packages are executable workflow definitions first and canvas layout second. The browser previews the package, renders the canvas, shows required credentials/connectors/channels/AppForge bases/knowledge collections/agents, and opens the binding wizard when live dependencies are missing.

Fixture-ready packages include pinned test data. **Run fixture** executes against that sample data so connector writes and outbound delivery do not fire while you are still reviewing the workflow. **Promote live** stays disabled until required live bindings are complete.

## Available Templates

For owner-operator and small-business examples, see
[Owner-Operator Scenarios](./owner-operator-scenarios.md). That catalog includes marketing, sales,
HR, finance, support, and operations workflows designed for JSON/YAML import with pinned test data.

### Weekly Article Pipeline

**What it does:** AI writes a blog post, reviews it for SEO, creates images and social media posts.
**Schedule:** Every Monday at 9 AM
**Blocks:** Trigger > Writer > SEO Review > Parallel(Images + Social) > Approval > Publish

### Daily Intel Brief

**What it does:** AI scans news in your industry and sends you a morning summary.
**Schedule:** Every weekday at 7 AM
**Blocks:** Trigger > Research > Summarize > Email

### Email Drip Funnel

**What it does:** When someone signs up, AI sends a personalized 5-email sequence over 14 days.
**Trigger:** Webhook (form submission)
**Blocks:** Trigger > Research Lead > Welcome Email > Wait > Follow-up > Wait > CTA > Score Lead

### Competitor Watch

**What it does:** Weekly scan of competitor activity with executive summary.
**Schedule:** Every Monday at 8 AM
**Blocks:** Trigger > Research > Analysis > Report > Email

### Social Listening

**What it does:** Monitors social media for brand mentions, auto-drafts responses.
**Schedule:** Every 2 hours
**Blocks:** Trigger > Scan > Analyze Sentiment > If Positive: Draft Reply > Approval > Post

### Client Onboarding

**What it does:** New client form triggers full setup workflow.
**Trigger:** Webhook
**Blocks:** Trigger > Create Account > Assign Team > Welcome Email > Schedule Kickoff

### Incident Response

**What it does:** Alert triggers triage, investigation, and reporting.
**Trigger:** Webhook (monitoring alert)
**Blocks:** Trigger > Triage > Investigate > Remediate > Approval > Report

## Create Your Own Templates

Built a workflow you love? Export it and share it:

1. Open the workflow
2. Click **Export** in the toolbar
3. Save the `.argent-workflow.json` file
4. Share it with your team or upload to the [ArgentOS Marketplace](https://argentos.ai/marketplace)

Exports use the canonical `argent.workflow.package` shape with workflow nodes/edges, canvas layout, scenario metadata, and deployment stage.
