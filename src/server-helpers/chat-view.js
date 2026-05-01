/**
 * @file src/server-helpers/chat-view.js
 * @description 聊天页 view model、对话标题和会话加载辅助。保持路由层薄一点，避免把页面状态散落到各聊天子路由。
 */

const {
  getConversationById,
  getLatestMessage,
  getConversationMessageCount,
  setConversationCurrentMessage,
  buildConversationPathView,
  fetchPathMessages,
} = require('../services/conversation-service');
const { getChatModelSelector } = require('../services/llm-gateway-service');
const { renderPage } = require('./rendering');

async function buildChatRequestContext(req, conversation, rawContent, parentMessageId, options = {}) {
  const messageCount = options.messageCount === undefined
    ? await getConversationMessageCount(conversation.id)
    : Number(options.messageCount || 0);
  const isFirstTurn = messageCount === 0;
  const content = String(rawContent || '').trim() || (isFirstTurn ? '[开始一次新的对话]' : '');
  let fallbackLeafId = conversation.current_message_id || options.fallbackLeafId || null;
  if (!fallbackLeafId && !isFirstTurn) {
    const latestMessage = await getLatestMessage(conversation.id);
    fallbackLeafId = latestMessage?.id || null;
  }
  const history = await fetchPathMessages(conversation.id, parentMessageId || fallbackLeafId || null);
  return {
    isFirstTurn,
    content,
    history,
    promptKind: isFirstTurn ? 'conversation-start' : 'chat',
    messageCount,
  };
}

function buildConversationTitle(characterName, content = '') {
  const tail = String(content || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return tail ? `${characterName} · ${tail}` : `${characterName} · 新对话`;
}

function buildNextConversationTitle(conversation, userContent) {
  return buildConversationTitle(conversation.character_name, userContent || conversation.character_summary || '');
}

async function renderChatPage(req, res, conversation, options = {}) {
  const latestMessage = conversation.current_message_id ? null : await getLatestMessage(conversation.id);
  const fallbackLeafId = conversation.current_message_id || latestMessage?.id || null;
  const requestedLeafId = Number(options.leafId || req.query.leaf || fallbackLeafId || 0) || null;
  const activeLeafId = requestedLeafId || fallbackLeafId || null;

  if (options.persistLeaf && activeLeafId && Number(conversation.current_message_id || 0) !== Number(activeLeafId)) {
    await setConversationCurrentMessage(conversation.id, activeLeafId);
    conversation.current_message_id = activeLeafId;
  }

  const view = activeLeafId
    ? await buildConversationPathView(conversation.id, activeLeafId, { messageCount: options.messageCount })
    : { pathMessages: [], activeLeafId: null, messageCount: options.messageCount === undefined ? await getConversationMessageCount(conversation.id) : Number(options.messageCount || 0) };
  const initialVisibleCount = Math.max(3, Number(options.initialVisibleCount || 3));
  const keepFromIndex = Math.max(0, view.pathMessages.length - initialVisibleCount - 1);
  view.visiblePathMessages = view.pathMessages.slice(keepFromIndex);
  view.hasOlderMessages = view.pathMessages.length > view.visiblePathMessages.length;
  view.oldestVisibleMessageId = view.visiblePathMessages.length ? view.visiblePathMessages[0].id : null;
  const chatModelSelector = await getChatModelSelector(req.session?.user?.id || null);

  const activeMode = (chatModelSelector.options || []).some((option) => option.mode === conversation.selected_model_mode)
    ? conversation.selected_model_mode
    : (chatModelSelector.options || []).find((option) => option.isDefault)?.mode || (chatModelSelector.options || [])[0]?.mode || conversation.selected_model_mode || 'standard';

  return renderPage(res, 'chat', {
    title: req.t ? req.t('聊天') : '聊天',
    conversation: {
      ...conversation,
      selected_model_mode: activeMode,
    },
    view,
    draftContent: options.draftContent || String(req.query.draft || ''),
    optimizedContent: options.optimizedContent || '',
    newContinuationPreview: options.newContinuationPreview || null,
    chatModelSelector,
    errorMessage: options.errorMessage || null,
  });
}

async function loadConversationForUserOrFail(req, res, conversationId) {
  const conversation = await getConversationById(conversationId, req.session.user.id);
  if (!conversation) {
    renderPage(res, 'message', { title: req.t ? req.t('提示') : '提示', message: req.t ? req.t('会话不存在或无权访问。') : '会话不存在或无权访问。' });
    return null;
  }
  return conversation;
}

module.exports = {
  buildChatRequestContext,
  buildConversationTitle,
  buildNextConversationTitle,
  renderChatPage,
  loadConversationForUserOrFail,
};
