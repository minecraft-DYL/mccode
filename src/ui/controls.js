// controls.js —— WinUI 风格原生控件工厂（零依赖）
// 视觉令牌全部来自 vendored 的 winui-theme.css（源自 WinUIonWeb, GPL-3.0）

import { h, clear, esc, copy } from '../core/util.js';

/* ------------------------------ 图标 ------------------------------ */

const P = {
  home: 'M12 3 2 11h3v9h5v-6h4v6h5v-9h3L12 3Z',
  layers: 'M12 2 2 7l10 5 10-5-10-5Zm0 20 10-5-1.8-.9L12 20.2 3.8 16.1 2 17l10 5Z',
  grid: 'M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.3 6.5 3.2L12 10.7 5.5 7.5 12 4.3Z',
  ghost: 'M12 2a7 7 0 0 0-7 7v12l2.3-2 2.4 2 2.3-2 2.3 2 2.4-2L19 21V9a7 7 0 0 0-7-7Zm-2.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z',
  sparkle: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Zm6 11 .9 2.6L21.5 17l-2.6.9L18 20.5l-.9-2.6L14.5 17l2.6-.9L18 13Z',
  tag: 'M3 3h9l9 9-9 9-9-9V3Zm4.5 3A1.5 1.5 0 1 0 7.5 9a1.5 1.5 0 0 0 0-3Z',
  puzzle: 'M10 3a2 2 0 0 1 2 2c0 .6-.2 1-.5 1.4H15v4.1c.4-.3.8-.5 1.4-.5a2 2 0 1 1 0 4c-.6 0-1-.2-1.4-.5V19H5v-9h2.5A2 2 0 0 1 10 3Z',
  terminal: 'M3 4h18v16H3V4Zm3.6 4.2 3 3-3 3 1.3 1.3 4.3-4.3-4.3-4.3-1.3 1.3Z',
  doc: 'M6 2h8l4 4v16H6V2Zm7 1.5V7h3.5L13 3.5Z',
  export: 'M12 3v10.6l3.3-3.3 1.4 1.4L12 17.4 7.3 11.7l1.4-1.4L12 13.6V3ZM4 19h16v2H4v-2Z',
  moon: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z',
  sun: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0-4v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1',
  reload: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z',
  copy: 'M8 2h10v3h2v17H6V5h2V2Zm2 3h6V4h-6v1Z',
  download: 'M12 3v10l3-3 1.4 1.4L12 15.8 7.6 11.4 9 10l3 3V3h-2ZM5 18h14v2H5v-2Z',
  play: 'M7 4l13 8-13 8V4Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2ZM6 8h12l-1 13H7L6 8Z',
  check: 'M9.5 17.2 4.8 12.5l-1.4 1.4 6.1 6.1L20.6 9l-1.4-1.4-9.7 9.6Z',
  warn: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  info: 'M11 7h2v2h-2V7Zm0 4h2v6h-2v-6Zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3 1.4 1.4Z',
  link: 'M10.6 13.4a3 3 0 0 1 0-4.2l3-3a3 3 0 0 1 4.2 4.2l-1.5 1.5-1.4-1.4 1.5-1.5a1 1 0 0 0-1.4-1.4l-3 3a1 1 0 0 0 0 1.4l-1.4 1.4Zm2.8-2.8a3 3 0 0 1 0 4.2l-3 3a3 3 0 0 1-4.2-4.2l1.5-1.5 1.4 1.4-1.5 1.5a1 1 0 0 0 1.4 1.4l3-3a1 1 0 0 0 0-1.4l1.4-1.4Z',
  filter: 'M3 5h18v2H3V5Zm3 6h12v2H6v-2Zm3 6h6v2H9v-2Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z',
  save: 'M4 2h12l4 4v16H4V2Zm3 2v5h9V4H7Zm9 16v-6H8v6h8Z',
  zoom: 'M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm-1 3v2H7v2h2v2h2v-2h2V9h-2V7h-2Z',
};

export function icon(name, size = 16) {
  const d = P[name] || P.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export const ICON_NAMES = Object.keys(P);

/* ------------------------------ 基础控件 ------------------------------ */

export function button({ label = '', variant = 'default', iconName = null, onClick = null, title = '', disabled = false, small = false, wide = false, iconOnly = false } = {}) {
  const cls = ['btn'];
  if (variant === 'accent') cls.push('btn-accent');
  if (variant === 'subtle') cls.push('btn-subtle');
  if (variant === 'danger') cls.push('btn-danger');
  if (small) cls.push('btn-sm');
  const iconOnlyFinal = iconOnly || (!label && iconName);
  if (iconOnlyFinal) cls.push('btn-icon'); else if (wide) cls.push('wide');
  const el = h('button', { class: cls.join(' '), title: title || label, type: 'button', disabled });
  if (iconName) el.appendChild(icon(iconName, small ? 14 : 16));
  if (label) el.appendChild(h('span', { text: label }));
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

export function iconButton(iconName, opts = {}) { return button({ ...opts, iconName, iconOnly: true }); }

export function textBox({ value = '', placeholder = '', mono = false, multi = false, rows = 6, onInput = null, onEnter = null, width = null, spellcheck = false } = {}) {
  const el = h(multi ? 'textarea' : 'input', {
    class: 'tb' + (mono ? ' mono' : ''),
    type: multi ? null : 'text',
    placeholder, spellcheck, rows: multi ? rows : null,
    style: width ? { width } : null,
  });
  el.value = value ?? '';
  if (onInput) el.addEventListener('input', () => onInput(el.value, el));
  if (onEnter && !multi) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(el.value, el); } });
  return el;
}

/* ---------------- 选择框：自绘 WinUI 风格，不再用原生 <select> ----------------
 * 原生 select 的下拉列表由操作系统绘制（Windows 上是 Win32 菜单），跟 WinUIonWeb
 * 主题完全脱节，深色主题下还会闪白。这里自绘：按钮 + 挂到 body 的浮层。
 * 对外 API 与旧实现一致（options / value / onChange / width / title），
 * 额外提供 .value 读写、setValue(v, silent)、openMenu()、closeMenu()。
 */
const __comboClosers = new Set();   // 已打开的浮层，保证同一时刻只开一个

function comboOptions(raw) {
  return (raw || []).map((o) => {
    if (o && typeof o === 'object') {
      return {
        value: o.value,
        label: o.label == null ? String(o.value) : String(o.label),
        disabled: !!o.disabled,
        title: o.title || '',
      };
    }
    // 兼容只传字符串数组的调用（旧实现读 o.value 会得到 undefined，这里顺手修掉）
    return { value: o, label: String(o), disabled: false, title: '' };
  });
}

export function combo({ options = [], value = null, onChange = null, width = null, title = '' } = {}) {
  const items = comboOptions(options);
  let cur = value != null ? value : (items.length ? items[0].value : '');

  const labelEl = h('span.combo-label');
  const btn = h('button.combo-btn', { type: 'button', title, 'aria-haspopup': 'listbox' });
  btn.appendChild(labelEl);
  btn.appendChild(h('span.combo-chev'));
  const root = h('span.combo.combo-w', null, btn);
  if (width) btn.style.width = typeof width === 'number' ? width + 'px' : width;

  let pop = null;
  let hi = -1;

  const same = (a, b) => String(a) === String(b);
  const curItem = () => items.find((i) => same(i.value, cur)) || null;

  function syncLabel() {
    const it = curItem();
    labelEl.textContent = it ? it.label : (cur == null ? '' : String(cur));
    labelEl.classList.toggle('is-empty', !it && (cur == null || cur === ''));
  }

  function close() {
    if (!pop) return;
    pop.remove();
    pop = null;
    hi = -1;
    root.classList.remove('is-open');
    __comboClosers.delete(close);
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onDocDown(e) {
    if (pop && !pop.contains(e.target) && !root.contains(e.target)) close();
  }

  function onKey(e) {
    if (!pop) return;
    const n = items.length;
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      for (let k = 0; k < n; k++) {
        hi = (hi + d + n) % n;
        if (!items[hi].disabled) break;
      }
      paintHi();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (hi >= 0 && items[hi] && !items[hi].disabled) pick(items[hi]);
    }
  }

  function paintHi() {
    if (!pop) return;
    Array.from(pop.children).forEach((el, i) => el.classList.toggle('is-hi', i === hi));
    const el = pop.children[hi];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function pick(it) {
    cur = it.value;
    syncLabel();
    close();
    if (onChange) onChange(it.value, root);
    btn.focus();
  }

  function open() {
    if (pop) { close(); return; }
    for (const c of Array.from(__comboClosers)) c();   // 关掉别的浮层
    __comboClosers.add(close);

    pop = h('div.combo-pop', { role: 'listbox' });
    items.forEach((it, i) => {
      const on = same(it.value, cur);
      const o = h('button.combo-opt' + (on ? '.is-sel' : '') + (it.disabled ? '.is-dis' : ''), { type: 'button', title: it.title });
      o.appendChild(h('span.combo-opt-label', { text: it.label }));
      o.appendChild(h('span.combo-opt-tick', { text: on ? '✓' : '' }));
      if (!it.disabled) {
        o.addEventListener('mouseenter', () => { hi = i; paintHi(); });
        o.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); pick(it); });
      }
      pop.appendChild(o);
    });
    document.body.appendChild(pop);
    root.classList.add('is-open');

    // 定位：先贴在按钮下方，再按视口边界翻上去/收进来
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = Math.max(r.width, 160) + 'px';
    pop.style.left = Math.round(r.left) + 'px';
    pop.style.top = Math.round(r.bottom + 4) + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) {
      pop.style.top = Math.round(Math.max(8, r.top - pr.height - 4)) + 'px';
    }
    if (pr.right > window.innerWidth - 8) {
      pop.style.left = Math.round(Math.max(8, window.innerWidth - 8 - pr.width)) + 'px';
    }

    hi = items.findIndex((i) => same(i.value, cur));
    paintHi();
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  }

  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
  btn.addEventListener('keydown', (e) => {
    if (!pop && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); open(); }
  });

  syncLabel();

  Object.defineProperty(root, 'value', {
    get: () => cur,
    set: (v) => { cur = v; syncLabel(); },
  });
  root.setValue = (v, silent) => { cur = v; syncLabel(); if (!silent && onChange) onChange(cur, root); };
  root.openMenu = open;
  root.closeMenu = close;
  return root;
}

export function checkBox({ label = '', checked = false, onChange = null } = {}) {
  const input = h('input', { type: 'checkbox', checked });
  if (onChange) input.addEventListener('change', () => onChange(input.checked, input));
  return h('label.chk', null, [input, h('span', { text: label })]);
}

export function toggleSwitch({ label = '', checked = false, onChange = null } = {}) {
  const track = h('span.tsw-track', null, h('span.tsw-thumb'));
  const el = h('span', { class: 'tsw' + (checked ? ' on' : '') }, [track, label ? h('span', { text: label }) : null]);
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    if (onChange) onChange(on, el);
  });
  el.setValue = (v) => el.classList.toggle('on', !!v);
  return el;
}

export function progressRing(size = 18, cls = '') {
  return h('span', { class: `spin ${cls}`.trim(), style: { width: size + 'px', height: size + 'px' } });
}

export function badge(text, kind = '') {
  return h('span', { class: 'badge ' + kind, text });
}

export function statCard(label, value, sub = '') {
  return h('div.stat', null, [
    h('div.stat-num', { text: String(value) }),
    h('div.stat-lbl', { text: label }),
    sub ? h('div.tiny.muted', { text: sub }) : null,
  ]);
}

export function bar(fraction, color = null) {
  return h('div.bar', null, h('i', { style: { width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: color || null } }));
}

export function infoBar({ level = 'info', title = '', text = '', actions = [] } = {}) {
  const iconName = { info: 'info', success: 'check', warning: 'warn', error: 'close' }[level] || 'info';
  return h(`div.infobar.${level}`, null, [
    h('span.ib-ico', null, icon(iconName, 18)),
    h('div', { style: { flex: '1', minWidth: '0' } }, [
      title ? h('div.ib-title', { text: title }) : null,
      text ? h('div', { html: text }) : null,
    ]),
    actions.length ? h('div.row', null, actions) : null,
  ]);
}

export function tabs(items, activeKey, onSelect) {
  const el = h('div.tabs');
  for (const it of items) {
    const t = h('button.tab' + (it.key === activeKey ? '.is-active' : ''), { type: 'button' });
    t.textContent = it.label;
    if (it.count != null) t.appendChild(h('span.badge', { text: String(it.count), style: { marginLeft: '6px' } }));
    t.addEventListener('click', () => onSelect(it.key));
    el.appendChild(t);
  }
  return el;
}

export function codeBlock(text, { html = false } = {}) {
  return h('div.code', { html: html ? text : esc(text) });
}

/* ------------------------------ 对话框 / 提示 ------------------------------ */

export function dialog({ title = '', body = null, actions = null, width = null, onClose = null }) {
  const host = document.getElementById('dialogHost') || document.body;
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); onClose && onClose(v); resolve(v); };
    const foot = h('div.dlg-foot');
    const actList = actions || [
      { label: '取消', value: null, variant: 'default' },
      { label: '确定', value: true, variant: 'accent' },
    ];
    for (const a of actList) {
      foot.appendChild(button({
        label: a.label, variant: a.variant || 'default',
        onClick: () => close(typeof a.value === 'function' ? a.value() : a.value),
      }));
    }
    const dlg = h('div.dlg', { style: width ? { width } : null }, [
      h('div.dlg-head', { text: title }),
      h('div.dlg-body', null, body),
      actions === false ? null : foot,
    ]);
    const overlay = h('div.dlg-overlay', null, dlg);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    host.appendChild(overlay);
    const first = dlg.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    dlg.__close = close;
  });
}

export async function alertDialog(title, message, level = 'info') {
  return dialog({
    title,
    body: infoBar({ level, text: esc(message) }),
    actions: [{ label: '知道了', value: true, variant: 'accent' }],
  });
}

export async function confirmDialog(title, message, { okLabel = '确定', danger = false } = {}) {
  return dialog({
    title,
    body: h('div', { html: esc(message) }),
    actions: [
      { label: '取消', value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'accent' },
    ],
  });
}

export function toast(text, level = 'info') {
  const host = document.getElementById('flyoutHost') || document.body;
  const el = h('div.tip', { style: { left: '50%', bottom: '48px', transform: 'translateX(-50%)', top: 'auto', pointerEvents: 'none', zIndex: 1300 } });
  el.appendChild(h('span', { text }));
  if (level === 'error') el.style.borderColor = 'var(--SystemFillColorCriticalBrush,#c42b1c)';
  host.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/** 给元素挂一个延迟提示（用原生 title，简单可靠） */
export function withTip(el, text) { el.title = text; return el; }

/* ------------------------------ 剪贴板按钮 ------------------------------ */

export function copyButton(getText, label = '复制') {
  return button({
    label, variant: 'default', iconName: 'copy', small: true,
    onClick: async () => {
      const t = typeof getText === 'function' ? getText() : getText;
      const ok = await copy(t);
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择', ok ? 'info' : 'error');
    },
  });
}

export function downloadButton(getText, filename, label = '导出') {
  return button({
    label, variant: 'default', iconName: 'download', small: true,
    onClick: async () => {
      const { dl } = await import('../core/util.js');
      const t = typeof getText === 'function' ? getText() : getText;
      dl(filename, t);
      toast(`已导出 ${filename}`);
    },
  });
}

/** 空状态 */
export function emptyState(title, hint, action = null) {
  return h('div', { style: { padding: '36px 12px', textAlign: 'center', color: 'var(--text-secondary)' } }, [
    h('div', { style: { marginBottom: '8px', opacity: '.6' } }, icon('info', 30)),
    h('div', { style: { fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: 'var(--text-primary)' }, text: title }),
    h('div.tiny', { text: hint }),
    action ? h('div', { style: { marginTop: '14px' } }, action) : null,
  ]);
}

export function clearNode(node) { clear(node); }
