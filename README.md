# 楼阁 / ai-roleplay-site

一个 Express + EJS 的多用户 AI 角色对话网站。站点名为“楼阁”，默认监听 `0.0.0.0:3217`，预定域名为 `https://aicafe.momentsofus.cn`。

它不是纯 demo：项目已经包含注册登录、角色创建、树状对话、分支/重算/编辑、流式生成、LLM Provider 管理、套餐额度、验证码和基础后台。

## 当前能力

- 用户注册 / 登录 / 退出 / 个人资料修改
- 图形验证码、邮箱验证码、手机验证码
- 角色创建、编辑、公开/私有可见性、删除保护
- 首页公开角色列表、用户工作台
- 会话创建与历史消息持久化
- 树状对话：
  - 任意节点继续对话
  - 任意节点新建独立分支会话
  - AI 回复重新生成（同父节点候选）
  - 用户消息 / AI 消息编辑为新分支变体
  - 输入优化、一键采用并发送
  - 默认聊天页只展示最新 3 条，可向上加载历史
- 流式 NDJSON 生成与前端富文本渲染
- `<think>...</think>` / `<thinking>...</thinking>` 思考块折叠展示
- Markdown / 代码块 / 引用 / 表格 / 图片等富文本展示
- LLM Provider 后台配置、模型模式、上下文窗口、超时、价格
- 后台全局对话记录查看：支持按用户、角色卡、日期筛选，并可进入单条会话查看完整消息链
- 套餐、订阅、请求额度 / token 额度、用量记录
- Redis Session、验证码/限流/消息树缓存；未配置 Redis 时可内存降级
- MySQL 优先，连接失败或未配置时 SQLite 本地降级
- Google Fonts 代理与缓存兜底
- 结构化日志、requestId、DEBUG 文档和项目地图

## 快速启动

```bash
cd /opt/openclaw/workspace/project/app/louge-roleplay
npm install
cp .env.example .env
npm run db:init
npm run dev
```

生产/普通启动：

```bash
npm run start
```

systemd 部署参考：

```bash
systemctl status ai-roleplay-site.service
systemctl restart ai-roleplay-site.service
journalctl -u ai-roleplay-site.service -f
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run start` | 启动生产进程（node src/server.js） |
| `npm run dev` | nodemon 开发模式 |
| `npm run db:init` | 初始化/补齐数据库结构和种子数据 |
| `npm run grant-admin -- <username>` | 给用户授予 admin 角色 |
| `npm run smoke:test` | 只读冒烟测试：主页、登录、注册、healthz 等 |
| `npm run health:check` | 配置、数据库、Redis、公开 HTTP 页面检查 |
| `npm run test:think` | think/reasoning 解析规则回归测试 |
| `npm run test:prompt-route` | Prompt/路由契约轻量测试 |
| `npm run docs:debug` | 重新生成项目地图、函数索引和 DEBUG 文档 |

## 配置说明

配置从 `.env` 读取，入口在 `src/config.js`。不要提交真实 `.env`。

关键变量：

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 `3217` |
| `APP_NAME` | 站点名，默认“楼阁” |
| `APP_URL` | 对外访问地址，脚本和回调会用到 |
| `SESSION_SECRET` | Session 密钥；生产必须固定配置 |
| `DATABASE_URL` | MySQL 连接串；未配置或失败时降级 SQLite |
| `DATABASE_ADMIN_URL` | 初始化数据库时使用的管理连接串 |
| `REDIS_URL` | Redis 连接串；未配置时使用内存降级 |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | 旧版直连 AI 配置；当前主要走后台 Provider |
| `RESEND_API_KEY` / `RESEND_FROM` | 邮箱验证码发送 |
| `ALIYUN_*` | 手机号/短信验证码相关配置 |
| `TRUST_PROXY` | 反代部署时是否信任代理 |
| `COOKIE_SECURE` | HTTPS 下建议开启 |
| `LOG_LEVEL` | `debug/info/warn/error`，默认 `info` |

隐私安全摘要可看 `config.getPrivacySafeSummary()`，不会输出完整密钥。

## 项目结构

| 路径 | 职责 |
|---|---|
| `src/server.js` | Express 启动壳：DB/Redis 初始化、中间件、路由、404、错误处理 |
| `src/routes/web-routes.js` | 主路由注册：公开页、认证、后台、角色、聊天、分支/回放/流式接口 |
| `src/server-helpers.js` | 页面渲染、参数解析、日志脱敏、聊天页 view model、NDJSON 辅助 |
| `src/services/` | 业务服务层：用户、角色、会话、LLM、套餐、验证码等 |
| `src/lib/` | DB、Redis、logger 基础设施 |
| `src/middleware/` | requestId、i18n、鉴权、错误处理 |
| `src/views/` | EJS 页面和局部模板 |
| `public/js/` | 页面交互脚本，聊天页流式逻辑在 `chat-page.js` |
| `public/styles/` | 全站样式拆分与样式说明 |
| `scripts/` | 初始化、测试、健康检查、文档生成脚本 |
| `docs/` | 架构、项目地图、函数说明、DEBUG 指南 |

更完整的文件地图见：

- `docs/PROJECT_MAP.md`：目录、文件、路由、调用链
- `docs/FUNCTION_REFERENCE.md`：每个 JS 文件和命名函数的介绍与调用说明
- `docs/DEBUGGING.md`：日志、requestId、常见问题排查
- `docs/server-architecture.md`：server 拆分说明
- `docs/bug-risk-report-2026-04-18.md`：历史风险与处理记录

## 核心调用链

### 普通页面

```text
browser
  -> src/server.js
  -> requestContext / session / i18n
  -> src/routes/web-routes.js
  -> src/services/*
  -> src/lib/db.js / src/lib/redis.js
  -> renderPage(view + layout)
```

### 聊天流式生成

```text
public/js/chat-page.js
  -> POST /chat/:conversationId/message/stream
  -> createNdjsonResponder()
  -> streamChatReplyToNdjson()
  -> llm-gateway-service.streamReplyViaGateway()
  -> Provider SSE
  -> NDJSON packet
  -> renderRichContent()
```

### 消息树

```text
conversation-service.addMessage()
  -> messages.parent_message_id / branch_from_message_id / edited_from_message_id
  -> invalidateConversationCache()
  -> listMessages()
  -> buildConversationView()
  -> chat.ejs / chat-message.ejs
```

## 数据库与缓存

### 数据库

`src/lib/db.js` 对上层屏蔽 MySQL/SQLite 差异：

- `DATABASE_URL` 存在：优先 MySQL
- MySQL 失败或未配置：自动降级 `data/local.db`
- SQL 占位符统一使用 `?`
- `query()` 返回：
  - SELECT/WITH：行数组
  - INSERT：`{ insertId, affectedRows }`
  - 其他 DML：`{ affectedRows }`
- `withTransaction()` 提供 MySQL/SQLite 兼容事务

初始化/补结构：

```bash
npm run db:init
```

### Redis

`src/lib/redis.js` 会在未配置 Redis 或连接失败时使用内存替代。开发可以接受；生产建议配置真实 Redis，否则：

- 重启后登录态丢失
- 验证码/限流/消息树缓存丢失
- 多进程之间状态不同步

## 日志与 DEBUG

统一使用 `src/lib/logger.js`：

```js
logger.info('Login succeeded', { requestId, userId });
logger.warn('Login failed', { requestId, reason: 'invalid_password' });
logger.error('LLM gateway request failed', { requestId, error: error.message });
logger.debug('Conversation messages cache hit', { conversationId, count });
```

开启 DEBUG：

```bash
LOG_LEVEL=debug npm run dev
```

每个请求由 `src/middleware/request-context.js` 注入 `requestId`，错误页也会展示。日志现在按日期拆分写入，避免长期追加到一个大文件：

- `logs/app-YYYY-MM-DD.log`：结构化业务日志
- `logs/app-error-YYYY-MM-DD.log`：error 级结构化日志
- `logs/access-YYYY-MM-DD.log`：HTTP access 日志
- `logs/app.log` / `logs/app-error.log`：systemd 旧追加文件，后台查询会兼容读取

管理员后台提供 `/admin/logs` 日志查询页，可按日期、等级、文件报错、类型报错、函数报错筛选，并支持分页。命令行排查时：

```bash
grep '<requestId>' logs/app-*.log logs/app-error-*.log logs/app.log logs/app-error.log
journalctl -u ai-roleplay-site.service --since '30 min ago' | grep '<requestId>'
```

日志规则：

- 不记录密码、Cookie、完整 API Key、完整 prompt
- email/phone 必须脱敏后写日志
- 高频细节放 `debug`
- 可恢复异常放 `warn`
- 不可恢复异常放 `error`

更多见 `docs/DEBUGGING.md`。

## 注释与文档约定

本项目已补充以下维护约定：

- JS/CSS/EJS 文件头说明职责和调用入口
- 关键函数使用 JSDoc 或在 `docs/FUNCTION_REFERENCE.md` 中说明输入/输出/调用方
- 新增文件后运行：

```bash
npm run docs:debug
```

这会刷新：

- `docs/PROJECT_MAP.md`
- `docs/FUNCTION_REFERENCE.md`
- `docs/DEBUGGING.md`

如果某个函数逻辑复杂，优先在源码函数上方补 JSDoc，再补文档索引。

## 前端说明

- `public/styles/site-pages.css` 是页面样式总入口，会 import `site-pages/` 下拆分文件。
- `public/js/chat-page.js` 负责聊天页核心交互：
  - NDJSON 流式消费
  - Markdown / rich content 渲染
  - think/thinking 折叠块
  - 历史消息加载
  - 输入优化
- `public/js/i18n-runtime.js` 提供浏览器端 `window.AI_ROLEPLAY_I18N.t()`。

如果浏览器仍显示旧 JS/CSS，先强刷或清缓存。

## 安全与权限

- 管理页全部通过 `requireAdmin` 保护
- 普通用户页面通过 `requireAuth` 保护
- 私有角色只应由创建者访问
- 角色/消息/会话删除都有安全检查，避免破坏已有会话树
- 页面错误不展示内部堆栈，后端日志保留 requestId 和错误信息

## 版本控制

推荐流程：

```bash
git checkout -b feat/xxx
npm run test:think
npm run test:prompt-route
npm run smoke:test
git add .
git commit -m "feat: xxx"
```

已忽略：

- `node_modules/`
- `.env`
- `logs/`
- `*.log`
- 本地数据文件

## 常见排查入口

| 问题 | 优先看 |
|---|---|
| 聊天流式无响应 | Network 的 NDJSON、`LLM provider request start/response received` 日志 |
| 生成结束后页面异常 | 浏览器 Console、`window.renderRichContent`、`public/js/chat-page.js` 缓存 |
| Markdown 不解析 | `renderRichContent()`、`52-rich-content.css` 是否加载 |
| 登录失败 | `Login failed` 日志和 requestId |
| 注册验证码失败 | `Register validation failed`、验证码 Redis/内存状态 |
| 消息树错乱 | `messages.parent_message_id`、`current_message_id`、`buildConversationView()` |
| 数据库连不上 | `[db] MySQL 连接失败`、`DATABASE_URL`、SQLite 降级日志 |
| Redis 连不上 | `[redis] Redis 连接失败`、`REDIS_URL`、内存模式 warning |

## 说明

- 若未配置 AI 接口/Provider，聊天会失败或返回兜底信息，具体取决于当前配置。
- 对话树能力依赖最新数据库结构，部署前请执行 `npm run db:init`。
- 文档生成脚本不会读取 `.env`，不会输出密钥。
