#!/bin/bash
# Test the dashboard.canvas.push gateway method

echo "Testing gateway canvas broadcast..."

curl -X POST http://localhost:18789/plugins/dashboard-canvas/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Document from HTTP",
    "content": "# Test\n\nThis is a test document pushed via the HTTP endpoint.\n\nIf you see this in your dashboard canvas, the HTTP fallback is working!",
    "type": "markdown"
  }' | jq

echo ""
echo "Check your dashboard - did the canvas open?"
