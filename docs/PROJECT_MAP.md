# ai-roleplay-site 项目梳理

> 本文档由 `scripts/update-docs-debug.js` 生成并可手工补充。目标是让后续维护者快速知道“文件在哪、谁调用谁、怎么 DEBUG”。

## 1. 项目定位

`ai-roleplay-site` 是一个 Express + EJS 的多用户 AI 角色对话站点，产品名“楼阁”。核心能力包括注册登录、角色创建、线性对话、重写/编辑、LLM Provider 管理、套餐额度、流式生成和富文本展示。

## 2. 目录职责

| 目录/文件 | 职责 |
|---|---|
| `src/server.js` | 应用启动壳，负责全局中间件和路由挂载。 |
| `src/routes/` | HTTP 路由编排层；目前主要集中在 `web-routes.js`。 |
| `src/services/` | 业务服务层；角色、会话、LLM、套餐、验证码等核心逻辑都在这里。 |
| `src/lib/` | 基础设施：数据库、Redis、日志。 |
| `src/middleware/` | Express 中间件：请求上下文、鉴权、i18n、错误处理。 |
| `src/views/` | EJS 页面和局部模板。 |
| `public/js/` | 浏览器端页面脚本。 |
| `public/styles/` | 全站样式拆分文件。 |
| `scripts/` | 初始化、健康检查、烟测、临时 E2E/单测脚本。 |
| `docs/` | 架构、风险、调试和维护文档。 |
| `data/` | 本地 SQLite 数据库目录，生产/开发数据，不应提交。 |
| `logs/` | 运行日志目录，不应提交。 |

## 3. 主要调用链

### 页面请求

`browser -> src/server.js -> middleware(requestContext/i18n/session) -> src/routes/web-routes.js -> service -> db/redis -> renderPage(EJS layout)`

### 聊天流式生成

`public/js/chat-page.js -> POST /chat/:id/message/stream -> createNdjsonResponder -> streamChatReplyToNdjson -> llm-gateway-service -> provider SSE -> NDJSON -> 前端 renderRichContent`

### 当前显示链读取

`renderChatPage/load history -> conversation-service.buildConversationPathView -> recursive CTE path query -> EJS/partial`

### 注册验证码

`register-page.js -> /api/send-email-code 或 /api/send-phone-code -> captcha-service.verifyCaptcha -> verification-service -> email/sms service -> Redis code`

## 4. JS 文件地图

| 文件 | 职责 / 调用说明 |
|---|---|
| `src/config.js` | 环境变量解析与隐私安全配置摘要。被 server、service、脚本读取。 |
| `src/i18n.js` | 服务端/客户端共用国际化词典与 HTML 文本翻译工具。被 i18n 中间件和渲染层调用。 |
| `src/lib/db-sqlite-schema.js` | SQLite 初始化 schema 与种子数据，供 db.js 首次创建本地库时调用。 |
| `src/lib/db.js` | 数据库抽象层，MySQL 优先、SQLite 兜底，提供 query/withTransaction。所有 service 的 DB 入口。 |
| `src/lib/logger.js` | 统一结构化日志输出，支持 LOG_LEVEL 过滤和 DEBUG 开关。所有后端模块应通过它写日志。 |
| `src/lib/redis.js` | Redis 客户端与内存降级实现，供 session、验证码、缓存、限流使用。 |
| `src/middleware/auth.js` | 登录/管理员鉴权中间件，保护 dashboard/admin/chat 等页面。 |
| `src/middleware/error-handler.js` | 全局错误转译与错误页渲染，避免向页面泄露堆栈。 |
| `src/middleware/i18n.js` | 根据 query/cookie/Accept-Language 解析语言，并向 req/res.locals 注入 t()。 |
| `src/middleware/request-context.js` | 为每个请求注入 requestId/currentUser，后续日志和错误页用它串联。 |
| `src/routes/web-routes.js` | 主 Web 路由注册文件：公开页、认证、后台、角色、线性聊天、重写/编辑/流式接口。依赖 service 层完成业务。 |
| `src/server-helpers.js` | 路由公共辅助：页面渲染、参数解析、账号脱敏、聊天页 view model、NDJSON 输出。被 web-routes.js 调用。 |
| `src/server.js` | Express 启动入口：等待 DB/Redis、装配全局中间件、注册路由、启动监听。调用链起点。 |
| `src/services/admin-conversation-service.js` | /** 管理后台全局对话记录查询服务。 调用说明： - `src/routes/web-routes.js` 的 `/admin/conversations` 调用 `listAdminConversations()` 渲染全局会话列表。 - `src/routes/web-routes.js` 的 `/admin/conversations/:id` 调用 `getAdminConversationDetail()` 查看单条会话完整消息。 - 支持按用户、角色卡、日期和删除状态筛选；后台可以恢复或永久删除软删除数据。 / |
| `src/services/admin-service.js` | 后台首页聚合查询：用户套餐、Provider 列表、概览统计。 |
| `src/services/ai-service.js` | 旧版直连 OpenAI 兼容接口服务；新路径优先使用 llm-gateway-service。 |
| `src/services/aliyun-sms-service.js` | 阿里云短信验证码发送封装。被 verification-service 调用。 |
| `src/services/captcha-service.js` | 图形验证码生成、刷新、读取与校验。依赖 Redis/内存缓存。 |
| `src/services/character-service.js` | 角色 CRUD 与可见性控制。被首页、dashboard、角色编辑和开聊流程调用。 |
| `src/services/conversation-service.js` | 会话/消息核心服务：消息写入、当前显示链读取、编辑、重写、独立对话克隆和删除保护。聊天路由主要依赖它。 |
| `src/services/email-service.js` | Resend 邮件验证码发送封装。被 verification-service 调用。 |
| `src/services/font-proxy-service.js` | Google Fonts 代理与缓存，避免页面字体资源直接失败。被 /fonts/* 路由调用。 |
| `src/services/llm-gateway-service.js` | LLM 网关核心：Provider 选择、额度校验、上下文裁剪、队列、流式解析、用量记录。 |
| `src/services/llm-provider-service.js` | 后台 Provider 管理、模型列表拉取、模型模式配置校验。 |
| `src/services/llm-usage-service.js` | LLM job 与 usage log 写入。被网关成功/失败收尾逻辑调用。 |
| `src/services/log-service.js` | /** 后台日志查询与按日写入服务。 调用说明： - `src/lib/logger.js` 调用 `appendDailyLog()`，把运行日志拆成 `logs/app-YYYY-MM-DD.log`、`logs/app-error-YYYY-MM-DD.log`、`logs/access-YYYY-MM-DD.log`。 - `src/routes/web-routes.js` 的 `/admin/logs` 调用 `listLogEntries()`，解析旧日志和新日志，提供日期、等级、文件、错误类型、函数名筛选与分页。 - 本服务只读写 `logs/` 目录，不碰业务数据库，也不记录敏感请求正文。 / |
| `src/services/password-service.js` | bcrypt 密码 hash/verify。被注册、登录、改密码使用。 |
| `src/services/phone-auth-service.js` | 国内手机号一键认证占位/封装。被注册流程调用。 |
| `src/services/plan-service.js` | 套餐、订阅、额度快照与额度断言。被后台和 LLM 网关调用。 |
| `src/services/prompt-engineering-service.js` | 全局提示词片段、角色提示词结构、运行时变量模板和最终 system prompt 拼装。 |
| `src/services/rate-limit-service.js` | 基于 Redis/内存 incr+expire 的轻量限流。被登录/注册/验证码调用。 |
| `src/services/user-service.js` | 用户创建、登录查询、资料更新、角色更新。 |
| `src/services/verification-service.js` | 邮箱/手机验证码签发与验证编排。调用 email/sms/rate-limit/captcha。 |
| `public/js/admin-page.js` | 后台交互：套餐字段切换、Prompt 片段排序/预览、后台列表过滤。 |
| `public/js/character-editor-page.js` | 角色编辑器动态字段：提示词条目增删、排序、预览。 |
| `public/js/chat-page.js` | 聊天页前端核心：流式 NDJSON 消费、富文本/Markdown 渲染、思考块折叠、加载历史、输入优化。 |
| `public/js/i18n-runtime.js` | 浏览器端轻量 t() 翻译函数，供页面脚本复用。 |
| `public/js/register-page.js` | 注册页交互：国家/地区切换、验证码刷新、邮箱/手机验证码发送。 |
| `scripts/full-flow-e2e.js` | 全流程 E2E 测试脚本：创建临时用户/角色/会话，验证当前显示链、LLM 流式、后台查询、日志和删除保护，结束后清理测试数据。 |
| `scripts/grant-admin.js` | /** 手动授予管理员权限。只允许本机显式执行，不走隐式自动提权。 用法：node scripts/grant-admin.js <username> / |
| `scripts/health-check.js` | /** 基础健康检查：配置、数据库、Redis、公开 HTTP 页面。 / |
| `scripts/init-db.js` | /** 数据库初始化脚本。根据当前配置自动选择初始化策略： MySQL 模式（DATABASE_URL 已设置）： - 使用 DATABASE_ADMIN_URL 创建数据库（若不存在） - 创建全部业务表并补全历史缺失字段/索引（幂等，可反复执行） - 写入默认套餐与 LLM 提供商种子数据 SQLite 模式（DATABASE_URL 未设置）： - 表结构由 db.js 在首次连接时自动初始化，此脚本无需额外操作 - 数据库文件路径：<项目根>/data/local.db 使用方式： npm run db:init 或 node scripts/init-db.js / |
| `scripts/smoke-test.js` | /** 生产冒烟检查：只做只读探测，不写业务数据。 / |
| `scripts/test-admin-conversations.js` | /** 后台全局对话记录查询冒烟测试。调用说明：`npm run admin-conversations:test`，验证服务查询、筛选和 EJS 模板渲染。 / |
| `scripts/test-admin-logs-route.js` | /** 管理后台日志页模板冒烟测试。调用说明：`npm run admin-logs:test`，验证日志查询结果能正常渲染为后台 UI。 / |
| `scripts/test-conversation-service.js` | /** Conversation service regression tests for linear chat refactor behavior. / |
| `scripts/test-log-service.js` | /** 日志解析服务冒烟测试。调用说明：`npm run logs:test`，用于确认后台日志分页/筛选基础逻辑可用。 / |
| `scripts/test-prompt-route.js` | /** Prompt 路由/LLM 网关的轻量单元测试。 调用说明： - `npm run test:prompt-route` 执行。 - 通过 monkey patch Module._load 隔离外部依赖，只验证 prompt 构造与路由调用契约。 / |
| `scripts/test-think-parser.js` | /** 最小回归测试：验证 think/reasoning 解析与展示规则的关键正则行为。 / |
| `scripts/tmp-stream-e2e.js` | /** 临时流式聊天 E2E 调试脚本。 调用说明： - 手动运行 `node scripts/tmp-stream-e2e.js`。 - 会使用 .env 中 APP_URL/DATABASE_URL，登录固定测试用户并请求流式接口。 - 这是排查聊天 NDJSON/最终落库问题的临时脚本，不应放进生产定时任务。 / |
| `scripts/update-docs-debug.js` | /** 一次性维护脚本：为 ai-roleplay-site 生成/刷新项目梳理文档、注释索引与调试说明。 使用场景： - 大规模代码梳理时，避免手工复制每个函数/文件说明。 - 新增 JS/EJS/CSS 文件后，可重新运行本脚本同步 docs/PROJECT_MAP.md 与 docs/FUNCTION_REFERENCE.md。 调用方式： node scripts/update-docs-debug.js 注意： - 该脚本只写 Markdown 文档，不改业务代码。 - 不读取 .env，不输出任何密钥。 / |
| `scripts/version-check.js` | /** Validate project version metadata before release/tagging. / |

## 5. EJS 模板地图

| 文件 | 职责 / 调用说明 |
|---|---|
| `src/views/admin-conversation-detail.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin-conversations.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin-logs.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin-plans.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin-prompts.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin-providers.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/admin.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/character-new.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/chat.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/dashboard.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/error.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/home.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/layout.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/login.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/message.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/partials/chat-message.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/profile.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
| `src/views/register.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |

## 6. 样式文件地图

| 文件 | 职责 / 调用说明 |
|---|---|
| `public/styles/README.md` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/shared-feedback.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/00-core.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/01-typography.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/10-home.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/11-home-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/20-admin.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/21-admin-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/30-character-editor.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/31-character-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/40-dashboard.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/41-dashboard-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/50-chat.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/51-chat-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/52-rich-content.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/53-mobile-chat.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/60-auth.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/61-register.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/70-shared-utilities.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/80-chat-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/90-profile.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/91-profile-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/95-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |

## 7. 路由清单

| 行号 | 路由注册 |
|---:|---|
| 339 | `app.get('/fonts/google.css', async (req, res) => {` |
| 353 | `app.get('/fonts/google/file', async (req, res) => {` |
| 366 | `app.get('/', async (req, res, next) => {` |
| 375 | `app.get('/register', async (req, res, next) => {` |
| 384 | `app.get('/api/captcha', async (req, res, next) => {` |
| 394 | `app.get('/api/captcha/image/:captchaId', async (req, res, next) => {` |
| 408 | `app.get('/healthz', async (req, res) => {` |
| 449 | `app.post('/api/send-email-code', async (req, res, next) => {` |
| 493 | `app.post('/api/send-phone-code', async (req, res, next) => {` |
| 539 | `app.post('/register', async (req, res, next) => {` |
| 663 | `app.get('/login', (req, res) => renderPage(res, 'login', { title: '登录' }));` |
| 664 | `app.post('/login', async (req, res, next) => {` |
| 717 | `app.get('/logout', (req, res) => {` |
| 721 | `app.get('/dashboard', requireAuth, async (req, res, next) => {` |
| 738 | `app.get('/profile', requireAuth, async (req, res, next) => {` |
| 755 | `app.post('/profile', requireAuth, async (req, res, next) => {` |
| 836 | `app.get('/admin', requireAdmin, async (req, res, next) => {` |
| 855 | `app.get('/admin/plans', requireAdmin, async (req, res, next) => {` |
| 872 | `app.get('/admin/providers', requireAdmin, async (req, res, next) => {` |
| 889 | `app.get('/admin/prompts', requireAdmin, async (req, res, next) => {` |
| 918 | `app.get('/admin/logs', requireAdmin, async (req, res, next) => {` |
| 950 | `app.get('/admin/conversations', requireAdmin, async (req, res, next) => {` |
| 985 | `app.get('/admin/conversations/:conversationId', requireAdmin, async (req, res, next) => {` |
| 1002 | `app.post('/admin/conversations/:conversationId/restore', requireAdmin, async (req, res, next) => {` |
| 1012 | `app.post('/admin/conversations/:conversationId/permanent-delete', requireAdmin, async (req, res, next) => {` |
| 1022 | `app.post('/admin/conversations/:conversationId/messages/:messageId/restore', requireAdmin, async (req, res, next) => {` |
| 1034 | `app.post('/admin/conversations/:conversationId/messages/:messageId/permanent-delete', requireAdmin, async (req, res, next) => {` |
| 1053 | `app.post('/admin/plans/new', requireAdmin, async (req, res, next) => {` |
| 1085 | `app.post('/admin/plans/:planId', requireAdmin, async (req, res, next) => {` |
| 1116 | `app.post('/admin/plans/:planId/delete', requireAdmin, async (req, res, next) => {` |
| 1142 | `app.post('/admin/users/:userId/role', requireAdmin, async (req, res, next) => {` |
| 1159 | `app.post('/admin/users/:userId/plan', requireAdmin, async (req, res, next) => {` |
| 1177 | `app.post('/admin/providers/new', requireAdmin, async (req, res, next) => {` |
| 1212 | `app.post('/admin/providers/:providerId', requireAdmin, async (req, res, next) => {` |
| 1242 | `app.post('/admin/prompt-blocks/new', requireAdmin, async (req, res, next) => {` |
| 1265 | `app.post('/admin/prompt-blocks/:blockId', requireAdmin, async (req, res, next) => {` |
| 1283 | `app.post('/admin/prompt-blocks/reorder', requireAdmin, async (req, res, next) => {` |
| 1299 | `app.post('/admin/prompt-blocks/:blockId/delete', requireAdmin, async (req, res, next) => {` |
| 1312 | `app.get('/characters/new', requireAuth, (req, res) => {` |
| 1321 | `app.get('/characters/:characterId/edit', requireAuth, async (req, res, next) => {` |
| 1352 | `app.post('/characters/new', requireAuth, async (req, res, next) => {` |
| 1371 | `app.post('/characters/:characterId/edit', requireAuth, async (req, res, next) => {` |
| 1396 | `app.post('/characters/:characterId/delete', requireAuth, async (req, res, next) => {` |
| 1420 | `app.post('/conversations/start/:characterId', requireAuth, async (req, res, next) => {` |
| 1473 | `app.get('/chat/:conversationId', requireAuth, async (req, res, next) => {` |
| 1494 | `app.get('/chat/:conversationId/messages/history', requireAuth, async (req, res, next) => {` |
| 1531 | `app.post('/chat/:conversationId/delete', requireAuth, async (req, res, next) => {` |
| 1549 | `app.post('/chat/:conversationId/message', requireAuth, async (req, res, next) => {` |
| 1630 | `app.post('/chat/:conversationId/message/stream', requireAuth, async (req, res, next) => {` |
| 1767 | `app.post('/chat/:conversationId/regenerate/:messageId/stream', requireAuth, async (req, res, next) => {` |
| 1860 | `app.post('/chat/:conversationId/regenerate/:messageId', requireAuth, async (req, res, next) => {` |
| 1917 | `app.post('/chat/:conversationId/messages/:messageId/delete', requireAuth, async (req, res, next) => {` |
| 1953 | `app.post('/chat/:conversationId/messages/:messageId/edit', requireAuth, async (req, res, next) => {` |
| 1978 | `app.post('/chat/:conversationId/messages/:messageId/edit-user', requireAuth, async (req, res, next) => {` |
| 2053 | `app.post('/chat/:conversationId/messages/:messageId/replay/stream', requireAuth, async (req, res, next) => {` |
| 2235 | `app.post('/chat/:conversationId/messages/:messageId/replay', requireAuth, async (req, res, next) => {` |
| 2373 | `app.post('/chat/:conversationId/model', requireAuth, async (req, res, next) => {` |
| 2393 | `app.post('/chat/:conversationId/optimize-input/stream', requireAuth, async (req, res, next) => {` |
| 2455 | `app.post('/chat/:conversationId/optimize-input', requireAuth, async (req, res, next) => {` |
| 2493 | `app.post('/chat/:conversationId/branch/:messageId', requireAuth, async (req, res, next) => {` |

## 8. DEBUG 入口

- 每个请求都有 `requestId`：错误页会展示，请用它 grep 日志。
- 后端日志统一走 `src/lib/logger.js`，支持 `LOG_LEVEL=debug`。
- 流式聊天优先看：浏览器 Console、Network 的 NDJSON 分包、后端 `LLM provider request start/response received`。
- 当前显示链异常优先看：`fetchPathMessages()` 的递归 CTE、`messages.parent_message_id` 和 `current_message_id`。
- 注册/登录异常优先看：`Register validation failed`、`Login failed`，日志会脱敏 email/phone。
