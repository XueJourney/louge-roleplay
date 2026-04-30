# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

## [1.1.1] - 2026-05-01

### Changed

- 前台取消导航栏“联系客服”按钮，避免页面常驻客服入口。
- 客服弹窗取消外链按钮，只保留二维码扫码入口与关闭按钮。

## [1.1.0] - 2026-05-01

### Added

- 新增通知中心后台，可配置显示时间、强制显示、只显示一次、新人通知、受众、展示位置、优先级与客服入口外部资源。
- 前台新增站内通知渲染器，支持弹窗、顶部横幅、轻提示，并在聊天报错或错误页主动展示客服入口。
- 新增通知表初始化与默认企业微信客服入口种子数据。

## [1.0.1] - 2026-05-01

### Fixed

- 聊天页加载更早消息时保持正确时间顺序，不再把历史消息倒序插入。
- 线性聊天从历史节点继续生成/重写/重新生成时，会清理旧的可见后续，避免同屏出现两条后续线。
- 流式回复被中断时，已生成的角色回复会以 `streaming` 状态保留，避免只留下孤立用户消息。
- GET 访问历史 `?leaf=` 不再改写会话当前指针；只有明确写操作才持久化当前 leaf。
- 复制独立对话时保留原会话回应风格，不再静默回到标准模式。
- MySQL 新库初始化时直接创建 `conversations.selected_model_mode` 字段。
- requestId 改用 Node 原生 `crypto.randomUUID()`，移除 `uuid` 依赖并清空 npm audit 中等风险。

### Changed

- 聊天输入改为 Enter 发送、Shift+Enter 换行。
- 增加移动端聊天底部操作菜单遮罩、安全区、触控尺寸与输入区吸底优化。

### Added

- 新增 `npm run conversation-service:test`，覆盖会话复制保留回应风格与 leaf 指针回归。

## [1.0.0] - 2026-05-01

### Added

- 建立楼阁项目的第一个生产基线版本。
- 包含注册/登录、角色创建与编辑、树状会话、分支/重算/编辑、流式聊天、后台 Provider 管理、套餐额度、验证码、后台日志与后台会话查看。
- 生产部署基线：systemd 服务 `ai-roleplay-site`、Nginx 反代、MySQL、Redis、HTTPS 域名 `aicafe.momentsofus.cn`。
- 增加版本管理规范、版本检查脚本与版本暴露能力。

### Known Issues

- 完整 E2E 会真实调用外部 LLM Provider；如果模型网关或模型响应超过 Provider 超时，会导致 `npm run full-flow:test` 失败。核心健康检查与轻量回归测试不依赖该链路。
