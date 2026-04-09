# 记不下 — 通用兼容方案 v2.1

> 目标：记不下作为通用外脑工具，支持多种接入方式，不绑死任何平台
> 创建：2026-04-07 | 更新：2026-04-08
> 状态：全部完成 ✅ | 更新：2026-04-09

---

## 设计原则

1. **核心是 CLI** — 所有功能通过 `ingest.js` 暴露，任何系统都能调用
2. **适配器模式** — ACP / OpenClaw / MCP / Webhook 各一个薄适配器
3. **增量收录** — URL hash 去重，已收录的跳过
4. **扁平架构** — 删除 orchestrate.js 中间层，逻辑并入 ingest.js

---

## 架构

```
                    ┌─────────────────────────────┐
                    │        记不下 Core           │
                    │                             │
                    │  lib/fetcher.js             │
                    │  lib/llm-compiler.js        │
                    │  lib/search.js              │
                    │  lib/indexer.js              │
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

---

## Phase 1：创建 `scripts/ingest.js` — 通用 CLI 入口（P0）

单 URL 端到端处理，带增量去重：

```bash
# 基本用法
node scripts/ingest.js https://example.com/article

# JSON 输出（方便程序解析）
node scripts/ingest.js https://example.com/article --json

# 只抓取不编译
node scripts/ingest.js https://example.com/article --fetch-only

# 强制重新收录（跳过去重）
node scripts/ingest.js https://example.com/article --force

# stdin 批量
echo "https://a.com\nhttps://b.com" | node scripts/ingest.js --stdin
```

### 增量去重

- `data/ingested.json` — 记录已收录 URL 的 MD5 hash
- 收录前检查 hash，已存在则跳过（除非 --force）
- 格式：`{ "hash": { "url": "...", "ingestedAt": "...", "wikiPath": "..." } }`

### lib 改动

- `lib/fetcher.js` — 新增 `fetchSingleUrl(url)` 导出
- `lib/llm-compiler.js` — 新增 `compileSingle(contentPath)` 导出

### JSON 输出格式

```json
{
  "url": "https://example.com/article",
  "status": "ok",
  "title": "文章标题",
  "summary": "一句话摘要",
  "tags": ["tag1", "tag2"],
  "language": "chinese",
  "wikiPath": "wiki/concepts/article-title.md",
  "contentPath": "raw/content/2026-04-07-abc123.md",
  "skipped": false
}
```

预计：30 min

---

## Phase 2a：OpenClaw Skill 适配（P0）

```
adapters/openclaw/
├── SKILL.md          # OpenClaw skill 定义
└── README.md         # 安装说明
```

SKILL.md 内容：
- 触发条件：消息包含 URL
- 执行：`node /path/to/jibuxia/scripts/ingest.js <url> --json`
- 解析 JSON 输出 → 格式化回复用户

同时更新 Henry agent 的 SOUL.md 引用此 skill。

预计：15 min

---

## Phase 2b：MCP Server 适配（P1）

```
adapters/mcp/
├── server.js         # MCP server
├── package.json      # 依赖 @modelcontextprotocol/server
└── README.md
```

暴露的 tools：
- `jibuxia_ingest` — 收录 URL（调用 ingest.js）
- `jibuxia_ask` — 问答搜索（调用 ask.js）
- `jibuxia_status` — 知识库状态（调用 status.js）

使用 `@modelcontextprotocol/server` 官方库。

预计：30 min

---

## Phase 2c：ACP 适配器整理（P1）

```
adapters/acp/
├── index.js          # 现有 acp-client/index.js（修复 send→sendWs bug）
├── config.json       # ACP 连接配置
├── package.json
└── README.md         # 说明：适用于标准 ACP 兼容平台
```

- 从 `acp-client/` 移入 `adapters/acp/`
- 修复 `send` → `sendWs` bug
- README 说明：此适配器用于标准 ACP 协议兼容平台，OpenClaw 请用 skill 适配

预计：10 min

---

## Phase 2d：Webhook 适配（P2）

```
adapters/webhook/
├── server.js         # 轻量 HTTP server
├── package.json
└── README.md
```

```bash
curl -X POST http://localhost:3456/ingest \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article"}'
```

预计：20 min

---

## Phase 3：清理和重组（P1）

### 删除

- `scripts/orchestrate.js` — 逻辑已并入 ingest.js
- `scripts/watch.js` — 已在 PLAN v1 中删除（确认）
- `acp-client/` 目录 — 已移入 `adapters/acp/`

### 最终目录结构

```
jibuxia/
├── lib/                  # 核心库
│   ├── config.js
│   ├── logger.js
│   ├── llm.js
│   ├── fetcher.js        # + fetchSingleUrl()
│   ├── llm-compiler.js   # + compileSingle()
│   ├── compiler.js
│   ├── indexer.js
│   ├── search.js
│   ├── lint.js
│   ├── llm-lint.js
│   └── output.js
├── scripts/
│   ├── ingest.js         # ★ 核心入口（fetch + compile + 去重）
│   ├── ask.js
│   ├── fetch.js
│   ├── index.js
│   ├── lint.js
│   └── status.js
├── adapters/
│   ├── acp/              # 标准 ACP 协议适配
│   ├── openclaw/         # OpenClaw skill 适配
│   ├── mcp/              # MCP server 适配
│   └── webhook/          # HTTP webhook 适配
├── raw/
│   ├── links/
│   └── content/
├── wiki/
│   ├── index.md
│   ├── concepts/
│   ├── articles/
│   └── health-reports/
├── data/
│   └── ingested.json     # ★ 增量去重记录
├── config.json
├── .env.example
├── package.json
└── README.md             # 更新：反映多适配器架构
```

### README 更新

```markdown
## 接入方式

| 方式 | 适用场景 | 常驻进程 | 依赖 |
|------|---------|---------|------|
| CLI | 脚本/cron/手动 | 否 | Node.js |
| OpenClaw Skill | OpenClaw agent | 否 | OpenClaw |
| ACP | ACP 兼容平台 | 是 | ws |
| MCP Server | Claude Desktop/Cursor | 是 | @mcp/server |
| Webhook | 任意 HTTP 客户端 | 是 | express |
| stdin pipe | Unix 管道 | 否 | Node.js |
```

预计：15 min

---

## 执行顺序

```
Phase 1 (ingest.js)  ──→  Phase 2a (OpenClaw skill)  ──→  可用 ✅
                      ├──→  Phase 2b (MCP server)     ──→  通用 ✅
                      ├──→  Phase 2c (ACP 整理)       ──→  兼容 ✅
                      └──→  Phase 2d (Webhook)        ──→  全覆盖 ✅
                                                       ↓
                                                  Phase 3 (清理)
```

Phase 1 + 2a 做完 = OpenClaw 可用
Phase 2b 做完 = Claude Desktop / Cursor 可用
全部做完 = 任何平台可用

总预计：~2 小时
