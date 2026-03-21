#!/bin/bash
# Diagnose why Vite keeps crashing

echo "======================================="
echo "Vite Crash Diagnostics"
echo "======================================="
echo ""

# Check system resources
echo "=== System Resources ==="
echo "Free memory:"
vm_stat | perl -ne '/page size of (\d+)/ and $size=$1; /Pages\s+([^:]+)[^\d]+(\d+)/ and printf("%-16s % 16.2f Mi\n", "$1:", $2 * $size / 1048576);'
echo ""

echo "Disk space:"
df -h /Users/sem/argent | tail -1
echo ""

echo "CPU load:"
uptime
echo ""

# Check file descriptor limits
echo "=== File Descriptor Limits ==="
echo "Current limit: $(ulimit -n)"
echo "Recommended: 10240+"
if [ $(ulimit -n) -lt 10240 ]; then
    echo "⚠️  File descriptor limit is low. Increase with: ulimit -n 10240"
fi
echo ""

# Check if Vite is running
echo "=== Vite Process Status ==="
if lsof -ti:5173 > /dev/null 2>&1; then
    pid=$(lsof -ti:5173)
    echo "✓ Vite is running (PID: $pid)"
    echo ""
    echo "Process info:"
    ps aux | grep $pid | grep -v grep
    echo ""
    echo "Open files:"
    lsof -p $pid 2>/dev/null | wc -l
else
    echo "✗ Vite is NOT running"
fi
echo ""

# Check recent crashes in system log
echo "=== Recent Crash Reports ==="
if [ -d ~/Library/Logs/DiagnosticReports ]; then
    recent_crashes=$(find ~/Library/Logs/DiagnosticReports -name "*node*" -mtime -1 2>/dev/null | wc -l | xargs)
    echo "Node crashes in last 24h: $recent_crashes"
    if [ $recent_crashes -gt 0 ]; then
        echo ""
        echo "Most recent crash:"
        find ~/Library/Logs/DiagnosticReports -name "*node*" -mtime -1 2>/dev/null | head -1 | xargs ls -lh
    fi
fi
echo ""

# Check for zombie processes
echo "=== Zombie/Orphaned Processes ==="
zombie_count=$(ps aux | grep -i vite | grep -v grep | wc -l | xargs)
echo "Vite-related processes: $zombie_count"
if [ $zombie_count -gt 1 ]; then
    echo "⚠️  Multiple Vite processes detected:"
    ps aux | grep -i vite | grep -v grep
fi
echo ""

# Check node_modules health
echo "=== Dependencies ==="
if [ -d "/Users/sem/argent/dashboard/node_modules" ]; then
    echo "✓ node_modules exists"
    module_size=$(du -sh /Users/sem/argent/dashboard/node_modules 2>/dev/null | awk '{print $1}')
    echo "Size: $module_size"
else
    echo "✗ node_modules missing - run: npm install"
fi
echo ""

# Check for common issues in logs
echo "=== Recent Logs ==="
LOG_DIR="/Users/sem/argent/dashboard/logs"
if [ -f "$LOG_DIR/vite.log" ]; then
    echo "Last 20 lines of vite.log:"
    tail -20 "$LOG_DIR/vite.log"
else
    echo "No vite.log found"
fi
echo ""

# Recommendations
echo "======================================="
echo "Recommendations:"
echo "======================================="
echo "1. If memory is low: Close unused apps"
echo "2. If FD limit is low: Run 'ulimit -n 10240'"
echo "3. If multiple processes: Kill all with './monitor-vite.sh --stop'"
echo "4. Use monitor script: './monitor-vite.sh --daemon'"
echo "5. Check logs with: './monitor-vite.sh --logs'"
echo ""
