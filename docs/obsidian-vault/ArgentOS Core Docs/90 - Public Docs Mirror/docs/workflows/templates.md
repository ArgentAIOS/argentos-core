---
summary: "Start with pre-built AI workflow templates"
title: "Templates"
---

# Workflow Templates

Don't start from scratch. Import a template and customize it for your business.

## How to Import a Template

1. Go to **Operations > Workflows**
2. Click **Import** in the sidebar
3. Select a `.argent-workflow.json` file
4. The workflow appears on your canvas -- customize and save

## Available Templates

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
