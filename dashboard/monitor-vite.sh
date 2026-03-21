#!/bin/bash
# Vite Dev Server Monitor & Auto-Restart
# Usage: ./monitor-vite.sh [--once|--daemon]

DASHBOARD_DIR="/Users/sem/argent/dashboard"
LOG_DIR="$DASHBOARD_DIR/logs"
VITE_LOG="$LOG_DIR/vite.log"
MONITOR_LOG="$LOG_DIR/monitor.log"
PID_FILE="$LOG_DIR/vite.pid"
PORT=8080

# Create log directory
mkdir -p "$LOG_DIR"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$MONITOR_LOG"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "$MONITOR_LOG"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✓ $1${NC}" | tee -a "$MONITOR_LOG"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ $1${NC}" | tee -a "$MONITOR_LOG"
}

# Check if Vite is running
is_vite_running() {
    # Check if port is in use
    lsof -ti:$PORT > /dev/null 2>&1
    local port_check=$?
    
    # Check if PID file exists and process is alive
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            return 0
        fi
    fi
    
    return $port_check
}

# Get Vite PID
get_vite_pid() {
    lsof -ti:$PORT 2>/dev/null | head -1
}

# Check system resources
check_resources() {
    # Memory pressure (macOS)
    local mem_pressure=$(memory_pressure 2>/dev/null | grep "System-wide memory free percentage" | awk '{print $5}' | tr -d '%')
    if [ ! -z "$mem_pressure" ] && [ "$mem_pressure" -lt 10 ]; then
        log_warning "Memory pressure high (${mem_pressure}% free)"
    fi
    
    # File descriptor limit
    local fd_limit=$(ulimit -n)
    local fd_used=$(lsof -p $(get_vite_pid) 2>/dev/null | wc -l)
    if [ ! -z "$fd_used" ] && [ $fd_used -gt $((fd_limit * 70 / 100)) ]; then
        log_warning "File descriptors: $fd_used/$fd_limit (${$((fd_used * 100 / fd_limit))}%)"
    fi
}

# Kill Vite process
kill_vite() {
    local pid=$(get_vite_pid)
    if [ ! -z "$pid" ]; then
        log "Killing Vite process (PID: $pid)"
        kill -9 $pid 2>/dev/null
        sleep 2
    fi
    rm -f "$PID_FILE"
}

# Start Vite
start_vite() {
    log "Starting Vite dev server..."
    cd "$DASHBOARD_DIR"
    
    # Increase file watcher limit (macOS)
    ulimit -n 10240 2>/dev/null
    
    # Start Vite in background
    npm run dev > "$VITE_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # Wait for server to start
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if lsof -ti:$PORT > /dev/null 2>&1; then
            log_success "Vite started successfully (PID: $pid, Port: $PORT)"
            return 0
        fi
        sleep 1
        ((attempts++))
    done
    
    log_error "Vite failed to start after 30 seconds"
    cat "$VITE_LOG" | tail -20 | tee -a "$MONITOR_LOG"
    return 1
}

# Restart Vite
restart_vite() {
    log "Restarting Vite..."
    kill_vite
    sleep 2
    start_vite
}

# One-time check
check_once() {
    if is_vite_running; then
        local pid=$(get_vite_pid)
        log_success "Vite is running (PID: $pid, Port: $PORT)"
        check_resources
        return 0
    else
        log_error "Vite is NOT running"
        return 1
    fi
}

# Daemon mode - continuous monitoring
run_daemon() {
    log "Starting Vite monitor daemon..."
    log "Logs: $MONITOR_LOG"
    log "Vite output: $VITE_LOG"
    
    # Initial start
    if ! is_vite_running; then
        start_vite
    else
        log_success "Vite already running"
    fi
    
    local restart_count=0
    local last_restart=0
    
    while true; do
        sleep 10
        
        if ! is_vite_running; then
            log_error "Vite crashed or stopped!"
            
            # Check if restarting too frequently (more than 3 times in 5 minutes)
            local now=$(date +%s)
            if [ $((now - last_restart)) -lt 300 ]; then
                ((restart_count++))
                if [ $restart_count -gt 3 ]; then
                    log_error "Vite restarting too frequently ($restart_count times in 5 minutes)"
                    log_error "Check logs at: $VITE_LOG"
                    log_error "Waiting 60 seconds before retry..."
                    sleep 60
                    restart_count=0
                fi
            else
                restart_count=0
            fi
            
            last_restart=$now
            restart_vite
        else
            # Periodic health check
            check_resources
        fi
    done
}

# Handle script arguments
case "${1:-}" in
    --once)
        check_once
        exit $?
        ;;
    --daemon|-d)
        run_daemon
        ;;
    --start)
        if is_vite_running; then
            log_warning "Vite is already running"
            exit 0
        fi
        start_vite
        ;;
    --stop)
        kill_vite
        log_success "Vite stopped"
        ;;
    --restart)
        restart_vite
        ;;
    --status)
        check_once
        ;;
    --logs)
        echo "=== Monitor Log ==="
        tail -50 "$MONITOR_LOG" 2>/dev/null || echo "No monitor logs"
        echo ""
        echo "=== Vite Log ==="
        tail -50 "$VITE_LOG" 2>/dev/null || echo "No vite logs"
        ;;
    *)
        echo "Vite Dev Server Monitor"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  --once, --status    Check if Vite is running (one-time)"
        echo "  --daemon, -d        Run continuous monitor (auto-restart)"
        echo "  --start             Start Vite manually"
        echo "  --stop              Stop Vite"
        echo "  --restart           Restart Vite"
        echo "  --logs              Show recent logs"
        echo ""
        echo "Examples:"
        echo "  $0 --status         # Quick check"
        echo "  $0 --daemon         # Run monitor (ctrl+c to stop)"
        echo "  $0 --logs           # View logs"
        exit 1
        ;;
esac
