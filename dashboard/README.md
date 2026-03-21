# ArgentOS Dashboard

**Visual interface for ArgentOS with Live2D avatar, task board, canvas workspace, and chat**

## Overview

The ArgentOS Dashboard provides a rich, interactive interface for working with your AI assistant:

- **🎭 Live2D Avatar** - Animated avatar with expressions, lip-sync, time-based outfits
- **📋 Task Board** - Visual task management with markers `[TASK:]`, `[TASK_DONE:]`
- **📄 Canvas** - Document workspace with markdown, code highlighting, diagrams
- **💬 Chat Panel** - Real-time chat with voice input/output
- **🧩 Widgets** - Customizable widgets (clock, calendar, weather, stocks, news)

## Quick Start

```bash
# Install dependencies
cd dashboard
npm install

# Start both API server and frontend
npm start

# Or start separately:
npm run api      # Start API server on port 9242
npm run dev      # Start Vite dev server on port 8080
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ArgentOS Dashboard                        │
│  (React App - http://localhost:8080)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Live2D     │  │  Task Board  │  │  Chat Panel  │      │
│  │   Avatar     │  │  + Canvas    │  │  + Voice I/O │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                            │                                │
│                    WebSocket Connection                     │
└────────────────────────────┼────────────────────────────────┘
                             │
                   ws://127.0.0.1:18789
                             │
┌────────────────────────────┼────────────────────────────────┐
│                  ArgentOS Gateway                           │
│         (argent gateway start)                              │
└─────────────────────────────────────────────────────────────┘
```

## Widget System

The dashboard has **7 widget positions**:

| Position | Location     | Size  |
| -------- | ------------ | ----- |
| 1-3      | Left column  | Small |
| 4-6      | Right column | Small |
| 7        | Bottom left  | Large |

### Available Widgets

- **Clock** - Live time and date
- **Calendar Agenda** - Next 5 upcoming events
- **Ticket List** - Active support tickets
- **Silver Price** - COMEX/SGE prices, Au/Ag ratio
- **Stock News** - Market news feed

### Creating Custom Widgets

1. Create component in `src/components/widgets/MyWidget.tsx`
2. Register in `src/components/widgets/widgetRegistry.ts`
3. Export from `src/components/widgets/index.ts`

## Task System

Tasks are created and managed through chat using markers:

```
[TASK:title]        - Create new task
[TASK_START:title]  - Mark in-progress
[TASK_DONE:title]   - Mark complete
[TASK_ERROR:title]  - Mark failed
```

### Task API Endpoints

- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/:id/start` - Start task
- `POST /api/tasks/:id/complete` - Complete task

## Canvas System

The canvas provides a document workspace with:

- **Markdown** - Full GFM support with Mermaid diagrams
- **Code** - Syntax highlighting for 50+ languages
- **Semantic Search** - Find documents by meaning
- **SSE Updates** - Real-time document push from agent

### Canvas API Endpoints

- `GET /api/canvas/documents` - List documents
- `GET /api/canvas/document/:id` - Get document
- `POST /api/canvas/save` - Save document (with embeddings)
- `DELETE /api/canvas/document/:id` - Delete document
- `POST /api/canvas/search` - Semantic/keyword search

## Voice Features

### Text-to-Speech (ElevenLabs)

- Multiple voice options
- Real-time lip-sync with avatar
- Toggle on/off in chat panel

### Speech-to-Text (OpenAI Whisper)

- Push-to-talk mode
- Click mic button to record
- Automatic transcription

## Configuration

### Environment Variables

Create `.env` in the dashboard directory:

```env
VITE_ELEVENLABS_API_KEY=your_key
VITE_OPENAI_API_KEY=your_key
```

### Gateway Connection

The dashboard connects to the ArgentOS gateway on port 18789:

```typescript
// src/hooks/useGateway.ts
const defaultUrl = `ws://${window.location.hostname}:18789`;
```

## File Structure

```
dashboard/
├── src/
│   ├── App.tsx              # Main app component
│   ├── components/
│   │   ├── Live2DAvatar.tsx # Avatar with expressions
│   │   ├── TaskList.tsx     # Task board
│   │   ├── ChatPanel.tsx    # Chat interface
│   │   ├── CanvasPanel.tsx  # Document workspace
│   │   └── widgets/         # Widget components
│   ├── hooks/
│   │   ├── useGateway.ts    # WebSocket connection
│   │   ├── useTasks.ts      # Task management
│   │   ├── useTTS.ts        # Text-to-speech
│   │   └── ...
│   └── db/
│       └── canvasDb.cjs     # Legacy canvas adapter (PG-only guard; no SQLite fallback)
├── public/
│   └── live2d/              # Avatar model files
├── api-server.cjs           # Express API backend
└── package.json
```

## Production Build

```bash
npm run build
npm run preview
```

## Integration with ArgentOS

The dashboard is designed to work with the ArgentOS gateway:

1. **Start Gateway**: `argent gateway start`
2. **Start Dashboard**: `npm start`
3. **Access**: http://localhost:8080

The WebSocket protocol is compatible with ArgentOS's gateway, using:

- Protocol version 3
- Event streaming for agent responses
- Task marker parsing for UI updates

## Credits

- **Live2D Model**: Alexia by kyokiStudio (Booth.pm)
- **Icons**: Lucide React
- **Styling**: Tailwind CSS v4
