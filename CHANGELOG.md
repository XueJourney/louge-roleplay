# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

## [1.2.0] - 2026-05-01

### Added

- 新增套餐级模型权益配置：后台可为每个套餐配置不定数量的前台可选模型，并隐藏真实 Provider/model ID。
- 新增模型请求倍率与 Token 倍率，支持高级模型按多倍请求次数或多倍 Token 扣减额度。
- 新增用量日志计费字段，保留原始 token/cost，同时记录模型 key、模型 ID、倍率、可计费请求单位与可计费 Token。
- 新增模型权益解析测试 `npm run model-entitlements:test`。

### Changed

- 聊天页模型选择改为按当前用户套餐动态渲染；套餐不支持的模型会被拒绝或回落到默认模型。
- 配额校验改为使用可计费请求/Token 单位，并补齐 `hybrid` 模式同时校验请求与 Token。
- MySQL/SQLite 初始化与升级路径新增 `plans.plan_models_json`、用量计费字段，并将会话模型字段放宽为通用 model key。
- 邮箱验证码改为更完整的响应式 HTML 卡片模板，同时保留纯文本兜底。
- 将邮箱模板、模型 entitlement、后台模型表单解析与模型-provider 校验拆成独立服务，减轻主流程文件负担。

### Fixed

- 修复后台套餐计费模式已支持 `hybrid` 但老 MySQL enum 可能未升级的问题。
- 修复后台可误选“Provider A + Provider B 模型”的隐性错配风险。
- 修复套餐模型默认 radio 在编辑页可能错误选中多行的问题。

## [1.1.4] - 2026-05-01

### Added

- 新增站点 favicon、Apple touch icon、PWA manifest 与 Open Graph 分享图。
- 为公开首页与公开角色列表补充页面级 SEO/社交分享描述。

### Fixed

- 富文本消息中的引号高亮改为在 DOM 清洗后处理文本节点，避免高亮逻辑破坏链接、代码块或已转义 HTML。

## [1.1.3] - 2026-05-01

### Added

- 新增 `npm run i18n:check`，检查中英文词典 key 覆盖与页面/前端脚本残留中文文案。

### Changed

- 补齐中英文 i18n 词典，覆盖后台日志、对话审计、通知中心、客服入口与通知弹窗等文案。
- 将通知中心、日志查询、对话记录详情和前端通知弹窗的用户可见硬编码文案接入翻译能力。

## [1.1.2] - 2026-05-01

### Fixed

- 恢复主页/导航栏“联系客服”入口，仅在二维码弹窗内部隐藏重复的外链按钮。

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
