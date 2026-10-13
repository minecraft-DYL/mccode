// util.js —— 通用工具，零依赖
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 极简 hyperscript：h('div.card', {onclick}, [children]) */
export function h(tag, props = null, children = null) {
  let el;
  const m = /^([a-zA-Z0-9-]+)([.#][^.#]+)*$/.exec(tag || 'div');
  const name = m ? m[1] : 'div';
  el = document.createElement(name);
  if (tag) {
    const cls = tag.match(/\.[^.#]+/g);
    if (cls) el.className = cls.map((c) => c.slice(1)).join(' ');
    const id = tag.match(/#[^.#]+/);
    if (id) el.id = id[0].slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = el.className ? el.className + ' ' + v : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  if (children == null || children === false) return el;
  if (Array.isArray(children)) { children.forEach((c) => append(el, c)); return el; }
  el.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function fmtNum(n) { return typeof n === 'number' ? n.toLocaleString('zh-CN') : String(n ?? '—'); }

export function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function dl(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text;
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mce.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mce.' + k, JSON.stringify(v)); } catch { /* 忽略配额错误 */ } },
  del(k) { try { localStorage.removeItem('mce.' + k); } catch { /* noop */ } },
};

/** 带超时的 fetch */
export async function fetchT(url, opt = {}, ms = 30000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), ms);
  try { return await fetch(url, { ...opt, signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

export async function fetchJSON(url, opt, ms) {
  const r = await fetchT(url, opt, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.json();
}

export async function fetchText(url, opt, ms) {
  const r = await fetchT(url, opt, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.text();
}

/** 并发池：限制同时进行的任务数 */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;
  const run = async () => {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await worker(items[i], i); } catch (e) { out[i] = { __error: e && e.message }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}
