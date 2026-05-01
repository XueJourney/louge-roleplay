/**
 * @file public/js/chat/streaming-ui.js
 * @description 聊天页流式渲染调度、自动跟随滚动和气泡最终态处理。
 */

(function () {
  function create(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const { t, renderStreamingPlainText, submissionState } = settings;
    let streamingRenderFrame = null;
    let autoFollowStreaming = true;

    function beginStreamingAutoFollow() {
      autoFollowStreaming = settings.isNearPageBottom(260);
    }

    function releaseStreamingAutoFollow() {
      if (submissionState.isSubmitting) {
        autoFollowStreaming = false;
      }
    }

    function maybeFollowStreamingBubble(streamBubble, behavior) {
      if (!autoFollowStreaming || !streamBubble || !streamBubble.article) {
        return;
      }
      streamBubble.article.scrollIntoView({ block: 'end', behavior: behavior || 'smooth' });
    }

    function bindAutoFollowRelease() {
      window.addEventListener('wheel', releaseStreamingAutoFollow, { passive: true });
      window.addEventListener('touchmove', releaseStreamingAutoFollow, { passive: true });
      window.addEventListener('keydown', (event) => {
        if (['ArrowUp', 'PageUp', 'Home', 'Space'].includes(event.key)) {
          releaseStreamingAutoFollow();
        }
      });
    }

    function scheduleStreamingRender(streamBubble, fullText, committedText, tailText) {
      if (!streamBubble) return;
      if (streamingRenderFrame) {
        cancelAnimationFrame(streamingRenderFrame);
      }
      submissionState.streamingRenderScheduled = true;
      streamingRenderFrame = requestAnimationFrame(() => {
        submissionState.streamingRenderScheduled = false;
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
      submissionState.streamingRenderScheduled = false;
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

    return {
      beginStreamingAutoFollow,
      releaseStreamingAutoFollow,
      maybeFollowStreamingBubble,
      bindAutoFollowRelease,
      scheduleStreamingRender,
      splitStreamingSegments,
      setBubbleFinalState,
    };
  }

  window.LougeChatStreamingUi = { create };
})();
