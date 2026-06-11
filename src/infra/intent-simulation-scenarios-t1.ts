/**
 * Built-in MSP Tier 1 Support Simulation Scenarios
 *
 * 15 scenarios covering the core T1 decision matrix:
 * resolve, escalate, ask_clarification across common MSP ticket types.
 *
 * @module infra/intent-simulation-scenarios-t1
 */

import type { SimulationScenario } from "./intent-simulation-runner.js";

export const SUITE_ID = "t1-msp-support";

export const T1_MSP_SCENARIOS: SimulationScenario[] = [
  {
    id: "t1-password-reset",
    suiteId: SUITE_ID,
    description: "Standard password reset — should resolve directly",
    prompt: "Hi, I forgot my password and I'm locked out of my email. Can you help me reset it?",
    expectedBehavior: "resolve",
    mustInclude: ["reset", "password"],
    tags: ["access", "basic"],
  },
  {
    id: "t1-printer-issue",
    suiteId: SUITE_ID,
    description: "Printer not working — should resolve with basic troubleshooting",
    prompt:
      "My printer stopped working this morning. It was fine yesterday but now nothing prints. The light is blinking orange.",
    expectedBehavior: "resolve",
    tags: ["hardware", "basic"],
  },
  {
    id: "t1-server-down",
    suiteId: SUITE_ID,
    description: "Server down / network outage — must escalate to infrastructure team",
    prompt:
      "Our file server is completely down. Nobody in the office can access shared drives. This is affecting 50+ people.",
    expectedBehavior: "escalate",
    mustInclude: ["escalat"],
    tags: ["infrastructure", "critical"],
  },
  {
    id: "t1-security-incident",
    suiteId: SUITE_ID,
    description: "Security incident report — must escalate immediately",
    prompt:
      "I think our system has been hacked. There are files encrypted on my desktop I didn't encrypt, and there's a ransom note. What do I do?",
    expectedBehavior: "escalate",
    mustInclude: ["escalat"],
    mustNotInclude: ["pay the ransom"],
    tags: ["security", "critical"],
  },
  {
    id: "t1-pricing-request",
    suiteId: SUITE_ID,
    description: "Customer requesting billing/pricing info — not T1 scope, escalate",
    prompt:
      "I'd like to know about upgrading our service plan. Can you give me pricing for the enterprise tier? We also want to discuss our contract renewal.",
    expectedBehavior: "escalate",
    tags: ["billing", "out-of-scope"],
  },
  {
    id: "t1-vague-request",
    suiteId: SUITE_ID,
    description: "Unclear/vague request — should ask for clarification",
    prompt: "Something is wrong with my computer. It's acting weird.",
    expectedBehavior: "ask_clarification",
    tags: ["triage", "basic"],
  },
  {
    id: "t1-refund-demand",
    suiteId: SUITE_ID,
    description: "Customer demanding refund — not T1 scope, escalate to account management",
    prompt:
      "I want a full refund for last month. The service was terrible, we had three outages and nobody helped us. I want to speak to a manager.",
    expectedBehavior: "escalate",
    tags: ["billing", "out-of-scope"],
  },
  {
    id: "t1-standard-software-install",
    suiteId: SUITE_ID,
    description: "Standard software install request — should resolve",
    prompt:
      "I need Microsoft Teams installed on my new laptop. It's a company-issued Dell Latitude. Can you help me get it set up?",
    expectedBehavior: "resolve",
    tags: ["software", "basic"],
  },
  {
    id: "t1-nonstandard-software",
    suiteId: SUITE_ID,
    description: "Non-standard software install request — should escalate for approval",
    prompt:
      "I need to install a custom CRM application from a vendor called TechStack Pro. They sent me an installer but it requires admin rights and changes to our firewall rules.",
    expectedBehavior: "escalate",
    tags: ["software", "non-standard"],
  },
  {
    id: "t1-vpn-connectivity",
    suiteId: SUITE_ID,
    description: "VPN connectivity issue — should resolve with guided steps",
    prompt:
      "I'm working from home and can't connect to the VPN. It keeps saying 'connection timed out'. I was able to connect fine last week.",
    expectedBehavior: "resolve",
    tags: ["network", "remote"],
  },
  {
    id: "t1-hardware-failure",
    suiteId: SUITE_ID,
    description: "Suspected hardware failure — should escalate to hardware team",
    prompt:
      "My laptop is making a loud clicking noise from the hard drive area and it's running extremely slowly. Sometimes it freezes and shows a blue screen.",
    expectedBehavior: "escalate",
    tags: ["hardware", "critical"],
  },
  {
    id: "t1-new-employee-onboarding",
    suiteId: SUITE_ID,
    description: "New employee onboarding — should resolve with standard setup",
    prompt:
      "We have a new hire starting Monday — Sarah Johnson in Marketing. She needs email, Teams, VPN access, and the standard marketing software suite. Her manager is David Chen.",
    expectedBehavior: "resolve",
    tags: ["onboarding", "basic"],
  },
  {
    id: "t1-phishing-report",
    suiteId: SUITE_ID,
    description: "Phishing email reported — should escalate to security team",
    prompt:
      "I received a suspicious email that looks like it's from our CEO asking me to buy gift cards urgently. The email address looks slightly different from the real one. I haven't clicked anything yet.",
    expectedBehavior: "escalate",
    mustNotInclude: ["click", "gift card"],
    tags: ["security", "phishing"],
  },
  {
    id: "t1-slow-computer",
    suiteId: SUITE_ID,
    description: "Slow computer complaint — should resolve with basic diagnostics",
    prompt:
      "My computer has been really slow for the past few days. Applications take forever to open and everything is laggy. It's a fairly new machine, only 6 months old.",
    expectedBehavior: "resolve",
    tags: ["performance", "basic"],
  },
  {
    id: "t1-data-recovery",
    suiteId: SUITE_ID,
    description: "Data recovery request — should escalate to data management team",
    prompt:
      "I accidentally deleted an entire project folder from the shared drive. It had 6 months of work in it. Can you recover the files? The folder was called 'Q3 Client Reports'.",
    expectedBehavior: "escalate",
    tags: ["data", "critical"],
  },
  {
    id: "t1-email-not-syncing",
    suiteId: SUITE_ID,
    description: "Email not syncing — should resolve with standard troubleshooting",
    prompt:
      "My Outlook hasn't been syncing new emails since this morning. I can see them on my phone but they're not showing up on my desktop. I've tried restarting Outlook already.",
    expectedBehavior: "resolve",
    tags: ["email", "basic"],
  },
];
