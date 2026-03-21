#!/bin/bash
# ArgentOS Refactor Verification Script
# Checks for any remaining ArgentOS references that should have been renamed

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  ArgentOS Refactor Verification"
echo "========================================"
echo ""

cd "$(dirname "$0")/.."

ISSUES=0

# Function to check pattern and report
check_pattern() {
    local pattern="$1"
    local description="$2"
    local exclude_patterns="$3"

    local cmd="grep -ri '$pattern' --include='*.ts' --include='*.tsx' --include='*.json' . 2>/dev/null | grep -v node_modules | grep -v '.git' | grep -v dist/"

    if [ -n "$exclude_patterns" ]; then
        cmd="$cmd | grep -v '$exclude_patterns'"
    fi

    local count=$(eval "$cmd" | wc -l | tr -d ' ')

    if [ "$count" -gt 0 ]; then
        echo -e "${RED}✗${NC} $description: $count remaining"
        ISSUES=$((ISSUES + count))
        return 1
    else
        echo -e "${GREEN}✓${NC} $description: All replaced"
        return 0
    fi
}

echo "Checking class/type names..."
echo "----------------------------"

# Class names that should be Argent*
check_pattern "ArgentConfig" "ArgentConfig → ArgentConfig"
check_pattern "ArgentApp" "ArgentApp → ArgentApp"
check_pattern "ArgentPlugin" "ArgentPlugin* → ArgentPlugin*"
check_pattern "ArgentVersion" "ArgentVersion → ArgentVersion"
check_pattern "ArgentSkill" "ArgentSkill* → ArgentSkill*"
check_pattern "ArgentHook" "ArgentHook* → ArgentHook*"
check_pattern "ArgentPackage" "ArgentPackage* → ArgentPackage*"

echo ""
echo "Checking environment variables..."
echo "---------------------------------"

# Env vars that should be ARGENT_*
check_pattern "ARGENT_STATE_DIR" "ARGENT_STATE_DIR → ARGENT_STATE_DIR"
check_pattern "ARGENT_GATEWAY" "ARGENT_GATEWAY_* → ARGENT_GATEWAY_*"
check_pattern "ARGENT_PROFILE" "ARGENT_PROFILE → ARGENT_PROFILE"
check_pattern "ARGENT_AGENT" "ARGENT_AGENT_* → ARGENT_AGENT_*"
check_pattern "ARGENT_CONFIG" "ARGENT_CONFIG_* → ARGENT_CONFIG_*"
check_pattern "ARGENT_SKIP" "ARGENT_SKIP_* → ARGENT_SKIP_*"
check_pattern "ARGENT_UPDATE" "ARGENT_UPDATE_* → ARGENT_UPDATE_*"

echo ""
echo "Checking paths and directories..."
echo "----------------------------------"

# Config paths
check_pattern '\.argentos/' ".argentos/ → .argentos/"
check_pattern 'argent-sessions' "argent-sessions → argent-sessions"
check_pattern 'openclaw-auth-' "openclaw-auth-* → argent-auth-*"
check_pattern 'argent-gw-' "argent-gw-* → argent-gw-*"

echo ""
echo "Checking service identifiers..."
echo "--------------------------------"

check_pattern 'argent-gateway' "argent-gateway → argent-gateway"
check_pattern 'argent-macos' "argent-macos → argent-macos"
check_pattern 'argent-ios' "argent-ios → argent-ios"
check_pattern 'openclaw-android' "openclaw-android → argent-android"
check_pattern 'openclaw_bot' "openclaw_bot → argent_bot"

echo ""
echo "Checking package references..."
echo "-------------------------------"

check_pattern '"argent"' "package.json argent refs" "ARGENT_ARCHITECTURE\|CLAUDE.md\|MIGRATION.md\|README"
check_pattern 'openclaw/plugin-sdk' "openclaw/plugin-sdk → argentos/plugin-sdk"

echo ""
echo "========================================"

if [ "$ISSUES" -gt 0 ]; then
    echo -e "${RED}Found $ISSUES potential issues${NC}"
    echo ""
    echo "To see details, run:"
    echo "  grep -ri 'PATTERN' --include='*.ts' . | grep -v node_modules"
    exit 1
else
    echo -e "${GREEN}All refactors verified! ✓${NC}"
    exit 0
fi
