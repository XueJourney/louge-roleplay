/*
 * @file public/js/chat/bubbles.js
 * @description 聊天页气泡 DOM 创建、临时流式气泡追加与 HTML 替换工具。
 */

(function () {
  function createChatBubbles(options) {
    const settings = Object.assign({
      t: (key) => key,
      chatContainer: null,
      beginStreamingAutoFollow: () => {},
      maybeFollowStreamingBubble: () => {},
      createFragmentFromHtml: null,
      hydrateRichContent: () => {},
    }, options || {});

    function createBubble(roleLabel, kindLabel, senderClass, content, bubbleOptions) {
      const article = document.createElement('article');
      article.className = `bubble bubble-${senderClass}`;
      if (bubbleOptions && bubbleOptions.isStreaming) {
        article.dataset.streaming = 'true';
      }
      if (bubbleOptions && bubbleOptions.isPending) {
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
      tools.innerHTML = `<div class="bubble-actions bubble-actions--stacked bubble-actions--live"><span class="bubble-ghost-dot"></span><span class="mini-note bubble-live-note">${settings.t('等待生成中…')}</span></div>`;

      article.appendChild(header);
      article.appendChild(rich);
      article.appendChild(tools);
      return { article, rich, tools };
    }

    function appendStreamingPair(userContent, pairOptions) {
      if (!settings.chatContainer) return null;
      const mode = Object.assign({
        userLabel: settings.t('你'),
        userKind: '',
        aiLabel: 'AI',
        aiKind: settings.t('生成中…'),
        userSenderClass: 'user',
        aiSenderClass: 'character',
      }, pairOptions || {});
      const userBubble = createBubble(mode.userLabel, mode.userKind, mode.userSenderClass, userContent, {
        isPending: true,
        timeLabel: settings.t('刚刚'),
      });
      const aiBubble = createBubble(mode.aiLabel, mode.aiKind, mode.aiSenderClass, '', {
        isStreaming: true,
        isPending: true,
        timeLabel: settings.t('生成中…'),
      });

      userBubble.article.classList.add('bubble-live');
      aiBubble.article.classList.add('bubble-live');

      settings.beginStreamingAutoFollow();
      settings.chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      settings.chatContainer.appendChild(userBubble.article);
      settings.chatContainer.appendChild(aiBubble.article);
      settings.maybeFollowStreamingBubble(aiBubble, 'smooth');
      return { userBubble, aiBubble };
    }

    function appendSingleStreamingBubble(roleLabel, kindLabel, senderClass, bubbleOptions) {
      if (!settings.chatContainer) return null;
      const bubble = createBubble(roleLabel, kindLabel, senderClass, '', {
        isStreaming: true,
        isPending: true,
        timeLabel: settings.t('生成中…'),
      });
      bubble.article.classList.add('bubble-live');
      if (bubbleOptions && bubbleOptions.noteText) {
        const note = bubble.article.querySelector('.bubble-live-note');
        if (note) {
          note.textContent = bubbleOptions.noteText;
        }
      }
      settings.beginStreamingAutoFollow();
      settings.chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
      settings.chatContainer.appendChild(bubble.article);
      settings.maybeFollowStreamingBubble(bubble, 'smooth');
      return bubble;
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

    function replaceBubbleWithHtml(streamBubble, html) {
      if (!streamBubble || !streamBubble.article || !streamBubble.article.parentNode || !html) {
        return null;
      }
      const fragment = settings.createFragmentFromHtml(html);
      const nextArticle = fragment.querySelector('article.bubble');
      if (!nextArticle) {
        return null;
      }
      streamBubble.article.replaceWith(nextArticle);
      settings.hydrateRichContent(nextArticle);
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
      const fragment = settings.createFragmentFromHtml(html);
      const nextArticle = fragment.querySelector('article.bubble');
      if (!nextArticle) {
        return null;
      }
      previous.replaceWith(nextArticle);
      settings.hydrateRichContent(nextArticle);
      return nextArticle;
    }

    return {
      createBubble,
      appendStreamingPair,
      appendSingleStreamingBubble,
      removeLivePair,
      replaceBubbleWithHtml,
      replacePreviousLiveUserBubble,
    };
  }

  window.LougeChatBubbles = { create: createChatBubbles };
}());
