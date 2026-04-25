---
summary: "Connect your favorite apps to AI workflows"
title: "Connectors"
---

# App Connectors

ArgentOS connects to 60+ apps. Each connector appears in your Workflows sidebar -- just drag it onto the canvas.

## How to Use a Connector

1. Look in the **Connectors** section of the left sidebar
2. Find the app you want (e.g., Stripe, HubSpot, Slack)
3. **Drag it onto the canvas** -- it creates an Action block
4. Click on it to configure (API key, account details, etc.)
5. Connect it to other blocks in your workflow

## Available Connectors

### CRM and Sales

Salesforce, HubSpot, Pipedrive, Close

### Project Management

Jira, ClickUp, Asana, Dart, Linear, Monday, Trello

### Communication

Slack, Discord, Microsoft Teams, Twilio (SMS/Voice/WhatsApp)

### Email

SendGrid, Resend, Mailchimp, Klaviyo

### Payments and Commerce

Stripe, Square, WooCommerce, Shopify

### Databases

Supabase, Neon (Postgres), Pinecone (AI/Vector)

### Documents and Storage

Google Drive, Dropbox, Box, Notion

### AI Services

OpenAI, Anthropic (Claude), Perplexity, ElevenLabs (voice)

### Developer Tools

GitHub, CodeRabbit, Blacksmith CI, Claude Code

### Accounting

QuickBooks, Xero

### Operations

PagerDuty, ConnectWise, Atera

### Scheduling

Calendly

### Social Media

Buffer, Hootsuite

### Automation

Zapier, n8n, Make

## Setting Up a Connector

Each connector needs authentication -- usually an API key or account login.

1. Click on the connector block
2. The right panel shows the required fields
3. Enter your API key or credentials
4. The connector will show a checkmark when connected

**Your credentials are encrypted.** ArgentOS stores them using AES-256-GCM encryption with your OS keychain. They never leave your machine.

**You only need to set up credentials once.** After the first time, every workflow that uses that connector picks up the same saved credentials automatically.

## Can't Find Your App?

New connectors are added regularly. Check the [ArgentOS Marketplace](https://argentos.ai/marketplace) for community-built connectors, or request one in the Discord community.
