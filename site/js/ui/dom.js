/** Ayudantes mínimos para construir DOM sin plantillas ni librerías. */

export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  return node;
}

export const frag = (children) => {
  const f = document.createDocumentFragment();
  for (const c of [].concat(children)) if (c) f.append(c);
  return f;
};

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function card(title, children, attrs = {}) {
  return h('section', { class: 'card', ...attrs }, [
    title ? h('div', { class: 'card-title', text: title }) : null,
    ...[].concat(children).filter(Boolean),
  ]);
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, [
    h('label', { text: label }),
    control,
    hint ? h('div', { class: 'hint', text: hint }) : null,
  ]);
}

export function num(value, decimals = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(decimals).replace('.', ',').replace(/,0+$/, '');
}

export function signed(value, decimals = 1) {
  if (value == null) return '—';
  const s = num(Math.abs(value), decimals);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${s}`;
}

/** Detalle plegable con la evidencia de una conclusión. */
export function why(summary, items) {
  if (!items?.length) return null;
  return h('details', { class: 'why' }, [
    h('summary', { text: summary }),
    h('ul', {}, items.map((t) => h('li', { html: t }))),
  ]);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function copyToClipboard(text) {
  return navigator.clipboard?.writeText(text);
}
