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
