# Jibuxia Webhook Adapter

> 通过 HTTP POST 接收 URL 进行收录

## 功能

轻量 HTTP webhook，任意能发 HTTP 请求的系统都能用。

## 运行

```bash
node adapters/webhook/server.js
```

默认端口：`3456`

可通过环境变量修改：
```bash
JIBUXIA_WEBHOOK_PORT=8080 node adapters/webhook/server.js
```

## API

### POST /ingest

收录一个 URL。

**Request:**
```bash
curl -X POST http://localhost:3456/ingest \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article"}'
```

**Response:**
```json
{
  "url": "https://example.com/article",
  "status": "ok",
  "skipped": false,
  "contentPath": "raw/content/2026-04-08-abc123.md"
}
```

### 参数

| 字段 | 类型 | 说明 |
|------|------|------|
| url | string | 要收录的 URL（必填） |
| force | boolean | 强制重新收录（跳过去重） |

## 目录结构

```
adapters/webhook/
├── server.js
├── package.json
└── README.md
```
