/**
 * @file public/js/chat-page.js
 * @description 线性聊天页脚本。
 * 实现：流式消息发送、历史加载、重写/重新生成反馈、富文本渲染与草稿恢复。
 * DEBUG：若流式发送异常，优先检查 #chat-compose-form 的 data-* 参数和 window.renderRichContent 是否可用。
 */

  (function () {
    const t = window.AI_ROLEPLAY_I18N?.t || ((key, vars) => key);
    const form = document.getElementById('chat-compose-form');
    const textarea = document.getElementById('content');
    if (!form || !textarea) return;

    const streamEndpoint = form.dataset.streamEndpoint || form.action;
    const optimizeStreamEndpoint = form.dataset.optimizeStreamEndpoint || '';
    const conversationId = form.dataset.conversationId || '';
    const chatContainer = document.querySelector('.chat-transcript');
    let isSubmitting = false;
    let streamingRenderScheduled = false;
    let streamingRenderFrame = null;
    let activeAbortController = null;
    let autoFollowStreaming = true;

    function isNearPageBottom(threshold) {
      const margin = Number(threshold || 180);
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const viewportBottom = scrollTop + window.innerHeight;
      const pageHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
      return pageHeight - viewportBottom <= margin;
    }

    function beginStreamingAutoFollow() {
      autoFollowStreaming = isNearPageBottom(260);
    }

    function releaseStreamingAutoFollow() {
      if (isSubmitting) {
        autoFollowStreaming = false;
      }
    }

    function maybeFollowStreamingBubble(streamBubble, behavior) {
      if (!autoFollowStreaming || !streamBubble || !streamBubble.article) {
        return;
      }
      streamBubble.article.scrollIntoView({ block: 'end', behavior: behavior || 'smooth' });
    }

    window.addEventListener('wheel', releaseStreamingAutoFollow, { passive: true });
    window.addEventListener('touchmove', releaseStreamingAutoFollow, { passive: true });
    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'PageUp', 'Home', 'Space'].includes(event.key)) {
        releaseStreamingAutoFollow();
      }
    });

    function closeMessageMenus(scope) {
      const root = scope || document;
      root.querySelectorAll('.message-menu[open], .more-menu[open], .message-menu-details[open]').forEach((menu) => {
        menu.removeAttribute('open');
      });
    }

    function closeSiblingMessageMenus(currentMenu) {
      document.querySelectorAll('.message-menu[open], .more-menu[open]').forEach((menu) => {
        if (menu !== currentMenu && !menu.contains(currentMenu)) {
          menu.removeAttribute('open');
        }
      });
    }

    function showToast(message) {
      const text = String(message || '').trim();
      if (!text) return;
      const toast = document.createElement('div');
      toast.className = 'chat-toast';
      toast.textContent = text;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      window.setTimeout(() => {
        toast.classList.remove('show');
        window.setTimeout(() => toast.remove(), 260);
      }, 2600);
    }

    function reloadToMessage(messageId, notice) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('leaf', normalizedMessageId);
      if (notice) {
        nextUrl.searchParams.set('notice', notice);
      }
      window.setTimeout(() => {
        window.location.assign(nextUrl.toString());
      }, 450);
    }

    function updateHiddenParentInputs(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      document.querySelectorAll('input[name="parentMessageId"]').forEach((input) => {
        input.value = normalizedMessageId;
      });
    }

    function updateCurrentMessageState(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      updateHiddenParentInputs(normalizedMessageId);
      form.dataset.messageCount = String(Math.max(Number(form.dataset.messageCount || '0'), 1));
      if (chatContainer) {
        const currentCount = Number(chatContainer.dataset.visibleCount || '0') || chatContainer.querySelectorAll('article.bubble[data-message-id]').length;
        const totalCount = Number(chatContainer.dataset.totalCount || '0') || currentCount;
        chatContainer.dataset.visibleCount = String(Math.max(currentCount, chatContainer.querySelectorAll('article.bubble[data-message-id]').length));
        chatContainer.dataset.totalCount = String(Math.max(totalCount, chatContainer.querySelectorAll('article.bubble[data-message-id]').length));
        chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      }
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('leaf', normalizedMessageId);
      window.history.replaceState({}, '', nextUrl.toString());
    }

    function ensureStartMessage() {
      const currentMessageCount = Number(form.dataset.messageCount || '0');
      if (currentMessageCount === 0 && !textarea.value.trim()) {
        textarea.value = t('[开始一次新的对话]');
      }
    }

    function removeStaleLinearTail(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId || !chatContainer) return;
      const articles = Array.from(chatContainer.querySelectorAll('article.bubble[data-message-id]'));
      const index = articles.findIndex((article) => String(article.dataset.messageId || '') === normalizedMessageId);
      if (index < 0) return;
      articles.slice(index + 1).forEach((article) => article.remove());
      chatContainer.dataset.visibleCount = String(chatContainer.querySelectorAll('article.bubble[data-message-id]').length);
      chatContainer.dataset.totalCount = String(Math.max(Number(chatContainer.dataset.totalCount || '0'), Number(chatContainer.dataset.visibleCount || '0')));
      updateHiddenParentInputs(normalizedMessageId);
    }

    function removeLivePair(streamBubble) {
      if (!streamBubble || !streamBubble.article || !streamBubble.article.parentNode) {
        return;
      }
      const previous = streamBubble.article.previousElementSibling;
      if (previous && previous.classList && previous.classList.contains('bubble-live')) {
        previous.remove();
      }
      streamBubble.article.remove();
    }

    function createBubble(roleLabel, kindLabel, senderClass, content, options) {
      const article = document.createElement('article');
      article.className = `bubble bubble-${senderClass}`;
      if (options && options.isStreaming) {
        article.dataset.streaming = 'true';
      }
      if (options && options.isPending) {
        article.classList.add('bubble-pending');
      }

      const header = document.createElement('div');
      header.className = 'bubble-header';

      const role = document.createElement('span');
      role.className = 'bubble-role';
      role.textContent = roleLabel;

      const status = document.createElement('span');
      status.className = 'bubble-status';
      status.textContent = kindLabel || '';

      header.appendChild(role);
      header.appendChild(status);

      const rich = document.createElement('div');
      rich.className = 'bubble-rich';
      rich.setAttribute('data-message-content', '');
      rich.innerHTML = '<div class="bubble-text"></div>';
      rich.querySelector('.bubble-text').textContent = content || '';

      const tools = document.createElement('div');
      tools.className = 'message-tools';
      tools.innerHTML = `<div class="bubble-actions bubble-actions--stacked bubble-actions--live"><span class="bubble-ghost-dot"></span><span class="mini-note bubble-live-note">${t('等待生成中…')}</span></div>`;

      article.appendChild(header);
      article.appendChild(rich);
      article.appendChild(tools);
      return { article, rich, tools };
    }

    function appendStreamingPair(userContent, options) {
      if (!chatContainer) return null;
      const mode = Object.assign({ userLabel: t('你'), userKind: '', aiLabel: 'AI', aiKind: t('生成中…'), userSenderClass: 'user', aiSenderClass: 'character' }, options || {});
      const userBubble = createBubble(mode.userLabel, mode.userKind, mode.userSenderClass, userContent, {
        isPending: true,
        timeLabel: t('刚刚'),
      });
      const aiBubble = createBubble(mode.aiLabel, mode.aiKind, mode.aiSenderClass, '', {
        isStreaming: true,
        isPending: true,
        timeLabel: t('生成中…'),
      });

      userBubble.article.classList.add('bubble-live');
      aiBubble.article.classList.add('bubble-live');

      beginStreamingAutoFollow();
      chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      chatContainer.appendChild(userBubble.article);
      chatContainer.appendChild(aiBubble.article);
      maybeFollowStreamingBubble(aiBubble, 'smooth');
      return { userBubble, aiBubble };
    }

    function appendSingleStreamingBubble(roleLabel, kindLabel, senderClass, options) {
      if (!chatContainer) return null;
      const bubble = createBubble(roleLabel, kindLabel, senderClass, '', {
        isStreaming: true,
        isPending: true,
        timeLabel: t('生成中…'),
      });
      bubble.article.classList.add('bubble-live');
      if (options && options.noteText) {
        const note = bubble.article.querySelector('.bubble-live-note');
        if (note) {
          note.textContent = options.noteText;
        }
      }
      beginStreamingAutoFollow();
      chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      chatContainer.appendChild(bubble.article);
      maybeFollowStreamingBubble(bubble, 'smooth');
      return bubble;
    }

    function renderStreamingPlainText(container, text) {
      if (!container) return;
      const block = document.createElement('div');
      block.className = 'bubble-text';
      block.textContent = String(text || '');
      container.replaceChildren(block);
      container.dataset.lineMode = 'false';
      container.dataset.finalPass = 'false';
    }

    function createFragmentFromHtml(html) {
      const template = document.createElement('template');
      template.innerHTML = String(html || '').trim();
      return template.content;
    }

    function hydrateRichContent(root) {
      if (typeof window.renderRichContent !== 'function') {
        return;
      }
      (root || document).querySelectorAll('[data-message-content]').forEach((node) => window.renderRichContent(node));
    }

    function replaceBubbleWithHtml(streamBubble, html) {
      if (!streamBubble || !streamBubble.article || !streamBubble.article.parentNode || !html) {
        return null;
      }
      const fragment = createFragmentFromHtml(html);
      const nextArticle = fragment.querySelector('article.bubble');
      if (!nextArticle) {
        return null;
      }
      streamBubble.article.replaceWith(nextArticle);
      hydrateRichContent(nextArticle);
      return nextArticle;
    }

    function replacePreviousLiveUserBubble(streamBubble, html) {
      if (!streamBubble || !streamBubble.article || !html) {
        return null;
      }
      const previous = streamBubble.article.previousElementSibling;
      if (!previous || !previous.classList || !previous.classList.contains('bubble-live')) {
        return null;
      }
      const fragment = createFragmentFromHtml(html);
      const nextArticle = fragment.querySelector('article.bubble');
      if (!nextArticle) {
        return null;
      }
      previous.replaceWith(nextArticle);
      hydrateRichContent(nextArticle);
      return nextArticle;
    }

    function scheduleStreamingRender(streamBubble, fullText, committedText, tailText) {
      if (!streamBubble) return;
      if (streamingRenderFrame) {
        cancelAnimationFrame(streamingRenderFrame);
      }
      streamingRenderScheduled = true;
      streamingRenderFrame = requestAnimationFrame(() => {
        streamingRenderScheduled = false;
        streamingRenderFrame = null;
        if (typeof window.renderRichContent === 'function') {
          window.renderRichContent(streamBubble.rich, fullText, {
            streaming: true,
            finalPass: false,
            lineMode: true,
            committed: committedText,
            tail: tailText,
            hideFolds: true,
          });
        } else {
          renderStreamingPlainText(streamBubble.rich, fullText);
        }
        maybeFollowStreamingBubble(streamBubble, 'auto');
        const note = streamBubble.article.querySelector('.bubble-live-note');
        if (note) note.textContent = String(fullText || '').trim() ? t('AI 正在输出…') : t('AI 正在思考…');
      });
    }

    function splitStreamingSegments(raw) {
      const source = String(raw || '');
      const parts = source.split(/\r?\n/);
      if (parts.length <= 1) {
        return { committed: '', tail: source };
      }
      return {
        committed: parts.slice(0, -1).join('\n'),
        tail: parts[parts.length - 1],
      };
    }

    function setBubbleFinalState(streamBubble, fullText, options) {
      if (!streamBubble) return;
      if (streamingRenderFrame) {
        cancelAnimationFrame(streamingRenderFrame);
        streamingRenderFrame = null;
      }
      streamingRenderScheduled = false;
      const state = Object.assign({ mode: 'message', messageId: '', kindText: '', error: false, plainText: false }, options || {});
      streamBubble.article.dataset.streaming = 'false';
      streamBubble.article.classList.remove('bubble-pending');
      if (state.error) {
        streamBubble.article.classList.add('bubble-system');
      }
      const status = streamBubble.article.querySelector('.bubble-status');
      if (status) {
        status.textContent = state.error ? t('执行失败') : '';
      }
      const tools = streamBubble.article.querySelector('.bubble-actions--live');
      if (tools) {
        tools.remove();
      }
      if (state.plainText) {
        renderStreamingPlainText(streamBubble.rich, fullText);
        return;
      }
      window.renderRichContent(streamBubble.rich, fullText, { streaming: false, finalPass: true, lineMode: false });
    }

    async function consumeNdjsonStream(options) {
      const settings = Object.assign({
        endpoint: '',
        payload: null,
        submitButton: null,
        previousButtonText: '',
        textareaNode: null,
        streamBubble: null,
        abortController: null,
        onDone: null,
        onError: null,
      }, options || {});

      const response = await fetch(settings.endpoint, {
        method: 'POST',
        body: new URLSearchParams(settings.payload),
        signal: settings.abortController ? settings.abortController.signal : undefined,
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
            return t('服务端返回了 HTML 错误页，流式请求没有正常完成。');
          }
          if (bodyText && bodyText.trim()) {
            return bodyText.trim().slice(0, 300);
          }
          if (!response.ok) {
            return t('请求失败：HTTP {status}', { status: response.status });
          }
          return t('流式请求失败，请稍后重试。');
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

      const handlePacket = (packet) => {
        if (!packet) return;
        if (packet.type === 'ping') {
          return;
        }
        if (packet.type === 'delta') {
          fullText = String(packet.full || '');
          gotRenderableContent = gotRenderableContent || Boolean(fullText);
          const preview = splitStreamingSegments(fullText);
          committedText = preview.committed;
          tailText = preview.tail;
          if (settings.streamBubble) {
            scheduleStreamingRender(settings.streamBubble, fullText, committedText, tailText);
          }
          return;
        }
        if (packet.type === 'line') {
          fullText = String(packet.full || fullText || '');
          committedText = String(packet.committed || '');
          tailText = String(packet.tail || '');
          gotRenderableContent = gotRenderableContent || Boolean(fullText || committedText || tailText);
          if (settings.streamBubble) {
            scheduleStreamingRender(settings.streamBubble, fullText, committedText, tailText);
          }
          return;
        }
        if (packet.type === 'user-message') {
          if (settings.streamBubble && packet.html) {
            replacePreviousLiveUserBubble(settings.streamBubble, packet.html);
          }
          return;
        }
        if (packet.type === 'done') {
          gotDonePacket = true;
          donePacket = packet;
          fullText = String(packet.full || fullText || '');
          finalMessageId = String(packet.messageId || packet.leafId || packet.replyMessageId || '');
          if (settings.streamBubble) {
            if (packet.parentMessageId && ['message', 'regenerate', 'replay'].includes(String(packet.mode || ''))) {
              removeStaleLinearTail(packet.parentMessageId);
            }
            if (packet.parentHtml) {
              replacePreviousLiveUserBubble(settings.streamBubble, packet.parentHtml);
              const parentId = String(packet.parentMessageId || '').trim();
              if (parentId && chatContainer) {
                const currentParent = Array.from(chatContainer.querySelectorAll('article.bubble[data-message-id]'))
                  .find((article) => String(article.dataset.messageId || '') === parentId);
                if (currentParent && !currentParent.classList.contains('bubble-live')) {
                  const fragment = createFragmentFromHtml(packet.parentHtml);
                  const nextArticle = fragment.querySelector('article.bubble');
                  if (nextArticle) {
                    currentParent.replaceWith(nextArticle);
                    hydrateRichContent(nextArticle);
                  }
                }
              }
            }
            if (packet.html) {
              const renderedArticle = replaceBubbleWithHtml(settings.streamBubble, packet.html);
              if (renderedArticle && finalMessageId) {
                renderedArticle.dataset.messageId = finalMessageId;
              }
            } else {
              setBubbleFinalState(settings.streamBubble, fullText, {
                mode: String(packet.mode || 'message'),
                messageId: finalMessageId,
                kindText: packet.mode === 'optimize-input' ? t('润色结果') : '',
              });
            }
          }
          return;
        }
        if (packet.type === 'error') {
          const message = String(t(packet.message || 'AI 回复失败，请稍后重试。'));
          if (settings.streamBubble) {
            setBubbleFinalState(settings.streamBubble, message, {
              mode: 'error',
              messageId: '',
              kindText: t('执行失败'),
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
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            handlePacket(JSON.parse(trimmed));
          } catch (error) {
            if (error instanceof Error) {
              throw error;
            }
          }
        });
      }

      if (buffer.trim()) {
        handlePacket(JSON.parse(buffer.trim()));
      }

      if (!gotDonePacket && settings.streamBubble) {
        if (gotRenderableContent && fullText) {
          setBubbleFinalState(settings.streamBubble, fullText, {
            mode: 'partial',
            messageId: '',
            kindText: t('连接中断'),
            error: true,
            plainText: true,
          });
          const note = settings.streamBubble.article.querySelector('.bubble-live-note');
          if (note) note.textContent = t('连接中断，已保留已生成内容');
        } else {
          throw new Error(t('流式连接中断，未收到完整结束信号。'));
        }
      }

      return {
        finalMessageId,
        fullText,
        packet: donePacket,
      };
    }

    async function handleMainComposeSubmit(event) {
      ensureStartMessage();
      if (isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
        return;
      }

      event.preventDefault();
      isSubmitting = true;
      const submitButton = form.querySelector('button[type="submit"]');
      const previousButtonText = submitButton ? submitButton.textContent : '';
      const payload = new FormData(form);
      const draftContent = String(payload.get('content') || '').trim();
      const streamPair = appendStreamingPair(draftContent, {
        userLabel: t('你'),
        userKind: '',
        aiLabel: 'AI',
        aiKind: t('生成中…'),
      });
      const streamBubble = streamPair ? streamPair.aiBubble : null;
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null;
      activeAbortController = abortController;
      if (!draftContent) {
        isSubmitting = false;
        removeLivePair(streamBubble);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || t('发送消息');
        }
        textarea.disabled = false;
        textarea.focus();
        activeAbortController = null;
        return;
      }
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = t('发送中…');
      }
      textarea.disabled = true;

      const handlePageAbort = () => {
        if (abortController && !abortController.signal.aborted) {
          abortController.abort();
        }
      };
      window.addEventListener('beforeunload', handlePageAbort, { once: true });

      try {
        const result = await consumeNdjsonStream({
          endpoint: streamEndpoint,
          payload,
          submitButton,
          previousButtonText,
          textareaNode: textarea,
          streamBubble,
          abortController,
        });

        if (result.finalMessageId) {
          updateCurrentMessageState(result.finalMessageId);
        }

        textarea.value = '';
      } catch (error) {
        console.error(error);
        const isAbortError = error && (error.name === 'AbortError' || /aborted/i.test(String(error.message || '')));
        const fallbackMessage = isAbortError
          ? t('生成中断，已保留这段回复。')
          : (error && error.message ? String(t(error.message)) : t('AI 回复失败，请稍后重试。'));
        if (!isAbortError && window.LougeNotifications && typeof window.LougeNotifications.showSupport === 'function') {
          window.LougeNotifications.showSupport({ reason: 'chat-exception' });
        }
        if (streamBubble && streamBubble.rich) {
          setBubbleFinalState(streamBubble, fallbackMessage, {
            mode: 'error',
            kindText: t('执行失败'),
            error: true,
          });
        } else {
          alert(fallbackMessage);
        }
        return;
      } finally {
        isSubmitting = false;
        textarea.disabled = false;
        window.removeEventListener('beforeunload', handlePageAbort);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || t('发送消息');
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    }

    form.addEventListener('submit', handleMainComposeSubmit);

    textarea.addEventListener('keydown', (event) => {
      if (event.isComposing || event.key !== 'Enter' || event.shiftKey) {
        return;
      }
      event.preventDefault();
      if (!isSubmitting && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else if (!isSubmitting) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const optimizeForm = document.getElementById('chat-optimize-form');
    if (optimizeForm && optimizeStreamEndpoint) {
      optimizeForm.addEventListener('submit', async (event) => {
        if (isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
          return;
        }
        event.preventDefault();
        isSubmitting = true;

        const submitButton = optimizeForm.querySelector('button[type="submit"]');
        const previousButtonText = submitButton ? submitButton.textContent : '';
        const payload = new FormData(optimizeForm);
        const draftContent = String(payload.get('content') || '').trim();
        const streamBubble = appendSingleStreamingBubble(t('系统'), t('优化输入中…'), 'system', { noteText: t('正在润色你的输入…') });
        const abortController = (typeof AbortController === 'function') ? new AbortController() : null;

        if (!draftContent) {
          isSubmitting = false;
          if (streamBubble && streamBubble.article) {
            streamBubble.article.remove();
          }
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = previousButtonText || t('润色输入');
          }
          showToast(t('请先输入要润色的内容。'));
          return;
        }

        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = t('优化中…');
        }

        try {
          const result = await consumeNdjsonStream({
            endpoint: optimizeStreamEndpoint,
            payload,
            submitButton,
            previousButtonText,
            streamBubble,
            abortController,
          });

          const optimizedContent = String(result.packet && result.packet.optimizedContent || result.fullText || '').trim();
          if (optimizedContent) {
            if (streamBubble && streamBubble.article) {
              streamBubble.article.remove();
            }
            showToast(t('已润色并放回输入框。'));
            const targetTextarea = document.getElementById('optimizeContent');
            if (targetTextarea) {
              targetTextarea.value = optimizedContent;
            }
            textarea.value = optimizedContent;
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          }
        } catch (error) {
          console.error(error);
          const fallbackMessage = error && error.message ? String(t(error.message)) : t('输入优化失败，请稍后重试。');
          if (streamBubble) {
            setBubbleFinalState(streamBubble, fallbackMessage, {
              mode: 'error',
              kindText: t('优化失败'),
              error: true,
            });
          } else {
            alert(fallbackMessage);
          }
        } finally {
          isSubmitting = false;
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = previousButtonText || t('优化输入');
          }
        }
      });
    }

    document.addEventListener('submit', async (event) => {
      const actionForm = event.target;
      if (!(actionForm instanceof HTMLFormElement)) {
        return;
      }
      if (!actionForm.matches('form[data-stream-endpoint]')) {
        return;
      }
      if (actionForm.id === 'chat-compose-form' || actionForm.id === 'chat-optimize-form') {
        return;
      }
      if (isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
        return;
      }

      event.preventDefault();
      isSubmitting = true;
      const submitButton = actionForm.querySelector('button[type="submit"]');
      const previousButtonText = submitButton ? submitButton.textContent : '';
      const endpoint = String(actionForm.dataset.streamEndpoint || '').trim();
      const mode = String(actionForm.dataset.streamMode || '').trim();
      const roleLabel = String(actionForm.dataset.streamRoleLabel || 'AI').trim() || 'AI';
      const kindLabel = String(actionForm.dataset.streamKindLabel || t('生成中…')).trim() || t('生成中…');
      const senderClass = String(actionForm.dataset.streamSenderClass || 'character').trim() || 'character';
      const previewContent = String(actionForm.dataset.streamPreviewContent || '').trim();
      const payload = new FormData(actionForm);
      closeMessageMenus();
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null;

      let streamBubble = null;
      if (mode === 'replay') {
        const pair = appendStreamingPair(previewContent, {
          userLabel: t('你'),
          userKind: '',
          aiLabel: roleLabel,
          aiKind: kindLabel,
          userSenderClass: 'user',
          aiSenderClass: senderClass,
        });
        streamBubble = pair ? pair.aiBubble : null;
      } else {
        streamBubble = appendSingleStreamingBubble(roleLabel, kindLabel, senderClass, { noteText: t('等待模型返回…') });
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = mode === 'replay' ? t('重写中…') : t('生成中…');
      }

      try {
        const result = await consumeNdjsonStream({
          endpoint,
          payload,
          submitButton,
          previousButtonText,
          streamBubble,
          abortController,
        });

        if (result.finalMessageId) {
          updateCurrentMessageState(result.finalMessageId);
          if (mode === 'replay') {
            showToast(t('已生成新的结果，旧内容已保留。'));
            reloadToMessage(result.finalMessageId, 'updated');
          } else if (mode === 'regenerate') {
            showToast(t('已显示新的结果。'));
          }
        }
      } catch (error) {
        console.error(error);
        const fallbackMessage = error && error.message ? String(t(error.message)) : t('操作失败，请稍后重试。');
        if (window.LougeNotifications && typeof window.LougeNotifications.showSupport === 'function') {
          window.LougeNotifications.showSupport({ reason: 'chat-action-exception' });
        }
        if (streamBubble) {
          setBubbleFinalState(streamBubble, fallbackMessage, {
            mode: 'error',
            kindText: t('执行失败'),
            error: true,
          });
        } else {
          alert(fallbackMessage);
        }
      } finally {
        isSubmitting = false;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || submitButton.textContent;
        }
      }
    });


    async function loadOlderMessages(button) {
      if (!button || button.disabled || !chatContainer) return;
      const beforeId = String(button.dataset.beforeId || chatContainer.dataset.oldestVisibleId || '').trim();
      if (!beforeId) return;
      const previousText = button.textContent;
      const anchor = chatContainer.firstElementChild;
      const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
      button.disabled = true;
      button.textContent = t('加载中…');
      try {
        const url = new URL(button.dataset.endpoint || `/chat/${conversationId}/messages/history`, window.location.origin);
        url.searchParams.set('beforeId', beforeId);
        url.searchParams.set('limit', '10');
        const currentMessage = new URLSearchParams(window.location.search).get('leaf');
        if (currentMessage) {
          url.searchParams.set('leaf', currentMessage);
        }
        const response = await fetch(url.toString(), {
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'fetch',
          },
        });
        if (!response.ok) {
          throw new Error(t('历史消息加载失败。'));
        }
        const payload = await response.json();
        if (payload.html) {
          const fragment = createFragmentFromHtml(payload.html);
          const nodes = Array.from(fragment.children);
          nodes.forEach((node) => {
            if (anchor && anchor.parentNode === chatContainer) {
              chatContainer.insertBefore(node, anchor);
            } else {
              chatContainer.prepend(node);
            }
          });
          hydrateRichContent(chatContainer);
          if (anchor) {
            const nextTop = anchor.getBoundingClientRect().top;
            window.scrollBy({ top: nextTop - anchorTop, behavior: 'instant' });
          }
        }
        if (payload.nextBeforeId) {
          button.dataset.beforeId = String(payload.nextBeforeId);
          chatContainer.dataset.oldestVisibleId = String(payload.nextBeforeId);
        }
        if (!payload.hasMore || !payload.count) {
          const loader = button.closest('[data-history-loader]');
          if (loader) loader.remove();
        } else {
          button.disabled = false;
          button.textContent = previousText || t('查看更早的消息');
        }
      } catch (error) {
        console.error(error);
        button.disabled = false;
        button.textContent = previousText || t('查看更早的消息');
        alert(error && error.message ? error.message : t('历史消息加载失败。'));
      }
    }

    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('[data-load-older-messages]') : null;
      if (!button) return;
      event.preventDefault();
      loadOlderMessages(button);
    });


    document.addEventListener('click', (event) => {
      const target = event.target;
      const menu = target && target.closest ? target.closest('.message-menu, .more-menu') : null;
      if (menu) {
        window.setTimeout(() => {
          if (menu.open) {
            closeSiblingMessageMenus(menu);
          }
        }, 0);
        return;
      }
      closeMessageMenus();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMessageMenus();
      }
    });

    window.addEventListener('load', () => {
      const target = document.querySelector('.chat-transcript article:last-child');
      if (target) {
        target.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    });

    const params = new URLSearchParams(window.location.search);
    const notice = params.get('notice');
    if (notice === 'updated') {
      showToast(t('已显示新的结果，旧内容已保留。'));
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('notice');
      window.history.replaceState({}, '', nextUrl.toString());
    }
    const draft = params.get('draft');
    if (draft && !textarea.value.trim()) {
      textarea.value = draft;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  })();

  (function () {
    const t = window.AI_ROLEPLAY_I18N?.t || ((key, vars) => {
      let text = String(key || '');
      if (vars && typeof vars === 'object') {
        Object.entries(vars).forEach(([name, value]) => {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        });
      }
      return text;
    });
    const THINK_BLOCK_RE = /<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    const GENERIC_FOLD_TAG_RE = /<([a-z][\w:-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    const SCRIPTISH_TAG_RE = /<\s*\/?\s*(script|iframe|object|embed|meta|link|base|form)\b[^>]*>/gi;
    const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;
    const QUOTE_RE = /(“[^”<>\n]{0,280}”|‘[^’<>\n]{0,280}’|「[^」<>\n]{0,280}」|&quot;[^<>\n]{0,280}&quot;|&#39;[^<>\n]{0,280}&#39;|"[^"<>\n]{0,280}"|'[^'<>\n]{0,280}')/g;
    const ALLOWED_TAGS = new Set(['p', 'br', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'details', 'summary', 'style', 'a', 'img']);
    let scopeSeed = 0;

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function buildFold(title, body, openByDefault) {
      const details = document.createElement('details');
      details.className = 'bubble-fold';
      if (openByDefault) {
        details.open = true;
      }

      const summary = document.createElement('summary');
      summary.textContent = title;

      const content = document.createElement('div');
      content.className = 'bubble-fold-body';
      content.textContent = body;

      details.appendChild(summary);
      details.appendChild(content);
      return details;
    }

    function collectFoldBlocks(raw, options) {
      const mode = Object.assign({ hideFolds: false }, options || {});
      const folds = [];
      let foldIndex = 0;
      let text = String(raw || '');

      text = text.replace(THINK_BLOCK_RE, (_, _tagName, inner) => {
        const body = String(inner || '').trim();
        if (mode.hideFolds || !body) {
          return '';
        }
        const key = `__FOLD_BLOCK_${foldIndex++}__`;
        folds.push({ key, title: t('思考内容'), body, open: false, kind: 'think' });
        return key;
      });

      text = text.replace(GENERIC_FOLD_TAG_RE, (full, tagName, inner) => {
        const normalizedTag = String(tagName || '').toLowerCase();
        if (['p', 'br', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'details', 'summary', 'style', 'a', 'img', 'think', 'thinking'].includes(normalizedTag)) {
          return full;
        }
        const plainInner = String(inner || '').replace(/<[^>]+>/g, '').trim();
        if (!plainInner) {
          return full;
        }
        if (mode.hideFolds) {
          return '';
        }
        const key = `__FOLD_BLOCK_${foldIndex++}__`;
        folds.push({ key, title: t('标签内容：<{tag}>', { tag: normalizedTag }), body: plainInner, open: false, kind: normalizedTag });
        return key;
      });

      return { text: text.replace(/\n{3,}/g, '\n\n').trim(), folds };
    }

    function sanitizeCss(cssText, scopeSelector) {
      const cleaned = String(cssText || '')
        .replace(/@import[\s\S]*?;/gi, '')
        .replace(/@charset[\s\S]*?;/gi, '')
        .replace(/@namespace[\s\S]*?;/gi, '')
        .replace(/expression\s*\([^)]*\)/gi, '')
        .replace(/behavior\s*:[^;}{]+[;}]?/gi, '')
        .replace(/-moz-binding\s*:[^;}{]+[;}]?/gi, '')
        .replace(/url\s*\(\s*(['"]?)\s*(javascript:|data:text\/html|data:application\/javascript)[^)]+\)/gi, 'url(#)');

      return cleaned.replace(/(^|})\s*([^@}{][^{]*){/g, (full, prefix, selectorGroup) => {
        const scopedSelectors = selectorGroup
          .split(',')
          .map((selector) => selector.trim())
          .filter(Boolean)
          .map((selector) => {
            if (/^(html|body|:root)$/i.test(selector)) {
              return scopeSelector;
            }
            return `${scopeSelector} ${selector}`;
          })
          .join(', ');
        return `${prefix} ${scopedSelectors} {`;
      });
    }

    function highlightQuotesInHtml(html) {
      return String(html || '').replace(QUOTE_RE, (full) => `<span class="bubble-quote">${full}</span>`);
    }

    function normalizeMarkdownLines(text) {
      return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/^(\s*)&gt;\s?/gm, '$1> ')
        .replace(/^(\s*)([-*_])\2\2\s*$/gm, '$1---');
    }

    function applyInlineMarkdown(text) {
      return String(text || '')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*(?!\s)(.+?)(?!\s)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_(?!\s)(.+?)(?!\s)_/g, '$1<em>$2</em>')
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2">')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    function markdownToHtml(text) {
      const normalized = normalizeMarkdownLines(text);
      const escaped = escapeHtml(normalized);
      const fenced = [];
      let htmlSeed = escaped.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const key = `__CODE_BLOCK_${fenced.length}__`;
        fenced.push(`<pre><code class="lang-${escapeHtml(lang || 'plain')}">${code}</code></pre>`);
        return key;
      });

      const lines = htmlSeed.split('\n');
      const parts = [];
      let paragraphLines = [];

      const flushParagraph = () => {
        if (!paragraphLines.length) {
          return;
        }
        const content = paragraphLines.join('<br>');
        parts.push(`<p>${applyInlineMarkdown(content)}</p>`);
        paragraphLines = [];
      };

      const isBlank = (line) => !String(line || '').trim();
      const isFencePlaceholder = (line) => /^__CODE_BLOCK_\d+__$/.test(String(line || '').trim());
      const isHr = (line) => /^(?:---|\*\*\*|___)\s*$/.test(String(line || '').trim());
      const parseHeading = (line) => String(line || '').match(/^(#{1,6})\s+(.+)$/);
      const isBullet = (line) => /^[-*]\s+.+$/.test(String(line || '').trim());
      const isOrdered = (line) => /^\d+\.\s+.+$/.test(String(line || '').trim());
      const isQuoted = (line) => /^(?:>|&gt;)\s?.*$/.test(String(line || '').trim());
      const isQuoteMarkerOnly = (line) => /^(?:>|&gt;)\s*$/.test(String(line || '').trim());

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = String(line || '').trim();

        if (isBlank(line)) {
          flushParagraph();
          continue;
        }

        if (isFencePlaceholder(trimmed)) {
          flushParagraph();
          parts.push(trimmed);
          continue;
        }

        if (isHr(line)) {
          flushParagraph();
          parts.push('<hr>');
          continue;
        }

        const headingMatch = parseHeading(line);
        if (headingMatch) {
          flushParagraph();
          const level = headingMatch[1].length;
          parts.push(`<h${level}>${applyInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
          continue;
        }

        if (isQuoted(line)) {
          flushParagraph();
          const quoteLines = [];

          if (isQuoteMarkerOnly(line)) {
            i += 1;
            while (i < lines.length && !isBlank(lines[i])) {
              quoteLines.push(lines[i]);
              i += 1;
            }
            i -= 1;
          } else {
            while (i < lines.length && isQuoted(lines[i]) && !isQuoteMarkerOnly(lines[i])) {
              quoteLines.push(String(lines[i] || '').replace(/^(?:>|&gt;)\s?/, ''));
              i += 1;
            }
            i -= 1;
          }

          const quoteContent = quoteLines.join('<br>').trim();
          parts.push(`<blockquote>${applyInlineMarkdown(quoteContent)}</blockquote>`);
          continue;
        }

        if (isBullet(line)) {
          flushParagraph();
          const items = [];
          while (i < lines.length && isBullet(lines[i])) {
            items.push(String(lines[i] || '').trim().replace(/^[-*]\s+/, ''));
            i += 1;
          }
          i -= 1;
          parts.push(`<ul>${items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ul>`);
          continue;
        }

        if (isOrdered(line)) {
          flushParagraph();
          const items = [];
          while (i < lines.length && isOrdered(lines[i])) {
            items.push(String(lines[i] || '').trim().replace(/^\d+\.\s+/, ''));
            i += 1;
          }
          i -= 1;
          parts.push(`<ol>${items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ol>`);
          continue;
        }

        paragraphLines.push(trimmed);
      }

      flushParagraph();
      let html = parts.join('');

      fenced.forEach((snippet, index) => {
        html = html.replace(`__CODE_BLOCK_${index}__`, snippet);
      });

      return highlightQuotesInHtml(html);
    }

    function splitStreamingSegments(raw) {
      const source = String(raw || '');
      const parts = source.split(/\r?\n/);
      if (parts.length <= 1) {
        return { committed: '', tail: source };
      }
      return {
        committed: parts.slice(0, -1).join('\n'),
        tail: parts[parts.length - 1],
      };
    }

    function markdownToPartialHtml(text) {
      const normalized = normalizeMarkdownLines(text);
      const lines = normalized.split('\n');
      let inFence = false;
      lines.forEach((line) => {
        if (/^```/.test(String(line || '').trim())) {
          inFence = !inFence;
        }
      });
      const balanced = inFence ? `${normalized}\n\`\`\`` : normalized;
      return markdownToHtml(balanced);
    }

    function buildStreamingPreviewHtml(text) {
      const source = String(text || '').trim();
      if (!source) {
        return '';
      }
      return markdownToPartialHtml(source);
    }

    function sanitizeNodeTree(root, scopeSelector) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      const toProcess = [];
      while (walker.nextNode()) {
        toProcess.push(walker.currentNode);
      }

      toProcess.forEach((node) => {
        const tag = node.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          const fragment = document.createDocumentFragment();
          while (node.firstChild) {
            fragment.appendChild(node.firstChild);
          }
          node.replaceWith(fragment);
          return;
        }

        Array.from(node.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = String(attr.value || '');
          if (name.startsWith('on')) {
            node.removeAttribute(attr.name);
            return;
          }
          if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
            node.removeAttribute(attr.name);
            return;
          }
          if (name === 'style') {
            node.removeAttribute(attr.name);
            return;
          }
          if (tag !== 'a' && (name === 'target' || name === 'rel')) {
            node.removeAttribute(attr.name);
          }
        });

        if (tag === 'a') {
          const href = String(node.getAttribute('href') || '');
          if (!/^https?:\/\//i.test(href)) {
            node.removeAttribute('href');
          }
          node.setAttribute('rel', 'noopener noreferrer nofollow');
          node.setAttribute('target', '_blank');
        }

        if (tag === 'img') {
          const src = String(node.getAttribute('src') || '');
          if (!/^https?:\/\//i.test(src)) {
            node.removeAttribute('src');
          }
          node.removeAttribute('srcset');
          node.removeAttribute('sizes');
          node.setAttribute('loading', 'lazy');
          node.setAttribute('decoding', 'async');
          node.setAttribute('referrerpolicy', 'no-referrer');
        }

        if (tag === 'style') {
          node.textContent = sanitizeCss(node.textContent || '', scopeSelector);
        }
      });
    }

    function renderRichContent(container, input, options) {
      const textNode = container.querySelector('.bubble-text');
      const raw = input !== undefined ? String(input || '') : String((textNode && textNode.textContent) || '');
      const mode = Object.assign({ streaming: false, finalPass: true, lineMode: false, committed: '', tail: '', hideFolds: false }, options || {});
      const sourceText = mode.lineMode
        ? `${String(mode.committed || '')}${mode.committed && mode.tail ? '\n' : ''}${String(mode.tail || '')}`
        : raw;
      const { text, folds } = collectFoldBlocks(sourceText, { hideFolds: mode.hideFolds || mode.streaming });
      const safeHtmlSeed = text.replace(SCRIPTISH_TAG_RE, '');
      const scopeId = container.dataset.renderScope || `render-scope-${Date.now()}-${++scopeSeed}`;
      const scopeSelector = `[data-render-scope="${scopeId}"]`;

      let html = '';
      if (mode.streaming && mode.lineMode) {
        html = buildStreamingPreviewHtml(safeHtmlSeed);
      } else {
        html = markdownToHtml(safeHtmlSeed);
        if (HTML_TAG_RE.test(safeHtmlSeed)) {
          html = safeHtmlSeed;
        }
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstElementChild || doc.body;
      sanitizeNodeTree(root, scopeSelector);

      const wrapper = document.createElement('div');
      wrapper.className = 'bubble-rich';
      wrapper.setAttribute('data-render-scope', scopeId);

      while (root.firstChild) {
        wrapper.appendChild(root.firstChild);
      }

      if (!wrapper.childNodes.length) {
        const fallbackText = document.createElement('div');
        fallbackText.className = 'bubble-text';
        fallbackText.textContent = sourceText;
        wrapper.appendChild(fallbackText);
      }

      if (folds.length) {
        const foldsWrap = document.createElement('div');
        foldsWrap.className = 'bubble-folds';
        folds.forEach((fold) => {
          foldsWrap.appendChild(buildFold(fold.title, fold.body, fold.open));
        });
        wrapper.appendChild(foldsWrap);
      }

      container.replaceChildren(...wrapper.childNodes);
      container.dataset.renderScope = scopeId;
      container.dataset.lineMode = mode.lineMode ? 'true' : 'false';
      container.dataset.finalPass = mode.finalPass ? 'true' : 'false';
    }

    window.renderRichContent = renderRichContent;
    document.querySelectorAll('[data-message-content]').forEach((node) => renderRichContent(node));
  })();
