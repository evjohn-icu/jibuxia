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
LLM_PROVIDER=$(node -e "console.log(require('./config.json').llm?.provider || 'unknown')")
LLM_MODEL=$(node -e "console.log(require('./config.json').llm?.model || 'default')")
LLM_BASE_URL=$(node -e "console.log(require('./config.json').llm?.baseUrl || '')")
echo "OK: LLM provider: $LLM_PROVIDER"
echo "OK: LLM model: $LLM_MODEL"
if [ -n "$LLM_BASE_URL" ]; then
    echo "OK: LLM base URL: $LLM_BASE_URL"
fi
PROVIDER_API_KEY=""
case "$LLM_PROVIDER" in
    minimax)
        PROVIDER_API_KEY="${MINIMAX_API_KEY:-$ANTHROPIC_API_KEY}"
        ;;
    anthropic)
        PROVIDER_API_KEY="$ANTHROPIC_API_KEY"
        ;;
    openai)
        PROVIDER_API_KEY="$OPENAI_API_KEY"
        ;;
esac

if [ -z "$JIBUXIA_LLM_API_KEY" ] && [ -z "$PROVIDER_API_KEY" ]; then
    echo "WARNING: no LLM API key is set for provider: $LLM_PROVIDER"
    echo "         Set JIBUXIA_LLM_API_KEY or the provider-specific API key."
    echo "         MiniMax: MINIMAX_API_KEY or ANTHROPIC_API_KEY; Anthropic: ANTHROPIC_API_KEY; OpenAI: OPENAI_API_KEY."
    echo "         fetch/index/status can run; compile:llm and LLM answers need the key."
else
    echo "OK: LLM API key is set"
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
echo "To inspect the system:"
echo "  npm run status"
echo ""
echo "If node/npm are installed via Homebrew on this machine, run:"
echo '  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"'
echo ""
echo "Or run individual modules:"
echo "  npm run fetch        # Fetch URLs from raw/links/"
echo "  npm run compile:llm  # Compile wiki with LLM"
echo "  npm run ask \"?\"     # Ask a question"
echo "  npm run lint         # Run local health check"
echo ""
