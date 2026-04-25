# Gateway

Gateway configuration, network model, health, pairing, API, and diagnostics.

- [Authentication](<90 - Public Docs Mirror/docs/gateway/authentication.md>) - Model authentication: OAuth, API keys, and setup-token
- [Background Exec and Process Tool](<90 - Public Docs Mirror/docs/gateway/background-process.md>) - Background exec execution and process management
- [Bonjour Discovery](<90 - Public Docs Mirror/docs/gateway/bonjour.md>) - Bonjour/mDNS discovery + debugging (Gateway beacons, clients, and common failure modes)
- [Bridge Protocol](<90 - Public Docs Mirror/docs/gateway/bridge-protocol.md>) - Bridge protocol (legacy nodes): TCP JSONL, pairing, scoped RPC
- [CLI Backends](<90 - Public Docs Mirror/docs/gateway/cli-backends.md>) - CLI backends: text-only fallback via local AI CLIs
- [Configuration Examples](<90 - Public Docs Mirror/docs/gateway/configuration-examples.md>) - Schema-accurate configuration examples for common ArgentOS setups
- [Configuration](<90 - Public Docs Mirror/docs/gateway/configuration.md>) - All configuration options for ~/.argentos/argent.json with examples
- [Discovery and Transports](<90 - Public Docs Mirror/docs/gateway/discovery.md>) - Node discovery and transports (Bonjour, Tailscale, SSH) for finding the gateway
- [Doctor](<90 - Public Docs Mirror/docs/gateway/doctor.md>) - Doctor command: health checks, config migrations, and repair steps
- [Gateway Lock](<90 - Public Docs Mirror/docs/gateway/gateway-lock.md>) - Gateway singleton guard using the WebSocket listener bind
- [Health Checks](<90 - Public Docs Mirror/docs/gateway/health.md>) - Health check steps for channel connectivity
- [Heartbeat](<90 - Public Docs Mirror/docs/gateway/heartbeat.md>) - Heartbeat polling messages and notification rules
- [Gateway Runbook](<90 - Public Docs Mirror/docs/gateway/index.md>) - Runbook for the Gateway service, lifecycle, and operations
- [Local Models](<90 - Public Docs Mirror/docs/gateway/local-models.md>) - Run ArgentOS on local LLMs (LM Studio, vLLM, LiteLLM, custom OpenAI endpoints)
- [Logging](<90 - Public Docs Mirror/docs/gateway/logging.md>) - Logging surfaces, file logs, WS log styles, and console formatting
- [Multiple Gateways](<90 - Public Docs Mirror/docs/gateway/multiple-gateways.md>) - Run multiple ArgentOS Gateways on one host (isolation, ports, and profiles)
- [Network model](<90 - Public Docs Mirror/docs/gateway/network-model.md>) - How the Gateway, nodes, and canvas host connect.
- [OpenAI Chat Completions](<90 - Public Docs Mirror/docs/gateway/openai-http-api.md>) - Expose an OpenAI-compatible /v1/chat/completions HTTP endpoint from the Gateway
- [OpenResponses API](<90 - Public Docs Mirror/docs/gateway/openresponses-http-api.md>) - Expose an OpenResponses-compatible /v1/responses HTTP endpoint from the Gateway
- [Gateway-Owned Pairing](<90 - Public Docs Mirror/docs/gateway/pairing.md>) - Gateway-owned node pairing (Option B) for iOS and other remote nodes
- [Gateway Protocol](<90 - Public Docs Mirror/docs/gateway/protocol.md>) - Gateway WebSocket protocol: handshake, frames, versioning
- [Remote Gateway Setup](<90 - Public Docs Mirror/docs/gateway/remote-gateway-readme.md>) - SSH tunnel setup for ArgentOS.app connecting to a remote gateway
- [Remote Access](<90 - Public Docs Mirror/docs/gateway/remote.md>) - Remote access using SSH tunnels (Gateway WS) and tailnets
- [Sandbox vs Tool Policy vs Elevated](<90 - Public Docs Mirror/docs/gateway/sandbox-vs-tool-policy-vs-elevated.md>) - Why a tool is blocked: sandbox runtime, tool allow/deny policy, and elevated exec gates
- [Sandboxing](<90 - Public Docs Mirror/docs/gateway/sandboxing.md>) - How ArgentOS sandboxing works: modes, scopes, workspace access, and images
- [Formal Verification (Security Models)](<90 - Public Docs Mirror/docs/gateway/security/formal-verification.md>) - Machine-checked security models for ArgentOS’s highest-risk paths.
- [Security](<90 - Public Docs Mirror/docs/gateway/security/index.md>) - Security considerations and threat model for running an AI gateway with shell access
- [Tailscale](<90 - Public Docs Mirror/docs/gateway/tailscale.md>) - Integrated Tailscale Serve/Funnel for the Gateway dashboard
- [Tools Invoke API](<90 - Public Docs Mirror/docs/gateway/tools-invoke-http-api.md>) - Invoke a single tool directly via the Gateway HTTP endpoint
- [Troubleshooting](<90 - Public Docs Mirror/docs/gateway/troubleshooting.md>) - Quick troubleshooting guide for common ArgentOS failures
- [Logging](<90 - Public Docs Mirror/docs/logging.md>) - Logging overview: file logs, console output, CLI tailing, and the Control UI
- [Network](<90 - Public Docs Mirror/docs/network.md>) - Network hub: gateway surfaces, pairing, discovery, and security
