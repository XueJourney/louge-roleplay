/**
 * @file public/js/chat/compose-submit.js
 * @description 主聊天输入框流式提交与 Enter 快捷键绑定。
 */

(function () {
  function bind(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const {
      t,
      form,
      textarea,
      streamEndpoint,
      submissionState,
      appendStreamingPair,
      removeLivePair,
      consumeNdjsonStream,
      setBubbleFinalState,
      updateCurrentMessageState,
      ensureStartMessage,
    } = settings;

    async function handleMainComposeSubmit(event) {
      ensureStartMessage();
      if (submissionState.isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
        return;
      }

      event.preventDefault();
      submissionState.isSubmitting = true;
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
      submissionState.activeAbortController = abortController;
      if (!draftContent) {
        submissionState.isSubmitting = false;
        removeLivePair(streamBubble);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || t('发送消息');
        }
        textarea.disabled = false;
        textarea.focus();
        submissionState.activeAbortController = null;
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
        submissionState.isSubmitting = false;
        textarea.disabled = false;
        window.removeEventListener('beforeunload', handlePageAbort);
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || t('发送消息');
        }
        if (submissionState.activeAbortController === abortController) {
          submissionState.activeAbortController = null;
        }
      }
    }

    function isMobileLikeInputDevice() {
      const ua = String(window.navigator?.userAgent || '');
      const hasTouch = Number(window.navigator?.maxTouchPoints || 0) > 0;
      const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
      return mobileUa || (hasTouch && coarsePointer);
    }

    form.addEventListener('submit', handleMainComposeSubmit);

    textarea.addEventListener('keydown', (event) => {
      if (event.isComposing || event.key !== 'Enter' || event.shiftKey || isMobileLikeInputDevice()) {
        return;
      }
      event.preventDefault();
      if (!submissionState.isSubmitting && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else if (!submissionState.isSubmitting) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
  }

  window.LougeChatComposeSubmit = { bind };
})();
