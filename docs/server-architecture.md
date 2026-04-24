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
承接原来 `server.js` 顶部的公共工具函数，主要是：
- 页面渲染：`renderPage`、`renderRegisterPage`、`renderValidationMessage`、`renderChatPage`
- 参数解析：`parseIntegerField`、`parseNumberField`、`parseIdParam`
- 文本/账号脱敏：`maskEmail`、`maskPhone`
- 日志 meta：`buildRegisterLogMeta`、`buildLoginLogMeta`
- 聊天编排辅助：`buildChatRequestContext`、`buildConversationTitle`、`buildBranchConversationTitle`、`buildNextConversationTitle`
- 流输出辅助：`writeNdjson`、`initNdjsonStream`
- 会话加载辅助：`loadConversationForUserOrFail`
- 角色 prompt 结构处理：`splitCharacterPromptProfile`、`buildCharacterPromptProfileFromForm`

### `src/routes/web-routes.js`
承接原来 `server.js` 里所有业务路由注册，包含：
- 首页、注册页、验证码 API
- Health check
- 角色/用户/计划/Provider/Admin 相关页面与 API
- 聊天主流程：
  - 普通发送
  - 流式发送
  - 重算 / regenerate
  - 删除消息 / 对话
  - 编辑用户消息 / AI 回复
  - replay
  - 分支创建
  - 模型模式切换
  - 输入优化

## 当前映射

### 仍在 `src/server.js`
- Express 初始化
- 全局中间件
- `registerWebRoutes(app)` 调用
- 404 handler
- `errorHandler`
- `bootstrap()`

### 已搬到 `src/server-helpers.js`
- `renderPage`
- `renderRegisterPage`
- `getClientIp`
- `maskEmail`
- `maskPhone`
- `buildRegisterLogMeta`
- `buildLoginLogMeta`
- `renderValidationMessage`
- `writeNdjson`
- `buildChatRequestContext`
- `initNdjsonStream`
- `parseIntegerField`
- `parseNumberField`
- `parseIdParam`
- `splitCharacterPromptProfile`
- `buildCharacterPromptProfileFromForm`
- `isEmail`
- `isAllowedInternationalEmail`
- `isDomesticPhone`
- `buildConversationTitle`
- `buildBranchConversationTitle`
- `buildNextConversationTitle`
- `renderChatPage`
- `loadConversationForUserOrFail`

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
- `src/routes/chat-routes.js`
- `src/routes/admin-routes.js`
- `src/routes/auth-routes.js`
- `src/routes/public-routes.js`

这样 `web-routes.js` 就能继续缩下去，最终变成只负责汇总注册。
