/**
 * @file public/js/generated/chat.bundle.js
 * @description Generated bundle. Do not edit directly; source order is defined in scripts/build-js.js.
 */

;
/* public/js/chat/rich-renderer/formatting.js */
(function () {
  window.ChatRichRenderer = window.ChatRichRenderer || {};
  const ns = window.ChatRichRenderer;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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


  function splitTableRow(line) {
    let source = String(line || '').trim();
    if (!source.includes('|')) return [];
    if (source.startsWith('|')) source = source.slice(1);
    if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);

    const cells = [];
    let current = '';
    let inCode = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];
      if (char === '`') {
        inCode = !inCode;
        current += char;
        continue;
      }
      if (char === '\\' && next === '|') {
        current += '|';
        i += 1;
        continue;
      }
      if (char === '|' && !inCode) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  }

  function parseTableSeparator(line) {
    const cells = splitTableRow(line);
    if (cells.length < 2) return null;
    const alignments = [];
    for (const cell of cells) {
      const value = String(cell || '').trim();
      if (!/^:?-{3,}:?$/.test(value)) return null;
      if (/^:-+:$/.test(value)) alignments.push('center');
      else if (/^-+:$/.test(value)) alignments.push('right');
      else if (/^:-+$/.test(value)) alignments.push('left');
      else alignments.push('');
    }
    return alignments;
  }

  function normalizeTableCells(cells, columnCount) {
    const normalized = cells.slice(0, columnCount);
    while (normalized.length < columnCount) normalized.push('');
    return normalized;
  }

  function renderTableCell(tag, content, alignment) {
    const alignClass = alignment ? ` class="align-${alignment}"` : '';
    return `<${tag}${alignClass}>${applyInlineMarkdown(String(content || '').trim())}</${tag}>`;
  }

  function tryParseTable(lines, startIndex) {
    const headerCells = splitTableRow(lines[startIndex]);
    const alignments = parseTableSeparator(lines[startIndex + 1]);
    if (headerCells.length < 2 || !alignments) return null;

    const columnCount = headerCells.length;
    const headerHtml = normalizeTableCells(headerCells, columnCount)
      .map((cell, index) => renderTableCell('th', cell, alignments[index]))
      .join('');
    const bodyRows = [];
    let endIndex = startIndex + 2;

    while (endIndex < lines.length) {
      const rowLine = lines[endIndex];
      if (!String(rowLine || '').trim()) break;
      const cells = splitTableRow(rowLine);
      if (cells.length < 2 || parseTableSeparator(rowLine)) break;
      bodyRows.push(`<tr>${normalizeTableCells(cells, columnCount)
        .map((cell, index) => renderTableCell('td', cell, alignments[index]))
        .join('')}</tr>`);
      endIndex += 1;
    }

    return {
      html: `<div class="bubble-table-wrap"><table><thead><tr>${headerHtml}</tr></thead>${bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : ''}</table></div>`,
      endIndex,
    };
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
      if (!paragraphLines.length) return;
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

      if (isBlank(line)) { flushParagraph(); continue; }
      if (isFencePlaceholder(trimmed)) { flushParagraph(); parts.push(trimmed); continue; }
      if (isHr(line)) { flushParagraph(); parts.push('<hr>'); continue; }

      const parsedTable = i + 1 < lines.length ? tryParseTable(lines, i) : null;
      if (parsedTable) {
        flushParagraph();
        parts.push(parsedTable.html);
        i = parsedTable.endIndex - 1;
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
          while (i < lines.length && !isBlank(lines[i])) { quoteLines.push(lines[i]); i += 1; }
          i -= 1;
        } else {
          while (i < lines.length && isQuoted(lines[i]) && !isQuoteMarkerOnly(lines[i])) {
            quoteLines.push(String(lines[i] || '').replace(/^(?:>|&gt;)\s?/, ''));
            i += 1;
          }
          i -= 1;
        }
        parts.push(`<blockquote>${applyInlineMarkdown(quoteLines.join('<br>').trim())}</blockquote>`);
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
    return html;
  }

  function markdownToPartialHtml(text) {
    const normalized = normalizeMarkdownLines(text);
    const lines = normalized.split('\n');
    let inFence = false;
    lines.forEach((line) => {
      if (/^```/.test(String(line || '').trim())) inFence = !inFence;
    });
    return markdownToHtml(inFence ? `${normalized}\n\`\`\`` : normalized);
  }

  function buildStreamingPreviewHtml(text) {
    const source = String(text || '').trim();
    return source ? markdownToPartialHtml(source) : '';
  }

  ns.escapeHtml = escapeHtml;
  ns.normalizeMarkdownLines = normalizeMarkdownLines;
  ns.markdownToHtml = markdownToHtml;
  ns.buildStreamingPreviewHtml = buildStreamingPreviewHtml;
}());


;
/* public/js/chat/rich-renderer/sanitizer.js */
(function () {
  window.ChatRichRenderer = window.ChatRichRenderer || {};
  const ns = window.ChatRichRenderer;
  const QUOTE_TOKENS = [
    { value: '&quot;', family: 'double', role: 'both' },
    { value: '&#39;', family: 'single', role: 'both' },
    { value: '“', family: 'double', role: 'open' },
    { value: '”', family: 'double', role: 'close' },
    { value: '"', family: 'double', role: 'both' },
    { value: '‘', family: 'single', role: 'open' },
    { value: '’', family: 'single', role: 'close' },
    { value: "'", family: 'single', role: 'both' },
    { value: '「', family: 'corner', role: 'open' },
    { value: '」', family: 'corner', role: 'close' },
  ];
  const ALLOWED_TAGS = new Set(['p', 'br', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'details', 'summary', 'style', 'a', 'img']);

  function sanitizeCss(cssText, scopeSelector) {
    const cleaned = String(cssText || '')
      .replace(/@import[\s\S]*?;/gi, '')
      .replace(/@charset[\s\S]*?;/gi, '')
      .replace(/@namespace[\s\S]*?;/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/behavior\s*:[^;}]+[;}]?/gi, '')
      .replace(/-moz-binding\s*:[^;}]+[;}]?/gi, '')
      .replace(/url\s*\(\s*(['"]?)\s*(javascript:|data:text\/html|data:application\/javascript)[^)]+\)/gi, 'url(#)');

    return cleaned.replace(/(^|})\s*([^@}{][^{]*){/g, (full, prefix, selectorGroup) => {
      const scopedSelectors = selectorGroup
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean)
        .map((selector) => (/^(html|body|:root)$/i.test(selector) ? scopeSelector : `${scopeSelector} ${selector}`))
        .join(', ');
      return `${prefix} ${scopedSelectors} {`;
    });
  }

  function findQuoteToken(source, index) {
    return QUOTE_TOKENS.find((token) => source.startsWith(token.value, index)) || null;
  }

  function findClosingQuote(source, startIndex, openingToken) {
    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];
      if (char === '<' || char === '>' || char === '\n') return null;
      const token = findQuoteToken(source, index);
      if (!token) continue;
      if (token.family !== openingToken.family) {
        index += token.value.length - 1;
        continue;
      }
      if (token.role === 'open' && token.role !== 'both') {
        index += token.value.length - 1;
        continue;
      }
      return { token, index };
    }
    return null;
  }

  function collectQuoteMatches(text) {
    const source = String(text || '');
    const matches = [];
    let index = 0;

    while (index < source.length) {
      const openingToken = findQuoteToken(source, index);
      if (!openingToken || openingToken.role === 'close') {
        index += 1;
        continue;
      }

      const closing = findClosingQuote(source, index + openingToken.value.length, openingToken);
      if (!closing || closing.index === index + openingToken.value.length) {
        index += openingToken.value.length;
        continue;
      }

      const end = closing.index + closing.token.value.length;
      matches.push({ index, end, text: source.slice(index, end) });
      index = end;
    }

    return matches;
  }

  function highlightQuotesInNodeTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('pre, code, style, a, .bubble-quote')) return NodeFilter.FILTER_REJECT;
        return collectQuoteMatches(node.nodeValue || '').length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const text = node.nodeValue || '';
      const matches = collectQuoteMatches(text);
      if (!matches.length) return;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      matches.forEach((match) => {
        if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        const span = document.createElement('span');
        span.className = 'bubble-quote';
        span.textContent = match.text;
        fragment.appendChild(span);
        lastIndex = match.end;
      });
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.replaceWith(fragment);
    });
  }

  function sanitizeNodeTree(root, scopeSelector) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const toProcess = [];
    while (walker.nextNode()) toProcess.push(walker.currentNode);

    toProcess.forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) fragment.appendChild(node.firstChild);
        node.replaceWith(fragment);
        return;
      }

      Array.from(node.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) || name === 'style') {
          node.removeAttribute(attr.name);
          return;
        }
        if (tag !== 'a' && (name === 'target' || name === 'rel')) node.removeAttribute(attr.name);
      });

      if (tag === 'a') {
        const href = String(node.getAttribute('href') || '');
        if (!/^https?:\/\//i.test(href)) node.removeAttribute('href');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
        node.setAttribute('target', '_blank');
      }

      if (tag === 'img') {
        const src = String(node.getAttribute('src') || '');
        if (!/^https?:\/\//i.test(src)) node.removeAttribute('src');
        node.removeAttribute('srcset');
        node.removeAttribute('sizes');
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }

      if (tag === 'style') node.textContent = sanitizeCss(node.textContent || '', scopeSelector);
    });
  }

  ns.sanitizeNodeTree = sanitizeNodeTree;
  ns.collectQuoteMatches = collectQuoteMatches;
  ns.highlightQuotesInNodeTree = highlightQuotesInNodeTree;
}());


;
/* public/js/chat/rich-renderer/folds.js */
(function () {
  window.ChatRichRenderer = window.ChatRichRenderer || {};
  const ns = window.ChatRichRenderer;
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
  const RICH_TAGS = new Set(['p', 'br', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'details', 'summary', 'style', 'a', 'img', 'think', 'thinking']);

  function buildFold(title, body, openByDefault) {
    const details = document.createElement('details');
    details.className = 'bubble-fold';
    if (openByDefault) details.open = true;

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
      if (mode.hideFolds || !body) return '';
      const key = `__FOLD_BLOCK_${foldIndex++}__`;
      folds.push({ key, title: t('思考内容'), body, open: false, kind: 'think' });
      return key;
    });

    text = text.replace(GENERIC_FOLD_TAG_RE, (full, tagName, inner) => {
      const normalizedTag = String(tagName || '').toLowerCase();
      if (RICH_TAGS.has(normalizedTag)) return full;
      const plainInner = String(inner || '').replace(/<[^>]+>/g, '').trim();
      if (!plainInner) return full;
      if (mode.hideFolds) return '';
      const key = `__FOLD_BLOCK_${foldIndex++}__`;
      folds.push({ key, title: t('标签内容：<{tag}>', { tag: normalizedTag }), body: plainInner, open: false, kind: normalizedTag });
      return key;
    });

    return { text: text.replace(/\n{3,}/g, '\n\n').trim(), folds };
  }

  ns.buildFold = buildFold;
  ns.collectFoldBlocks = collectFoldBlocks;
}());


;
/* public/js/chat/rich-renderer.js */
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


;
/* public/js/chat/dom-utils.js */
/**
 * @file public/js/chat/dom-utils.js
 * @description 聊天页 DOM 小工具：滚动判断、菜单收起、toast、富文本挂载等。
 */

(function () {
  function isNearPageBottom(threshold) {
    const margin = Number(threshold || 180);
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewportBottom = scrollTop + window.innerHeight;
    const pageHeight = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    return pageHeight - viewportBottom <= margin;
  }

  function closeMessageMenus(scope) {
    const root = scope || document;
    root.querySelectorAll('.message-menu-details[open], .more-menu[open]').forEach((menu) => {
      menu.removeAttribute('open');
    });
    if (!scope && window.LougeMessageMenus && typeof window.LougeMessageMenus.closeAll === 'function') {
      window.LougeMessageMenus.closeAll();
    }
  }

  function closeSiblingMessageMenus(currentMenu) {
    document.querySelectorAll('.more-menu[open]').forEach((menu) => {
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

  window.LougeChatDomUtils = {
    isNearPageBottom,
    closeMessageMenus,
    closeSiblingMessageMenus,
    showToast,
    renderStreamingPlainText,
    createFragmentFromHtml,
    hydrateRichContent,
  };
}());


;
/* public/js/chat/bubbles.js */
/**
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


;
/* public/js/chat/stream-client.js */
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


;
/* public/js/chat/message-menu.js */
/**
 * @file public/js/chat/message-menu.js
 * @description 聊天消息操作区：点击消息上的“⋯”，在对应消息上方插入轻量上下文操作卡。
 */

(function () {
  let activeMessageId = '';

  function getExistingDock() {
    return document.querySelector('[data-message-actions-dock]');
  }

  function setActiveMessage(article) {
    document.querySelectorAll('.bubble.is-actions-active').forEach((node) => {
      if (node !== article) node.classList.remove('is-actions-active');
    });
    if (article) article.classList.add('is-actions-active');
  }

  function closeActions() {
    const dock = getExistingDock();
    if (dock) dock.remove();
    activeMessageId = '';
    setActiveMessage(null);
  }

  function renderActionsFor(article) {
    const template = article && article.querySelector(':scope > template[data-message-actions-template]');
    if (!article || !template) return;

    const messageId = String(article.dataset.messageId || '').trim();
    if (activeMessageId && activeMessageId === messageId) {
      closeActions();
      return;
    }

    closeActions();

    const dock = document.createElement('div');
    dock.className = 'message-actions-dock';
    dock.dataset.messageActionsDock = 'true';
    dock.dataset.activeMessageId = messageId;

    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('[data-message-actions-card]');
    if (!card) return;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'message-actions-close';
    closeButton.setAttribute('aria-label', (window.AI_ROLEPLAY_I18N && window.AI_ROLEPLAY_I18N.t ? window.AI_ROLEPLAY_I18N.t('关闭操作面板') : '关闭操作面板'));
    const closeIcon = document.createElement('span');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener('click', closeActions);
    card.querySelector('.message-actions-head')?.appendChild(closeButton);

    dock.appendChild(card);
    const rich = article.querySelector(':scope > .bubble-rich');
    if (rich) {
      article.insertBefore(dock, rich);
    } else {
      article.appendChild(dock);
    }
    activeMessageId = messageId;
    setActiveMessage(article);

    requestAnimationFrame(() => {
      const rect = dock.getBoundingClientRect();
      const viewportTop = 12;
      if (rect.top < viewportTop || rect.bottom > window.innerHeight - 120) {
        const top = rect.top + window.scrollY - 16;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    });
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target && event.target.closest ? event.target.closest('[data-message-actions-trigger]') : null;
    if (!trigger) return;
    event.preventDefault();
    const article = trigger.closest('.bubble[data-message-id]');
    renderActionsFor(article);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeActions();
  });

  document.addEventListener('submit', (event) => {
    const dock = getExistingDock();
    if (dock && event.target && dock.contains(event.target)) {
      window.setTimeout(closeActions, 80);
    }
  }, true);

  window.LougeMessageMenus = {
    closeAll: closeActions,
    closeActions,
  };
}());


;
/* public/js/chat/conversation-state.js */
/**
 * @file public/js/chat/conversation-state.js
 * @description 聊天页 URL leaf、父消息隐藏字段、可见消息计数与旧尾巴清理。
 */

(function () {
  function create(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const { form, textarea, chatContainer, t } = settings;

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

    function updateChatCounts() {
      if (!chatContainer) return;
      const currentCount = chatContainer.querySelectorAll('article.bubble[data-message-id]').length;
      chatContainer.dataset.visibleCount = String(currentCount);
      chatContainer.dataset.totalCount = String(Math.max(Number(chatContainer.dataset.totalCount || '0'), currentCount));
    }

    function updateHiddenParentInputs(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      document.querySelectorAll('input[name="parentMessageId"]').forEach((input) => {
        input.value = normalizedMessageId;
      });
    }

    function collapseOldRenderedMessages(options) {
      if (!chatContainer) return;
      const settings = Object.assign({ keepLatest: Number(chatContainer.dataset.keepLatest || 8) || 8 }, options || {});
      const keepLatest = Math.max(4, Math.min(80, Number(settings.keepLatest || 8) || 8));
      const articles = Array.from(chatContainer.querySelectorAll('article.bubble[data-message-id]'));
      if (articles.length <= keepLatest) {
        updateChatCounts();
        return;
      }

      const removable = articles.slice(0, Math.max(0, articles.length - keepLatest));
      if (!removable.length) {
        updateChatCounts();
        return;
      }

      const firstKept = articles[removable.length];
      const nextBeforeId = firstKept ? String(firstKept.dataset.messageId || '').trim() : '';
      const removedCount = removable.length;
      removable.forEach((article) => article.remove());
      updateChatCounts();
      if (nextBeforeId) {
        chatContainer.dataset.oldestVisibleId = nextBeforeId;
        const loader = document.querySelector('[data-history-loader]');
        const button = loader ? loader.querySelector('[data-load-older-messages]') : null;
        if (button) {
          button.dataset.beforeId = nextBeforeId;
        }
      }
      if (settings.showNotice && removedCount > 0 && typeof settings.showToast === 'function') {
        settings.showToast(t('已折叠较早消息，可点“查看更早的消息”重新加载。'));
      }
    }

    function updateCurrentMessageState(messageId) {
      const normalizedMessageId = String(messageId || '').trim();
      if (!normalizedMessageId) return;
      updateHiddenParentInputs(normalizedMessageId);
      form.dataset.messageCount = String(Math.max(Number(form.dataset.messageCount || '0'), 1));
      if (chatContainer) {
        chatContainer.querySelectorAll('.empty-chat-state').forEach((node) => node.remove());
        updateChatCounts();
        collapseOldRenderedMessages({ keepLatest: Number(chatContainer.dataset.keepLatest || 8) || 8 });
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
      updateChatCounts();
      updateHiddenParentInputs(normalizedMessageId);
    }

    function applyInitialUrlState() {
      const params = new URLSearchParams(window.location.search);
      const notice = params.get('notice');
      if (notice === 'updated' && typeof settings.showToast === 'function') {
        settings.showToast(t('已显示新的结果，旧内容已保留。'));
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
    }

    return {
      reloadToMessage,
      updateHiddenParentInputs,
      updateCurrentMessageState,
      collapseOldRenderedMessages,
      ensureStartMessage,
      removeStaleLinearTail,
      applyInitialUrlState,
    };
  }

  window.LougeChatConversationState = { create };
})();


;
/* public/js/chat/streaming-ui.js */
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


;
/* public/js/chat/compose-submit.js */
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
      collapseOldRenderedMessages,
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
          if (typeof collapseOldRenderedMessages === 'function') {
            collapseOldRenderedMessages();
          }
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


;
/* public/js/chat/optimize-submit.js */
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


;
/* public/js/chat/action-stream-submit.js */
/**
 * @file public/js/chat/action-stream-submit.js
 * @description 重新生成、从这里重写等消息操作表单的流式提交绑定。
 */

(function () {
  function bind(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const {
      t,
      submissionState,
      appendStreamingPair,
      appendSingleStreamingBubble,
      consumeNdjsonStream,
      setBubbleFinalState,
      updateCurrentMessageState,
      reloadToMessage,
      closeMessageMenus,
      showToast,
    } = settings;

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
      if (submissionState.isSubmitting || !window.fetch || !window.ReadableStream || typeof window.renderRichContent !== 'function') {
        return;
      }

      event.preventDefault();
      submissionState.isSubmitting = true;
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
        submissionState.isSubmitting = false;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousButtonText || submitButton.textContent;
        }
      }
    });
  }

  window.LougeChatActionStreamSubmit = { bind };
})();


;
/* public/js/chat/history-loader.js */
/**
 * @file public/js/chat/history-loader.js
 * @description 聊天页“查看更早消息”懒加载与滚动位置保持。
 */

(function () {
  function bind(options) {
    const settings = Object.assign({ t: (key) => key }, options || {});
    const {
      t,
      conversationId,
      chatContainer,
      createFragmentFromHtml,
      hydrateRichContent,
      closeMessageMenus,
    } = settings;

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
  }

  window.LougeChatHistoryLoader = { bind };
})();


;
/* public/js/chat/controller.js */
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
      collapseOldRenderedMessages: conversationState.collapseOldRenderedMessages,
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
