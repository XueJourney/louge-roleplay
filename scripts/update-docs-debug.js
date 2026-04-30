#!/usr/bin/env node
/**
 * @file scripts/update-docs-debug.js
 * @description
 * 一次性维护脚本：为 ai-roleplay-site 生成/刷新项目梳理文档、注释索引与调试说明。
 *
 * 使用场景：
 * - 大规模代码梳理时，避免手工复制每个函数/文件说明。
 * - 新增 JS/EJS/CSS 文件后，可重新运行本脚本同步 docs/PROJECT_MAP.md 与 docs/FUNCTION_REFERENCE.md。
 *
 * 调用方式：
 *   node scripts/update-docs-debug.js
 *
 * 注意：
 * - 该脚本只写 Markdown 文档，不改业务代码。
 * - 不读取 .env，不输出任何密钥。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function write(file, content) {
  const target = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function walk(dir, predicate = () => true) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  const output = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(ROOT, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        visit(full);
      } else if (predicate(relative)) {
        output.push(relative);
      }
    }
  }
  visit(base);
  return output.sort();
}

function extractFileDescription(source) {
  const jsDoc = source.match(/\/\*\*[\s\S]*?\*\//);
  if (!jsDoc) return '';
  const desc = jsDoc[0]
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
    .filter((line) => line && !line.startsWith('@file'))
    .join(' ')
    .replace(/@description\s*/g, '')
    .trim();
  return desc;
}

function extractFunctions(source) {
  const names = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const name = match[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(name)) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

const FILE_NOTES = {
  'src/server.js': 'Express 启动入口：等待 DB/Redis、装配全局中间件、注册路由、启动监听。调用链起点。',
  'src/server-helpers.js': '路由公共辅助：页面渲染、参数解析、账号脱敏、聊天页 view model、NDJSON 输出。被 web-routes.js 调用。',
  'src/routes/web-routes.js': '主 Web 路由注册文件：公开页、认证、后台、角色、线性聊天、重写/编辑/流式接口。依赖 service 层完成业务。',
  'src/config.js': '环境变量解析与隐私安全配置摘要。被 server、service、脚本读取。',
  'src/i18n.js': '服务端/客户端共用国际化词典与 HTML 文本翻译工具。被 i18n 中间件和渲染层调用。',
  'src/lib/db.js': '数据库抽象层，MySQL 优先、SQLite 兜底，提供 query/withTransaction。所有 service 的 DB 入口。',
  'src/lib/db-sqlite-schema.js': 'SQLite 初始化 schema 与种子数据，供 db.js 首次创建本地库时调用。',
  'src/lib/logger.js': '统一结构化日志输出，支持 LOG_LEVEL 过滤和 DEBUG 开关。所有后端模块应通过它写日志。',
  'src/lib/redis.js': 'Redis 客户端与内存降级实现，供 session、验证码、缓存、限流使用。',
  'src/middleware/request-context.js': '为每个请求注入 requestId/currentUser，后续日志和错误页用它串联。',
  'src/middleware/i18n.js': '根据 query/cookie/Accept-Language 解析语言，并向 req/res.locals 注入 t()。',
  'src/middleware/auth.js': '登录/管理员鉴权中间件，保护 dashboard/admin/chat 等页面。',
  'src/middleware/error-handler.js': '全局错误转译与错误页渲染，避免向页面泄露堆栈。',
  'src/services/admin-service.js': '后台首页聚合查询：用户套餐、Provider 列表、概览统计。',
  'src/services/ai-service.js': '旧版直连 OpenAI 兼容接口服务；新路径优先使用 llm-gateway-service。',
  'src/services/aliyun-sms-service.js': '阿里云短信验证码发送封装。被 verification-service 调用。',
  'src/services/captcha-service.js': '图形验证码生成、刷新、读取与校验。依赖 Redis/内存缓存。',
  'src/services/character-service.js': '角色 CRUD 与可见性控制。被首页、dashboard、角色编辑和开聊流程调用。',
  'src/services/conversation-service.js': '会话/消息核心服务：消息写入、当前显示链读取、编辑、重写、独立对话克隆和删除保护。聊天路由主要依赖它。',
  'src/services/email-service.js': 'Resend 邮件验证码发送封装。被 verification-service 调用。',
  'src/services/font-proxy-service.js': 'Google Fonts 代理与缓存，避免页面字体资源直接失败。被 /fonts/* 路由调用。',
  'src/services/llm-gateway-service.js': 'LLM 网关核心：Provider 选择、额度校验、上下文裁剪、队列、流式解析、用量记录。',
  'src/services/llm-provider-service.js': '后台 Provider 管理、模型列表拉取、模型模式配置校验。',
  'src/services/llm-usage-service.js': 'LLM job 与 usage log 写入。被网关成功/失败收尾逻辑调用。',
  'src/services/password-service.js': 'bcrypt 密码 hash/verify。被注册、登录、改密码使用。',
  'src/services/phone-auth-service.js': '国内手机号一键认证占位/封装。被注册流程调用。',
  'src/services/plan-service.js': '套餐、订阅、额度快照与额度断言。被后台和 LLM 网关调用。',
  'src/services/prompt-engineering-service.js': '全局提示词片段、角色提示词结构、运行时变量模板和最终 system prompt 拼装。',
  'src/services/rate-limit-service.js': '基于 Redis/内存 incr+expire 的轻量限流。被登录/注册/验证码调用。',
  'src/services/user-service.js': '用户创建、登录查询、资料更新、角色更新。',
  'src/services/verification-service.js': '邮箱/手机验证码签发与验证编排。调用 email/sms/rate-limit/captcha。',
  'scripts/full-flow-e2e.js': '全流程 E2E 测试脚本：创建临时用户/角色/会话，验证当前显示链、LLM 流式、后台查询、日志和删除保护，结束后清理测试数据。',
  'public/js/chat-page.js': '聊天页前端核心：流式 NDJSON 消费、富文本/Markdown 渲染、思考块折叠、加载历史、输入优化。',
  'public/js/admin-page.js': '后台交互：套餐字段切换、Prompt 片段排序/预览、后台列表过滤。',
  'public/js/character-editor-page.js': '角色编辑器动态字段：提示词条目增删、排序、预览。',
  'public/js/register-page.js': '注册页交互：国家/地区切换、验证码刷新、邮箱/手机验证码发送。',
  'public/js/i18n-runtime.js': '浏览器端轻量 t() 翻译函数，供页面脚本复用。',
};

const FUNCTION_NOTES = {
  renderPage: '统一渲染业务视图并套 layout；调用方传 res/view/params，内部负责 i18n 翻译和渲染失败兜底。',
  renderRegisterPage: '渲染注册页并注入验证码、表单状态和公开手机号认证配置。',
  getClientIp: '从 x-forwarded-for/socket 提取客户端 IP；主要用于限流和日志。',
  maskEmail: '脱敏邮箱，日志中只保留少量可定位信息。',
  maskPhone: '脱敏手机号，日志中只保留前三后四。',
  buildRegisterLogMeta: '生成注册流程结构化日志 meta。',
  buildLoginLogMeta: '生成登录流程结构化日志 meta。',
  writeNdjson: '向响应写入一行 NDJSON，并在支持时 flush。',
  initNdjsonStream: '初始化流式响应头，关闭代理缓冲。',
  buildChatRequestContext: '根据当前会话/父消息/输入，计算聊天 promptKind 和历史上下文。',
  renderChatPage: '加载当前显示链、计算可见消息，渲染线性聊天页。',
  loadConversationForUserOrFail: '按当前用户加载会话；不存在时直接渲染提示页并返回 null。',
  query: '执行 SQL，自动等待数据库初始化并适配 MySQL/SQLite 返回格式。',
  withTransaction: '以 MySQL/SQLite 兼容形式执行事务回调。',
  initRedis: '初始化 Redis；失败或未配置时降级到内存客户端。',
  requestContext: '为请求生成 requestId，写入 req 和 res.locals。',
  attachI18n: '解析 locale，挂载 req.t/res.locals.t 和客户端词典。',
  requireAuth: '要求登录；未登录跳转 /login。',
  requireAdmin: '要求管理员；非管理员记录警告并展示无权限页。',
  errorHandler: '全局错误处理中间件；记录日志并按错误类型展示友好消息。',
  createCharacter: '创建角色，写入用户、基础设定、首句、提示词结构和可见性。',
  updateCharacter: '更新当前用户拥有的角色。',
  listPublicCharacters: '读取公开且 published 的角色供首页展示。',
  listUserCharacters: '读取某用户自己的角色供 dashboard 展示。',
  getCharacterById: '读取角色详情；传 userId 时限制必须归属该用户。',
  deleteCharacterSafely: '安全删除角色；已有会话时拒绝删除。',
  createConversation: '创建会话，可带父会话、来源消息、模型模式和标题。',
  addMessage: '按 sequence_no 追加消息并失效会话消息缓存。',
  normalizeMessagePromptKind: '规范化 messages.prompt_kind 写库值；兼容旧调用传入 chat，并回落到 normal，避免 MySQL ENUM 写入截断。',
  listMessages: '读取完整消息列表，保留给克隆独立对话和诊断脚本使用；聊天页不再调用。',
  buildPathMessages: '从已加载消息列表中取当前显示链，主要给脚本/克隆逻辑复用。',
  buildConversationPathView: '按当前消息构造聊天页轻量显示链 view model，不加载完整消息列表。',
  cloneConversationBranch: '把某条消息之前的内容复制成独立对话。',
  deleteMessageSafely: '删除消息前检查后续消息和派生对话，避免破坏已有内容。',
  deleteConversationSafely: '删除会话前检查后续关联，避免留下孤立内容。',
  generateReplyViaGateway: '非流式生成 AI 回复，走统一 LLM 网关。',
  streamReplyViaGateway: '流式生成 AI 回复，onDelta 接收增量。',
  streamOptimizeUserInputViaGateway: '流式优化用户输入。',
  optimizeUserInputViaGateway: '非流式优化用户输入。',
  executeLlmRequest: 'LLM 网关总编排：额度、Provider、prompt、调用、记录用量。',
  callProviderStream: '调用 OpenAI-compatible chat completions stream 并解析 SSE。',
  trimMessagesForContext: '按 Provider 上下文窗口裁剪历史消息。',
  summarizeDiscardedMessages: '将被裁剪的旧消息摘要后回填上下文。',
  composeSystemPrompt: '按全局片段、角色片段、系统提示和运行时变量拼装 system prompt。',
  applyRuntimeTemplate: '替换提示词中的运行时变量，例如时间、用户名。',
  parsePromptItemsFromForm: '从表单数组字段中解析角色/全局提示词条目。',
  normalizePromptItems: '清洗提示词条目，去空值并规范 order/enabled。',
  hitLimit: '限流计数：窗口内超过 limit 返回 true。',
  hashPassword: '生成 bcrypt hash。',
  verifyPassword: '校验明文密码与 hash。',
};

function functionNote(name) {
  if (Object.prototype.hasOwnProperty.call(FUNCTION_NOTES, name)) {
    return FUNCTION_NOTES[name];
  }
  return '内部辅助函数；调用方见所在文件导出或同文件路由/事件处理逻辑。';
}

function generateProjectMap() {
  const jsFiles = walk('src', (f) => f.endsWith('.js'))
    .concat(walk('public/js', (f) => f.endsWith('.js')))
    .concat(walk('scripts', (f) => f.endsWith('.js')));
  const viewFiles = walk('src/views', (f) => f.endsWith('.ejs'));
  const styleFiles = walk('public/styles', (f) => f.endsWith('.css') || f.endsWith('.md'));

  const routeLines = read('src/routes/web-routes.js')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter((item) => /^app\.(get|post|put|patch|delete)\(/.test(item.line))
    .map((item) => `| ${item.index} | \`${item.line.replace(/\|/g, '\\|')}\` |`)
    .join('\n');

  const fileTable = jsFiles.map((file) => {
    const source = read(file);
    const desc = FILE_NOTES[file] || extractFileDescription(source) || '待补充：该文件缺少明确文件头说明。';
    return `| \`${file}\` | ${desc.replace(/\|/g, '\\|')} |`;
  }).join('\n');

  const viewTable = viewFiles.map((file) => `| \`${file}\` | EJS 页面/局部模板；由 \`renderPage\` 或 \`ejs.renderFile\` 渲染，具体入口见路由表。 |`).join('\n');
  const styleTable = styleFiles.map((file) => `| \`${file}\` | 样式资源；通过 \`public/styles/site-pages.css\` 或页面 layout 引入。 |`).join('\n');

  return `# ai-roleplay-site 项目梳理\n\n` +
`> 本文档由 \`scripts/update-docs-debug.js\` 生成并可手工补充。目标是让后续维护者快速知道“文件在哪、谁调用谁、怎么 DEBUG”。\n\n` +
`## 1. 项目定位\n\n` +
`\`ai-roleplay-site\` 是一个 Express + EJS 的多用户 AI 角色对话站点，产品名“楼阁”。核心能力包括注册登录、角色创建、线性对话、重写/编辑、LLM Provider 管理、套餐额度、流式生成和富文本展示。\n\n` +
`## 2. 目录职责\n\n` +
`| 目录/文件 | 职责 |\n|---|---|\n` +
`| \`src/server.js\` | 应用启动壳，负责全局中间件和路由挂载。 |\n` +
`| \`src/routes/\` | HTTP 路由编排层；目前主要集中在 \`web-routes.js\`。 |\n` +
`| \`src/services/\` | 业务服务层；角色、会话、LLM、套餐、验证码等核心逻辑都在这里。 |\n` +
`| \`src/lib/\` | 基础设施：数据库、Redis、日志。 |\n` +
`| \`src/middleware/\` | Express 中间件：请求上下文、鉴权、i18n、错误处理。 |\n` +
`| \`src/views/\` | EJS 页面和局部模板。 |\n` +
`| \`public/js/\` | 浏览器端页面脚本。 |\n` +
`| \`public/styles/\` | 全站样式拆分文件。 |\n` +
`| \`scripts/\` | 初始化、健康检查、烟测、临时 E2E/单测脚本。 |\n` +
`| \`docs/\` | 架构、风险、调试和维护文档。 |\n` +
`| \`data/\` | 本地 SQLite 数据库目录，生产/开发数据，不应提交。 |\n` +
`| \`logs/\` | 运行日志目录，不应提交。 |\n\n` +
`## 3. 主要调用链\n\n` +
`### 页面请求\n\n` +
`\`browser -> src/server.js -> middleware(requestContext/i18n/session) -> src/routes/web-routes.js -> service -> db/redis -> renderPage(EJS layout)\`\n\n` +
`### 聊天流式生成\n\n` +
`\`public/js/chat-page.js -> POST /chat/:id/message/stream -> createNdjsonResponder -> streamChatReplyToNdjson -> llm-gateway-service -> provider SSE -> NDJSON -> 前端 renderRichContent\`\n\n` +
`### 当前显示链读取\n\n` +
`\`renderChatPage/load history -> conversation-service.buildConversationPathView -> recursive CTE path query -> EJS/partial\`\n\n` +
`### 注册验证码\n\n` +
`\`register-page.js -> /api/send-email-code 或 /api/send-phone-code -> captcha-service.verifyCaptcha -> verification-service -> email/sms service -> Redis code\`\n\n` +
`## 4. JS 文件地图\n\n| 文件 | 职责 / 调用说明 |\n|---|---|\n${fileTable}\n\n` +
`## 5. EJS 模板地图\n\n| 文件 | 职责 / 调用说明 |\n|---|---|\n${viewTable}\n\n` +
`## 6. 样式文件地图\n\n| 文件 | 职责 / 调用说明 |\n|---|---|\n${styleTable}\n\n` +
`## 7. 路由清单\n\n| 行号 | 路由注册 |\n|---:|---|\n${routeLines}\n\n` +
`## 8. DEBUG 入口\n\n` +
`- 每个请求都有 \`requestId\`：错误页会展示，请用它 grep 日志。\n` +
`- 后端日志统一走 \`src/lib/logger.js\`，支持 \`LOG_LEVEL=debug\`。\n` +
`- 流式聊天优先看：浏览器 Console、Network 的 NDJSON 分包、后端 \`LLM provider request start/response received\`。\n` +
`- 当前显示链异常优先看：\`fetchPathMessages()\` 的递归 CTE、\`messages.parent_message_id\` 和 \`current_message_id\`。\n` +
`- 注册/登录异常优先看：\`Register validation failed\`、\`Login failed\`，日志会脱敏 email/phone。\n`;
}

function generateFunctionReference() {
  const files = walk('src', (f) => f.endsWith('.js'))
    .concat(walk('public/js', (f) => f.endsWith('.js')))
    .concat(walk('scripts', (f) => f.endsWith('.js')))
    .sort();

  let content = '# 函数与调用说明索引\n\n';
  content += '> 本文档由 `scripts/update-docs-debug.js` 生成，用于满足“每个文件、每个函数都有介绍和调用说明”的维护需求。真正复杂的函数仍建议在源码附近补充 JSDoc。\n\n';
  for (const file of files) {
    const source = read(file);
    const desc = FILE_NOTES[file] || extractFileDescription(source) || '待补充文件职责。';
    const functions = extractFunctions(source);
    content += `## \`${file}\`\n\n`;
    content += `${desc}\n\n`;
    if (!functions.length) {
      content += '- 本文件没有可识别的命名函数，主要通过顶层脚本、配置或模板逻辑工作。\n\n';
      continue;
    }
    content += '| 函数 | 介绍与调用说明 |\n|---|---|\n';
    for (const name of functions) {
      content += `| \`${name}\` | ${functionNote(name).replace(/\|/g, '\\|')} |\n`;
    }
    content += '\n';
  }
  return content;
}

function generateDebugGuide() {
  return `# DEBUG 与日志指南\n\n` +
`## 日志级别\n\n` +
`日志统一由 \`src/lib/logger.js\` 输出。推荐：\n\n` +
`\`\`\`bash\nLOG_LEVEL=debug npm run dev\n# 或生产环境临时调试：\nLOG_LEVEL=debug npm run start\n\`\`\`\n\n` +
`级别顺序：\`debug < info < warn < error\`。生产默认建议 \`info\`，排查问题时改为 \`debug\`。\n\n` +
`## 日志文件与后台查询\n\n` +
`日志现在会按日期拆分，避免长期塞进单个文件：\n\n` +
`- \`logs/app-YYYY-MM-DD.log\`：业务结构化日志\n` +
`- \`logs/app-error-YYYY-MM-DD.log\`：error 级结构化日志\n` +
`- \`logs/access-YYYY-MM-DD.log\`：morgan HTTP access 日志\n` +
`- \`logs/app.log\` / \`logs/app-error.log\`：systemd 旧追加文件，仍会被后台查询兼容读取\n\n` +
`后台入口：\`/admin/logs\`。支持日期查询、等级筛选、文件报错筛选、类型报错筛选、函数报错筛选和分页。\n\n` +
`## requestId\n\n` +
`\`src/middleware/request-context.js\` 会给每个请求生成 \`requestId\`，错误页也会展示。排障时：\n\n` +
`\`\`\`bash\ngrep '<requestId>' logs/app-*.log logs/app-error-*.log logs/app.log logs/app-error.log\n# systemd 部署时：\njournalctl -u ai-roleplay-site.service --since '30 min ago' | grep '<requestId>'\n\`\`\`\n\n` +
`## 常见问题排查\n\n` +
`### 1. 聊天流式生成结束后显示异常\n\n` +
`检查顺序：\n\n` +
`1. 浏览器 Console 是否有 JS 报错。\n` +
`2. Network 中 \`/chat/:id/message/stream\` 是否持续返回 \`application/x-ndjson\`。\n` +
`3. 后端日志是否有 \`LLM provider request start\`、\`LLM provider response received\`、\`LLM gateway request failed\`。\n` +
`4. 前端 \`window.renderRichContent\` 是否存在，\`public/js/chat-page.js\` 是否为最新版本（必要时强刷）。\n\n` +
`### 2. Markdown / think 折叠不显示\n\n` +
`检查：\`public/js/chat-page.js\` 的 \`renderRichContent\`、\`collectFoldBlocks\`、\`markdownToHtml\`，以及 \`public/styles/site-pages/52-rich-content.css\` 是否加载。\n\n` +
`### 3. 登录/注册失败\n\n` +
`看日志中的 \`Register validation failed\`、\`Register succeeded\`、\`Login failed\`、\`Login succeeded\`。日志会脱敏邮箱/手机。\n\n` +
`### 4. 数据库异常\n\n` +
`- \`[db] MySQL 连接失败，自动降级到 SQLite\`：检查 \`DATABASE_URL\`。\n` +
`- SQLite 本地库：\`data/local.db\`。\n` +
`- 初始化/迁移：\`npm run db:init\`。\n\n` +
`### 5. Redis / 缓存异常\n\n` +
`- \`[redis] REDIS_URL 未设置，使用内存模式\`：开发可接受，生产不建议。\n` +
`- 会话消息缓存异常不应阻塞业务；会记录 warning 并回源 DB。聊天页首屏已改为轻量读取。\n\n` +
`## 全流程测试\n\n` +
`- 入口：\`npm run full-flow:test\`。\n` +
`- 覆盖：DB/Redis、用户创建与默认套餐、角色创建/编辑、当前显示链、真实 LLM 流式回复与输入优化、聊天页渲染、后台对话/日志查询、删除保护。\n` +
`- 测试脚本使用唯一临时数据，结束时会尽量删除新增用户、角色、会话、LLM job/usage 记录。若中途被强杀，可按输出的 userId / characterId / conversationId 做人工清理。\n\n` +
`## 加日志约定\n\n` +
`- 业务成功：\`logger.info('xxx succeeded', { requestId, ... })\`\n` +
`- 可恢复异常：\`logger.warn('xxx failed but fallback', { requestId, error })\`\n` +
`- 不可恢复异常：\`logger.error('xxx failed', { requestId, error, stack })\`\n` +
`- 高频细节：\`logger.debug('xxx detail', { requestId, ids/counts })\`，避免输出完整 prompt、密码、token、API key。\n`;
}

function main() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  write('docs/PROJECT_MAP.md', generateProjectMap());
  write('docs/FUNCTION_REFERENCE.md', generateFunctionReference());
  write('docs/DEBUGGING.md', generateDebugGuide());
  console.log('Updated docs/PROJECT_MAP.md, docs/FUNCTION_REFERENCE.md, docs/DEBUGGING.md');
}

main();
