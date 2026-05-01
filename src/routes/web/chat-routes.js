/**
 * @file src/routes/web/chat-routes.js
 * @description 聊天路由聚合：页面、发送、重生、编辑、重写、工具。
 */

const { registerChatPageRoutes } = require('./chat/page-routes');
const { registerChatMessageRoutes } = require('./chat/message-routes');
const { registerChatRegenerateRoutes } = require('./chat/regenerate-routes');
const { registerChatEditRoutes } = require('./chat/edit-routes');
const { registerChatReplayRoutes } = require('./chat/replay-routes');
const { registerChatToolRoutes } = require('./chat/tool-routes');

function registerChatRoutes(app, ctx) {
  registerChatPageRoutes(app, ctx);
  registerChatMessageRoutes(app, ctx);
  registerChatRegenerateRoutes(app, ctx);
  registerChatEditRoutes(app, ctx);
  registerChatReplayRoutes(app, ctx);
  registerChatToolRoutes(app, ctx);
}

module.exports = { registerChatRoutes };
