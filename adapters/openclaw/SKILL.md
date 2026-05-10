# Skill: jibuxia-openclaw

## Description

记不下外脑系统的 URL 收录 skill。当消息包含 URL 时，自动调用 ingest.js 进行抓取、编译和索引。

## Triggers

- 消息包含 `http://` 或 `https://`
- 关键词：收录、保存、抓取、ingest、收藏

## Command

```bash
node {{JIBUXIA_PATH}}/scripts/ingest.js {{URL}} --json
```

## Output

JSON 格式：
```json
{
  "url": "...",
  "status": "ok|error|skipped",
  "skipped": true|false,
  "skippedReason": "duplicate|null",
  "contentPath": "...",
  "wikiPages": [],
  "indexedChunks": 0,
  "compileStatus": "ok|warning|skipped",
  "title": "..."
}
```

## Error Handling

- `status: error` - 抓取或编译失败
- `status: skipped` - URL 已收录（去重）
- `status: ok` - 成功

## Example

User: "帮我收录这个文章 https://example.com/ai-news"

Agent response: "已收录至记不下知识库：文章标题"
