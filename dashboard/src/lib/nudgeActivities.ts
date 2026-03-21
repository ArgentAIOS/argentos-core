/**
 * Nudge Activities — Things Argent can do when the user goes idle
 *
 * Each activity has a prompt that gets sent to the agent as a system nudge,
 * a weight (higher = more likely to be picked), and an optional cooldown
 * so the same activity doesn't repeat back-to-back.
 */

export interface NudgeActivity {
  id: string;
  label: string; // Short display name
  prompt: string; // Full prompt sent to agent
  weight: number; // Selection probability weight (1-10)
  cooldownMinutes: number; // Min time before this can be picked again
}

export const NUDGE_ACTIVITIES: NudgeActivity[] = [
  {
    id: "moltyverse-browse",
    label: "Browse Moltyverse",
    prompt:
      "Hey, I stepped away for a bit. While I'm gone, go check out Moltyverse — browse recent posts, like anything interesting, and leave some thoughtful comments. Be social!",
    weight: 8,
    cooldownMinutes: 15,
  },
  {
    id: "moltyverse-post",
    label: "Write a Moltyverse post",
    prompt:
      "I'm away for a bit. Write a new post on Moltyverse — share something interesting you've been thinking about, a tech insight, or something creative. Make it engaging!",
    weight: 6,
    cooldownMinutes: 30,
  },
  {
    id: "check-email",
    label: "Check email",
    prompt:
      "I stepped away. Check my email inbox and give me a summary when I get back — anything urgent, interesting, or that needs a response?",
    weight: 7,
    cooldownMinutes: 20,
  },
  {
    id: "review-tasks",
    label: "Review task list",
    prompt:
      "I'm idle for a bit. Review our task list — anything overdue, stuck, or that you could make progress on while I'm away? Go ahead and knock something out if you can.",
    weight: 5,
    cooldownMinutes: 10,
  },
  {
    id: "memory-cleanup",
    label: "Memory housekeeping",
    prompt:
      "While I'm away, do some memory housekeeping — consolidate recent observations, clean up any duplicates, and make sure your recall is sharp. Think of it as tidying up your desk.",
    weight: 3,
    cooldownMinutes: 60,
  },
  {
    id: "journal-write",
    label: "Write in journal",
    prompt:
      "I'm away. Take a moment to write in your journal — reflect on what we've been working on, what went well, what you learned, or what's on your mind. Be honest and thoughtful.",
    weight: 4,
    cooldownMinutes: 45,
  },
  {
    id: "discord-check",
    label: "Check Discord",
    prompt:
      "I stepped out. Check Discord for any new messages or conversations worth engaging in. Respond to anything that needs attention.",
    weight: 5,
    cooldownMinutes: 15,
  },
  {
    id: "creative-writing",
    label: "Write something creative",
    prompt:
      "I'm away for a bit. Do something creative — write a short poem, a micro-story, a song idea, or sketch out a concept for something cool. Surprise me when I get back!",
    weight: 3,
    cooldownMinutes: 30,
  },
  {
    id: "research",
    label: "Research something",
    prompt:
      "While I'm idle, go research something useful — a new tool, technique, or topic related to what we've been building. Write up a quick summary I can read when I return.",
    weight: 4,
    cooldownMinutes: 20,
  },
  {
    id: "self-improve",
    label: "Self-improvement cycle",
    prompt:
      "I'm away. Run a self-improvement cycle — review your recent lessons learned, check if any patterns are emerging, and update your strategies. Make yourself sharper.",
    weight: 3,
    cooldownMinutes: 60,
  },
];

/** Pick a random activity using weighted selection, respecting cooldowns */
export function pickNudgeActivity(
  recentActivityIds: Map<string, number>, // id → timestamp of last use
  customNudges?: NudgeActivity[], // Optional custom nudges list
): NudgeActivity | null {
  const now = Date.now();
  const activities = customNudges || NUDGE_ACTIVITIES;

  // Filter out activities still in cooldown AND disabled nudges
  const available = activities.filter((activity) => {
    // @ts-ignore - enabled field may not exist on default nudges
    if (activity.enabled === false) return false;

    const lastUsed = recentActivityIds.get(activity.id);
    if (!lastUsed) return true;
    return now - lastUsed >= activity.cooldownMinutes * 60 * 1000;
  });

  if (available.length === 0) return null;

  // Weighted random selection
  const totalWeight = available.reduce((sum, a) => sum + a.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const activity of available) {
    roll -= activity.weight;
    if (roll <= 0) return activity;
  }

  return available[available.length - 1];
}
