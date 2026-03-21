# Widget System Guide

## Overview

The dashboard has a widget system with **7 positions**:

- **Positions 1-3:** Left column (small widgets)
- **Positions 4-6:** Right column (small widgets)
- **Position 7:** Bottom left area (large widget)

## Widget Sizes

Widgets support two size variants:

- **`small`** - Compact layout for positions 1-6
- **`large`** - Expanded layout for position 7

The widget automatically adapts based on the `size` prop passed from the App.

## Available Widgets

### 🕐 Clock

- **ID:** `clock`
- **Description:** Live time and date display
- **Best for:** Positions 1-6 (small)

### 📅 Calendar Agenda

- **ID:** `calendar-agenda`
- **Description:** Next 5 upcoming events
- **Best for:** Any position

### 🎫 Ticket List

- **ID:** `tickets`
- **Description:** Active support tickets
- **Best for:** Any position

### 🪙 Silver Price

- **ID:** `silver-price`
- **Description:** Live silver spot prices & gold/silver ratio
- **Sizes:**
  - **Small:** Shows COMEX spot, daily change, and Au/Ag ratio
  - **Large:** Full grid with COMEX, SGE, ratio, and market status
- **Best for:** Position 7 (large) for full details

### 📰 Stock News (NEW!)

- **ID:** `stock-news`
- **Description:** Latest market news from Silver Intel Report
- **Sizes:**
  - **Small:** Top article with headline, sentiment, and tickers
  - **Large:** Scrollable feed with 5 latest articles
- **Features:**
  - Sentiment indicators (bullish/neutral/bearish)
  - Tickers mentioned highlighted
  - Source attribution
  - Auto-refresh every 5 minutes
- **Best for:** Position 7 (large) for full news feed

### ⬜ Empty

- **ID:** `empty`
- **Description:** Placeholder widget
- **Best for:** Unused positions

## Changing Widgets

Widgets are managed via the `useWidgets` hook. To change a widget:

1. Open the **Widget Settings** (gear icon in dashboard)
2. Click on a position
3. Select a new widget from the list

Or programmatically:

```tsx
const { updateWidget } = useWidgets();
updateWidget(7, "silver-price"); // Set position 7 to silver price
```

## Creating New Widgets

### 1. Create Widget Component

```tsx
// src/components/widgets/MyWidget.tsx
import { WidgetContainer } from "./WidgetContainer";

interface MyWidgetProps {
  size?: "small" | "large";
}

export function MyWidget({ size = "small" }: MyWidgetProps) {
  if (size === "large") {
    return <WidgetContainer className="h-full">{/* Large layout */}</WidgetContainer>;
  }

  return <WidgetContainer className="h-full">{/* Small layout */}</WidgetContainer>;
}
```

### 2. Register in widgetRegistry.ts

```tsx
import { MyWidget } from "./MyWidget";

export type WidgetType = "..." | "my-widget";

export const widgetRegistry: Record<WidgetType, WidgetDefinition> = {
  // ...
  "my-widget": {
    id: "my-widget",
    name: "My Widget",
    description: "Description here",
    component: MyWidget,
    icon: "🎨",
  },
};
```

### 3. Export from index.ts

```tsx
export { MyWidget } from "./MyWidget";
```

## Widget Layout Guidelines

### Small Widgets (Positions 1-6)

- Keep content compact and scannable
- Use smaller font sizes (text-xs, text-sm)
- Max 2-3 data points visible at once
- Consider vertical layout

### Large Widgets (Position 7)

- More breathing room
- Can use grids or multi-column layouts
- Larger typography (text-2xl for main numbers)
- More detailed information

## API Endpoints for Widgets

### Silver/Gold Prices

```
GET /api/metals/prices
```

Returns:

```json
{
  "silver": {
    "spot": 31.24,
    "sge": 31.87,
    "change24h": 0.45,
    "changePercent": 1.46
  },
  "gold": {
    "spot": 2789.5,
    "change24h": -12.3
  },
  "goldSilverRatio": 89.31,
  "timestamp": "2026-01-30T12:00:00Z"
}
```

### Calendar Events

```
GET /api/calendar/next
GET /api/calendar/today
GET /api/calendar/upcoming
```

### Weather

```
GET /api/weather
```

### Tasks

```
GET /api/tasks
POST /api/tasks
PUT /api/tasks/:id
DELETE /api/tasks/:id
```

### News (Silver Intel Report)

```
GET /api/news?limit=10&offset=0
```

Returns:

```json
[
  {
    "title": "Ed Steer: The empire strikes back",
    "summary": "Market analysis summary...",
    "source": "GATA",
    "published_at": "2026-01-31T16:11:41Z",
    "category": "mining_production",
    "sentiment": "bullish",
    "importance": 3,
    "tickers_mentioned": ["AG", "MAG", "SILV"],
    "image_url": "/static/images/...",
    "slug": "ed-steer-the-empire-strikes-back-6593"
  }
]
```

## Best Practices

1. **Always use WidgetContainer** - Provides consistent styling
2. **Make size-aware** - Support both small and large variants
3. **Handle loading states** - Show spinner or skeleton
4. **Handle errors gracefully** - Display fallback UI
5. **Auto-refresh data** - Use intervals for live data
6. **Use tabular-nums** - For better number alignment
7. **Respect dark theme** - Use white/opacity-based colors

## Example: Silver Price Widget

Position 7 (large) shows:

- COMEX Spot Price with daily change
- SGE Spot Price with premium
- Gold/Silver Ratio
- Market status indicator

Positions 1-6 (small) show:

- COMEX Spot Price
- Daily change percentage
- Au/Ag ratio

---

**To set silver price widget on position 7:**
Use the widget settings UI or run in browser console:

```js
// In browser dev console
localStorage.setItem("argent-widget-7", "silver-price");
location.reload();
```
