# 记不下

外脑系统，帮你把脑子里的杂念倒出来、收集、归类、整理，减少注意力碎片化。

## 核心功能

- **通用 CLI**：一个入口处理所有 URL 收录逻辑
- **多适配器支持**：CLI / OpenClaw Skill / MCP / Webhook / ACP 多路接入
- **增量收录**：URL hash 去重，已收录跳过，支持强制重抓
- **LLM 编译**：使用 MiniMax M2.7 将原始内容编译为结构化 wiki
- **语言保持**：中文来源自动生成中文 wiki，英文来源生成英文 wiki
- **Q&A 搜索**：基于内容的智能问答
- **安全可靠**：API Key 通过环境变量管理

## 系统架构

```
                     ┌─────────────────────────────┐
                     │        记不下 Core           │
                     │                             │
                     │  lib/fetcher.js             │
                     │  lib/llm-compiler.js        │
                     │  lib/search.js              │
                     │  lib/indexer.js             │
                     │                             │
                     │  scripts/ingest.js  ← 核心入口│
                     │  scripts/ask.js             │
                     │  scripts/status.js          │
                     └──────────┬──────────────────┘
                                │
          ┌─────────────┬───────┼───────┬─────────────┐
          │             │       │       │             │
    ┌─────┴─────┐ ┌────┴────┐ ┌┴────┐ ┌┴──────┐ ┌───┴────┐
    │ CLI 直调  │ │  ACP    │ │ OC  │ │  MCP  │ │Webhook │
    │           │ │ adapter │ │Skill│ │Server │ │Server  │
    │ node      │ │         │ │     │ │       │ │        │
    │ ingest.js │ │adapters/│ │ OC  │ │@mcp/  │ │ HTTP   │
    │ <url>     │ │ acp/    │ │agent│ │server │ │ POST   │
    └───────────┘ └─────────┘ └─────┘ └───────┘ └────────┘
```

## 目录结构

```
jibuxia/
├── lib/                  # 核心库
│   ├── config.js         # 统一配置加载
│   ├── logger.js         # pino 日志封装
│   ├── llm.js            # 共享 LLM 客户端
│   ├── fetcher.js        # URL → Markdown 抓取
│   ├── compiler.js       # 基础编译
│   ├── indexer.js        # JSON 索引存储
│   ├── search.js         # Q&A 搜索
│   ├── lint.js           # 本地健康检查
│   ├── llm-compiler.js   # ★ LLM 驱动编译
│   ├── llm-lint.js       # LLM 体检
│   └── output.js         # 输出工具
├── scripts/
│   ├── ingest.js         # ★ 核心入口（fetch + compile + 去重）
│   ├── ask.js            # 问答 CLI
│   ├── fetch.js          # 抓取 CLI
│   ├── index.js          # 索引 CLI
│   ├── lint.js           # 体检 CLI
│   └── status.js         # 状态查看
├── adapters/
│   ├── acp/              # 标准 ACP 协议适配器
│   ├── openclaw/         # OpenClaw Skill 适配器
│   ├── mcp/              # MCP Server（Claude Desktop / Cursor）
│   └── webhook/          # HTTP Webhook 适配器
├── raw/
│   ├── links/
│   └── content/
├── wiki/
│   ├── index.md
│   ├── concepts/
│   ├── articles/
│   └── health-reports/
├── data/
│   ├── chunks.json       # 搜索索引
│   └── ingested.json     # 已收录 URL 记录
├── config.json
├── .env.example
└── package.json
```

## 快速开始

### 1. 配置

```bash
export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"  # 如果 Node/npm 由 Linuxbrew 安装
npm install
(cd adapters/mcp && npm install)

cp .env.example .env
# 编辑 .env，设置 JIBUXIA_LLM_API_KEY
```

### 2. CLI 使用

```bash
# 收录单个 URL
npm run ingest -- https://example.com/article

# JSON 输出（方便程序解析）
node scripts/ingest.js https://example.com/article --json
# 或：
npm run --silent ingest -- https://example.com/article --json

# 只抓取不编译
npm run ingest -- https://example.com/article --fetch-only

# 强制重新收录
npm run ingest -- https://example.com/article --force

# 批量收录
echo "https://a.com\nhttps://b.com" | npm run ingest -- --stdin

# 问答
npm run ask -- "AI 是什么？"

# 查看状态
npm run status
```

`ingest` 当前采用“增量触发、全库上下文编译”：新 URL 抓取完成后，会让 LLM 基于整个已有 raw content/wiki 上下文创建或更新页面。没有设置 `JIBUXIA_LLM_API_KEY` 时，fetch-only、status、索引和本地搜索仍可用；LLM 编译和回答会返回清楚的 warning/error。

机器调用 `--json` 时优先使用 `node scripts/ingest.js ... --json` 或 `npm run --silent ...`，避免 npm 自己的脚本头污染 stdout。

## 接入方式

| 方式 | 适用场景 | 常驻进程 | 说明 |
|------|---------|---------|------|
| CLI | 脚本/cron/手动 | 否 | `npm run ingest` |
| OpenClaw Skill | OpenClaw agent | 否 | `adapters/openclaw/SKILL.md` |
| ACP | ACP 兼容平台 | 是 | `adapters/acp/` |
| MCP Server | Claude Desktop / Cursor | 是 | `adapters/mcp/` |
| Webhook | 任意 HTTP 客户端 | 是 | `adapters/webhook/` |
| stdin pipe | Unix 管道 | 否 | `echo "url" \| npm run ingest -- --stdin` |

## ACP 协议格式

### 接收消息

```json
{
  "type": "text",
  "content": [{"type": "text", "text": "请处理 URL: https://example.com"}],
  "replyTo": "agent:main:my-session"
}
```

### 回复格式

```json
{
  "jsonrpc": "2.0",
  "method": "agent_message",
  "params": {
    "sessionKey": "agent:main:my-session",
    "content": [{"type": "text", "text": "收录完成！"}]
  }
}
```

## 依赖

- Node.js 18+
- LLM API（MiniMax M2.7 或 OpenAI/Anthropic）

## 项目亮点

1. **轻量级**：JSON 文件存储，无需数据库
2. **多平台**：任何能发 HTTP/WS 的系统都能接入
3. **语言感知**：正确处理中英文混合来源
4. **Wiki 风格**：`[[page-name]]` 语法组织知识图谱
5. **增量收录**：hash 去重，支持强制重抓
