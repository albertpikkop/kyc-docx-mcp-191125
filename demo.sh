#!/bin/bash

# KYC Intel Demo Launcher
# One command to start everything for a flawless demo

set -e

echo "🚀 KYC Intel Demo Launcher"
echo "=========================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Kill any existing processes
echo -e "${YELLOW}🧹 Cleaning up old processes...${NC}"
pkill -f "tsx.*cli" 2>/dev/null || true
pkill -f "python.*http.server" 2>/dev/null || true
sleep 1

# Start MCP Server
echo -e "${BLUE}🔧 Starting MCP Server on port 3000...${NC}"
cd "$(dirname "$0")"
MCP_TRANSPORT=sse npx tsx src/mcp/cli.ts &
SERVER_PID=$!
sleep 3

# Check server health
echo -e "${YELLOW}🏥 Checking server health...${NC}"
for i in {1..10}; do
    if curl -s http://localhost:3000/healthz | grep -q "ok"; then
        echo -e "${GREEN}✅ Server is healthy!${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ Server failed to start"
        exit 1
    fi
    sleep 1
done

# Start static file server for wizard
echo -e "${BLUE}📁 Starting file server on port 8888...${NC}"
python3 -m http.server 8888 &
FILE_SERVER_PID=$!
sleep 1

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}   🎉 KYC Intel Demo Ready!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "   ${BLUE}Wizard:${NC}    http://localhost:8888/kyc-wizard.html"
echo -e "   ${BLUE}Inspector:${NC} http://localhost:8888/mcp-inspector.html"
echo -e "   ${BLUE}API Docs:${NC}  http://localhost:3000/docs"
echo ""
echo -e "${YELLOW}   Press Ctrl+C to stop all services${NC}"
echo ""

# Open wizard in browser
if command -v open &> /dev/null; then
    open "http://localhost:8888/kyc-wizard.html"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8888/kyc-wizard.html"
fi

# Wait and cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Shutting down demo...${NC}"
    kill $SERVER_PID 2>/dev/null || true
    kill $FILE_SERVER_PID 2>/dev/null || true
    pkill -f "tsx.*cli" 2>/dev/null || true
    pkill -f "python.*http.server.*8888" 2>/dev/null || true
    echo -e "${GREEN}✅ Demo stopped cleanly${NC}"
}

trap cleanup EXIT INT TERM

# Keep running
wait

