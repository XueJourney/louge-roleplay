/**
 * @file src/routes/web/chat-stream-utils.js
 * @description
 * 聊天流式接口的 NDJSON 响应工具：错误文案映射、消息片段渲染、流式行切分与中断兜底。
 *
 * 设计约束：
 * - 只被 web 路由层调用，避免 service 层依赖 Express response。
 * - `safeWrite` 必须在连接关闭后静默失败，防止客户端断开导致二次异常。
 * - 用户主动断开但已有部分模型输出时，优先保留已生成内容，避免“写了半天全没了”。
 */

const path = require('path');
const ejs = require('ejs');

const { translate, translateHtml } = require('../../i18n');
const logger = require('../../lib/logger');
const { buildConversationPathView } = require('../../services/conversation-service');
const {
  streamReplyViaGateway,
  streamOptimizeUserInputViaGateway,
} = require('../../services/llm-gateway-service');
const {
  writeNdjson,
  initNdjsonStream,
} = require('../../server-helpers');

const CHAT_MESSAGE_PARTIAL = path.join(__dirname, '..', '..', 'views', 'partials', 'chat-message.ejs');

function mapLlmErrorToUserMessage(error) {
  const errMsg = String(error?.message || '');
  if (errMsg === 'REQUEST_QUOTA_EXCEEDED' || errMsg === 'TOKEN_QUOTA_EXCEEDED') {
    return '额度不足，暂时没法继续生成。';
  }
  if (/aborted by downstream client/i.test(errMsg)) {
    return '这次生成已中断。';
  }
  if (/gateway timeout|request timeout|provider request timeout|504/i.test(errMsg)) {
    return '上游模型服务超时了，先歇一下再试。';
  }
  if (/rate limited|429/i.test(errMsg)) {
    return '上游模型服务被限流了，等一会儿再试。';
  }
  return 'AI 回复失败，请稍后重试。';
}

function buildConversationCharacterPayload(conversation) {
  return {
    name: conversation.character_name,
    summary: conversation.character_summary,
    personality: conversation.personality,
    prompt_profile_json: conversation.prompt_profile_json,
  };
}

function renderChatMessageHtml(req, conversation, message) {
  const locale = req.locale || req.res?.locals?.locale || 'zh-CN';
  const t = req.t || req.res?.locals?.t || ((key, vars) => translate(locale, key, vars));

  return new Promise((resolve, reject) => {
    ejs.renderFile(CHAT_MESSAGE_PARTIAL, { conversation, message, t, locale }, {}, (error, html) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(translateHtml(locale, html));
    });
  });
}

async function buildChatMessagePacket(req, conversation, activeLeafId, messageId) {
  const view = await buildConversationPathView(conversation.id, activeLeafId || messageId);
  const message = view.pathMessages.find((item) => Number(item.id) === Number(messageId));
  if (!message) {
    return null;
  }
  return {
    id: message.id,
    senderType: message.sender_type,
    html: await renderChatMessageHtml(req, conversation, message),
  };
}

function createNdjsonResponder(req, res) {
  let streamClosed = false;
  const abortController = new AbortController();

  initNdjsonStream(res);

  const safeWrite = (payload) => {
    if (streamClosed || res.writableEnded) {
      return false;
    }
    try {
      writeNdjson(res, payload);
      if (typeof res.flush === 'function') {
        res.flush();
      }
      return true;
    } catch (error) {
      cleanup();
      logger.debug('[chat-stream] NDJSON write skipped after stream error', {
        requestId: req.requestId,
        error: error.message,
      });
      return false;
    }
  };

  const heartbeatTimer = setInterval(() => {
    safeWrite({ type: 'ping', ts: Date.now() });
  }, 10000);

  const cleanup = () => {
    if (streamClosed) {
      return;
    }
    streamClosed = true;
    clearInterval(heartbeatTimer);
  };

  req.on('close', () => {
    if (res.writableEnded) {
      cleanup();
      return;
    }
    cleanup();
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  });

  return {
    abortController,
    safeWrite,
    isClosed: () => streamClosed || res.writableEnded,
    end: () => {
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    },
    fail: (error) => {
      if (!res.writableEnded) {
        safeWrite({
          type: 'error',
          message: mapLlmErrorToUserMessage(error),
        });
        res.end();
      }
      cleanup();
    },
  };
}

function createStreamingLineWriter(safeWrite) {
  let lineBuffer = '';

  return {
    onDelta(deltaText, fullContent) {
      const delta = String(deltaText || '');
      const full = String(fullContent || '');
      safeWrite({ type: 'delta', delta, full });
      lineBuffer += delta;
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() || '';
      const committedText = full.slice(0, Math.max(0, full.length - lineBuffer.length));
      parts.forEach((line) => {
        safeWrite({
          type: 'line',
          line,
          full,
          committed: committedText,
          tail: lineBuffer,
        });
      });
    },
    flush(fullContent) {
      const full = String(fullContent || '');
      if (!lineBuffer.trim()) {
        lineBuffer = '';
        return;
      }
      safeWrite({
        type: 'line',
        line: lineBuffer,
        full,
        committed: full,
        tail: '',
      });
      lineBuffer = '';
    },
  };
}

async function streamChatReplyToNdjson({
  requestId,
  userId,
  conversationId,
  character,
  messages,
  userMessage,
  systemHint = '',
  promptKind = 'chat',
  modelMode = 'standard',
  signal,
  safeWrite,
  user = null,
}) {
  let latestFullContent = '';
  let streamed;
  const lineWriter = createStreamingLineWriter(safeWrite);

  try {
    streamed = await streamReplyViaGateway({
      requestId,
      userId,
      conversationId,
      character,
      messages,
      userMessage,
      systemHint,
      promptKind,
      modelMode,
      signal,
      user,
      onDelta: async (deltaText, fullContent) => {
        latestFullContent = String(fullContent || '');
        lineWriter.onDelta(deltaText, fullContent);
      },
    });
  } catch (error) {
    if (signal && signal.aborted && latestFullContent.trim()) {
      return latestFullContent;
    }
    throw error;
  }

  lineWriter.flush(streamed.content);
  return streamed.content;
}

async function streamOptimizedInputToNdjson({
  requestId,
  userId,
  conversationId,
  character,
  messages,
  userInput,
  modelMode = 'standard',
  signal,
  safeWrite,
  user = null,
}) {
  const lineWriter = createStreamingLineWriter(safeWrite);
  const streamed = await streamOptimizeUserInputViaGateway({
    requestId,
    userId,
    conversationId,
    character,
    messages,
    userInput,
    modelMode,
    signal,
    user,
    onDelta: async (deltaText, fullContent) => {
      lineWriter.onDelta(deltaText, fullContent);
    },
  });

  lineWriter.flush(streamed.content);
  return streamed.content;
}

module.exports = {
  mapLlmErrorToUserMessage,
  buildConversationCharacterPayload,
  renderChatMessageHtml,
  buildChatMessagePacket,
  createNdjsonResponder,
  createStreamingLineWriter,
  streamChatReplyToNdjson,
  streamOptimizedInputToNdjson,
};
