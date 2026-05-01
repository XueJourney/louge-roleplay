/**
 * @file src/server-helpers.js
 * @description
 * 路由层公共辅助函数的兼容导出门面。具体实现已按职责拆到 `src/server-helpers/`：
 * - rendering：页面渲染、默认 meta、提示页
 * - request-meta：IP、账号脱敏和日志 meta
 * - ndjson：流响应基础写入
 * - parsing：参数解析与账号格式校验
 * - character-prompt-profile：角色 Prompt Profile 表单转换
 * - chat-view：聊天页 view model、标题和会话加载
 *
 * 调用说明：
 * - 现有路由可继续 `require('../server-helpers')`，避免大范围改动。
 * - service 层不要反向依赖本文件，避免形成“业务服务 -> 路由工具”的耦合。
 * - DEBUG 信息统一走 logger，页面只展示必要状态，不暴露内部堆栈。
 */

module.exports = {
  ...require('./server-helpers/rendering'),
  ...require('./server-helpers/request-meta'),
  ...require('./server-helpers/ndjson'),
  ...require('./server-helpers/parsing'),
  ...require('./server-helpers/character-prompt-profile'),
  ...require('./server-helpers/chat-view'),
};
