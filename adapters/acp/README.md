# Jibuxia ACP Adapter

> 适用于标准 ACP 协议兼容平台的适配器

## 说明

此适配器用于标准 ACP 协议兼容平台，通过 WebSocket 接收 URL 并自动收录。

**注意**：OpenClaw 平台建议使用 `openclaw/` skill 适配器（更轻量，不需要维护 WebSocket 连接）。

## 依赖

- Node.js 18+
- `ws` package (已在根目录 package.json 中声明)
- `chokidar` package (已在根目录 package.json 中声明)

## 配置

编辑 `config.json`：

```json
{
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": ""
  },
  "session": {
    "key": "agent:main:link-collector",
    "label": "link-collector"
  }
}
```

## 运行

```bash
node adapters/acp/index.js
```

## ACP 协议格式

### 接收消息

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

### replyTo 字段

可选字段，指定处理完成后回复的目标 session。

### 回复格式

处理完成后发送：

```json
{
  "jsonrpc": "2.0",
  "method": "agent_message",
  "params": {
    "sessionKey": "agent:main:my-session",
    "content": [
      {
        "type": "text",
        "text": "记不下知识库更新完成！\n\n新增 3 个概念，2 篇文章。"
      }
    ]
  }
}
```

## 目录结构

```
adapters/acp/
├── index.js       # ACP 客户端
├── config.json    # ACP 配置
└── README.md
```
