#!/bin/bash
# Simple Vite startup script with resource checks

DASHBOARD_DIR="/Users/sem/argent/dashboard"
LOG_DIR="$DASHBOARD_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$DASHBOARD_DIR"

echo "==================================="
echo "Starting Argent Dashboard Dev Server"
echo "==================================="
echo "Directory: $DASHBOARD_DIR"
echo "Time: $(date)"
echo "Logs: $LOG_DIR/vite.log"
echo ""

# Increase file descriptor limit (helps prevent crashes)
ulimit -n 10240

# Check Node version
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo ""

# Check if port 5173 is already in use
if lsof -ti:5173 > /dev/null 2>&1; then
    echo "⚠️  Port 5173 is already in use. Killing existing process..."
    lsof -ti:5173 | xargs kill -9 2>/dev/null
    sleep 2
fi

# Check available memory
if command -v vm_stat &> /dev/null; then
    free_mem=$(vm_stat | grep "Pages free" | awk '{print $3}' | tr -d '.')
    free_mb=$((free_mem * 4096 / 1024 / 1024))
    echo "Free memory: ${free_mb}MB"
    if [ $free_mb -lt 500 ]; then
        echo "⚠️  Low memory warning: Less than 500MB free"
    fi
    echo ""
fi

# Start Vite
echo "Starting Vite..."
exec npm run dev 2>&1 | tee "$LOG_DIR/vite.log"
