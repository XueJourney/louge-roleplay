/**
 * @file public/js/chat/rich-renderer.js
 * @description 聊天消息富文本渲染与安全净化。
 */

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
