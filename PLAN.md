# 记不下（Jibuxia）代码改进计划

> 基于 Opus 代码审查结果，分 3 个 Phase 执行
> **状态：全部完成 ✅**

## Phase 1: 安全 + 基础架构（P0/P1）✅

### 1.1 API Key 移至环境变量
- `config.json` — 删除 `llm.apiKey` 字段 ✅
- `lib/llm-compiler.js` — 读 `process.env.JIBUXIA_LLM_API_KEY` ✅
- `lib/search.js` — 同上 ✅
- `lib/llm-lint.js` — 同上 ✅
- `.env.example` — 添加 `JIBUXIA_LLM_API_KEY=` ✅

### 1.2 提取共享 LLM 模块
- 新建 `lib/llm.js` — 提取 `createLlmClient()` 和 `callLlm()` ✅
- `lib/llm-compiler.js` — 改为 `import { callLlm } from './llm.js'` ✅
- `lib/search.js` — 同上 ✅
- `lib/llm-lint.js` — 同上 ✅

### 1.3 统一配置加载
- 新建 `lib/config.js` — 统一 `loadConfig()` + 路径解析 ✅
- 所有文件改为 `import { config, paths } from './config.js'` ✅
- 移除各文件中重复的 `join(__dirname, '..', 'config.json')` ✅

### 1.4 ACP 连接恢复
- `acp-client/index.js` — 添加断连自动重连（指数退避，最大 5 分钟）✅
- 添加心跳检测（30 秒 ping）✅

### 1.5 优雅关闭
- `scripts/orchestrate.js` — 添加 SIGINT/SIGTERM handler ✅
- 关闭前完成当前处理中的任务，清理 WebSocket 连接 ✅

## Phase 2: 可靠性（P1/P2）✅

### 2.1 输入验证
- `lib/fetcher.js` — URL 格式验证 + 域名黑名单 + 响应大小限制（10MB）✅
- 拒绝 localhost/内网 URL ✅

### 2.2 抓取限速
- `lib/fetcher.js` — 同域名间隔 2 秒，全局并发上限 3 ✅

### 2.3 异步文件操作
- `lib/indexer.js` — `readFileSync` → `readFile` ✅
- `lib/compiler.js` — 同上 ✅
- 其他文件按需改 ✅

### 2.4 Proper Logging
- 安装 `pino`（轻量）✅
- 新建 `lib/logger.js` ✅
- 全局替换 `console.log` → `logger.info` ✅

## Phase 3: Henry 桥接 + 清理 ✅

### 3.1 ACP 回传
- `acp-client/index.js` — 处理完成后发送结果到 `replyTo` session ✅
- `scripts/orchestrate.js` — compile 完成回调触发回传 ✅

### 3.2 ACP 消息格式文档
- `README.md` — 添加 ACP 接口规范（输入/输出消息格式）✅

### 3.3 代码清理
- 删除 `scripts/watch.js`（与 orchestrate.js 重复）✅
- 删除 `lib/output.js` 中未使用的 chart 函数 ✅
- 合并 `scripts/compile.js` 和 `lib/compiler.js` 入口 ✅

## 执行方式

每个 Phase 用 OpenCode ACP session 执行：
- Phase 1 → ✅ 已完成
- Phase 2 → ✅ Phase 1 完成后
- Phase 3 → ✅ Phase 2 完成后

预计总工时：~1-2 小时 OpenCode 执行时间
