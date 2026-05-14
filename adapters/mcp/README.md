# Jibuxia MCP Server

> 让 Claude Desktop / Cursor 等 MCP 客户端访问记不下知识库

## 功能

提供三个工具：
- `jibuxia_ingest` — 收录 URL 到知识库
- `jibuxia_ask` — 问答搜索
- `jibuxia_status` — 查看知识库状态

## 安装

```bash
cd /path/to/jibuxia
npm install
```

## Claude Desktop 配置

在 `~/.config/Claude/claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "jibuxia": {
      "command": "node",
      "args": ["/path/to/jibuxia/adapters/mcp/server.js"]
    }
  }
}
```

## Cursor 配置

在 Cursor settings 中添加 MCP server：

```json
{
  "mcpServers": {
    "jibuxia": {
      "command": "node",
      "args": ["/path/to/jibuxia/adapters/mcp/server.js"]
    }
  }
}
```

## 使用

```
User: 收录 https://example.com/article
-> jibuxia_ingest({ url: "https://example.com/article" })

User: 记不下里有什么关于AI的内容？
-> jibuxia_ask({ query: "AI相关内容" })

User: 记不下状态如何？
-> jibuxia_status({})
```

## 依赖

- Node.js 18+
- Jibuxia 已配置 (`JIBUXIA_LLM_API_KEY` 环境变量)
- `@modelcontextprotocol/sdk` (已在根目录 package.json 中声明)
