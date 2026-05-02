(function () {
  window.ChatRichRenderer = window.ChatRichRenderer || {};
  const ns = window.ChatRichRenderer;
  const QUOTE_RE = /(“[^”<>\n]{0,280}”|‘[^’<>\n]{0,280}’|「[^」<>\n]{0,280}」|&quot;[^<>\n]{0,280}&quot;|&#39;[^<>\n]{0,280}&#39;|"[^"<>\n]{0,280}"|'[^'<>\n]{0,280}')/g;
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

  function highlightQuotesInNodeTree(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('pre, code, style, a')) return NodeFilter.FILTER_REJECT;
        if (!QUOTE_RE.test(node.nodeValue || '')) {
          QUOTE_RE.lastIndex = 0;
          return NodeFilter.FILTER_REJECT;
        }
        QUOTE_RE.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      const text = node.nodeValue || '';
      let lastIndex = 0;
      QUOTE_RE.lastIndex = 0;
      let match;
      while ((match = QUOTE_RE.exec(text))) {
        if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        const span = document.createElement('span');
        span.className = 'bubble-quote';
        span.textContent = match[0];
        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }
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
  ns.highlightQuotesInNodeTree = highlightQuotesInNodeTree;
}());
