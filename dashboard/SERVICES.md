# Argent Dashboard Services Guide

## Architecture Overview

Argent consists of **3 independent services** that work together:

```
┌─────────────────────────────────────────────────────────────┐
│                    Argent Dashboard                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌─────────────┐ │
│  │   Frontend   │────▶│  API Server  │────▶│  ArgentOS   │ │
│  │  (Vite/React)│     │  (Express)   │     │  Gateway    │ │
│  │   Port 8080  │     │  Port 3001   │     │ Port 18789  │ │
│  └──────────────┘     └──────────────┘     └─────────────┘ │
│       ▲                     ▲                     ▲         │
│       │                     │                     │         │
│    Browser              REST API            WebSocket       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Service Locations

### Workspace Path

```
/Users/sem/argent/
├── argent-dashboard/          # Main dashboard code
│   ├── src/                   # React frontend
│   ├── api-server.js          # Express backend
│   ├── package.json           # Dependencies
│   └── vite.config.ts         # Vite config
├── SOUL.md                    # Agent personality
├── USER.md                    # Your profile
├── AGENTS.md                  # Workspace rules
└── memory/                    # Task/canvas storage
    ├── tasks.json
    └── canvas.db
```

### ArgentOS Installation

```
/Users/sem/.nvm/versions/node/v22.22.0/lib/node_modules/argent/
```

---

## Dependencies

### Frontend (`argent-dashboard/package.json`)

**Core:**

- `react` + `react-dom` - UI framework
- `vite` - Build tool & dev server
- `typescript` - Type safety

**UI Components:**

- `framer-motion` - Animations
- `lucide-react` - Icons
- `tailwindcss` - Styling
- `pixi-live2d-display` - Avatar rendering

**Markdown/Canvas:**

- `react-markdown` - Markdown rendering
- `react-syntax-highlighter` - Code highlighting
- `mermaid` - Diagram rendering
- `remark-gfm` - GitHub-flavored markdown

**Communication:**

- `ws` - WebSocket client (Gateway connection)

**Voice:**

- `openai` - Whisper API (speech-to-text)
- (ElevenLabs via fetch API - no npm package)

### Backend (`api-server.js`)

**No package.json** - Uses minimal deps:

- `express` + `cors` - REST API
- `better-sqlite3` - Canvas storage (already in frontend deps)
- Built-in `fetch` for upstream APIs

### ArgentOS Gateway

**Installed globally** via npm:

```bash
npm install -g argent
```

**Dependencies:** Managed by ArgentOS (not in this project)

---

## How Services Start

### 1. ArgentOS Gateway (Daemon)

**Binary:**

```bash
/Users/sem/.nvm/versions/node/v22.22.0/bin/argent
```

**Commands:**

```bash
argent gateway status   # Check if running
argent gateway start    # Start daemon
argent gateway stop     # Stop daemon
argent gateway restart  # Restart daemon
```

**What it does:**

- Runs as background daemon (always on)
- Listens on `ws://localhost:18789`
- Manages WebSocket connections
- Routes messages to Claude API
- Handles session state

**Current status:**

```bash
$ ps aux | grep argent-gateway
sem  56871  argent-gateway  # ✅ Running (PID 56871)
```

**Daemon process:** Runs via `launchd` or as background process. Survives reboots if configured.

---

### 2. API Server (Manual/Monitor)

**Location:** `/Users/sem/argent/argent-dashboard/api-server.js`

**Start manually:**

```bash
cd /Users/sem/argent/argent-dashboard
node api-server.js &
```

**Current status:**

```bash
$ ps aux | grep api-server
sem  69290  node api-server.js  # ✅ Running (PID 69290)
```

**What it does:**

- REST API on `http://localhost:3001`
- Proxies to Silver Intel Report APIs
- Manages tasks (read/write `tasks.json`)
- Serves calendar/weather data
- No database (uses flat files)

**Endpoints:**

```
GET  /api/tasks
POST /api/tasks
GET  /api/metals/prices
GET  /api/news
GET  /api/calendar/next
GET  /api/weather
```

**Not a daemon:** Must be started manually or via monitor script.

---

### 3. Vite Frontend (Development)

**Location:** `/Users/sem/argent/argent-dashboard/`

**Start manually:**

```bash
cd /Users/sem/argent/argent-dashboard
npm run dev
```

**Current status:**

```bash
$ ps aux | grep vite
sem  60621  node .../vite  # ✅ Running (PID 60621)
```

**What it does:**

- Serves React app on `http://localhost:8080`
- Hot module replacement (HMR)
- Development only (use `npm run build` for production)
- Proxies `/api/*` requests to API server (port 3001)

**Not a daemon:** Dev server only. Build + serve static files for production.

---

## Service Monitor (Recommended)

Use the included monitor script to keep services alive:

```bash
cd /Users/sem/argent/argent-dashboard
./monitor-services.sh --daemon
```

**Features:**

- Auto-starts API server + Vite
- Restarts on crash
- Rate-limited (won't restart too frequently)
- Logs to `logs/monitor.log`

**Commands:**

```bash
./monitor-services.sh --status   # Check status
./monitor-services.sh --start    # Start all
./monitor-services.sh --stop     # Stop all
./monitor-services.sh --restart  # Restart all
./monitor-services.sh --daemon   # Run monitor (keeps alive)
./monitor-services.sh --logs     # Show recent logs
```

**Note:** Monitor does NOT manage ArgentOS Gateway (it's a system daemon).

---

## Ports

| Service              | Port  | Protocol  | Purpose              |
| -------------------- | ----- | --------- | -------------------- |
| **Vite**             | 8080  | HTTP      | Frontend (React app) |
| **API Server**       | 3001  | HTTP      | REST API             |
| **ArgentOS Gateway** | 18789 | WebSocket | Claude connection    |

---

## Quick Start Commands

### Start Everything (Manual)

```bash
# Terminal 1: Gateway (if not running)
argent gateway start

# Terminal 2: API Server
cd /Users/sem/argent/argent-dashboard
node api-server.js

# Terminal 3: Frontend
cd /Users/sem/argent/argent-dashboard
npm run dev
```

**Access:** http://localhost:8080

---

### Start with Monitor (Recommended)

```bash
# Ensure Gateway is running
argent gateway status

# Start monitored services
cd /Users/sem/argent/argent-dashboard
./monitor-services.sh --daemon
```

Press Ctrl+C to stop monitor (services keep running).

---

## Check Service Status

### Quick Check

```bash
cd /Users/sem/argent/argent-dashboard
./monitor-services.sh --status
```

**Output:**

```
=== Argent Dashboard Services ===

✓ Vite running (PID: 60621, Port: 8080)
✓ API Server running (PID: 69290, Port: 3001)

All services running
Dashboard: http://localhost:8080
```

### Manual Check

```bash
# Check ports
lsof -i :8080  # Vite
lsof -i :3001  # API
lsof -i :18789 # Gateway

# Or check processes
ps aux | grep -E "vite|api-server|argent-gateway"
```

---

## Stopping Services

### Stop API + Vite (Monitor Script)

```bash
./monitor-services.sh --stop
```

### Stop Gateway

```bash
argent gateway stop
```

### Kill Individual Service

```bash
# Find PID
lsof -i :8080  # Example: PID 60621

# Kill it
kill 60621

# Force kill if needed
kill -9 60621
```

---

## Production Deployment

**For production, you'd:**

1. **Build frontend:**

   ```bash
   cd /Users/sem/argent/argent-dashboard
   npm run build
   ```

2. **Serve with nginx/caddy** (not Vite dev server)

3. **Run API server via PM2/systemd:**

   ```bash
   pm2 start api-server.js --name argent-api
   pm2 startup  # Auto-start on boot
   ```

4. **Gateway is already a daemon** (no change needed)

---

## Logs

### Monitor Logs

```bash
tail -f /Users/sem/argent/argent-dashboard/logs/monitor.log
tail -f /Users/sem/argent/argent-dashboard/logs/vite.log
tail -f /Users/sem/argent/argent-dashboard/logs/api-server.log
```

### Gateway Logs

```bash
argent logs
```

---

## Troubleshooting

### Services Won't Start

**Check ports are free:**

```bash
lsof -i :8080
lsof -i :3001
lsof -i :18789
```

**Kill conflicting processes:**

```bash
pkill -f vite
pkill -f api-server
```

### Gateway Not Responding

```bash
argent gateway restart
```

### Dashboard Shows "Connecting..."

1. Check Gateway is running: `argent gateway status`
2. Check WebSocket URL in browser console (should be `ws://localhost:18789`)
3. Verify token matches `~/.argent/config.json`

---

## Dependencies Install/Update

### Update Dashboard Dependencies

```bash
cd /Users/sem/argent/argent-dashboard
npm install  # Install
npm update   # Update
```

### Update ArgentOS

```bash
npm update -g argent
```

---

## Summary

**Argent = 3 services:**

1. **ArgentOS Gateway** (daemon, always running)
   - Start: `argent gateway start`
   - Runs in background

2. **API Server** (manual start or monitor)
   - Start: `node api-server.js &`
   - Or use monitor script

3. **Vite Frontend** (dev server)
   - Start: `npm run dev`
   - Dev only, not a daemon

**Best practice:** Use monitor script to keep API + Vite alive, let Gateway run as system daemon.

---

**Location:** `/Users/sem/argent/argent-dashboard/`  
**Dependencies:** Managed via `npm install`  
**Monitor Script:** `./monitor-services.sh`  
**Access:** http://localhost:8080
