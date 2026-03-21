#!/bin/bash
# Argent Dashboard Services Monitor
# Monitors both Vite (8080) and API server (3002)

DASHBOARD_DIR="/Users/sem/argent/dashboard"
LOG_DIR="$DASHBOARD_DIR/logs"
VITE_LOG="$LOG_DIR/vite.log"
API_LOG="$LOG_DIR/api-server.log"
MONITOR_LOG="$LOG_DIR/monitor.log"
VITE_PID_FILE="$LOG_DIR/vite.pid"
API_PID_FILE="$LOG_DIR/api.pid"
VITE_PORT=8080
API_PORT=9242

# Create log directory
mkdir -p "$LOG_DIR"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] ℹ $1${NC}" | tee -a "$MONITOR_LOG"
}

# Check if port is in use
is_port_alive() {
    local port=$1
    nc -z localhost $port 2>/dev/null
    return $?
}

# Get PID using port
get_pid_by_port() {
    local port=$1
    lsof -ti:$port 2>/dev/null | head -1
}

# Kill process by PID file
kill_service() {
    local name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p $pid > /dev/null 2>&1; then
            log "Killing $name (PID: $pid)"
            kill -9 $pid 2>/dev/null
            sleep 1
        fi
        rm -f "$pid_file"
    fi
}

# Start Vite
start_vite() {
    log_info "Starting Vite dev server..."
    cd "$DASHBOARD_DIR"
    
    # Increase file watcher limit
    ulimit -n 10240 2>/dev/null
    
    # Start Vite in background
    npm run dev > "$VITE_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$VITE_PID_FILE"
    
    # Wait for server to start
    local attempts=0
    while [ $attempts -lt 30 ]; do
        if is_port_alive $VITE_PORT; then
            log_success "Vite started (PID: $pid, Port: $VITE_PORT)"
            return 0
        fi
        sleep 1
        ((attempts++))
    done
    
    log_error "Vite failed to start after 30 seconds"
    tail -20 "$VITE_LOG" | tee -a "$MONITOR_LOG"
    return 1
}

# Start API server
start_api() {
    log_info "Starting API server..."
    cd "$DASHBOARD_DIR"
    
    # Start API server in background (use explicit Node path for consistency)
    /opt/homebrew/bin/node api-server.cjs > "$API_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$API_PID_FILE"
    
    # Wait for server to start
    local attempts=0
    while [ $attempts -lt 10 ]; do
        if is_port_alive $API_PORT; then
            log_success "API server started (PID: $pid, Port: $API_PORT)"
            return 0
        fi
        sleep 1
        ((attempts++))
    done
    
    log_error "API server failed to start after 10 seconds"
    tail -20 "$API_LOG" | tee -a "$MONITOR_LOG"
    return 1
}

# Check service status
check_service() {
    local name=$1
    local port=$2
    
    if is_port_alive $port; then
        local pid=$(get_pid_by_port $port)
        echo -e "${GREEN}✓${NC} $name running (PID: $pid, Port: $port)"
        return 0
    else
        echo -e "${RED}✗${NC} $name NOT running"
        return 1
    fi
}

# Status check
status_check() {
    echo "=== Argent Dashboard Services ==="
    echo ""
    check_service "Vite" $VITE_PORT
    local vite_status=$?
    check_service "API Server" $API_PORT
    local api_status=$?
    echo ""
    
    if [ $vite_status -eq 0 ] && [ $api_status -eq 0 ]; then
        echo -e "${GREEN}All services running${NC}"
        echo "Dashboard: http://localhost:$VITE_PORT"
        return 0
    else
        echo -e "${YELLOW}Some services are down${NC}"
        return 1
    fi
}

# Start all services
start_all() {
    log "Starting all services..."
    
    # Check if already running
    local vite_running=false
    local api_running=false
    
    if is_port_alive $VITE_PORT; then
        log_warning "Vite already running on port $VITE_PORT"
        vite_running=true
    fi
    
    if is_port_alive $API_PORT; then
        log_warning "API server already running on port $API_PORT"
        api_running=true
    fi
    
    # Start what's not running
    if [ "$vite_running" = false ]; then
        start_vite
    fi
    
    if [ "$api_running" = false ]; then
        start_api
    fi
    
    echo ""
    status_check
}

# Stop all services
stop_all() {
    log "Stopping all services..."
    
    kill_service "Vite" "$VITE_PID_FILE"
    kill_service "API server" "$API_PID_FILE"
    
    # Double-check ports are free
    if is_port_alive $VITE_PORT; then
        local pid=$(get_pid_by_port $VITE_PORT)
        log_warning "Force killing process on port $VITE_PORT (PID: $pid)"
        kill -9 $pid 2>/dev/null
    fi
    
    if is_port_alive $API_PORT; then
        local pid=$(get_pid_by_port $API_PORT)
        log_warning "Force killing process on port $API_PORT (PID: $pid)"
        kill -9 $pid 2>/dev/null
    fi
    
    log_success "All services stopped"
}

# Restart all services
restart_all() {
    log "Restarting all services..."
    stop_all
    sleep 2
    start_all
}

# Daemon mode - continuous monitoring
run_daemon() {
    log "Starting Argent Dashboard monitor daemon..."
    log "Logs: $MONITOR_LOG"
    log "Vite output: $VITE_LOG"
    log "API output: $API_LOG"
    echo ""
    
    # Initial start
    start_all
    
    local vite_restart_count=0
    local api_restart_count=0
    local last_vite_restart=0
    local last_api_restart=0
    
    while true; do
        sleep 10
        
        local now=$(date +%s)
        
        # Check Vite
        if ! is_port_alive $VITE_PORT; then
            log_error "Vite crashed or stopped!"
            
            # Rate limiting
            if [ $((now - last_vite_restart)) -lt 300 ]; then
                ((vite_restart_count++))
                if [ $vite_restart_count -gt 3 ]; then
                    log_error "Vite restarting too frequently ($vite_restart_count times in 5 minutes)"
                    log_error "Waiting 60 seconds..."
                    sleep 60
                    vite_restart_count=0
                fi
            else
                vite_restart_count=0
            fi
            
            last_vite_restart=$now
            start_vite
        fi
        
        # Check API server
        if ! is_port_alive $API_PORT; then
            log_error "API server crashed or stopped!"
            
            # Rate limiting
            if [ $((now - last_api_restart)) -lt 300 ]; then
                ((api_restart_count++))
                if [ $api_restart_count -gt 3 ]; then
                    log_error "API server restarting too frequently ($api_restart_count times in 5 minutes)"
                    log_error "Waiting 60 seconds..."
                    sleep 60
                    api_restart_count=0
                fi
            else
                api_restart_count=0
            fi
            
            last_api_restart=$now
            start_api
        fi
    done
}

# Show logs
show_logs() {
    echo "=== Monitor Log (last 30 lines) ==="
    tail -30 "$MONITOR_LOG" 2>/dev/null || echo "No monitor logs"
    echo ""
    echo "=== Vite Log (last 20 lines) ==="
    tail -20 "$VITE_LOG" 2>/dev/null || echo "No vite logs"
    echo ""
    echo "=== API Server Log (last 20 lines) ==="
    tail -20 "$API_LOG" 2>/dev/null || echo "No API server logs"
}

# Handle script arguments
case "${1:-}" in
    --status|-s)
        status_check
        exit $?
        ;;
    --daemon|-d)
        run_daemon
        ;;
    --start)
        start_all
        ;;
    --stop)
        stop_all
        ;;
    --restart)
        restart_all
        ;;
    --logs|-l)
        show_logs
        ;;
    *)
        echo "Argent Dashboard Services Monitor"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  --status, -s        Check service status"
        echo "  --daemon, -d        Run continuous monitor (auto-restart)"
        echo "  --start             Start all services"
        echo "  --stop              Stop all services"
        echo "  --restart           Restart all services"
        echo "  --logs, -l          Show recent logs"
        echo ""
        echo "Services:"
        echo "  - Vite dev server (port $VITE_PORT)"
        echo "  - API server (port $API_PORT)"
        echo ""
        echo "Examples:"
        echo "  $0 --status         # Quick check"
        echo "  $0 --start          # Start all"
        echo "  $0 --daemon         # Monitor & keep alive"
        exit 1
        ;;
esac
