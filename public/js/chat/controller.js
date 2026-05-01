/**
 * @file public/js/chat/controller.js
 * @description 聊天页轻量入口：装配 DOM 工具、流客户端和各交互子模块。
 */

(function () {
    const t = window.AI_ROLEPLAY_I18N?.t || ((key, vars) => key);
    const form = document.getElementById('chat-compose-form');
    const textarea = document.getElementById('content');
    if (!form || !textarea) return;

    const domUtils = window.LougeChatDomUtils || {};
    const {
      isNearPageBottom,
      closeMessageMenus,
      showToast,
      renderStreamingPlainText,
      createFragmentFromHtml,
      hydrateRichContent,
    } = domUtils;
    if (!window.LougeChatDomUtils) {
      console.warn('[chat] LougeChatDomUtils missing; controller skipped.');
      return;
    }

    const requiredModules = [
      'LougeChatBubbles',
      'LougeChatStreamClient',
      'LougeChatConversationState',
      'LougeChatStreamingUi',
      'LougeChatComposeSubmit',
      'LougeChatOptimizeSubmit',
      'LougeChatActionStreamSubmit',
      'LougeChatHistoryLoader',
    ];
    const missingModule = requiredModules.find((name) => !window[name]);
    if (missingModule) {
      console.warn(`[chat] ${missingModule} missing; controller skipped.`);
      return;
    }

    const streamEndpoint = form.dataset.streamEndpoint || form.action;
    const optimizeStreamEndpoint = form.dataset.optimizeStreamEndpoint || '';
    const conversationId = form.dataset.conversationId || '';
    const chatContainer = document.querySelector('.chat-transcript');
    const submissionState = {
      isSubmitting: false,
      streamingRenderScheduled: false,
      activeAbortController: null,
    };

    const streamingUi = window.LougeChatStreamingUi.create({
      t,
      isNearPageBottom,
      renderStreamingPlainText,
      submissionState,
    });
    streamingUi.bindAutoFollowRelease();

    const bubbleToolkit = window.LougeChatBubbles.create({
      t,
      chatContainer,
      beginStreamingAutoFollow: streamingUi.beginStreamingAutoFollow,
      maybeFollowStreamingBubble: streamingUi.maybeFollowStreamingBubble,
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

    const conversationState = window.LougeChatConversationState.create({
      t,
      form,
      textarea,
      chatContainer,
      showToast,
    });

    const streamClient = window.LougeChatStreamClient.create({
      t,
      splitStreamingSegments: streamingUi.splitStreamingSegments,
      scheduleStreamingRender: streamingUi.scheduleStreamingRender,
      setBubbleFinalState: streamingUi.setBubbleFinalState,
      replacePreviousLiveUserBubble,
      replaceBubbleWithHtml,
      removeStaleLinearTail: conversationState.removeStaleLinearTail,
      createFragmentFromHtml,
      hydrateRichContent,
      chatContainer,
    });
    if (!streamClient) {
      console.warn('[chat] LougeChatStreamClient missing; controller skipped.');
      return;
    }
    const { consumeNdjsonStream } = streamClient;

    window.LougeChatComposeSubmit.bind({
      t,
      form,
      textarea,
      streamEndpoint,
      submissionState,
      appendStreamingPair,
      removeLivePair,
      consumeNdjsonStream,
      setBubbleFinalState: streamingUi.setBubbleFinalState,
      updateCurrentMessageState: conversationState.updateCurrentMessageState,
      ensureStartMessage: conversationState.ensureStartMessage,
    });

    window.LougeChatOptimizeSubmit.bind({
      t,
      textarea,
      optimizeStreamEndpoint,
      submissionState,
      appendSingleStreamingBubble,
      consumeNdjsonStream,
      setBubbleFinalState: streamingUi.setBubbleFinalState,
      showToast,
    });

    window.LougeChatActionStreamSubmit.bind({
      t,
      submissionState,
      appendStreamingPair,
      appendSingleStreamingBubble,
      consumeNdjsonStream,
      setBubbleFinalState: streamingUi.setBubbleFinalState,
      updateCurrentMessageState: conversationState.updateCurrentMessageState,
      reloadToMessage: conversationState.reloadToMessage,
      closeMessageMenus,
      showToast,
    });

    window.LougeChatHistoryLoader.bind({
      t,
      conversationId,
      chatContainer,
      createFragmentFromHtml,
      hydrateRichContent,
      closeMessageMenus,
    });

    conversationState.applyInitialUrlState();
  })();
