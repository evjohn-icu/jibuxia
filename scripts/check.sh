#!/bin/bash
# 记不下 - ADHD 外脑系统 - 启动检查

BREW_BIN="/home/linuxbrew/.linuxbrew/bin"
if [ -d "$BREW_BIN" ]; then
    export PATH="$BREW_BIN:$PATH"
fi

echo "==================================="
echo "记不下 Pre-flight Check"
echo "==================================="
echo ""

# Check Node.js
echo "[1/5] Checking Node.js..."
node --version || { echo "ERROR: Node.js not found"; exit 1; }
echo "OK: Node.js $(node --version)"
echo ""

# Check npm
echo "[2/5] Checking npm..."
npm --version || { echo "ERROR: npm not found"; exit 1; }
echo "OK: npm $(npm --version)"
echo ""

# Check dependencies
echo "[3/5] Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi
npm ls --depth=0 >/dev/null || { echo "ERROR: Dependencies are missing or invalid. Run: npm install"; exit 1; }
if [ -f "adapters/mcp/package.json" ]; then
    if [ ! -d "adapters/mcp/node_modules" ]; then
        echo "Installing MCP adapter dependencies..."
        (cd adapters/mcp && npm install)
    fi
    (cd adapters/mcp && npm ls --depth=0 >/dev/null) || { echo "ERROR: MCP adapter dependencies are missing or invalid"; exit 1; }
fi
echo "OK: Dependencies installed"
echo ""

# Check config
echo "[4/5] Checking config.json..."
if [ ! -f "config.json" ]; then
    echo "ERROR: config.json not found"
    exit 1
fi
node -e "JSON.parse(require('fs').readFileSync('config.json'))" 2>/dev/null || { echo "ERROR: Invalid JSON in config.json"; exit 1; }
echo "OK: config.json is valid"
echo ""

# Check LLM config
echo "[5/5] Checking LLM configuration..."
LLM_PROVIDER=$(node -e "console.log(require('./config.json').llm.provider)")
if [ -z "$JIBUXIA_LLM_API_KEY" ]; then
    echo "WARNING: JIBUXIA_LLM_API_KEY is not set; fetch-only/status work, LLM compile/ask will need it"
else
    echo "OK: LLM provider: $LLM_PROVIDER (JIBUXIA_LLM_API_KEY set)"
fi
echo ""

# Check directories
echo "Checking directories..."
for dir in raw/links raw/content wiki wiki/concepts wiki/articles wiki/assets data; do
    if [ ! -d "$dir" ]; then
        echo "Creating $dir..."
        mkdir -p "$dir"
    fi
done
echo "OK: All directories ready"
echo ""

echo "==================================="
echo "Pre-flight check complete!"
echo "==================================="
echo ""
echo "To start the system:"
echo "  npm run status"
echo ""
echo "Or run individual modules:"
echo "  npm run ingest -- <url> --json"
echo "  npm run fetch        # Fetch URLs from raw/links/"
echo "  npm run compile:llm  # Compile wiki with LLM"
echo "  npm run ask \"?\"     # Ask a question"
echo "  npm run lint:llm     # Run health check"
echo ""
