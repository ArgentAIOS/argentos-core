# Argent Dashboard - Architecture & Deployment Guide

## Overview

Argent Dashboard is a **local-first AI assistant interface** that provides a visual, interactive way to work with ArgentOS. Think of it as your mission control - real-time avatar, task board, canvas workspace, and chat interface all in one.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Argent Dashboard                         │
│  (React App - http://localhost:8080)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Live2D     │  │  Task Board  │  │  Chat Panel  │      │
│  │   Avatar     │  │  + Canvas    │  │  + Voice I/O │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                            │                                │
│                    WebSocket Connection                     │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                   ws://127.0.0.1:18789
                             │
┌────────────────────────────┼────────────────────────────────┐
│                  ArgentOS Gateway                           │
│         (Node.js WebSocket Server)                          │
│                                                              │
│  • Manages chat sessions                                    │
│  • Routes messages to/from Claude API                       │
│  • Streams responses back to dashboard                      │
│  • Handles task markers [TASK:], [TASK_DONE:], etc.        │
│  • Manages alerts and notifications                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                             │
                    Anthropic Claude API
                             │
                        (Sonnet 4.5)
```

## Project Structure

```
/Users/sem/argent/
├── argent-dashboard/           # ← Frontend + API server (this project)
│   ├── src/                    # React frontend source
│   │   ├── components/         # UI components
│   │   │   ├── Live2DAvatar.tsx      # Avatar with expressions/lip-sync
│   │   │   ├── TaskList.tsx          # Task board with cron jobs
│   │   │   ├── ChatPanel.tsx         # Chat interface with voice
│   │   │   ├── CanvasPanel.tsx       # Document workspace
│   │   │   └── ...
│   │   ├── hooks/              # React hooks
│   │   │   ├── useGateway.ts         # WebSocket connection to ArgentOS
│   │   │   ├── useTTS.ts             # ElevenLabs text-to-speech
│   │   │   ├── useSpeechRecognition.ts # Whisper voice input
│   │   │   ├── useTasks.ts           # Task management
│   │   │   ├── useWeather.ts         # Weather data
│   │   │   └── useCalendar.ts        # Google Calendar integration
│   │   └── App.tsx             # Main app component
│   ├── public/
│   │   └── live2d/             # Live2D avatar model files
│   │       └── argent/         # Alexia model (kyokiStudio)
│   ├── api-server.cjs          # Express API server (tasks, calendar, etc.)
│   ├── package.json
│   └── vite.config.ts          # Vite build config
│
├── .argent/                  # ArgentOS config directory
│   ├── config.json             # Gateway configuration
│   ├── gateway.db              # SQLite database
│   └── .env                    # API keys (Anthropic, etc.)
│
├── SOUL.md                     # Agent personality/behavior
├── USER.md                     # User profile (Jason's info)
├── AGENTS.md                   # Workspace conventions
├── TOOLS.md                    # Local tool notes (API keys, etc.)
├── MEMORY.md                   # Long-term curated memory
└── memory/                     # Daily memory logs
    └── YYYY-MM-DD.md
```

## Connection Flow

1. **Dashboard starts** → Vite dev server on port 8080
2. **API server starts** → Express on port 3002 (tasks, calendar, weather)
3. **Dashboard connects** → WebSocket to ArgentOS Gateway (port 18789)
4. **User sends message** → Dashboard → Gateway → Claude API
5. **Claude streams response** → Gateway → Dashboard (with task markers)
6. **Task markers parsed** → [TASK:] creates task, [TASK_DONE:] completes it
7. **TTS triggered** → Dashboard calls ElevenLabs directly (if audio enabled)

## Key Configuration Files

### 1. ArgentOS Gateway Config

**Location:** `~/.argent/config.json`

```json
{
  "gateway": {
    "port": 18789,
    "token": "2e2e68eafa063275bd341b669c734d5c880ce3a78694fef3"
  },
  "model": "anthropic/claude-sonnet-4-5"
}
```

### 2. Dashboard Environment

**Location:** `/Users/sem/argent/argent-dashboard/.env`

```env
VITE_ELEVENLABS_API_KEY=your_elevenlabs_key
VITE_OPENAI_API_KEY=your_openai_key_for_whisper
```

### 3. Gateway Token

**In App.tsx:**

```typescript
const GATEWAY_URL = "ws://127.0.0.1:18789";
const GATEWAY_TOKEN = "2e2e68eafa063275bd341b669c734d5c880ce3a78694fef3";
```

## Starting the System

### Manual Start (Current)

```bash
# Terminal 1: Start ArgentOS Gateway
argent gateway start

# Terminal 2: Start API Server
cd /Users/sem/argent/argent-dashboard
node api-server.cjs

# Terminal 3: Start Frontend
cd /Users/sem/argent/argent-dashboard
npm run dev
```

### Access

- Dashboard: http://localhost:8080
- API Server: http://localhost:3002

## Deployment for Employees

### Option 1: Clone & Configure (Recommended)

**On each employee machine:**

```bash
# 1. Install ArgentOS globally
npm install -g argent

# 2. Clone the workspace
git clone <your-repo-url> ~/argent
cd ~/argent

# 3. Set up ArgentOS
argent init
# → Follow prompts, add Anthropic API key

# 4. Copy identity files (customize per employee)
# Edit USER.md with employee's name/info
# Edit SOUL.md if needed (or use shared personality)

# 5. Install dashboard dependencies
cd argent-dashboard
npm install

# 6. Configure environment
cp .env.example .env
# → Add ElevenLabs API key for voice
# → Add OpenAI API key for Whisper

# 7. Start services
# Terminal 1
argent gateway start

# Terminal 2
node api-server.cjs

# Terminal 3
npm run dev
```

### Option 2: Docker Compose (Future)

Create a `docker-compose.yml` to run:

- ArgentOS Gateway
- API Server
- Frontend (production build)

```yaml
version: "3.8"
services:
  gateway:
    image: argent/gateway:latest
    ports:
      - "18789:18789"
    volumes:
      - ./argent:/workspace
      - ./.argent:/root/.argent
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

  api-server:
    build: ./argent-dashboard
    command: node api-server.cjs
    ports:
      - "3002:3002"
    volumes:
      - ./argent-dashboard:/app

  frontend:
    build: ./argent-dashboard
    command: npm run dev
    ports:
      - "8080:8080"
    depends_on:
      - gateway
      - api-server
```

### Option 3: Managed Service (SaaS)

If you want to centralize this:

1. **Host Gateway centrally** on your Dell R750
2. **Each employee runs dashboard locally** (connects to your gateway)
3. **Shared workspace** with per-user memory isolation

Benefits:

- Central API key management
- Shared task coordination
- Easier updates

Drawbacks:

- Privacy concerns (all chat goes through your server)
- Network dependency

## Key Dependencies

### Frontend (Dashboard)

- **React + TypeScript** - UI framework
- **Vite** - Build tool & dev server
- **PIXI.js + Live2D** - Avatar rendering
- **ElevenLabs API** - Text-to-speech
- **OpenAI Whisper API** - Speech recognition
- **ReactMarkdown** - Canvas document rendering
- **Mermaid** - Diagram rendering

### API Server

- **Express** - REST API server
- **SQLite (better-sqlite3)** - Task/document storage
- **gog CLI** - Google Calendar integration

### Backend (ArgentOS)

- **Node.js** - Runtime
- **WebSocket** - Real-time communication
- **Anthropic SDK** - Claude API client

## Database Schema

**Location:** `/Users/sem/argent/argent-dashboard/argent.db`

```sql
-- Tasks table
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  schedule TEXT,
  next_run INTEGER
);

-- Canvas documents
CREATE TABLE canvas_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  language TEXT,
  created_at INTEGER NOT NULL
);
```

## API Endpoints

### Task Management

- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/:id/start` - Start task
- `POST /api/tasks/:id/complete` - Complete task

### Calendar

- `GET /api/calendar/next` - Next upcoming event
- `GET /api/calendar/today` - Today's events
- `GET /api/calendar/upcoming` - Next 7 days (up to 10 events)

### Canvas

- `GET /api/canvas/documents` - List all documents
- `GET /api/canvas/document/:id` - Get document by ID
- `POST /api/canvas/document` - Save document
- `DELETE /api/canvas/document/:id` - Delete document

### Weather

- `GET /api/weather` - Current weather (cached 15 min)

## Task Markers

Argent uses special markers in chat responses to control the UI:

```markdown
[TASK:title] - Creates a pending task
[TASK:title|details] - Creates task with multi-line details
[TASK_START:title] - Marks task in-progress
[TASK_DONE:title] - Marks task completed

[ALERT:message] - Info alert
[ALERT_WARN:message] - Warning alert
[ALERT_URGENT:message] - Urgent alert

[TTS:text to speak] - Override what gets spoken (vs what's displayed)
```

## Live2D Avatar

**Model:** Alexia by kyokiStudio (Booth.pm)
**License:** Personal use (check license if redistributing to employees)

**Modes:**

- **Full mode** - Full body, 3 zoom presets (full/portrait/face)
- **Bubble mode** - Head only, circular frame (when canvas is open)

**Features:**

- State-based expressions (idle, thinking, working, success, error)
- Real-time lip-sync from TTS audio
- Time-based outfit changes (professional/casual/tech)
- Trackpad-friendly positioning controls

## Voice Features

### Text-to-Speech (ElevenLabs)

- **Jessica** (default) - Playful, bright, warm
- **Lily** - Velvety, refined actress
- Streams directly from ElevenLabs API
- Triggers lip-sync on avatar
- Can be toggled on/off in chat panel

### Speech-to-Text (OpenAI Whisper)

- **Push-to-talk** mode (default)
- Click mic button to start listening
- Automatic transcription → sent as message
- Stops TTS playback when listening

## Customization

### Per-Employee Setup

Each employee should customize:

1. **USER.md** - Their name, timezone, preferences
2. **SOUL.md** - Agent personality (or use shared)
3. **TOOLS.md** - Local API keys, device names, etc.
4. **Voice selection** - In chat panel dropdown
5. **Avatar mode** - Full vs bubble preference

### Shared vs Personal

**Shared (same for everyone):**

- Code (argent-dashboard)
- Avatar model
- Task system
- Canvas features

**Personal (per employee):**

- ArgentOS config/API key
- Memory files (MEMORY.md, memory/\*.md)
- Calendar/email integration (gog accounts)
- Voice preferences

## Production Build

```bash
# Build for production
cd /Users/sem/argent/argent-dashboard
npm run build

# Serve production build
npm install -g serve
serve -s dist -l 8080
```

## Troubleshooting

### Dashboard won't connect

- Check `argent gateway status`
- Verify gateway token matches in App.tsx
- Check port 18789 is not blocked

### Tasks not updating

- Check API server is running (port 3002)
- Check `argent.db` file permissions
- Verify `/api/tasks` endpoint responds

### Avatar not loading

- Check `/public/live2d/argent/` folder exists
- Verify model files are present
- Check browser console for PIXI errors

### Voice not working

- Verify ElevenLabs API key in `.env`
- Check browser allows microphone access
- Test with different voice (dropdown)

## Next Steps

1. **Push to GitHub** - Create private repo for employees
2. **Document per-employee setup** - Onboarding checklist
3. **Create Docker setup** - Easier deployment
4. **Add authentication** - If centralizing gateway
5. **Mobile app** - React Native version?

## Questions?

This is a **living document**. As you deploy to more employees and find edge cases, update this guide.

---

Built with ⚡ by Argent
