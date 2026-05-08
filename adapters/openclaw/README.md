# Jibuxia OpenClaw Skill

> 记不下外脑系统的 OpenClaw Agent 集成

## 功能

当 agent 收到包含 URL 的消息时，自动调用记不下进行收录。

## 触发条件

- 消息内容包含 `http://` 或 `https://` URL
- 用户请求"收录"、"保存"、"ingest"、"抓取"等关键词

## 执行命令

```bash
node /path/to/jibuxia/scripts/ingest.js <url> --json
```

## 输出格式

```json
{
  "url": "https://example.com/article",
  "status": "ok",
  "title": "文章标题",
  "skipped": false,
  "contentPath": "raw/content/2026-04-08-abc123.md",
  "wikiPages": [],
  "indexedChunks": 0,
  "compileStatus": "ok"
}
```

## 在 SOUL.md 中引用

```
## 工具

当用户发送包含 URL 的内容时，自动调用 jibuxia 进行收录：

参考 skill: jibuxia-openclaw
```

## 安装

1. 将此目录链接到 OpenClaw skills 目录
2. 或在 agent 的 SOUL.md 中直接引用执行路径

## 依赖

- Node.js 18+
- Jibuxia 已配置 (`JIBUXIA_LLM_API_KEY` 环境变量)
