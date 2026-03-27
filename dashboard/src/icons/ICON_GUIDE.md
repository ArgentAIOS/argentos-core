# ArgentOS Icon System

## Design Philosophy

These icons are built from the visual language of ArgentOS itself:

- **Orbital/flowing geometry** — inspired by your particle system and Workflow Map
- **Luminous quality** — soft glows and subtle filters, not harsh edges
- **Minimal line weight** — elegant and refined, not busy
- **Connection emphasis** — dashed bridges, arcs, and flowing lines
- **Modular construction** — pieces nest and orbit each other

## Color Palette

### Dark Mode (Default)

- **Primary:** `#00aaff` (cyan) — main accent, connections, glows
- **Secondary:** `#00ffcc` (teal) — alternative accent, workflows
- **Accent:** `#ffa500` (warm gold/orange) — warm highlights, nodes
- **Muted:** `#4a5568` (subtle gray) — backgrounds, secondary elements

### Light Mode

- **Primary:** `#0066cc` (deep blue) — maintains contrast on light
- **Secondary:** `#009999` (deep teal) — readable, cohesive
- **Accent:** `#cc6600` (deep gold) — warm but legible
- **Muted:** `#999999` (muted gray) — secondary elements

## Icon Reference

### Tab Icons (Primary Navigation)

| Icon | Name             | Concept                                       | Usage                  |
| ---- | ---------------- | --------------------------------------------- | ---------------------- |
| 🌐   | **Workflow Map** | Concentric orbital rings with glowing nucleus | Main operations HUD    |
| 📊   | **Workloads**    | Cascading particles with flow lines           | Execution tracking     |
| ✅   | **Task Manager** | Nested priority layers                        | Personal task tracking |
| 👥   | **Org Chart**    | Connected constellation nodes                 | Team structure         |
| ⏱️   | **Schedule**     | Pulsing wave/temporal rhythm                  | Cron jobs and timing   |
| 🤖   | **Workers**      | Glowing agent node with presence rings        | Active agents          |

### Utility Icons

| Icon | Name         | Concept                         | Usage           |
| ---- | ------------ | ------------------------------- | --------------- |
| 🏠   | **Home**     | Angular house structure         | Dashboard home  |
| ⚙️   | **Settings** | Center gear with orbital spokes | Configuration   |
| ➕   | **Add**      | Cross within orbital ring       | Create new item |

## Usage

### Basic Import

```tsx
import { WorkflowMapIcon, TaskManagerIcon, IconRenderer } from '@/icons/ArgentOS';

// Direct component
<WorkflowMapIcon size={32} darkMode={true} />

// Via renderer
<IconRenderer name="workflow-map" size={32} darkMode={true} />
```

### Props

```typescript
interface IconProps {
  size?: number; // 16-64px recommended
  className?: string; // Additional CSS classes
  darkMode?: boolean; // true (default) = dark, false = light
  animated?: boolean; // Some icons support animation
}
```

### Size Recommendations

| Context          | Size    | Notes               |
| ---------------- | ------- | ------------------- |
| Tab bar          | 20-24px | Standard icon size  |
| Large display    | 32-40px | Dashboard headlines |
| Small indicators | 16px    | Secondary elements  |
| Hero/marketing   | 48-64px | Prominent display   |

### Examples

```tsx
// Tab navigation
<div className="tab-bar">
  <button><WorkflowMapIcon size={20} /></button>
  <button><TaskManagerIcon size={20} /></button>
  <button><ScheduleIcon size={20} /></button>
</div>

// With animation
<WorkflowMapIcon size={48} darkMode={true} animated={true} />

// Light mode variant
<OrgChartIcon size={32} darkMode={false} />

// In a header
<div className="header">
  <h1>
    <TaskManagerIcon size={28} /> Your Tasks
  </h1>
</div>
```

## Design Details

### Glow Effects

All icons use SVG filters for luminous quality:

```xml
<filter id="glow-[icon]" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="0.6-1.2" result="coloredBlur"/>
  <feMerge>
    <feMergeNode in="coloredBlur"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>
```

### Stroke vs Fill

- **Primary nodes/accents:** `fill` (glowing, solid)
- **Connection lines:** `stroke` with low opacity (subtle, dashed)
- **Outlines:** `stroke` with varying opacity (layered depth)

### Opacity Layering

Creates visual hierarchy:

- **Active/focus:** 0.8-1.0 opacity
- **Primary:** 0.6-0.8 opacity
- **Secondary:** 0.3-0.6 opacity
- **Background:** 0.1-0.3 opacity

## Animation Support

Icons with `animated={true}`:

| Icon             | Animation        | Duration | Effect                     |
| ---------------- | ---------------- | -------- | -------------------------- |
| **Workflow Map** | Orbital rotation | 20s      | Slow continuous orbit      |
| **Workloads**    | Cascade flow     | 3s       | Particles flowing downward |
| **Org Chart**    | Node pulse       | 4s       | Connection awareness       |
| **Schedule**     | Wave pulse       | 2s       | Temporal rhythm            |
| **Workers**      | Node breathing   | 3s       | Agent presence             |
| **Settings**     | Gear spin        | 4s       | Configuration state        |

## CSS Integration

Icons work with CSS variables. Example theme integration:

```css
:root[data-theme="dark"] {
  --icon-primary: #00aaff;
  --icon-secondary: #00ffcc;
  --icon-accent: #ffa500;
}

:root[data-theme="light"] {
  --icon-primary: #0066cc;
  --icon-secondary: #009999;
  --icon-accent: #cc6600;
}
```

## Accessibility

- Icons are **decorative by default** (no aria-label)
- For buttons, wrap in `<button>` with text label or `aria-label`
- All icons scale cleanly from 16px to 64px
- Sufficient color contrast in both dark and light modes

## Dark/Light Mode Switching

```tsx
const [darkMode, setDarkMode] = useState(true);

<div className="nav">
  <WorkflowMapIcon darkMode={darkMode} />
  <TaskManagerIcon darkMode={darkMode} />
  <button onClick={() => setDarkMode(!darkMode)}>{darkMode ? "☀️" : "🌙"}</button>
</div>;
```

## Performance Notes

- All icons are inline SVG (no external files)
- Filters apply only to relevant icon layers
- Animations use CSS (not JS) for 60fps
- File size: ~19KB total (compressed)

## Future Extensions

Planned additions:

- **Status indicators:** success, warning, error, pending
- **Queue icons:** priority levels, workload states
- **Agent types:** specialty icons for different agent roles
- **Seasonal themes:** alternate color palettes for marketing

## Version History

- **v1.0** (Mar 26, 2026) — Initial icon system with 9 icons (6 tabs + 3 utilities), dark/light modes, animation support
