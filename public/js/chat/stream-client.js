/**
 * @file public/js/chat/stream-client.js
 * @description 聊天页 NDJSON 流式请求消费器。
 */

(function () {
  function createStreamClient(options) {
    const settings = Object.assign({
      t: (key) => key,
      splitStreamingSegments: null,
      scheduleStreamingRender: null,
      setBubbleFinalState: null,
      replacePreviousLiveUserBubble: null,
      replaceBubbleWithHtml: null,
      removeStaleLinearTail: null,
      createFragmentFromHtml: null,
      hydrateRichContent: null,
      chatContainer: null,
    }, options || {});

    async function consumeNdjsonStream(streamOptions) {
      const request = Object.assign({
        endpoint: '',
        payload: null,
        streamBubble: null,
        abortController: null,
      }, streamOptions || {});

      const response = await fetch(request.endpoint, {
        method: 'POST',
        body: new URLSearchParams(request.payload),
        signal: request.abortController ? request.abortController.signal : undefined,
        headers: {
          'Accept': 'application/x-ndjson',
          'X-Requested-With': 'fetch',
        },
      });

      const responseType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !response.body || !responseType.includes('application/x-ndjson')) {
        const bodyText = await response.text().catch(() => '');
        const message = (() => {
          if (bodyText && /<html|<!doctype html/i.test(bodyText)) {
            return settings.t('服务端返回了 HTML 错误页，流式请求没有正常完成。');
          }
          if (bodyText && bodyText.trim()) {
            return bodyText.trim().slice(0, 300);
          }
          if (!response.ok) {
            return settings.t('请求失败：HTTP {status}', { status: response.status });
          }
          return settings.t('流式请求失败，请稍后重试。');
        })();
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalMessageId = '';
      let fullText = '';
      let committedText = '';
      let tailText = '';
      let gotDonePacket = false;
      let gotRenderableContent = false;
      let donePacket = null;
      let packetError = null;

      const handlePacket = (packet) => {
        if (!packet) return;
        if (packet.type === 'ping') {
          return;
        }
        if (packet.type === 'delta') {
          fullText = String(packet.full || '');
          gotRenderableContent = gotRenderableContent || Boolean(fullText);
          const preview = settings.splitStreamingSegments(fullText);
          committedText = preview.committed;
          tailText = preview.tail;
          if (request.streamBubble) {
            settings.scheduleStreamingRender(request.streamBubble, fullText, committedText, tailText);
          }
          return;
        }
        if (packet.type === 'line') {
          fullText = String(packet.full || fullText || '');
          committedText = String(packet.committed || '');
          tailText = String(packet.tail || '');
          gotRenderableContent = gotRenderableContent || Boolean(fullText || committedText || tailText);
          if (request.streamBubble) {
            settings.scheduleStreamingRender(request.streamBubble, fullText, committedText, tailText);
          }
          return;
        }
        if (packet.type === 'user-message') {
          if (request.streamBubble && packet.html) {
            settings.replacePreviousLiveUserBubble(request.streamBubble, packet.html);
          }
          return;
        }
        if (packet.type === 'done') {
          gotDonePacket = true;
          donePacket = packet;
          fullText = String(packet.full || fullText || '');
          finalMessageId = String(packet.messageId || packet.leafId || packet.replyMessageId || '');
          if (request.streamBubble) {
            if (packet.parentMessageId && ['message', 'regenerate', 'replay'].includes(String(packet.mode || ''))) {
              settings.removeStaleLinearTail(packet.parentMessageId);
            }
            if (packet.parentHtml) {
              settings.replacePreviousLiveUserBubble(request.streamBubble, packet.parentHtml);
              const parentId = String(packet.parentMessageId || '').trim();
              if (parentId && settings.chatContainer) {
                const currentParent = Array.from(settings.chatContainer.querySelectorAll('article.bubble[data-message-id]'))
                  .find((article) => String(article.dataset.messageId || '') === parentId);
                if (currentParent && !currentParent.classList.contains('bubble-live')) {
                  const fragment = settings.createFragmentFromHtml(packet.parentHtml);
                  const nextArticle = fragment.querySelector('article.bubble');
                  if (nextArticle) {
                    currentParent.replaceWith(nextArticle);
                    settings.hydrateRichContent(nextArticle);
                  }
                }
              }
            }
            if (packet.html) {
              const renderedArticle = settings.replaceBubbleWithHtml(request.streamBubble, packet.html);
              if (renderedArticle && finalMessageId) {
                renderedArticle.dataset.messageId = finalMessageId;
              }
            } else {
              settings.setBubbleFinalState(request.streamBubble, fullText, {
                mode: String(packet.mode || 'message'),
                messageId: finalMessageId,
                kindText: packet.mode === 'optimize-input' ? settings.t('润色结果') : '',
              });
            }
          }
          return;
        }
        if (packet.type === 'error') {
          const message = String(settings.t(packet.message || 'AI 回复失败，请稍后重试。'));
          if (request.streamBubble) {
            settings.setBubbleFinalState(request.streamBubble, message, {
              mode: 'error',
              messageId: '',
              kindText: settings.t('执行失败'),
              error: true,
            });
          }
          if (window.LougeNotifications && typeof window.LougeNotifications.showSupport === 'function') {
            window.LougeNotifications.showSupport({ reason: 'chat-error' });
          }
          throw new Error(message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handlePacket(JSON.parse(trimmed));
          } catch (error) {
            packetError = error instanceof Error ? error : new Error(String(error || 'stream packet error'));
            break;
          }
        }
        if (packetError) {
          throw packetError;
        }
      }

      if (buffer.trim()) {
        handlePacket(JSON.parse(buffer.trim()));
      }

      if (!gotDonePacket && request.streamBubble) {
        if (gotRenderableContent && fullText) {
          settings.setBubbleFinalState(request.streamBubble, fullText, {
            mode: 'partial',
            messageId: '',
            kindText: settings.t('连接中断'),
            error: true,
            plainText: true,
          });
          const note = request.streamBubble.article.querySelector('.bubble-live-note');
          if (note) note.textContent = settings.t('连接中断，已保留已生成内容');
        } else {
          throw new Error(settings.t('流式连接中断，未收到完整结束信号。'));
        }
      }

      return {
        finalMessageId,
        fullText,
        packet: donePacket,
      };
    }

    return { consumeNdjsonStream };
  }

  window.LougeChatStreamClient = { create: createStreamClient };
}());
