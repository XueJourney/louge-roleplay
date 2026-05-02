/**
 * @file public/js/chat/rich-renderer.js
 * @description 聊天消息富文本渲染入口。核心实现拆分在 public/js/chat/rich-renderer/。
 */

(function () {
  const ns = window.ChatRichRenderer || {};
  const SCRIPTISH_TAG_RE = /<\s*\/?\s*(script|iframe|object|embed|meta|link|base|form)\b[^>]*>/gi;
  const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;
  let scopeSeed = 0;

  function renderRichContent(container, input, options) {
    const textNode = container.querySelector('.bubble-text');
    const raw = input !== undefined ? String(input || '') : String((textNode && textNode.textContent) || '');
    const mode = Object.assign({ streaming: false, finalPass: true, lineMode: false, committed: '', tail: '', hideFolds: false }, options || {});
    const sourceText = mode.lineMode
      ? `${String(mode.committed || '')}${mode.committed && mode.tail ? '\n' : ''}${String(mode.tail || '')}`
      : raw;
    const { text, folds } = ns.collectFoldBlocks(sourceText, { hideFolds: mode.hideFolds || mode.streaming });
    const safeHtmlSeed = text.replace(SCRIPTISH_TAG_RE, '');
    const scopeId = container.dataset.renderScope || `render-scope-${Date.now()}-${++scopeSeed}`;
    const scopeSelector = `[data-render-scope="${scopeId}"]`;

    let html = '';
    if (mode.streaming && mode.lineMode) {
      html = ns.buildStreamingPreviewHtml(safeHtmlSeed);
    } else {
      html = ns.markdownToHtml(safeHtmlSeed);
      if (HTML_TAG_RE.test(safeHtmlSeed)) html = safeHtmlSeed;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild || doc.body;
    ns.sanitizeNodeTree(root, scopeSelector);
    ns.highlightQuotesInNodeTree(root);

    const wrapper = document.createElement('div');
    wrapper.className = 'bubble-rich';
    wrapper.setAttribute('data-render-scope', scopeId);

    while (root.firstChild) wrapper.appendChild(root.firstChild);

    if (!wrapper.childNodes.length) {
      const fallbackText = document.createElement('div');
      fallbackText.className = 'bubble-text';
      fallbackText.textContent = sourceText;
      wrapper.appendChild(fallbackText);
    }

    if (folds.length) {
      const foldsWrap = document.createElement('div');
      foldsWrap.className = 'bubble-folds';
      folds.forEach((fold) => foldsWrap.appendChild(ns.buildFold(fold.title, fold.body, fold.open)));
      wrapper.appendChild(foldsWrap);
    }

    container.replaceChildren(...wrapper.childNodes);
    container.dataset.renderScope = scopeId;
    container.dataset.lineMode = mode.lineMode ? 'true' : 'false';
    container.dataset.finalPass = mode.finalPass ? 'true' : 'false';
  }

  window.renderRichContent = renderRichContent;
  document.querySelectorAll('[data-message-content]').forEach((node) => renderRichContent(node));
}());
