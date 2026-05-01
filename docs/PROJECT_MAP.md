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
| `src/i18n/messages.en.js` | /** English UI translations for server-rendered pages and browser scripts. / |
| `src/i18n/messages.zh-CN.js` | /** 中文界面文案词典，供服务端页面和前端脚本共享。 / |
| `src/lib/db-sqlite-schema.js` | SQLite 初始化 schema 与种子数据，供 db.js 首次创建本地库时调用。 |
| `src/lib/db.js` | 数据库抽象层，MySQL 优先、SQLite 兜底，提供 query/withTransaction。所有 service 的 DB 入口。 |
| `src/lib/logger.js` | 统一结构化日志输出，支持 LOG_LEVEL 过滤和 DEBUG 开关。所有后端模块应通过它写日志。 |
| `src/lib/redis.js` | Redis 客户端与内存降级实现，供 session、验证码、缓存、限流使用。 |
| `src/lib/sqlite-schema/characters-conversations.js` | /** 角色、互动事件、会话与消息表结构。 / |
| `src/lib/sqlite-schema/llm.js` | /** LLM 提供商、任务队列与用量日志 SQLite 结构。 / |
| `src/lib/sqlite-schema/plans.js` | /** 套餐表结构与模型权益字段补列。 / |
| `src/lib/sqlite-schema/prompts-notifications.js` | /** 系统提示词片段、站内通知与客服入口表结构。 / |
| `src/lib/sqlite-schema/seed.js` | /** 默认套餐、默认 LLM provider 与旧套餐模型权益回填。 / |
| `src/lib/sqlite-schema/subscriptions.js` | /** 用户订阅表结构与用户状态索引。 / |
| `src/lib/sqlite-schema/users.js` | /** 用户表结构、public_id 补列与历史用户 public_id 回填。 / |
| `src/lib/url-safety.js` | /** 外部服务 URL 安全校验，避免 Provider Base URL 被用于 SSRF/内网探测。 / |
| `src/lib/user-public-id.js` | /** 用户公开唯一 ID 生成工具。公开 ID 从三位起步，无固定上限。 / |
| `src/middleware/auth.js` | 登录/管理员鉴权中间件，保护 dashboard/admin/chat 等页面。 |
| `src/middleware/csrf.js` | /** 基于 session 的轻量 CSRF 防护。优先校验 token；为避免上线时旧页面脚本瞬断，允许同源 Origin/Referer 兜底。 / |
| `src/middleware/error-handler.js` | 全局错误转译与错误页渲染，避免向页面泄露堆栈。 |
| `src/middleware/i18n.js` | 根据 query/cookie/Accept-Language 解析语言，并向 req/res.locals 注入 t()。 |
| `src/middleware/request-context.js` | 为每个请求注入 requestId/currentUser，后续日志和错误页用它串联。 |
| `src/routes/web-routes.js` | 主 Web 路由注册文件：公开页、认证、后台、角色、线性聊天、重写/编辑/流式接口。依赖 service 层完成业务。 |
| `src/routes/web/admin-routes.js` | /** 管理后台路由聚合器。具体页面/表单路由拆分在 `src/routes/web/admin/`，本文件只保持注册顺序。 / |
| `src/routes/web/admin/admin-route-utils.js` | /** 管理后台路由共享小工具：表单校验错误识别和分页 URL 拼装。 / |
| `src/routes/web/admin/conversation-routes.js` | /** 管理后台全局对话审计、软删除恢复与永久删除路由。 / |
| `src/routes/web/admin/dashboard-routes.js` | /** 管理后台首页路由，展示概览、用户与套餐摘要。 / |
| `src/routes/web/admin/log-routes.js` | /** 管理后台日志查询页路由，支持日期、等级、文件、错误类型和函数名筛选。 / |
| `src/routes/web/admin/notification-routes.js` | /** 管理后台通知中心与前台客服通知查询接口。 / |
| `src/routes/web/admin/plan-routes.js` | /** 管理后台套餐列表、新增、更新与删除路由，包含模型权益配置校验。 / |
| `src/routes/web/admin/prompt-routes.js` | /** 管理后台全局 Prompt 片段预览、创建、排序、更新与删除路由。 / |
| `src/routes/web/admin/provider-routes.js` | /** 管理后台 LLM Provider 列表、新增与更新路由。 / |
| `src/routes/web/admin/user-routes.js` | /** 管理后台用户角色与套餐调整路由。 / |
| `src/routes/web/auth-routes.js` | /** 认证与个人中心路由聚合器。具体实现拆分在 `src/routes/web/auth/`。 / |
| `src/routes/web/auth/dashboard-routes.js` | /** 用户控制台路由，汇总角色、会话、套餐和额度快照。 / |
| `src/routes/web/auth/profile-routes.js` | /** 个人资料维护路由，支持用户名、邮箱、手机和密码变更。 / |
| `src/routes/web/auth/register-routes.js` | /** 用户注册提交路由，包含地区、邮箱/手机验证码和默认登录态建立。 / |
| `src/routes/web/auth/session-routes.js` | /** 登录、登出路由，包含 IP 限流和失败原因脱敏日志。 / |
| `src/routes/web/auth/verification-routes.js` | /** 邮箱/手机验证码发送接口，统一在响应后刷新图形验证码以降低重放风险。 / |
| `src/routes/web/character-routes.js` | /** 从 web-routes.js 拆出的路由分组。 / |
| `src/routes/web/chat-routes.js` | /** 聊天路由聚合：页面、发送、重生、编辑、重写、工具。 / |
| `src/routes/web/chat-stream-utils.js` | /** 聊天流式接口的 NDJSON 响应工具：错误文案映射、消息片段渲染、流式行切分与中断兜底。 设计约束： - 只被 web 路由层调用，避免 service 层依赖 Express response。 - `safeWrite` 必须在连接关闭后静默失败，防止客户端断开导致二次异常。 - 用户主动断开但已有部分模型输出时，优先保留已生成内容，避免“写了半天全没了”。 / |
| `src/routes/web/chat/edit-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/chat/message-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/chat/page-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/chat/regenerate-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/chat/replay-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/chat/tool-routes.js` | /** 聊天路由子分组。 / |
| `src/routes/web/public-routes.js` | /** 从 web-routes.js 拆出的路由分组。 / |
| `src/server-helpers.js` | 路由公共辅助：页面渲染、参数解析、账号脱敏、聊天页 view model、NDJSON 输出。被 web-routes.js 调用。 |
| `src/server-helpers/character-prompt-profile.js` | /** 角色 Prompt Profile 表单与存储格式转换，供角色编辑页和路由层复用。 / |
| `src/server-helpers/chat-view.js` | /** 聊天页 view model、对话标题和会话加载辅助。保持路由层薄一点，避免把页面状态散落到各聊天子路由。 / |
| `src/server-helpers/ndjson.js` | /** NDJSON 流响应基础工具。只负责 Express response 头和单包写入，不包含聊天业务语义。 / |
| `src/server-helpers/parsing.js` | /** 路由层参数解析与基础账号格式校验。外部输入必须显式校验，避免 `Number(...) \|\| 0` 把非法值静默吞掉。 / |
| `src/server-helpers/rendering.js` | /** EJS 页面渲染、默认 meta 与通用提示页封装。 / |
| `src/server-helpers/request-meta.js` | /** 请求来源与账号标识脱敏工具。日志只记录可排障信息，不写入完整邮箱/手机号/密码等敏感值。 / |
| `src/server.js` | Express 启动入口：等待 DB/Redis、装配全局中间件、注册路由、启动监听。调用链起点。 |
| `src/services/admin-conversation-service.js` | /** 管理后台全局对话记录查询服务。 调用说明： - `src/routes/web-routes.js` 的 `/admin/conversations` 调用 `listAdminConversations()` 渲染全局会话列表。 - `src/routes/web-routes.js` 的 `/admin/conversations/:id` 调用 `getAdminConversationDetail()` 查看单条会话完整消息。 - 支持按用户、角色卡、日期和删除状态筛选；后台可以恢复或永久删除软删除数据。 / |
| `src/services/admin-service.js` | 后台首页聚合查询：用户套餐、Provider 列表、概览统计。 |
| `src/services/ai-service.js` | 旧版直连 OpenAI 兼容接口服务；新路径优先使用 llm-gateway-service。 |
| `src/services/aliyun-sms-service.js` | 阿里云短信验证码发送封装。被 verification-service 调用。 |
| `src/services/captcha-service.js` | 图形验证码生成、刷新、读取与校验。依赖 Redis/内存缓存。 |
| `src/services/character-service.js` | 角色 CRUD 与可见性控制。被首页、dashboard、角色编辑和开聊流程调用。 |
| `src/services/character-social-service.js` | /** 公开角色点赞、评论、使用量与热度统计服务。 / |
| `src/services/conversation-service.js` | 会话/消息核心服务：消息写入、当前显示链读取、编辑、重写、独立对话克隆和删除保护。聊天路由主要依赖它。 |
| `src/services/conversation/message-view.js` | /** 会话消息视图层纯函数：metadata 解析、think 标签清理和链路构建。 / |
| `src/services/conversation/path-repository.js` | /** 使用递归查询读取当前会话从叶子消息到根消息的显示链。 / |
| `src/services/email-service.js` | Resend 邮件验证码发送封装。被 verification-service 调用。 |
| `src/services/email-template-service.js` | /** Branded HTML email templates for verification messages. / |
| `src/services/font-proxy-service.js` | Google Fonts 代理与缓存，避免页面字体资源直接失败。被 /fonts/* 路由调用。 |
| `src/services/llm-gateway-service.js` | LLM 网关核心：Provider 选择、额度校验、上下文裁剪、队列、流式解析、用量记录。 |
| `src/services/llm-gateway/content-utils.js` | /** LLM 响应内容、token 粗估和上下文裁剪工具。 / |
| `src/services/llm-gateway/priority-queue.js` | /** LLM 全局并发与优先级队列。 / |
| `src/services/llm-gateway/provider-client.js` | /** OpenAI-compatible provider 调用与 SSE 流解析。 / |
| `src/services/llm-provider-service.js` | 后台 Provider 管理、模型列表拉取、模型模式配置校验。 |
| `src/services/llm-usage-service.js` | LLM job 与 usage log 写入。被网关成功/失败收尾逻辑调用。 |
| `src/services/log-service.js` | /** 后台日志查询与按日写入服务。 调用说明： - `src/lib/logger.js` 调用 `appendDailyLog()`，把运行日志拆成 `logs/app-YYYY-MM-DD.log`、`logs/app-error-YYYY-MM-DD.log`、`logs/access-YYYY-MM-DD.log`。 - `src/routes/web-routes.js` 的 `/admin/logs` 调用 `listLogEntries()`，解析旧日志和新日志，提供日期、等级、文件、错误类型、函数名筛选与分页。 - 本服务只读写 `logs/` 目录，不碰业务数据库，也不记录敏感请求正文。 / |
| `src/services/model-entitlement-service.js` | /** Plan-specific model entitlement normalization, persistence helpers, and quota multiplier math. / |
| `src/services/model-form-service.js` | /** Parse admin form fields for plan model entitlements. / |
| `src/services/notification-service.js` | /** 站内通知与客服入口配置服务。调用说明：管理后台维护通知规则与客服入口外部资源，布局与聊天页通过公开接口读取当前用户可见通知。 / |
| `src/services/password-service.js` | bcrypt 密码 hash/verify。被注册、登录、改密码使用。 |
| `src/services/phone-auth-service.js` | 国内手机号一键认证占位/封装。被注册流程调用。 |
| `src/services/plan-model-validation-service.js` | /** Server-side validation for plan model entitlements against configured providers. / |
| `src/services/plan-service.js` | 套餐、订阅、额度快照与额度断言。被后台和 LLM 网关调用。 |
| `src/services/plan/crud.js` | /** 套餐 CRUD 与默认套餐切换逻辑，保留原 SQL 行为。 / |
| `src/services/plan/hydration.js` | /** 套餐模型权益 JSON 的解析、默认模型兜底与列表展示字段补齐。 / |
| `src/services/plan/normalizer.js` | /** 套餐载荷归一化与数值字段强校验，避免后台表单脏值进入服务层。 / |
| `src/services/plan/subscriptions.js` | /** 用户套餐订阅、用量统计、配额断言和套餐模型选项。 / |
| `src/services/plan/usage-window.js` | /** 根据数据库类型和套餐周期生成用量统计时间窗口 SQL。 / |
| `src/services/prompt-engineering-service.js` | 全局提示词片段、角色提示词结构、运行时变量模板和最终 system prompt 拼装。 |
| `src/services/rate-limit-service.js` | 基于 Redis/内存 incr+expire 的轻量限流。被登录/注册/验证码调用。 |
| `src/services/user-service.js` | 用户创建、登录查询、资料更新、角色更新。 |
| `src/services/verification-service.js` | 邮箱/手机验证码签发与验证编排。调用 email/sms/rate-limit/captcha。 |
| `public/js/admin-page.js` | 后台交互：套餐字段切换、Prompt 片段排序/预览、后台列表过滤。 |
| `public/js/character-editor-page.js` | 角色编辑器动态字段：提示词条目增删、排序、预览。 |
| `public/js/chat-page.js` | 聊天页前端核心：流式 NDJSON 消费、富文本/Markdown 渲染、思考块折叠、加载历史、输入优化。 |
| `public/js/chat/action-stream-submit.js` | /** 重新生成、从这里重写等消息操作表单的流式提交绑定。 / |
| `public/js/chat/bubbles.js` | /** 聊天页气泡 DOM 创建、临时流式气泡追加与 HTML 替换工具。 / |
| `public/js/chat/compose-submit.js` | /** 主聊天输入框流式提交与 Enter 快捷键绑定。 / |
| `public/js/chat/controller.js` | /** 聊天页轻量入口：装配 DOM 工具、流客户端和各交互子模块。 / |
| `public/js/chat/conversation-state.js` | /** 聊天页 URL leaf、父消息隐藏字段、可见消息计数与旧尾巴清理。 / |
| `public/js/chat/dom-utils.js` | /** 聊天页 DOM 小工具：滚动判断、菜单收起、toast、富文本挂载等。 / |
| `public/js/chat/history-loader.js` | /** 聊天页“查看更早消息”懒加载与滚动位置保持。 / |
| `public/js/chat/message-menu.js` | /** 聊天消息操作区：点击消息上的“⋯”，在对应消息上方插入轻量上下文操作卡。 / |
| `public/js/chat/optimize-submit.js` | /** 润色输入表单的流式提交绑定。 / |
| `public/js/chat/rich-renderer.js` | /** 聊天消息富文本渲染与安全净化。 / |
| `public/js/chat/stream-client.js` | /** 聊天页 NDJSON 流式请求消费器。 / |
| `public/js/chat/streaming-ui.js` | /** 聊天页流式渲染调度、自动跟随滚动和气泡最终态处理。 / |
| `public/js/csrf.js` | /** 自动为同源 POST 表单与 fetch 请求附加 CSRF token。 / |
| `public/js/error-page.js` | /** 错误页脚本；当前客服入口由 notification-client 的 data-open-support 委托统一处理。 / |
| `public/js/form-guards.js` | /** CSP 兼容的全局表单保护：替代模板里的 inline onsubmit confirm。 / |
| `public/js/i18n-runtime.js` | 浏览器端轻量 t() 翻译函数，供页面脚本复用。 |
| `public/js/layout-bootstrap.js` | /** 全站前端 bootstrap。由 layout 注入 JSON 数据，本文件负责挂到 window。 / |
| `public/js/notification-client.js` | /** 前台站内通知与客服入口展示。调用说明：layout 注入 bootstrap 后自动显示，聊天错误可触发 support 模式。 / |
| `public/js/profile-page.js` | /** 个人资料页验证码刷新、邮箱验证码和短信验证码发送交互。 / |
| `public/js/quota-bars.js` | /** 将 data-width 百分比应用到额度条，避免 inline style 违反 CSP。 / |
| `public/js/register-config.js` | /** 注册页认证配置 bootstrap，避免 inline script 违反 CSP。 / |
| `public/js/register-page.js` | 注册页交互：国家/地区切换、验证码刷新、邮箱/手机验证码发送。 |
| `scripts/check-i18n-completeness.js` | /** 检查楼阁项目 i18n 词典是否覆盖已登记 key，并扫描页面/前端脚本残留中文文案，帮助持续补全国际化。 调用说明：npm run i18n:check。脚本只读文件，发现缺失时以非 0 退出。 / |
| `scripts/full-flow-e2e.js` | 全流程 E2E 测试脚本：创建临时用户/角色/会话，验证当前显示链、LLM 流式、后台查询、日志和删除保护，结束后清理测试数据。 |
| `scripts/grant-admin.js` | /** 手动授予管理员权限。只允许本机显式执行，不走隐式自动提权。 用法：node scripts/grant-admin.js <username> / |
| `scripts/health-check.js` | /** 基础健康检查：配置、数据库、Redis、公开 HTTP 页面。 / |
| `scripts/init-db.js` | /** 数据库初始化脚本。根据当前配置自动选择初始化策略： MySQL 模式（DATABASE_URL 已设置）： - 使用 DATABASE_ADMIN_URL 创建数据库（若不存在） - 创建全部业务表并补全历史缺失字段/索引（幂等，可反复执行） - 写入默认套餐与 LLM 提供商种子数据 SQLite 模式（DATABASE_URL 未设置）： - 表结构由 db.js 在首次连接时自动初始化，此脚本无需额外操作 - 数据库文件路径：<项目根>/data/local.db 使用方式： npm run db:init 或 node scripts/init-db.js / |
| `scripts/smoke-test.js` | /** 生产冒烟检查：只做只读探测，不写业务数据。 / |
| `scripts/test-admin-conversations.js` | /** 后台全局对话记录查询冒烟测试。调用说明：`npm run admin-conversations:test`，验证服务查询、筛选和 EJS 模板渲染。 / |
| `scripts/test-admin-logs-route.js` | /** 管理后台日志页模板冒烟测试。调用说明：`npm run admin-logs:test`，验证日志查询结果能正常渲染为后台 UI。 / |
| `scripts/test-conversation-service.js` | /** Conversation service regression tests for linear chat refactor behavior. / |
| `scripts/test-log-service.js` | /** 日志解析服务冒烟测试。调用说明：`npm run logs:test`，用于确认后台日志分页/筛选基础逻辑可用。 / |
| `scripts/test-model-entitlements.js` | /** Focused tests for plan model entitlement normalization and admin form parsing. / |
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
| `src/views/admin-notifications.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
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
| `src/views/public-characters.ejs` | EJS 页面/局部模板；由 `renderPage` 或 `ejs.renderFile` 渲染，具体入口见路由表。 |
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
| `public/styles/site-pages/12-public-characters.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/20-admin.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/21-admin-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/25-notifications.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/30-character-editor.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/31-character-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/40-dashboard.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/41-dashboard-polish.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/42-dashboard-sections.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
| `public/styles/site-pages/43-dashboard-responsive.css` | 样式资源；通过 `public/styles/site-pages.css` 或页面 layout 引入。 |
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


## 8. DEBUG 入口

- 每个请求都有 `requestId`：错误页会展示，请用它 grep 日志。
- 后端日志统一走 `src/lib/logger.js`，支持 `LOG_LEVEL=debug`。
- 流式聊天优先看：浏览器 Console、Network 的 NDJSON 分包、后端 `LLM provider request start/response received`。
- 当前显示链异常优先看：`fetchPathMessages()` 的递归 CTE、`messages.parent_message_id` 和 `current_message_id`。
- 注册/登录异常优先看：`Register validation failed`、`Login failed`，日志会脱敏 email/phone。
