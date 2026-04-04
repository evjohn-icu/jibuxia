#!/bin/bash
# 记不下 - ADHD 外脑系统 - 启动检查

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
LLM_APIKEY=$(node -e "console.log(require('./config.json').llm.apiKey)")
if [ -z "$LLM_APIKEY" ]; then
    echo "WARNING: LLM API key is empty in config.json"
else
    echo "OK: LLM provider: $LLM_PROVIDER"
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
echo "  npm start"
echo ""
echo "Or run individual modules:"
echo "  npm run fetch        # Fetch URLs from raw/links/"
echo "  npm run compile:llm  # Compile wiki with LLM"
echo "  npm run ask \"?\"     # Ask a question"
echo "  npm run lint:llm     # Run health check"
echo ""
