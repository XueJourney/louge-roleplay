/**
 * @file public/js/chat/controller.js
 * @description 聊天页交互控制：流式发送、历史加载、重写/重新生成反馈。
 */

(function () {
    const t = window.AI_ROLEPLAY_I18N?.t || ((key, vars) => key);
    const form = document.getElementById('chat-compose-form');
    const textarea = document.getElementById('content');
    if (!form || !textarea) return;

    const {
      isNearPageBottom,
      closeMessageMenus,
      closeSiblingMessageMenus,
      showToast,
      renderStreamingPlainText,
      createFragmentFromHtml,
      hydrateRichContent,
    } = window.LougeChatDomUtils || {};
    if (!window.LougeChatDomUtils) {
      console.warn('[chat] LougeChatDomUtils missing; controller skipped.');
      return;
    }

    const streamEndpoint = form.dataset.streamEndpoint || form.action;
    const optimizeStreamEndpoint = form.dataset.optimizeStreamEndpoint || '';
    const conversationId = form.dataset.conversationId || '';
    const chatContainer = document.querySelector('.chat-transcript');
    let isSubmitting = false;
    let streamingRenderScheduled = false;
    let streamingRenderFrame = null;
    let activeAbortController = null;
    let autoFollowStreaming = true;

    const bubbleToolkit = window.LougeChatBubbles && window.LougeChatBubbles.create({
      t,
      chatContainer,
      beginStreamingAutoFollow: () => beginStreamingAutoFollow(),
      maybeFollowStreamingBubble: (streamBubble, behavior) => maybeFollowStreamingBubble(streamBubble, behavior),
      createFragmentFromHtml,
      hydrateRichContent,
    });
    if (!bubbleToolkit) {
      console.warn('[chat] LougeChatBubbles missing; controller skipped.');
      return;
    }
    const {
      appendStreamingPair,
      appendSingleStreamingBubble,
      removeLivePair,
      replaceBubbleWithHtml,
      replacePreviousLiveUserBubble,
    } = bubbleToolkit;

    let streamClient = null;

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

    streamClient = window.LougeChatStreamClient && window.LougeChatStreamClient.create({
      t,
      splitStreamingSegments,
      scheduleStreamingRender,
      setBubbleFinalState,
      replacePreviousLiveUserBubble,
      replaceBubbleWithHtml,
      removeStaleLinearTail,
      createFragmentFromHtml,
      hydrateRichContent,
      chatContainer,
    });
    if (!streamClient) {
      console.warn('[chat] LougeChatStreamClient missing; controller skipped.');
      return;
    }
    const { consumeNdjsonStream } = streamClient;

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


