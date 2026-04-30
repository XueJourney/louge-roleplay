# DEBUG 与日志指南

## 日志级别

日志统一由 `src/lib/logger.js` 输出。推荐：

```bash
LOG_LEVEL=debug npm run dev
# 或生产环境临时调试：
LOG_LEVEL=debug npm run start
```

级别顺序：`debug < info < warn < error`。生产默认建议 `info`，排查问题时改为 `debug`。

## 日志文件与后台查询

日志现在会按日期拆分，避免长期塞进单个文件：

- `logs/app-YYYY-MM-DD.log`：业务结构化日志
- `logs/app-error-YYYY-MM-DD.log`：error 级结构化日志
- `logs/access-YYYY-MM-DD.log`：morgan HTTP access 日志
- `logs/app.log` / `logs/app-error.log`：systemd 旧追加文件，仍会被后台查询兼容读取

后台入口：`/admin/logs`。支持日期查询、等级筛选、文件报错筛选、类型报错筛选、函数报错筛选和分页。

## requestId

`src/middleware/request-context.js` 会给每个请求生成 `requestId`，错误页也会展示。排障时：

```bash
grep '<requestId>' logs/app-*.log logs/app-error-*.log logs/app.log logs/app-error.log
# systemd 部署时：
journalctl -u ai-roleplay-site.service --since '30 min ago' | grep '<requestId>'
```

## 常见问题排查

### 1. 聊天流式生成结束后显示异常

检查顺序：

1. 浏览器 Console 是否有 JS 报错。
2. Network 中 `/chat/:id/message/stream` 是否持续返回 `application/x-ndjson`。
3. 后端日志是否有 `LLM provider request start`、`LLM provider response received`、`LLM gateway request failed`。
4. 前端 `window.renderRichContent` 是否存在，`public/js/chat-page.js` 是否为最新版本（必要时强刷）。

### 2. Markdown / think 折叠不显示

检查：`public/js/chat-page.js` 的 `renderRichContent`、`collectFoldBlocks`、`markdownToHtml`，以及 `public/styles/site-pages/52-rich-content.css` 是否加载。

### 3. 登录/注册失败

看日志中的 `Register validation failed`、`Register succeeded`、`Login failed`、`Login succeeded`。日志会脱敏邮箱/手机。

### 4. 数据库异常

- `[db] MySQL 连接失败，自动降级到 SQLite`：检查 `DATABASE_URL`。
- SQLite 本地库：`data/local.db`。
- 初始化/迁移：`npm run db:init`。

### 5. Redis / 缓存异常

- `[redis] REDIS_URL 未设置，使用内存模式`：开发可接受，生产不建议。
- 会话消息缓存异常不应阻塞业务；会记录 warning 并回源 DB。聊天页首屏已改为轻量读取。

## 全流程测试

- 入口：`npm run full-flow:test`。
- 覆盖：DB/Redis、用户创建与默认套餐、角色创建/编辑、当前显示链、真实 LLM 流式回复与输入优化、聊天页渲染、后台对话/日志查询、删除保护。
- 测试脚本使用唯一临时数据，结束时会尽量删除新增用户、角色、会话、LLM job/usage 记录。若中途被强杀，可按输出的 userId / characterId / conversationId 做人工清理。

## 加日志约定

- 业务成功：`logger.info('xxx succeeded', { requestId, ... })`
- 可恢复异常：`logger.warn('xxx failed but fallback', { requestId, error })`
- 不可恢复异常：`logger.error('xxx failed', { requestId, error, stack })`
- 高频细节：`logger.debug('xxx detail', { requestId, ids/counts })`，避免输出完整 prompt、密码、token、API key。
