/**
 * @file public/js/chat/optimize-submit.js
 * @description 润色输入表单的流式提交绑定。
 */

(function () {
  function bind(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const {
      t,
      textarea,
      optimizeStreamEndpoint,
      submissionState,
      appendSingleStreamingBubble,
      consumeNdjsonStream,
      setBubbleFinalState,
      showToast,
    } = settings;
    const optimizeForm = document.getElementById('chat-optimize-form');
    if (!optimizeForm || !optimizeStreamEndpoint) {
      return;
    }

    optimizeForm.addEventListener('submit', async (event) => {
      if (submissionState.isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
        return;
      }
      event.preventDefault();
      submissionState.isSubmitting = true;

      const submitButton = optimizeForm.querySelector('button[type="submit"]');
      const previousButtonText = submitButton ? submitButton.textContent : '';
      const payload = new FormData(optimizeForm);
      const draftContent = String(payload.get('content') || '').trim();
      const streamBubble = appendSingleStreamingBubble(t('系统'), t('优化输入中…'), 'system', { noteText: t('正在润色你的输入…') });
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null;

      if (!draftContent) {
        submissionState.isSubmitting = false;
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
        submissionState.isSubmitting = false;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || t('优化输入');
        }
      }
    });
  }

  window.LougeChatOptimizeSubmit = { bind };
})();
