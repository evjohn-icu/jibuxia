# 记不下

外脑系统，帮你把脑子里的杂念倒出来、收集、归类、整理，减少注意力碎片化。

## 核心功能

- **ACP 协议集成**：通过 WebSocket 接收 OpenClaw 发送的 URL，支持 `replyTo` 回复
- **自动抓取**：将 URL 内容转换为 Markdown 保存，带限速和输入验证
- **LLM 编译**：使用 MiniMax M2.7 将原始内容编译为结构化 wiki
- **语言保持**：中文来源自动生成中文 wiki，英文来源生成英文 wiki
- **Q&A 搜索**：基于内容的智能问答
- **自动体检**：定期检查知识库健康状态
- **安全可靠**：API Key 通过环境变量管理，指数退避重连，心跳保活

## 系统架构

```
OpenClaw → [ACP WebSocket] → raw/links/ → [fetcher] → raw/content/
                                                        ↓
                                            ┌───────────┴───────────┐
                                            ↓                       ↓
                                         wiki/                [chunks.json]
                                      (LLM编译)                      ↓
                                            ↓                       ↓
                                     ┌──────┴──────┐          [search]
                                     ↓             ↓
                                  concepts/      articles/
```

## ACP 协议格式

### 接收消息格式

ACP 客户端通过 WebSocket 接收消息，支持以下格式：

```json
{
  "type": "text",
  "content": [
    {
      "type": "text",
      "text": "请处理这些 URL: https://example.com/article"
    }
  ],
  "replyTo": "agent:main:my-session"
}
```

或：

```json
{
  "method": "agent_message",
  "params": {
    "content": [
      {
        "type": "text",
        "text": "请处理这些 URL: https://example.com/article"
      }
    ],
    "replyTo": "agent:main:my-session"
  }
}
```

### replyTo 字段

- 可选字段，指定处理完成后回复的目标 session
- 如果指定，ACP 客户端会在处理完成后发送结果到该 session
- 值格式为 `agent:main:<session-name>`

### 回复格式

处理完成后，ACP 客户端会发送如下回复：

```json
{
  "jsonrpc": "2.0",
  "method": "agent_message",
  "params": {
    "sessionKey": "agent:main:my-session",
    "content": [
      {
        "type": "text",
        "text": "记不下知识库更新完成！\n\n新增 3 个概念，2 篇文章。\n\n查看: wiki/index.md"
      }
    ]
  }
}
```

## 目录结构

```
jibuxia/
├── acp-client/           # ACP 协议客户端（独立运行）
│   └── index.js          # 接收 OpenClaw 发来的 URL，支持 replyTo 回复
├── lib/
│   ├── config.js         # 统一配置加载
│   ├── logger.js         # pino 日志封装
│   ├── llm.js            # 共享 LLM 客户端
│   ├── fetcher.js        # URL → Markdown 抓取（限速 + 验证）
│   ├── compiler.js       # 基础编译 + fullCompile()
│   ├── indexer.js        # JSON 索引存储
│   ├── search.js         # Q&A 搜索
│   ├── lint.js           # 本地健康检查
│   ├── llm-compiler.js   # ★ LLM 驱动编译（核心）
│   ├── llm-lint.js       # LLM 驱动的体检
│   └── output.js         # Marp/图表输出
├── scripts/
│   ├── orchestrate.js    # 主编排器（ACP + 监控 + 自动编译）
│   ├── ask.js            # 问答 CLI
│   ├── lint.js           # 体检 CLI
│   ├── fetch.js          # 抓取 CLI
│   ├── index.js          # 索引 CLI
│   └── status.js         # 状态查看
├── raw/
│   ├── links/            # URL 文件（ACP 写入）
│   └── content/          # 抓取的完整内容
├── wiki/
│   ├── index.md          # 入口索引
│   ├── concepts/          # 概念页面
│   ├── articles/         # 主题文章
│   └── health-reports/   # 体检报告
├── data/
│   └── reply-queue/      # ACP 回复队列
├── config.json           # 配置文件（不含 apiKey）
├── .env.example          # 环境变量模板
└── package.json
```

## 快速开始

### 1. 配置

1. 复制 `.env.example` 为 `.env`，设置 `JIBUXIA_LLM_API_KEY`

2. 编辑 `config.json`：

```json
{
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": ""
  },
  "session": {
    "key": "agent:main:link-collector",
    "label": "link-collector"
  },
  "llm": {
    "provider": "minimax",
    "model": "MiniMax-M2.7",
    "baseUrl": "https://api.minimaxi.com/v1"
  },
  "compile": {
    "debounceMs": 30000,
    "batchSize": 10
  }
}
```

### 2. 启动

```bash
# 启动完整系统（ACP + 监控 + 自动编译）
npm start

# 或单独运行各模块
npm run compile:llm  # LLM 编译
npm run ask "问题"    # Q&A
```

### 3. 使用

1. 在 OpenClaw 中发送包含 URL 的消息到 `agent:main:link-collector` session
2. ACP client 接收 URL 并写入 `raw/links/`
3. Fetcher 自动抓取内容到 `raw/content/`
4. LLM 编译器自动编译到 `wiki/`

## CLI 命令

| 命令 | 说明 |
|------|------|
| `npm start` | 启动完整系统（ACP + 监控 + 自动编译） |
| `npm run compile` | 基础编译 + 索引更新 |
| `npm run compile:llm` | LLM 编译 |
| `npm run fetch` | 抓取 raw/links/ 中的 URL |
| `npm run index` | 更新搜索索引 |
| `npm run lint` | 本地体检 |
| `npm run lint:llm` | LLM 体检 |
| `npm run ask "问题"` | 搜索并显示结果 |
| `npm run status` | 查看知识库状态 |

## 当前状态

- **源文件**：15 个已抓取的内容
- **概念**：18 个 compiled concepts
- **文章**：6 个 compiled articles
- **语言支持**：已修复中文来源 → 中文 wiki 的问题

## MiniMax M2.7 集成注意事项

1. **Endpoint**: `https://api.minimaxi.com/v1`
2. **Model**: `MiniMax-M2.7`（注意大小写）
3. **Temperature**: 必须设置为 1.0（0.0 会报错）
4. **思考标签**：需移除 `<thinking>` 等标签
5. **extra_body**: 支持 `reasoning_split: true`

## 语言保持实现

在 `lib/llm-compiler.js` 中实现：

```javascript
function detectLanguage(text) {
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(text) ? 'chinese' : 'english';
}
```

每个源都会标注语言：
```
**[LANGUAGE: CHINESE]** - This source is in Chinese. You MUST write the wiki page in Chinese.
```

## 依赖

- Node.js 18+
- OpenClaw Gateway（用于 ACP 接收）
- LLM API（MiniMax M2.7）

## 项目亮点

1. **轻量级**：使用 JSON 文件存储，无需数据库
2. **全自动化**：文件监控 + 自动编译
3. **语言感知**：正确处理中英文内容的混合来源
4. **Wiki 风格**：使用 `[[page-name]]` 语法组织知识图谱
5. **反向链接**：自动追踪页面间的引用关系
