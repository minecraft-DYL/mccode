// shell.js —— NavigationView 外壳、页面路由、状态栏

import { h, clear, fmtNum } from '../core/util.js';
import { state, subscribe, notify, setTheme, toggleTheme, versionLabel, pushStatus } from '../core/store.js';
import { STATUS_LABEL } from '../core/capabilities.js';
import { SOURCE_LABEL } from '../core/registry.js';
import { icon, button, toast } from './controls.js';

import * as overview from './pages/overview.js';
import * as versions from './pages/versions.js';
import * as matrix from './pages/matrix.js';
import * as pickers from './pages/pickers.js';
import * as blocks from './pages/blocks.js';
import * as nbt from './pages/nbt.js';
import * as components from './pages/components.js';
import * as commands from './pages/commands.js';
import * as output from './pages/output.js';

const NAV = [
  { group: '前置', items: [overview, versions, matrix] },
  { group: '编辑', items: [pickers, blocks, nbt, components, commands] },
  { group: '产出', items: [output] },
];

const PAGES = new Map(NAV.flatMap((g) => g.items.map((p) => [p.meta.id, p])));

let currentRender = null;

export function mount() {
  // 支持深链接：#matrix / #commands …
  const initial = location.hash.replace(/^#/, '');
  if (PAGES.has(initial)) state.page = initial;

  buildNav();
  bindChrome();
  subscribe((what) => {
    if (what === 'navigate' || what === 'version' || what === 'versions') renderPage();
    if (what === 'registry' || what === 'registry:busy' || what === 'status') updateStatusBar();
    if (what === 'theme') updateThemeButton();
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (PAGES.has(id) && id !== state.page) { state.page = id; renderPage(); }
  });
  renderPage();
  updateStatusBar();
  updateThemeButton();
  startClock();
}

/* ------------------------------ 导航 ------------------------------ */

function buildNav() {
  const host = document.getElementById('navItems');
  clear(host);
  for (const g of NAV) {
    host.appendChild(h('div.nv-group-label', { text: g.group }));
    for (const p of g.items) {
      const item = h('div.nv-item', { dataset: { page: p.meta.id }, title: p.meta.subtitle || p.meta.title }, [
        h('span.nv-ico', null, icon(p.meta.icon, 18)),
        h('span.nv-label', { text: p.meta.title }),
      ]);
      item.addEventListener('click', () => go(p.meta.id));
      host.appendChild(item);
    }
  }
  syncNavActive();
}

function syncNavActive() {
  document.querySelectorAll('.nv-item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.page === state.page);
  });
}

function go(id) {
  if (!PAGES.has(id)) return;
  state.page = id;
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  renderPage();
}

export function currentPage() { return state.page; }

/* ------------------------------ 页面渲染 ------------------------------ */

function renderPage() {
  const page = PAGES.get(state.page) || overview;
  state.page = page.meta.id;

  document.getElementById('pageTitle').textContent = page.meta.title;
  document.getElementById('pageSubtitle').textContent = page.meta.subtitle || '';
  document.title = `${page.meta.title} · MC 编辑器`;

  const actions = document.getElementById('pageActions');
  clear(actions);
  actions.appendChild(button({ iconName: 'reload', iconOnly: true, small: true, title: '重新渲染当前页', onClick: () => renderPage() }));
  actions.appendChild(button({ iconName: state.theme === 'dark' ? 'sun' : 'moon', iconOnly: true, small: true, title: '切换明暗主题', onClick: () => toggleTheme() }));

  const root = document.getElementById('pageView');
  root.__pageRender = renderPage;
  try {
    page.render(root);
    currentRender = page;
  } catch (e) {
    clear(root);
    root.appendChild(h('div.card', null, [
      h('h2.card-title', { text: '这个页面渲染出错了' }),
      h('div.code', { text: String(e && e.stack || e) }),
      h('div.row', { style: { marginTop: '10px' } }, [button({ label: '重试', variant: 'accent', small: true, onClick: () => renderPage() })]),
    ]));
    // eslint-disable-next-line no-console
    console.error('[shell] 页面渲染失败', e);
  }
  syncNavActive();
  updateStatusBar();
  document.getElementById('pageScroll').scrollTop = 0;
}

/* ------------------------------ 状态栏 ------------------------------ */

function updateStatusBar() {
  const v = document.getElementById('sbVersion');
  v.textContent = versionLabel();

  const reg = state.registry;
  document.getElementById('sbRegistry').textContent = reg
    ? `注册表：物品 ${fmtNum(reg.items.length)} / 实体 ${fmtNum(reg.entities.length)} / 粒子 ${fmtNum(reg.particles.length)}`
    : '注册表：未检索';

  document.getElementById('sbSource').textContent = `数据源：${reg ? (SOURCE_LABEL[reg.source] || reg.source) : (SOURCE_LABEL[state.registrySource] || state.registrySource)}`;

  const brand = document.getElementById('brandVersion');
  if (brand) brand.textContent = state.version || '未选择版本';

  document.getElementById('registryHint').textContent = reg ? `${fmtNum(reg.items.length)} 物品` : '注册表未加载';
}

function startClock() {
  const el = document.getElementById('sbClock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('zh-CN'); };
  tick(); setInterval(tick, 1000);
}

/* ------------------------------ 顶栏交互 ------------------------------ */

function bindChrome() {
  document.getElementById('themeToggle').addEventListener('click', () => toggleTheme());
  document.getElementById('reloadRegistry').addEventListener('click', async () => {
    const { loadRegistry } = await import('../core/store.js');
    if (!state.version) { toast('请先选择版本', 'error'); return; }
    await loadRegistry({ force: true });
  });

  const search = document.getElementById('navSearch');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('.nv-item').forEach((el) => {
      const page = PAGES.get(el.dataset.page);
      const hit = !q || page.meta.title.toLowerCase().includes(q) || (page.meta.subtitle || '').toLowerCase().includes(q);
      el.classList.toggle('hidden', !hit);
    });
    document.querySelectorAll('.nv-group-label').forEach((el) => {
      let n = el.nextElementSibling, any = false;
      while (n && !n.classList.contains('nv-group-label')) {
        if (n.classList.contains('nv-item') && !n.classList.contains('hidden')) any = true;
        n = n.nextElementSibling;
      }
      el.classList.toggle('hidden', !any);
    });
  });

  // 快捷键
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.key === 'F5') return;
    const map = { '1': 'overview', '2': 'versions', '3': 'matrix', '4': 'pickers', '5': 'nbt', '6': 'components', '7': 'commands', '8': 'output' };
    if (e.ctrlKey && map[e.key]) {
      e.preventDefault();
      // Ctrl+滚轮缩放已由节点图处理；这里留空避免冲突
    }
    if (e.altKey && map[e.key]) { e.preventDefault(); go(map[e.key]); }
  });

  // 双击状态栏 → 打开日志
  document.getElementById('statusBar').addEventListener('dblclick', async () => {
    const { dialog } = await import('./controls.js');
    const body = h('div.code', { style: { maxHeight: '400px' } });
    body.innerHTML = state.status.map((s) => {
      const c = { error: '#ff8a80', warning: '#ffcc80', success: '#b5e8a0' }[s.level] || 'var(--text-secondary)';
      return `<div style="color:${c}">${new Date(s.at).toLocaleTimeString('zh-CN')} · ${String(s.text).replace(/[<>&]/g, '')}</div>`;
    }).join('') || '（无日志）';
    dialog({ title: '运行日志', body, actions: [{ label: '关闭', value: true, variant: 'accent' }], width: '680px' });
  });

  pushStatus('外壳已挂载。按 Alt+数字键可在页面间快速切换。');
}

function updateThemeButton() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  clear(btn);
  btn.appendChild(icon(state.theme === 'dark' ? 'sun' : 'moon', 16));
}

void setTheme; void STATUS_LABEL; void currentRender;
