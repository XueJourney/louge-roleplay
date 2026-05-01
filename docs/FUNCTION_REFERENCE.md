# 函数与调用说明索引

> 本文档由 `scripts/update-docs-debug.js` 生成，用于满足“每个文件、每个函数都有介绍和调用说明”的维护需求。真正复杂的函数仍建议在源码附近补充 JSDoc。

## `public/js/admin-page.js`

后台交互：套餐字段切换、Prompt 片段排序/预览、后台列表过滤。

| 函数 | 介绍与调用说明 |
|---|---|
| `apply` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `applyFilter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `applyModelFilter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatPromptSection` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getItems` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `moveItem` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalize` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderPreview` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `setupPlanModelRow` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `syncDefaultValue` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `syncOrder` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/character-editor-page.js`

角色编辑器动态字段：提示词条目增删、排序、预览。

| 函数 | 介绍与调用说明 |
|---|---|
| `bindItem` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createItem` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `refreshOrders` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderPreview` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat-page.js`

聊天页前端核心：流式 NDJSON 消费、富文本/Markdown 渲染、思考块折叠、加载历史、输入优化。

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `public/js/chat/bubbles.js`

待补充文件职责。

| 函数 | 介绍与调用说明 |
|---|---|
| `appendSingleStreamingBubble` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `appendStreamingPair` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createBubble` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createChatBubbles` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `removeLivePair` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `replaceBubbleWithHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `replacePreviousLiveUserBubble` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat/controller.js`

/** 聊天页交互控制：流式发送、历史加载、重写/重新生成反馈。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `beginStreamingAutoFollow` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureStartMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handleMainComposeSubmit` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handlePageAbort` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `loadOlderMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maybeFollowStreamingBubble` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `releaseStreamingAutoFollow` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `reloadToMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `removeStaleLinearTail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `scheduleStreamingRender` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `setBubbleFinalState` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `splitStreamingSegments` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateCurrentMessageState` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateHiddenParentInputs` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat/dom-utils.js`

待补充文件职责。

| 函数 | 介绍与调用说明 |
|---|---|
| `closeMessageMenus` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `closeSiblingMessageMenus` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createFragmentFromHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `hydrateRichContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isNearPageBottom` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderStreamingPlainText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showToast` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat/message-menu.js`

/** 聊天消息操作区：点击消息上的“⋯”，在对应消息上方插入轻量上下文操作卡。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `closeActions` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getExistingDock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderActionsFor` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `setActiveMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat/rich-renderer.js`

/** 聊天消息富文本渲染与安全净化。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `acceptNode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `applyInlineMarkdown` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildFold` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildStreamingPreviewHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `collectFoldBlocks` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `escapeHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `flushParagraph` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `highlightQuotesInNodeTree` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isBlank` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isBullet` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isFencePlaceholder` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isHr` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isOrdered` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isQuoteMarkerOnly` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isQuoted` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `markdownToHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `markdownToPartialHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeMarkdownLines` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseHeading` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderRichContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sanitizeCss` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sanitizeNodeTree` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `splitStreamingSegments` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/chat/stream-client.js`

待补充文件职责。

| 函数 | 介绍与调用说明 |
|---|---|
| `consumeNdjsonStream` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createStreamClient` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handlePacket` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `message` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/csrf.js`

/** 自动为同源 POST 表单与 fetch 请求附加 CSRF token。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `attachCsrfToForms` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/error-page.js`

/** 错误页脚本；当前客服入口由 notification-client 的 data-open-support 委托统一处理。 /

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `public/js/form-guards.js`

/** CSP 兼容的全局表单保护：替代模板里的 inline onsubmit confirm。 /

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `public/js/i18n-runtime.js`

浏览器端轻量 t() 翻译函数，供页面脚本复用。

| 函数 | 介绍与调用说明 |
|---|---|
| `interpolate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `t` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/layout-bootstrap.js`

/** 全站前端 bootstrap。由 layout 注入 JSON 数据，本文件负责挂到 window。 /

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `public/js/notification-client.js`

/** 前台站内通知与客服入口展示。调用说明：layout 注入 bootstrap 后自动显示，聊天错误可触发 support 模式。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildSupportQr` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `closeActiveOverlay` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `hasSeen` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `markSeen` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `qrImageUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderBanner` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderModal` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderToast` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showInitialNotifications` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showNotification` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showSupport` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `storageKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `text` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/profile-page.js`

待补充文件职责。

| 函数 | 介绍与调用说明 |
|---|---|
| `applyCaptchaRefreshFromResponse` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getCaptchaPayload` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `refreshCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sendEmailCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sendPhoneCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showCaptchaHint` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/quota-bars.js`

/** 将 data-width 百分比应用到额度条，避免 inline style 违反 CSP。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `applyQuotaBars` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `public/js/register-config.js`

/** 注册页认证配置 bootstrap，避免 inline script 违反 CSP。 /

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `public/js/register-page.js`

注册页交互：国家/地区切换、验证码刷新、邮箱/手机验证码发送。

| 函数 | 介绍与调用说明 |
|---|---|
| `applyCaptchaRefreshFromResponse` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getCountryType` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handleCountryChange` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `init` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `refreshCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sendEmailCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sendPhoneCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `showCaptchaHint` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `syncCountryCards` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toggleEmailBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/check-i18n-completeness.js`

/** 检查楼阁项目 i18n 词典是否覆盖已登记 key，并扫描页面/前端脚本残留中文文案，帮助持续补全国际化。 调用说明：npm run i18n:check。脚本只读文件，发现缺失时以非 0 退出。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `add` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `collectChineseLiterals` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `collectTKeys` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isInsideTCall` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeLiteral` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `printList` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shouldIgnoreLiteral` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `walk` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/full-flow-e2e.js`

全流程 E2E 测试脚本：创建临时用户/角色/会话，验证当前显示链、LLM 流式、后台查询、日志和删除保护，结束后清理测试数据。

| 函数 | 介绍与调用说明 |
|---|---|
| `cleanupCreatedData` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `makeMockResponse` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `onDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `redirect` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `render` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `send` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `status` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `type` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/grant-admin.js`

/** 手动授予管理员权限。只允许本机显式执行，不走隐式自动提权。 用法：node scripts/grant-admin.js <username> /

| 函数 | 介绍与调用说明 |
|---|---|
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/health-check.js`

/** 基础健康检查：配置、数据库、Redis、公开 HTTP 页面。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `checkDatabase` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `checkRedis` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `fetchStatus` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/init-db.js`

/** 数据库初始化脚本。根据当前配置自动选择初始化策略： MySQL 模式（DATABASE_URL 已设置）： - 使用 DATABASE_ADMIN_URL 创建数据库（若不存在） - 创建全部业务表并补全历史缺失字段/索引（幂等，可反复执行） - 写入默认套餐与 LLM 提供商种子数据 SQLite 模式（DATABASE_URL 未设置）： - 表结构由 db.js 在首次连接时自动初始化，此脚本无需额外操作 - 数据库文件路径：<项目根>/data/local.db 使用方式： npm run db:init 或 node scripts/init-db.js /

| 函数 | 介绍与调用说明 |
|---|---|
| `backfillUserPublicIds` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildLegacyPlanModelsJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureColumn` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureIndex` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureUniqueIndex` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `exists` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getDatabaseNameFromUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getRandomDigits` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maskApiKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `quoteIdentifier` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/smoke-test.js`

/** 生产冒烟检查：只做只读探测，不写业务数据。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `assert` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `fetchText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-admin-conversations.js`

/** 后台全局对话记录查询冒烟测试。调用说明：`npm run admin-conversations:test`，验证服务查询、筛选和 EJS 模板渲染。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `t` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-admin-logs-route.js`

/** 管理后台日志页模板冒烟测试。调用说明：`npm run admin-logs:test`，验证日志查询结果能正常渲染为后台 UI。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `t` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-conversation-service.js`

/** Conversation service regression tests for linear chat refactor behavior. /

| 函数 | 介绍与调用说明 |
|---|---|
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-log-service.js`

/** 日志解析服务冒烟测试。调用说明：`npm run logs:test`，用于确认后台日志分页/筛选基础逻辑可用。 /

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `scripts/test-model-entitlements.js`

/** Focused tests for plan model entitlement normalization and admin form parsing. /

| 函数 | 介绍与调用说明 |
|---|---|
| `testFormParsing` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `testNormalizationAndBilling` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `testSerializationAndFallback` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-prompt-route.js`

/** Prompt 路由/LLM 网关的轻量单元测试。 调用说明： - `npm run test:prompt-route` 执行。 - 通过 monkey patch Module._load 隔离外部依赖，只验证 prompt 构造与路由调用契约。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/test-think-parser.js`

/** 最小回归测试：验证 think/reasoning 解析与展示规则的关键正则行为。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `assert` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `collectFoldTitles` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `combineReplyContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractReasoningText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeLooseText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `stripThinkTags` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/tmp-stream-e2e.js`

/** 临时流式聊天 E2E 调试脚本。 调用说明： - 手动运行 `node scripts/tmp-stream-e2e.js`。 - 会使用 .env 中 APP_URL/DATABASE_URL，登录固定测试用户并请求流式接口。 - 这是排查聊天 NDJSON/最终落库问题的临时脚本，不应放进生产定时任务。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `consumeNdjson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `cookieHeader` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `login` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `postForm` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `queryDb` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `request` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `startConversation` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `summarizePackets` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateCookies` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/update-docs-debug.js`

/** 一次性维护脚本：为 ai-roleplay-site 生成/刷新项目梳理文档、注释索引与调试说明。 使用场景： - 大规模代码梳理时，避免手工复制每个函数/文件说明。 - 新增 JS/EJS/CSS 文件后，可重新运行本脚本同步 docs/PROJECT_MAP.md 与 docs/FUNCTION_REFERENCE.md。 调用方式： node scripts/update-docs-debug.js 注意： - 该脚本只写 Markdown 文档，不改业务代码。 - 不读取 .env，不输出任何密钥。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `extractFileDescription` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractFunctions` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `functionNote` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateDebugGuide` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateFunctionReference` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateProjectMap` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `main` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `read` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `visit` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `walk` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `write` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `scripts/version-check.js`

/** Validate project version metadata before release/tagging. /

| 函数 | 介绍与调用说明 |
|---|---|
| `fail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maybeExec` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ok` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `readJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/config.js`

环境变量解析与隐私安全配置摘要。被 server、service、脚本读取。

| 函数 | 介绍与调用说明 |
|---|---|
| `getPrivacySafeSummary` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maskSecret` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `readBool` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `readString` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/i18n.js`

服务端/客户端共用国际化词典与 HTML 文本翻译工具。被 i18n 中间件和渲染层调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `buildLocaleSwitchLinks` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getClientMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getLocaleMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `interpolate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeLocale` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `pickFromAcceptLanguage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `resolveLocale` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `translate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `translateHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `translateTagAttributes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `translateTextSegment` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/i18n/messages.en.js`

待补充文件职责。

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `src/i18n/messages.zh-CN.js`

待补充文件职责。

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `src/lib/db-sqlite-schema.js`

SQLite 初始化 schema 与种子数据，供 db.js 首次创建本地库时调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `backfillSqliteUserPublicIds` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildLegacyPlanModelsJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureSqliteCharactersVisibilityColumn` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureSqliteColumn` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureSqliteUniqueIndex` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `exists` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getRandomDigitsForSqliteBackfill` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `initSqliteSchema` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maskApiKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/lib/db.js`

数据库抽象层，MySQL 优先、SQLite 兜底，提供 query/withTransaction。所有 service 的 DB 入口。

| 函数 | 介绍与调用说明 |
|---|---|
| `getDbType` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `initMySQL` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `initSQLite` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `initialize` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `query` | 执行 SQL，自动等待数据库初始化并适配 MySQL/SQLite 返回格式。 |
| `sqliteExec` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toSqliteDialect` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `waitReady` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `withTransaction` | 以 MySQL/SQLite 兼容形式执行事务回调。 |

## `src/lib/logger.js`

统一结构化日志输出，支持 LOG_LEVEL 过滤和 DEBUG 开关。所有后端模块应通过它写日志。

| 函数 | 介绍与调用说明 |
|---|---|
| `debug` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `error` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatMeta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `info` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `log` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `redactString` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sanitizeLogMeta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shouldLog` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `warn` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/lib/redis.js`

Redis 客户端与内存降级实现，供 session、验证码、缓存、限流使用。

| 函数 | 介绍与调用说明 |
|---|---|
| `_isExpired` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `constructor` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `get` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `initRedis` | 初始化 Redis；失败或未配置时降级到内存客户端。 |
| `isRedisReal` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `on` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `set` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/lib/url-safety.js`

/** 外部服务 URL 安全校验，避免 Provider Base URL 被用于 SSRF/内网探测。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `assertSafeExternalHttpUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `assertSafeHttpsUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isPrivateIp` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isPrivateIpv4` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isPrivateIpv6` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/lib/user-public-id.js`

/** 用户公开唯一 ID 生成工具。公开 ID 从三位起步，无固定上限。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `generateUniqueUserPublicId` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getRandomDigits` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/middleware/auth.js`

登录/管理员鉴权中间件，保护 dashboard/admin/chat 等页面。

| 函数 | 介绍与调用说明 |
|---|---|
| `requireAdmin` | 要求管理员；非管理员记录警告并展示无权限页。 |
| `requireAuth` | 要求登录；未登录跳转 /login。 |

## `src/middleware/csrf.js`

/** 基于 session 的轻量 CSRF 防护。优先校验 token；为避免上线时旧页面脚本瞬断，允许同源 Origin/Referer 兜底。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `createCsrfToken` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `csrfProtection` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getExpectedOrigin` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getSubmittedToken` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `hasSameOriginSignal` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isSameOrigin` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `safeCompare` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/middleware/error-handler.js`

全局错误转译与错误页渲染，避免向页面泄露堆栈。

| 函数 | 介绍与调用说明 |
|---|---|
| `errorHandler` | 全局错误处理中间件；记录日志并按错误类型展示友好消息。 |
| `mapErrorToPresentation` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderErrorWithLayout` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/middleware/i18n.js`

根据 query/cookie/Accept-Language 解析语言，并向 req/res.locals 注入 t()。

| 函数 | 介绍与调用说明 |
|---|---|
| `attachI18n` | 解析 locale，挂载 req.t/res.locals.t 和客户端词典。 |

## `src/middleware/request-context.js`

为每个请求注入 requestId/currentUser，后续日志和错误页用它串联。

| 函数 | 介绍与调用说明 |
|---|---|
| `requestContext` | 为请求生成 requestId，写入 req 和 res.locals。 |

## `src/routes/web-routes.js`

主 Web 路由注册文件：公开页、认证、后台、角色、线性聊天、重写/编辑/流式接口。依赖 service 层完成业务。

| 函数 | 介绍与调用说明 |
|---|---|
| `registerWebRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `resolveAllowedInitialModelMode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/admin-routes.js`

/** 从 web-routes.js 拆出的路由分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildPageUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `registerAdminRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/auth-routes.js`

/** 从 web-routes.js 拆出的路由分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildFormState` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `refreshAndRespond` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `registerAuthRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `registerLogMeta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderProfileMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderRegisterError` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/character-routes.js`

/** 从 web-routes.js 拆出的路由分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerCharacterRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat-routes.js`

/** 聊天路由聚合：页面、发送、重生、编辑、重写、工具。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat-stream-utils.js`

/** 聊天流式接口的 NDJSON 响应工具：错误文案映射、消息片段渲染、流式行切分与中断兜底。 设计约束： - 只被 web 路由层调用，避免 service 层依赖 Express response。 - `safeWrite` 必须在连接关闭后静默失败，防止客户端断开导致二次异常。 - 用户主动断开但已有部分模型输出时，优先保留已生成内容，避免“写了半天全没了”。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildChatMessagePacket` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildConversationCharacterPayload` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `cleanup` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createNdjsonResponder` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createStreamingLineWriter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `flush` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `mapLlmErrorToUserMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `onDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderChatMessageHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `safeWrite` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `streamChatReplyToNdjson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `streamOptimizedInputToNdjson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/edit-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatEditRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/message-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatMessageRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/page-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatPageRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/regenerate-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatRegenerateRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/replay-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatReplayRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/chat/tool-routes.js`

/** 聊天路由子分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `registerChatToolRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/routes/web/public-routes.js`

/** 从 web-routes.js 拆出的路由分组。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `getSameOriginBackUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `registerPublicRoutes` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/server-helpers.js`

路由公共辅助：页面渲染、参数解析、账号脱敏、聊天页 view model、NDJSON 输出。被 web-routes.js 调用。

- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。

## `src/server-helpers/character-prompt-profile.js`

/** 角色 Prompt Profile 表单与存储格式转换，供角色编辑页和路由层复用。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildCharacterPromptProfileFromForm` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `splitCharacterPromptProfile` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/server-helpers/chat-view.js`

/** 聊天页 view model、对话标题和会话加载辅助。保持路由层薄一点，避免把页面状态散落到各聊天子路由。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildChatRequestContext` | 根据当前会话/父消息/输入，计算聊天 promptKind 和历史上下文。 |
| `buildConversationTitle` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildNextConversationTitle` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `loadConversationForUserOrFail` | 按当前用户加载会话；不存在时直接渲染提示页并返回 null。 |
| `renderChatPage` | 加载当前显示链、计算可见消息，渲染线性聊天页。 |

## `src/server-helpers/ndjson.js`

/** NDJSON 流响应基础工具。只负责 Express response 头和单包写入，不包含聊天业务语义。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `initNdjsonStream` | 初始化流式响应头，关闭代理缓冲。 |
| `writeNdjson` | 向响应写入一行 NDJSON，并在支持时 flush。 |

## `src/server-helpers/parsing.js`

/** 路由层参数解析与基础账号格式校验。外部输入必须显式校验，避免 `Number(...) || 0` 把非法值静默吞掉。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `isAllowedInternationalEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isDomesticPhone` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseIdParam` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseIntegerField` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseNumberField` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/server-helpers/rendering.js`

/** EJS 页面渲染、默认 meta 与通用提示页封装。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildAbsoluteUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildDefaultMeta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `escapeHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `renderPage` | 统一渲染业务视图并套 layout；调用方传 res/view/params，内部负责 i18n 翻译和渲染失败兜底。 |
| `renderRegisterPage` | 渲染注册页并注入验证码、表单状态和公开手机号认证配置。 |
| `renderValidationMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/server-helpers/request-meta.js`

/** 请求来源与账号标识脱敏工具。日志只记录可排障信息，不写入完整邮箱/手机号/密码等敏感值。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildLoginLogMeta` | 生成登录流程结构化日志 meta。 |
| `buildRegisterLogMeta` | 生成注册流程结构化日志 meta。 |
| `getClientIp` | 从 x-forwarded-for/socket 提取客户端 IP；主要用于限流和日志。 |
| `maskEmail` | 脱敏邮箱，日志中只保留少量可定位信息。 |
| `maskPhone` | 脱敏手机号，日志中只保留前三后四。 |

## `src/server.js`

Express 启动入口：等待 DB/Redis、装配全局中间件、注册路由、启动监听。调用链起点。

| 函数 | 介绍与调用说明 |
|---|---|
| `bootstrap` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildCspDirectives` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `nonceValue` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shutdown` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `write` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/admin-conversation-service.js`

/** 管理后台全局对话记录查询服务。 调用说明： - `src/routes/web-routes.js` 的 `/admin/conversations` 调用 `listAdminConversations()` 渲染全局会话列表。 - `src/routes/web-routes.js` 的 `/admin/conversations/:id` 调用 `getAdminConversationDetail()` 查看单条会话完整消息。 - 支持按用户、角色卡、日期和删除状态筛选；后台可以恢复或永久删除软删除数据。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildConversationWhere` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatDateTime` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getAdminConversationDetail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listAdminConversations` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listConversationFilterOptions` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeDate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizePositiveInteger` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeStatusFilter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `permanentlyDeleteConversation` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `permanentlyDeleteMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `restoreConversation` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `restoreMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `trimPreview` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/admin-service.js`

后台首页聚合查询：用户套餐、Provider 列表、概览统计。

| 函数 | 介绍与调用说明 |
|---|---|
| `getAdminOverview` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listProviders` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listUsersWithPlans` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/ai-service.js`

旧版直连 OpenAI 兼容接口服务；新路径优先使用 llm-gateway-service。

| 函数 | 介绍与调用说明 |
|---|---|
| `appendContentDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `appendReasoningDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPromptMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildRuntimeContext` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `callProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `closeReasoningIfNeeded` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `combineReplyContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractMessageContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractReasoningText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateReply` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handleSseBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeTextContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `optimizeUserInput` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseStreamDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shouldAppendUserMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `stripThinkTags` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/aliyun-sms-service.js`

阿里云短信验证码发送封装。被 verification-service 调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `createClient` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `sendLoginCodeSms` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/captcha-service.js`

图形验证码生成、刷新、读取与校验。依赖 Redis/内存缓存。

| 函数 | 介绍与调用说明 |
|---|---|
| `createCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateSvg` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getCaptchaImage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `invalidateCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `randomText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `refreshCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `verifyCaptcha` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/character-service.js`

角色 CRUD 与可见性控制。被首页、dashboard、角色编辑和开聊流程调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `countCharacterConversations` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createCharacter` | 创建角色，写入用户、基础设定、首句、提示词结构和可见性。 |
| `deleteCharacterSafely` | 安全删除角色；已有会话时拒绝删除。 |
| `getCharacterById` | 读取角色详情；传 userId 时限制必须归属该用户。 |
| `getPublicCharacterSelectFields` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getPublicCharacterSortSql` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getPublicCharacterStatsJoinSql` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listFeaturedPublicCharacters` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listPublicCharacters` | 读取公开且 published 的角色供首页展示。 |
| `listUserCharacters` | 读取某用户自己的角色供 dashboard 展示。 |
| `normalizePublicCharacterSort` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeVisibility` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `stringifyPromptProfile` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateCharacter` | 更新当前用户拥有的角色。 |

## `src/services/character-social-service.js`

/** 公开角色点赞、评论、使用量与热度统计服务。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `addCharacterComment` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensurePublicCharacter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listCharacterComments` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `markCharacterUsed` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeCommentBody` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toggleCharacterLike` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/conversation-service.js`

会话/消息核心服务：消息写入、当前显示链读取、编辑、重写、独立对话克隆和删除保护。聊天路由主要依赖它。

| 函数 | 介绍与调用说明 |
|---|---|
| `addMessage` | 按 sequence_no 追加消息并失效会话消息缓存。 |
| `buildConversationPathView` | 按当前消息构造聊天页轻量显示链 view model，不加载完整消息列表。 |
| `buildMessageMaps` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPathMessages` | 从已加载消息列表中取当前显示链，主要给脚本/克隆逻辑复用。 |
| `cloneConversationBranch` | 把某条消息之前的内容复制成独立对话。 |
| `countChildConversations` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createConversation` | 创建会话，可带父会话、来源消息、模型模式和标题。 |
| `createEditedMessageVariant` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `decoratePathMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `deleteConversationSafely` | 删除会话前检查后续关联，避免留下孤立内容。 |
| `deleteMessageSafely` | 删除消息前检查后续消息和派生对话，避免破坏已有内容。 |
| `fetchMessagesFromDatabase` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `fetchPathMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getConversationById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getConversationMessageCount` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getConversationMessagesCacheKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getLatestMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getMessageById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `invalidateConversationCache` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listMessages` | 读取完整消息列表，保留给克隆独立对话和诊断脚本使用；聊天页不再调用。 |
| `listUserConversations` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeMessageForView` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeMessagePromptKind` | 规范化 messages.prompt_kind 写库值；兼容旧调用传入 chat，并回落到 normal，避免 MySQL ENUM 写入截断。 |
| `safeParseJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `setConversationCurrentMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shortText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `stripThinkTags` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateConversationModelMode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateConversationTitle` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/email-service.js`

Resend 邮件验证码发送封装。被 verification-service 调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `sendVerificationEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/email-template-service.js`

/** Branded HTML email templates for verification messages. /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildVerificationEmailHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildVerificationEmailText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `escapeHtml` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/font-proxy-service.js`

Google Fonts 代理与缓存，避免页面字体资源直接失败。被 /fonts/* 路由调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `fetchWithTimeout` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getCache` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getFontFile` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getGoogleFontCss` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isAllowedFontFileUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `logFontProxyError` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `rewriteGoogleFontCss` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `setCache` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/llm-gateway-service.js`

LLM 网关核心：Provider 选择、额度校验、上下文裁剪、队列、流式解析、用量记录。

| 函数 | 介绍与调用说明 |
|---|---|
| `attachSelectedModel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPromptMessages` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildRuntimeContext` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `executeLlmQueued` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `executeLlmRequest` | LLM 网关总编排：额度、Provider、prompt、调用、记录用量。 |
| `finalizeLlmJobFailure` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `finalizeLlmJobSuccess` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `generateReplyViaGateway` | 非流式生成 AI 回复，走统一 LLM 网关。 |
| `getChatModelSelector` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `optimizeUserInputViaGateway` | 非流式优化用户输入。 |
| `resolveCallModelMode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `resolveProviderForPlanModel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `streamOptimizeUserInputViaGateway` | 流式优化用户输入。 |
| `streamReplyViaGateway` | 流式生成 AI 回复，onDelta 接收增量。 |
| `summarizeDiscardedMessages` | 将被裁剪的旧消息摘要后回填上下文。 |

## `src/services/llm-gateway/content-utils.js`

/** LLM 响应内容、token 粗估和上下文裁剪工具。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildSummaryTranscript` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `combineReplyContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `estimatePromptTokens` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `estimateTokens` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractMessageContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractReasoningText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeMessageRole` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeTextContent` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `shouldAppendUserMessage` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `stripThinkTags` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `trimMessagesForContext` | 按 Provider 上下文窗口裁剪历史消息。 |

## `src/services/llm-gateway/priority-queue.js`

/** LLM 全局并发与优先级队列。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `createPriorityQueue` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `drainQueue` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `enqueueWithPriority` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/llm-gateway/provider-client.js`

/** OpenAI-compatible provider 调用与 SSE 流解析。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `appendContentDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `appendReasoningDelta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `armIdleTimeout` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `callProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `callProviderStream` | 调用 OpenAI-compatible chat completions stream 并解析 SSE。 |
| `cleanup` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `closeReasoningIfNeeded` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `extractStreamDeltaParts` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getProviderModelId` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `handleSseBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeProviderError` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `readProviderErrorBody` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/llm-provider-service.js`

后台 Provider 管理、模型列表拉取、模型模式配置校验。

| 函数 | 介绍与调用说明 |
|---|---|
| `buildModelOptions` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureNonNegativeNumber` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensurePositiveInteger` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `fetchProviderModels` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getActiveProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getProviderById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listProviders` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `maskApiKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeBaseUrl` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `pickDefaultModel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `resolveProviderModels` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `validateContextWindow` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/llm-usage-service.js`

LLM job 与 usage log 写入。被网关成功/失败收尾逻辑调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `createLlmJob` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createUsageLog` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateLlmJob` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/log-service.js`

/** 后台日志查询与按日写入服务。 调用说明： - `src/lib/logger.js` 调用 `appendDailyLog()`，把运行日志拆成 `logs/app-YYYY-MM-DD.log`、`logs/app-error-YYYY-MM-DD.log`、`logs/access-YYYY-MM-DD.log`。 - `src/routes/web-routes.js` 的 `/admin/logs` 调用 `listLogEntries()`，解析旧日志和新日志，提供日期、等级、文件、错误类型、函数名筛选与分页。 - 本服务只读写 `logs/` 目录，不碰业务数据库，也不记录敏感请求正文。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `appendDailyLog` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildEntryFields` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `collectFacet` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `compactProjectPath` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureLogDir` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getDailyLogPath` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getLocalDateKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `inferErrorType` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `inferFunctionName` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `inferLogFileType` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listAvailableDates` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listLogEntries` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listReadableLogFiles` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `matchesText` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeLevel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeLogDate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseApacheDate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseDateFromFileName` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseJsonMeta` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseLogFile` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseLogLine` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parseStackFrame` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `readFileTail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toDisplayTime` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/model-entitlement-service.js`

/** Plan-specific model entitlement normalization, persistence helpers, and quota multiplier math. /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildDefaultPlanModelsFromProvider` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPlanModelLabel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findPlanModel` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getBillableRequestUnits` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getBillableTokenUnits` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeModelKey` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeMultiplier` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizePlanModelItem` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizePlanModels` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeProviderId` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parsePlanModelsJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `serializePlanModels` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/model-form-service.js`

/** Parse admin form fields for plan model entitlements. /

| 函数 | 介绍与调用说明 |
|---|---|
| `asArray` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `parsePlanModelsFromBody` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/notification-service.js`

/** 站内通知与客服入口配置服务。调用说明：管理后台维护通知规则与客服入口外部资源，布局与聊天页通过公开接口读取当前用户可见通知。 /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildNotificationPayload` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createNotification` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `decodeNotification` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `deleteNotification` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureNotificationSchema` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatDateForInput` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getClientNotificationBootstrap` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `isNotificationVisibleToUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listActiveNotificationsForUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listNotificationsForAdmin` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeBoolean` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeChoice` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeOptionalDate` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizeString` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `seedSupportNotificationIfEmpty` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toNumber` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateNotification` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/password-service.js`

bcrypt 密码 hash/verify。被注册、登录、改密码使用。

| 函数 | 介绍与调用说明 |
|---|---|
| `hashPassword` | 生成 bcrypt hash。 |
| `verifyPassword` | 校验明文密码与 hash。 |

## `src/services/phone-auth-service.js`

国内手机号一键认证占位/封装。被注册流程调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `verifyDomesticPhoneIdentity` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/plan-model-validation-service.js`

/** Server-side validation for plan model entitlements against configured providers. /

| 函数 | 介绍与调用说明 |
|---|---|
| `buildProviderModelLookup` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `validatePlanModelsAgainstProviders` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/plan-service.js`

套餐、订阅、额度快照与额度断言。被后台和 LLM 网关调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `assertUserQuotaAvailable` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `assignDefaultPlanToUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPlanModelOptions` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildUsageSinceClause` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `createPlan` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `deletePlan` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensureNonNegativeInteger` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `ensurePositiveInteger` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findPlanById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getActiveSubscriptionForUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getCurrentUsageForUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getSubscriptionModelConfig` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `getUserQuotaSnapshot` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `hydratePlanModelsForPlan` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `hydratePlanModelsForPlans` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listPlans` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizePlanPayload` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updatePlan` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateUserPlan` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/prompt-engineering-service.js`

全局提示词片段、角色提示词结构、运行时变量模板和最终 system prompt 拼装。

| 函数 | 介绍与调用说明 |
|---|---|
| `applyRuntimeTemplate` | 替换提示词中的运行时变量，例如时间、用户名。 |
| `applyRuntimeTemplateToCharacter` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildCharacterPromptItems` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `buildPromptPreview` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `composeSystemPrompt` | 按全局片段、角色片段、系统提示和运行时变量拼装 system prompt。 |
| `createPromptBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `deletePromptBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatPromptSection` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `formatRuntimeTime` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `listPromptBlocks` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `normalizePromptItems` | 清洗提示词条目，去空值并规范 order/enabled。 |
| `parsePromptItemsFromForm` | 从表单数组字段中解析角色/全局提示词条目。 |
| `reorderPromptBlocks` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `safeParseJson` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `toArray` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updatePromptBlock` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/rate-limit-service.js`

基于 Redis/内存 incr+expire 的轻量限流。被登录/注册/验证码调用。

| 函数 | 介绍与调用说明 |
|---|---|
| `hitLimit` | 限流计数：窗口内超过 limit 返回 true。 |

## `src/services/user-service.js`

用户创建、登录查询、资料更新、角色更新。

| 函数 | 介绍与调用说明 |
|---|---|
| `createUser` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserAuthById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserByEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserById` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserByLogin` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserByPhone` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserByPublicId` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `findUserByUsername` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `unbindUserEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `unbindUserPhone` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updatePasswordHash` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateUserEmail` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateUserPhone` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateUserRole` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `updateUsername` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

## `src/services/verification-service.js`

邮箱/手机验证码签发与验证编排。调用 email/sms/rate-limit/captcha。

| 函数 | 介绍与调用说明 |
|---|---|
| `generateCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `issueEmailCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `issuePhoneCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `verifyEmailCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |
| `verifyPhoneCode` | 内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。 |

