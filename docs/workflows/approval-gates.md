---
summary: "Add human review to your AI workflows"
title: "Approval Gates"
---

# Approval Gates -- Your Safety Net

An approval gate pauses your workflow and asks you to review before continuing. Think of it as a "check my work" step.

## Why Use Approvals?

AI is powerful but not perfect. Before your workflow:

- **Sends an email to a client** -- make sure it sounds right
- **Posts on social media** -- verify the tone matches your brand
- **Creates an invoice** -- confirm the amounts are correct
- **Publishes a blog post** -- review for accuracy

## How to Add an Approval

1. Drag a **Gate** block onto your canvas
2. Place it between the AI step and the output
3. Click on it -- select **Approval** as the gate type
4. Configure:
   - **Review Message** -- What should you look at? (e.g., "Review the draft email before sending")
   - **Show Previous Output** -- Turn this on to see what the AI produced
   - **Timeout** -- How long to wait before the gate auto-resolves (0 = wait forever)
   - **On Timeout** -- What happens if you don't respond? (Auto-approve, deny, or escalate)

## How It Works

1. Your workflow runs normally until it hits the approval gate
2. **The pipeline pauses** -- the gate turns amber on the canvas
3. **You get notified** -- a banner appears on your dashboard
4. **You see what the AI produced** -- the previous step's output is displayed
5. **You decide:**
   - **Approve** -- workflow continues to the next step
   - **Deny** -- workflow stops, nothing gets sent

## Example

```
[Every Monday 9 AM]
  -> [AI writes blog post]
  -> [APPROVAL: "Review the draft before publishing"]
  -> [Post to WordPress]
  -> [Share on social media]
```

Without the approval gate, the blog post goes live automatically. With it, you get to read it first. One click to approve, and the rest of the pipeline continues.

## Tips

- **Start with approvals everywhere**, then remove them once you trust the output
- **Set a timeout** so pipelines don't get stuck -- 24 hours is a good default
- **Use "auto-approve on timeout"** for low-risk steps (like saving to documents)
- **Use "deny on timeout"** for high-risk steps (like sending client emails)
- **Use "escalate on timeout"** if someone else should review when you are unavailable
