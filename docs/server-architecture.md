# ai-roleplay-site server 架构说明

这份文档说明 `src/server.js` 已经拆成哪些模块，以及各自负责什么。

## 总体结构

### `src/server.js`
只保留启动壳，职责很小：
- 创建 Express 实例
- 等待数据库初始化
- 初始化 Redis
- 安装全局中间件
- 注册业务路由
- 安装 404 与全局错误处理
- 启动 `app.listen(...)`

### `src/server-helpers.js`
兼容导出门面，继续对旧调用方暴露同一批 helper；具体实现已按职责拆到 `src/server-helpers/`：
- `rendering.js`：`renderPage`、`renderRegisterPage`、`renderValidationMessage`、默认 meta、HTML escape
- `request-meta.js`：`getClientIp`、`maskEmail`、`maskPhone`、注册/登录日志 meta
- `ndjson.js`：`writeNdjson`、`initNdjsonStream`
- `parsing.js`：`parseIntegerField`、`parseNumberField`、`parseIdParam`、邮箱/手机号格式校验
- `character-prompt-profile.js`：角色 prompt profile 表单与存储格式转换
- `chat-view.js`：`buildChatRequestContext`、`buildConversationTitle`、`buildNextConversationTitle`、`renderChatPage`、`loadConversationForUserOrFail`

### `src/routes/web-routes.js`
路由聚合与依赖注入入口，负责组装 `routeContext` 并注册公开页、认证、后台、角色、聊天等子路由。聊天流式响应的细节已下沉到 `src/routes/web/chat-stream-utils.js`。

## 当前映射

### 仍在 `src/server.js`
- Express 初始化
- 全局中间件
- `registerWebRoutes(app)` 调用
- 404 handler
- `errorHandler`
- `bootstrap()`

### 已搬到 `src/server-helpers/` 并由 `src/server-helpers.js` 统一导出
- `rendering.js`
  - `renderPage`
  - `renderRegisterPage`
  - `renderValidationMessage`
- `request-meta.js`
  - `getClientIp`
  - `maskEmail`
  - `maskPhone`
  - `buildRegisterLogMeta`
  - `buildLoginLogMeta`
- `ndjson.js`
  - `writeNdjson`
  - `initNdjsonStream`
- `parsing.js`
  - `parseIntegerField`
  - `parseNumberField`
  - `parseIdParam`
  - `isEmail`
  - `isAllowedInternationalEmail`
  - `isDomesticPhone`
- `character-prompt-profile.js`
  - `splitCharacterPromptProfile`
  - `buildCharacterPromptProfileFromForm`
- `chat-view.js`
  - `buildChatRequestContext`
  - `buildConversationTitle`
  - `buildNextConversationTitle`
  - `renderChatPage`
  - `loadConversationForUserOrFail`

### 已搬到 `src/routes/web/chat-stream-utils.js`
- `mapLlmErrorToUserMessage`
- `buildConversationCharacterPayload`
- `renderChatMessageHtml`
- `buildChatMessagePacket`
- `createNdjsonResponder`
- `createStreamingLineWriter`
- `streamChatReplyToNdjson`
- `streamOptimizedInputToNdjson`

### 已搬到 `src/routes/web-routes.js`
- 所有 `app.get(...)`
- 所有 `app.post(...)`
- 跟具体页面/业务流相关的编排逻辑

## 这么拆的原因

原版 `server.js` 太重，混了三类东西：
1. 启动壳
2. 纯工具函数
3. 所有路由逻辑

拆完之后：
- `server.js` 更容易维护
- 路由更容易继续分文件
- 工具函数更容易复用
- 后面要再拆聊天/管理/认证，只需要继续从 `web-routes.js` 往下拆

## 下一步建议

如果还要继续瘦身，推荐优先再拆这几个：
- `src/routes/web/admin-routes.js`：按 dashboard / plans / providers / notifications / prompts / logs / conversations / users 拆分
- `src/routes/web/auth-routes.js`：按 verification / register / session / dashboard / profile 拆分
- `public/js/chat/controller.js`：按 conversation state / streaming UI / compose submit / optimize submit / action stream submit / history loader 拆分
- `src/services/plan-service.js`：按 plan normalizer / CRUD / subscription / quota 拆分

继续采用“兼容门面 + 搬迁式拆分”，避免一次重构过多调用方。
