// Tiny text formatter for lesson content.
//   $x^2 + v_{0}t$   inline math (sup/sub only; Greek typed directly)
//   `code`           inline code
//   **bold**
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function math(src) {
  let s = src;
  s = s.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
  s = s.replace(/\^([^\s<{(])/g, '<sup>$1</sup>').replace(/_([^\s<{(])/g, '<sub>$1</sub>');
  return `<span class="m">${s}</span>`;
}

export function fmt(str) {
  if (str == null) return '';
  let s = esc(String(str));
  const stash = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { stash.push(`<code>${c}</code>`); return `\u0000${stash.length - 1}\u0000`; });
  s = s.replace(/\$([^$]+)\$/g, (_, m) => math(m));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  return s;
}

export function codeBlock(code, lang = '') {
  return `<pre class="code" data-lang="${lang}"><code>${esc(code)}</code></pre>`;
}

// Body items: string paragraph | { eq } | { code, lang } | { list: [] } | { note }
export function body(items) {
  return (items || []).map(it => {
    if (typeof it === 'string') return `<p>${fmt(it)}</p>`;
    if (it.eq) return `<div class="eq">${fmt('$' + it.eq + '$')}${it.where ? `<span class="eq-where">${fmt(it.where)}</span>` : ''}</div>`;
    if (it.code) return codeBlock(it.code, it.lang);
    if (it.list) return `<ul>${it.list.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>`;
    if (it.note) return `<p class="note">${fmt(it.note)}</p>`;
    return '';
  }).join('');
}

export { esc };
