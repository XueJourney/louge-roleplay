# 风险复核报告 - 2026-05-01

## 范围

本次复核覆盖楼阁项目当前维护批次的结构拆分、流式聊天、认证/后台路由、套餐额度、SQLite 初始化、文档与验证脚本。目标是降低大文件维护风险，同时保持现有外部行为不变。

## 已完成的风险缓解

### 1. 大文件拆分与职责隔离

- `src/routes/web/admin-routes.js` 已改为聚合器，具体后台页面拆到 `src/routes/web/admin/`：dashboard、plans、providers、notifications、prompts、logs、conversations、users。
- `src/routes/web/auth-routes.js` 已改为聚合器，验证码、注册、登录会话、dashboard、profile 分拆到 `src/routes/web/auth/`。
- `public/js/chat/controller.js` 已瘦身为前端装配入口，流式 UI、会话状态、主输入提交、润色提交、消息动作提交、历史加载分别拆到 `public/js/chat/` 子模块。
- `src/services/plan-service.js` 已拆为兼容门面，套餐 CRUD、订阅/配额、载荷归一化、模型权益 hydration、用量周期 SQL 片段均放入 `src/services/plan/`。
- `src/services/conversation-service.js` 已拆出消息视图纯函数与递归路径查询模块。
- `src/lib/db-sqlite-schema.js` 已拆为 SQLite schema 聚合入口，具体表结构与种子数据按领域放入 `src/lib/sqlite-schema/`。

### 2. 兼容性策略

- 保留原有主入口文件名与导出名，旧调用方不需要改 import 路径。
- 路由拆分采用 `registerXRoutes(app, ctx)` 注入模式，保留原依赖来源与中间件顺序。
- 前端脚本按原 controller 内部函数边界搬迁，并在 `chat.ejs` 中显式按依赖顺序加载。

### 3. 异常/边界处理

- 聊天 NDJSON 写入路径已增加连接关闭/写入失败保护，避免客户端断开后触发二次异常。
- 聊天前端入口会检测必需模块缺失并中止初始化，避免半初始化造成重复绑定。
- 验证码发送失败路径继续刷新图形验证码，减少旧验证码重放和用户卡死风险。
- 套餐 payload 数值字段统一做非负/正整数校验，避免后台表单脏值进入 DB。
- SQLite schema 拆分后保留 `IF NOT EXISTS`、补列与索引幂等逻辑，重复初始化安全。

## 剩余关注点

| 风险点 | 当前状态 | 建议 |
|---|---|---|
| `public/js/chat/rich-renderer.js` 仍较大 | 459 行，承担富文本解析/净化核心职责 | 暂不继续拆，避免破坏消息渲染安全边界；后续若新增 Markdown 能力再按 tokenizer / sanitizer / renderer 拆。 |
| 前端脚本加载顺序 | 已在 `chat.ejs` 明确依赖顺序 | 若未来引入 bundler，应把这些全局模块改为模块化 import。 |
| SQLite 与 MySQL schema 双轨 | SQLite 已拆分，MySQL 初始化仍在脚本中维护 | 每次新增字段需同时更新 MySQL init、SQLite schema、version check/health check。 |
| 完整 E2E 依赖外部 LLM | 当前轻量验证不真实调用模型 | 发布前如 Provider 可用，单独运行 `npm run full-flow:test`。 |

## 验证策略

本次完成后应运行：

- `node -c` 覆盖新增/变更 JS 文件。
- `npm run docs:debug` 刷新项目地图和函数索引。
- 核心回归：`test:think`、`test:prompt-route`、`conversation-service:test`、`model-entitlements:test`。
- 后台页面冒烟：`admin-logs:test`、`admin-conversations:test`。
- 发布前检查：`i18n:check`、`version:check`、`health:check`、`smoke:test`、`git diff --check`。

## 结论

本批维护主要是行为保持型拆分。高风险路径（聊天流式、认证、后台套餐、SQLite 初始化）均保留兼容入口，并通过语法检查、文档生成和回归脚本验证。当前没有发现需要阻塞提交的未处理风险。
