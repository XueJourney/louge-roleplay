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
