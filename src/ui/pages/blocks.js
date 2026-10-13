// pages/blocks.js —— 方块选择器（独立成页）
//
// 数据全部来自 zh.minecraft.wiki 取证（见 src/data/blocks.js 头部的取证记录）：
//   · 1.13+          → Java版数据值/方块ID            （命名空间 ID，1286 条）
//   · ≤1.12.2        → Java版数据值/扁平化前/方块ID   （数字 ID，256 条）
//   · Classic        → Java版数据值/Classic           （数字 ID，50 条）
// 图标用 wiki 原图（热链实测可用），不是自绘占位；图挂掉时才回退到 itemIcon() 的首字缩写。

import { h, clear, fmtNum, copy } from '../../core/util.js';
import { state, notify, setVersion } from '../../core/store.js';
import { searchEntries } from '../../core/fuzzy.js';
import { button, textBox, badge, infoBar, emptyState, toast, combo } from '../controls.js';
import { itemIcon } from '../item-icon.js';
import { parseVersion, isDatapackEra, versionOrder } from '../../core/versions.js';
import { buildGive, buildSetblock, findCommand, commandAvailable } from '../../core/commands.js';
import {
  BLOCKS_MODERN, BLOCKS_PREFLAT, BLOCKS_CLASSIC,
  BLOCK_ITEM_IDS, BLOCKS_STATS, BLOCKS_PROVENANCE, wikiIconUrl,
} from '../../data/blocks.js';

export const meta = {
  id: 'blocks',
  title: '方块',
  subtitle: '方块选择器 —— ID / 中文名 / 数字 ID 检索，图标取自 minecraft wiki，一键生成 setblock / fill / give',
  icon: 'grid',
};

/* ============================== 样式（幂等注入，不碰 app.css） ============================== */

const CSS = `
.blk-toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:10px 0 4px; }
.blk-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(184px,1fr)); gap:8px; margin-top:10px; }
.blk-cell { display:flex; gap:8px; align-items:center; padding:6px 8px; border-radius:var(--radius-md,6px);
  border:1px solid transparent; background:var(--subtle-tertiary, rgba(128,128,128,.10)); cursor:pointer;
  transition:background .12s ease, border-color .12s ease; min-width:0; }
.blk-cell:hover { background:var(--subtle-secondary, rgba(128,128,128,.18)); }
.blk-cell.is-sel { border-color:var(--accent-base,#4CC2FF); background:var(--subtle-secondary, rgba(128,128,128,.18)); }
.blk-ico { flex:0 0 auto; display:grid; place-items:center; }
.blk-ico-ph { width:100%; height:100%; border-radius:6px; background:var(--subtle-tertiary, rgba(128,128,128,.14)); }
.blk-meta { min-width:0; flex:1; }
.blk-name { font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.blk-id { font-size:11px; color:var(--text-secondary); font-family:var(--font-mono,Consolas,monospace);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.blk-hero { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
.blk-hero-ico { width:112px; height:112px; padding:8px; border-radius:var(--radius-lg,8px);
  background:var(--subtle-tertiary, rgba(128,128,128,.12)); display:grid; place-items:center; }
.blk-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:13px; align-content:start; }
.blk-kv dt { color:var(--text-secondary); }
.blk-kv dd { margin:0; color:var(--text-primary); font-family:var(--font-mono,Consolas,monospace); word-break:break-all; }
.blk-cmd + .blk-cmd { margin-top:10px; }
.blk-cmd-head { display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap; }
.blk-params { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin:12px 0 4px; }
.blk-param { display:flex; flex-direction:column; gap:4px; }
.blk-param > span { font-size:11px; color:var(--text-secondary); }
.blk-warn { color:var(--text-secondary); font-size:12px; }
`;

function ensureStyles() {
  if (document.getElementById('mce-blocks-style')) return;
  document.head.appendChild(h('style#mce-blocks-style', { text: CSS }));
}

/* ============================== 数据集（模块加载时构建一次） ============================== */

const DATA = {
  modern: BLOCKS_MODERN.map((b) => ({ ...b, iconUrl: wikiIconUrl(b.icon), hasItem: b.form !== 'none' })),
  preflat: BLOCKS_PREFLAT.map((b) => ({ ...b, iconUrl: wikiIconUrl(b.icon), hasItem: !/不能通过任何途径获得/.test(b.obtain || '') })),
  classic: BLOCKS_CLASSIC.map((b) => ({ ...b, iconUrl: wikiIconUrl(b.icon), hasItem: !/不能通过任何途径获得/.test(b.obtain || '') })),
};

/** 图标加载结果统计（真实取证：img 的 load/error 事件，每个 img 只计一次） */
const iconStats = { ok: 0, fail: 0, total: 0 };
const iconSeen = new Set();   // 加载成功的图标 URL

/**
 * 严格取某命令在某版本下的语法表单。
 *
 * 为什么不直接用 core/commands.js 的 formFor()：它最后一行是
 *   `return best || cmd.forms[cmd.forms.length - 1]`
 * —— 没有任何表单匹配该版本时会**落回最后一个表单**。对 /fill 来说，唯一记录的表单是 1.13+ 的，
 * 于是 1.12.2 会拿到 1.13 的语法（实测产出 `/fill ~ ~ ~ ~ ~2 ~ 1` 这种不存在的命令）。
 * 这正是「拿新版本的语法冒充旧版本」，本页拒绝这种兜底：匹配不到就如实报「未取证」。
 */
function strictForm(cmd, version) {
  if (!cmd || !cmd.forms || !cmd.forms.length) return null;
  const idx = versionOrder(version);
  let best = null;
  for (const f of cmd.forms) {
    if (versionOrder(f.since) > idx) continue;
    if (f.until && versionOrder(f.until) < idx) continue;
    if (!best || versionOrder(f.since) > versionOrder(best.since)) best = f;
  }
  return best;
}

/* ============================== 当前时代的判定 ============================== */

/**
 * 返回 { key, list, label, note }。
 * note 里的「未取证」是真实结论，不是措辞：远古版本的独立数字 ID 表本页没有取证。
 */
function eraFor(version) {
  const p = parseVersion(version);
  if (!version) {
    return { key: 'modern', list: DATA.modern, label: '未选择版本', note: '尚未选择版本，下面按 1.13+ 的命名空间 ID 表展示。选版本后会切换。' };
  }
  if (p.era === 'classic') {
    return {
      key: 'classic', list: DATA.classic, label: `Classic（${version}）`,
      note: 'Classic 有自己独立的数字 ID 表，本页用的是 wiki「Java版数据值/Classic」那张表，共 50 条（Dec 0–49）。',
    };
  }
  if (p.era) {
    return {
      key: 'ancient-missing', list: [], label: `${version}（远古版本）`,
      note: `**未取证**：${version} 属于 ${p.era} 时代，它的数字 ID 表与 Classic、与 ≤1.12.2 的表都不同。`
        + '本页只取证了 Classic 与 ≤1.12.2 两张表，没有拿到这个时代的独立表，因此**不拿别的表顶替**。'
        + '可以切到 Classic 时代或 1.12.2 查看已取证的数据。',
    };
  }
  if (isDatapackEra(version)) {
    return {
      key: 'modern', list: DATA.modern, label: `1.13+（${version}）`,
      note: `1.13 起方块扁平化为命名空间 ID。本表取证自 wiki「Java版数据值/方块ID」，共 ${fmtNum(DATA.modern.length)} 条。`,
    };
  }
  return {
    key: 'preflat', list: DATA.preflat, label: `≤1.12.2（${version}）`,
    note: `1.13 之前方块用数字 ID + 数据值。本表取证自 wiki「Java版数据值/扁平化前/方块ID」，共 ${fmtNum(DATA.preflat.length)} 条（含 1.13 已改名的旧 ID）。`,
  };
}

/* ============================== 页面状态 ============================== */

const PAGE = 96;
let ui = {
  q: '', page: 0, filter: 'all',
  pos: '~ ~ ~', fillFrom: '~ ~ ~', fillTo: '~ ~2 ~', targets: '@s', count: 1,
};
let sel = null;                 // 当前选中的方块
let combined = null;            // 合并去重后的展示条目（同一 ID 只留一条）

/**
 * 同一数据集里可能有重复 ID，合并成一个候选，保留最小 Dec。
 * 注意：≤1.12.2 表里 dec 253 / 254 两行是 wiki 标注的「（未使用）」占位，命名空间 ID 列**本来就是空的**——
 * 不能因为 id 都是空串就把它们合成一条，所以键取 `id || 'dec:'+dec`（忠实于 wiki，又不丢行）。
 */
function combine(list) {
  const map = new Map();
  for (const b of list) {
    const key = b.id || `dec:${b.dec}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, { ...b, key, decs: b.dec == null ? [] : [b.dec] }); continue; }
    if (b.dec != null && !prev.decs.includes(b.dec)) prev.decs.push(b.dec);
    if (b.iconUrl && !prev.iconUrl) { prev.iconUrl = b.iconUrl; prev.icon = b.icon; }
  }
  return [...map.values()];
}

/* ============================== 图标懒加载 ============================== */

let io = null;
function observer() {
  if (io) return io;
  if (typeof IntersectionObserver !== 'function') return null;
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      if (en.target.__reveal) en.target.__reveal();
      io.unobserve(en.target);
    }
  }, { rootMargin: '400px 0px' });
  return io;
}

/** 懒加载图标格子：进入视口才真的去请求 wiki 图片（避免一次拉几百张） */
function lazyIcon(entry, size) {
  const box = h('div.blk-ico', { style: { width: `${size}px`, height: `${size}px` } });
  const draw = () => {
    if (box.__done) return;
    box.__done = true;
    clear(box);
    if (!entry.iconUrl) {
      // wiki 表里图标单元格本来就是空的（air / cave_air / moving_piston / void_air）
      box.appendChild(itemIcon({ id: entry.id, name: entry.name }, size));
      return;
    }
    const node = itemIcon({ id: entry.id, name: entry.name, icon: entry.iconUrl }, size);
    const img = node.querySelector('img');
    if (img) {
      const record = (ok) => {
        if (box.__counted) return;
        box.__counted = true;
        iconStats.total++;
        if (ok) { iconStats.ok++; iconSeen.add(entry.iconUrl); } else iconStats.fail++;
      };
      img.addEventListener('load', () => record(true), { once: true });
      img.addEventListener('error', () => record(false), { once: true });
      if (img.complete) record(img.naturalWidth > 0);
    }
    box.appendChild(node);
  };
  box.__reveal = draw;
  const ob = observer();
  if (ob) { box.appendChild(h('div.blk-ico-ph')); ob.observe(box); }
  else draw();
  return box;
}

/* ============================== 页面渲染 ============================== */

export function render(root) {
  ensureStyles();
  clear(root);

  const era = eraFor(state.version);
  combined = combine(era.list);
  if (sel && !combined.some((b) => b.key === sel.key)) sel = null;

  root.appendChild(headerCard(era));
  publishHook(era);

  if (era.key === 'ancient-missing') {
    root.appendChild(ancientCard(era));
    return;
  }

  root.appendChild(searchCard(era));
  root.appendChild(detailCard(era));
}

function rerender() {
  const r = document.getElementById('pageView');
  if (r && r.__pageRender) r.__pageRender();
}

/* -------- 头部：取证信息 -------- */

function headerCard(era) {
  const counts = BLOCKS_PROVENANCE.counts;
  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '方块数据（来自 minecraft wiki 取证）' }),
        h('p.card-sub', {
          text: `数据源 ${BLOCKS_PROVENANCE.host} · 来源页：${BLOCKS_PROVENANCE.pages.join('、')} · 抓取时间 ${BLOCKS_PROVENANCE.fetchedAt}`,
        }),
      ]),
      h('div.row', null, [
        badge(`1.13+ ${fmtNum(counts.modern)} 条`, 'ok'),
        badge(`≤1.12.2 ${fmtNum(counts.preflat)} 条`, ''),
        badge(`Classic ${fmtNum(counts.classic)} 条`, ''),
      ]),
    ]),
    infoBar({ level: 'info', title: `当前版本 ${state.version || '未选择'} → ${era.label}`, text: era.note.replace(/\*\*/g, '').replace(/\n/g, ' ') }),
    h('div.row', { style: { marginTop: '10px' } }, [
      h('span.tiny.muted', { text: `图标：wiki 原图热链（实测 naturalWidth=300）。方块物品条目 ${fmtNum(BLOCKS_STATS.blockItems)} 条已被本页接管，应从「选择器」页的物品列表里移除。` }),
    ]),
  ]);
}

/* -------- 远古版本：未取证 -------- */

function ancientCard(era) {
  return h('div.card', null, [
    h('div.card-head', null, [h('h2.card-title', { text: '这个时代的方块表「未取证」' })]),
    infoBar({
      level: 'warning',
      title: `${state.version} 的数字 ID 表没有取证`,
      text: era.note.replace(/\*\*/g, ''),
    }),
    h('div.row', { style: { marginTop: '12px' } }, [
      button({ label: '切到 Classic 时代（已取证）', variant: 'accent', iconName: 'grid', onClick: () => switchVersion('c0.30_01c') }),
      button({ label: '切到 1.12.2（扁平化前数字 ID）', onClick: () => switchVersion('1.12.2') }),
      button({ label: '切到 1.13+（命名空间 ID）', onClick: () => switchVersion('1.13') }),
    ]),
  ]);
}

function switchVersion(v) {
  setVersion(v);
  notify('version');
  notify('navigate');
  toast(`已切换到 ${v}`);
}

/* -------- 搜索 + 候选列表 -------- */

function searchCard(era) {
  const listHost = h('div');
  const countBadge = badge('', '');
  const pageInfo = h('span.tiny.muted');
  const prevBtn = button({ label: '上一页', small: true, onClick: () => { ui.page--; refresh(); } });
  const nextBtn = button({ label: '下一页', small: true, onClick: () => { ui.page++; refresh(); } });

  function filtered() {
    let rows = combined;
    if (ui.filter === 'item') rows = rows.filter((b) => b.hasItem);
    else if (ui.filter === 'blockonly') rows = rows.filter((b) => !b.hasItem);
    if (!ui.q.trim()) return rows;
    // 搜索排序统一走 fuzzy.searchEntries；数字 ID 通过 aliases 参与匹配
    const hit = searchEntries(rows, ui.q, {
      aliasesOf: (e) => (e.decs && e.decs.length ? e.decs.map(String) : (e.dec != null ? [String(e.dec)] : [])),
      limit: rows.length,
    });
    return hit;
  }

  function refresh() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (ui.page >= pages) ui.page = 0;
    const slice = rows.slice(ui.page * PAGE, ui.page * PAGE + PAGE);

    clear(listHost);
    if (!slice.length) {
      listHost.appendChild(emptyState('没有匹配的方块', ui.q ? `换个关键词试试（当前版本 ${state.version}）` : '当前筛选条件下没有条目'));
    } else {
      const grid = h('div.blk-grid');
      for (const b of slice) grid.appendChild(cell(b, era));
      listHost.appendChild(grid);
    }
    countBadge.textContent = `匹配 ${fmtNum(rows.length)} / ${fmtNum(combined.length)}`;
    countBadge.className = 'badge' + (rows.length ? ' ok' : ' no');
    pageInfo.textContent = `${ui.page + 1} / ${pages}`;
    prevBtn.disabled = ui.page === 0;
    nextBtn.disabled = ui.page >= pages - 1;
  }

  const tb = textBox({
    placeholder: `搜索方块：中文名 / 命名空间 ID / 数字 ID…（当前 ${fmtNum(combined.length)} 条）`,
    onInput: (v) => { ui.q = v; ui.page = 0; refresh(); },
  });
  tb.value = ui.q;

  const filterCombo = combo({
    options: [
      { value: 'all', label: '全部方块' },
      { value: 'item', label: '有物品形式（可 /give）' },
      { value: 'blockonly', label: '没有物品形式' },
    ],
    value: ui.filter,
    width: 200,
    title: '按物品形式筛选',
    onChange: (v) => { ui.filter = v; ui.page = 0; refresh(); },
  });

  setTimeout(refresh, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '检索方块' }),
      h('div.row', null, [countBadge, prevBtn, pageInfo, nextBtn]),
    ]),
    h('div.blk-toolbar', null, [
      h('div', { style: { flex: '1', minWidth: '240px' } }, tb),
      filterCombo,
    ]),
    listHost,
  ]);
}

function cell(b, era) {
  const el = h('div.blk-cell' + (sel && sel.key === b.key ? '.is-sel' : ''), {
    dataset: { blockId: b.id, blockKey: b.key },
    title: `${b.name}\n${b.id || '（wiki 未给命名空间 ID）'}${b.dec != null ? `\n数字 ID ${b.dec}` : ''}`,
  });
  el.appendChild(lazyIcon(b, 34));
  const idLine = era.key === 'modern'
    ? `minecraft:${b.id}`
    : (era.key === 'classic' ? `#${b.dec}` : `#${b.dec} ${b.id || '（未使用）'}`);
  el.appendChild(h('div.blk-meta', null, [
    h('div.blk-name', { text: b.name }),
    h('div.blk-id', { text: idLine }),
  ]));
  el.addEventListener('click', () => {
    sel = b;
    document.querySelectorAll('.blk-cell').forEach((n) => n.classList.toggle('is-sel', n.dataset.blockKey === b.key));
    const r = document.getElementById('pageView');
    if (r && r.__pageRender) r.__pageRender();
    // 选中后滚回详情区
    setTimeout(() => { const d = document.getElementById('blkDetail'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'start' }); }, 0);
  });
  return el;
}

/* -------- 选中详情 + 命令生成 -------- */

function detailCard(era) {
  const card = h('div.card#blkDetail');
  if (!sel) {
    card.appendChild(h('p.card-sub', { style: { margin: '0' }, text: '点选任意方块后，这里给出大图、取证信息，以及可直接复制的 /setblock、/fill、/give。' }));
    return card;
  }
  const b = sel;
  const idLine = era.key === 'modern' ? `minecraft:${b.id}` : (era.key === 'classic' ? `#${b.dec}` : `#${b.dec} ${b.id}`);

  card.appendChild(h('div.card-head', null, [
    h('h2.card-title', { text: `已选中：${b.name}` }),
    h('div.row', null, [
      badge(era.key === 'modern' ? '命名空间 ID' : '数字 ID', 'accent'),
      badge(b.hasItem ? '有物品形式' : '没有物品形式', b.hasItem ? 'ok' : 'no'),
    ]),
  ]));

  // 大图
  const heroIco = h('div.blk-hero-ico');
  heroIco.appendChild(lazyIcon(b, 96));

  const facts = h('dl.blk-kv', null, [
    h('dt', { text: '名称' }), h('dd', { text: b.name }),
    h('dt', { text: '命名空间 ID' }), h('dd', { text: era.key === 'classic' ? '（Classic 时代没有命名空间 ID）' : `minecraft:${b.id}` }),
    h('dt', { text: '数字 ID' }), h('dd', { text: b.dec == null ? '—' : String(b.dec) }),
    h('dt', { text: '旧数字 ID' }), h('dd', { text: b.legacy == null ? '—' : String(b.legacy) }),
    h('dt', { text: '物品形式' }), h('dd', { text: b.formText || (b.obtain ? `wiki 标注：${b.obtain}` : '（1.13 前的表没有这一列）') }),
    h('dt', { text: 'wiki 图标文件' }), h('dd', { text: b.icon || '（wiki 表里该行图标为空）' }),
  ]);

  card.appendChild(h('div.blk-hero', null, [heroIco, facts]));

  if (b.iconUrl) {
    card.appendChild(h('div.row', { style: { marginTop: '8px' } }, [
      h('span.tiny.muted', { text: '图标 URL：' }),
      h('a.mono.tiny', { href: b.iconUrl, target: '_blank', rel: 'noreferrer', text: b.iconUrl }),
    ]));
  }

  // 参数输入（可直接改、能回填）
  const posBox = textBox({ value: ui.pos, mono: true, onInput: (v) => { ui.pos = v; paintCmds(); }, width: '150px' });
  const fromBox = textBox({ value: ui.fillFrom, mono: true, onInput: (v) => { ui.fillFrom = v; paintCmds(); }, width: '150px' });
  const toBox = textBox({ value: ui.fillTo, mono: true, onInput: (v) => { ui.fillTo = v; paintCmds(); }, width: '150px' });
  const tgtBox = textBox({ value: ui.targets, mono: true, onInput: (v) => { ui.targets = v; paintCmds(); }, width: '110px' });
  const cntBox = textBox({ value: String(ui.count), mono: true, onInput: (v) => { ui.count = Number(v) || 1; paintCmds(); }, width: '80px' });

  const param = (label, box) => h('label.blk-param', null, [h('span', { text: label }), box]);

  card.appendChild(h('div.blk-params', null, [
    param('/setblock 坐标', posBox),
    param('/fill 起点', fromBox),
    param('/fill 终点', toBox),
    param('/give 目标', tgtBox),
    param('/give 数量', cntBox),
  ]));

  const cmdHost = h('div');
  card.appendChild(cmdHost);

  /** 生成三条命令（已用仓库里取证过的语法表单，绝不手写模板） */
  function build() {
    const out = [];
    const isModern = era.key === 'modern';
    const blockArg = isModern ? `minecraft:${b.id}` : String(b.dec);
    const V = state.version;

    // /setblock
    const sb = findCommand('setblock');
    if (sb && !commandAvailable(sb, V)) out.push({ name: 'setblock', missing: `该版本还没有 /setblock（自 ${sb.since} 起可用）` });
    else out.push({ name: 'setblock', text: '/' + buildSetblock(V, { pos: ui.pos, block: blockArg }) });

    // /fill —— 只认真正匹配该版本的表单。1.13+ 的表单取证过；
    // ≤1.12.2 的表单在本仓库和 wiki 的「命令/fill」页面都没有记录，因此这里明确报「未取证」。
    const fl = findCommand('fill');
    const fillForm = strictForm(fl, V);
    if (fl && !commandAvailable(fl, V)) out.push({ name: 'fill', missing: `该版本还没有 /fill（自 ${fl.since} 起可用）` });
    else if (!fillForm) out.push({ name: 'fill', unverified: `**未取证**：/fill 在 ${V} 使用的语法，本仓库的取证表和 wiki 的「命令/fill」页面都只记录了 1.13+ 的形式，所以这里不给推测出来的命令。` });
    else out.push({ name: 'fill', text: '/' + fillForm.template({ from: ui.fillFrom, to: ui.fillTo, block: blockArg }) });

    // /give —— 只有「有物品形式」的方块才能给
    const gv = findCommand('give');
    if (!b.hasItem) {
      out.push({
        name: 'give',
        missing: b.form === 'none'
          ? '**未取证/不适用**：wiki 的「物品形式」列写的是「没有物品形式」，这个方块给不出来。'
          : `**不适用**：wiki 标注「${b.obtain}」，这个方块拿不到物品形式。`,
      });
    } else if (gv && !commandAvailable(gv, V)) {
      out.push({ name: 'give', missing: `该版本还没有 /give（自 ${gv.since} 起可用）` });
    } else {
      const itemArg = isModern ? `minecraft:${b.form === 'same' ? b.id : (b.item || b.id)}` : String(b.dec);
      out.push({ name: 'give', text: '/' + buildGive(V, { targets: ui.targets, item: itemArg, count: ui.count }) });
    }
    return out;
  }

  function paintCmds() {
    clear(cmdHost);
    for (const c of build()) {
      const block = h('div.blk-cmd');
      block.appendChild(h('div.blk-cmd-head', null, [
        badge('/' + c.name, 'accent'),
        c.text ? h('span.tiny.muted', { text: `按 ${state.version} 的语法` }) : null,
        h('span.spacer'),
        c.text ? button({
          label: '复制', small: true, iconName: 'copy',
          onClick: async () => { (await copy(c.text)) ? toast('已复制命令') : toast('复制失败', 'error'); },
        }) : null,
        c.text ? button({
          label: '送进命令编辑器', small: true, iconName: 'terminal',
          onClick: () => { state.commandDraft = c.text; state.page = 'commands'; notify('navigate'); },
        }) : null,
      ]));
      if (c.text) block.appendChild(h('div.code', { text: c.text }));
      else {
        block.appendChild(h('div.blk-warn', { text: String(c.missing || c.unverified || '').replace(/\*\*/g, '') }));
      }
      cmdHost.appendChild(block);
    }
  }
  setTimeout(paintCmds, 0);

  card.appendChild(h('div.row', { style: { marginTop: '12px' } }, [
    button({
      label: '复制 ID', small: true, iconName: 'copy',
      onClick: async () => { (await copy(idLine)) ? toast('已复制 ID') : toast('复制失败', 'error'); },
    }),
    button({
      label: '复制全部命令', small: true, iconName: 'copy',
      onClick: async () => {
        const txt = build().filter((c) => c.text).map((c) => c.text).join('\n');
        if (!txt) { toast('当前没有可用的命令', 'error'); return; }
        (await copy(txt)) ? toast('已复制全部命令') : toast('复制失败', 'error');
      },
    }),
    button({ label: '去物品选择器', small: true, iconName: 'box', onClick: () => { state.page = 'pickers'; notify('navigate'); } }),
  ]));

  return card;
}

/* ============================== 给 CDP 测试用的钩子 ============================== */

function publishHook(era) {
  window.__MCE_BLOCKS__ = {
    era: era.key,
    version: state.version,
    total: combined.length,
    page: ui.page,
    selected: sel ? { id: sel.id, key: sel.key, name: sel.name, dec: sel.dec, icon: sel.iconUrl } : null,
    stats: BLOCKS_STATS,
    provenance: BLOCKS_PROVENANCE,
    iconStats,
    iconSeen,
    /** 把当前页所有还没画出来的图标立刻画出来（测试用，绕过视口判定） */
    revealAll() {
      document.querySelectorAll('.blk-ico').forEach((n) => { if (n.__reveal) n.__reveal(); });
      return document.querySelectorAll('.blk-ico img').length;
    },
    /** 断言用：统计当前 DOM 里 <img> 的真实加载情况 */
    imgReport() {
      const imgs = [...document.querySelectorAll('.blk-ico img')];
      return {
        count: imgs.length,
        loaded: imgs.filter((i) => i.naturalWidth > 0).length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
        sample: imgs.slice(0, 5).map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })),
      };
    },
    /** 以编程方式选中一个方块，便于断言命令生成 */
    select(id) {
      const b = combined.find((x) => x.key === id || x.id === id);
      if (!b) return false;
      sel = b;
      rerender();
      return true;
    },
  };
}

export function statsLine() {
  return `方块 ${fmtNum(DATA.modern.length)}（1.13+）+ ${fmtNum(DATA.preflat.length)}（≤1.12.2）+ ${fmtNum(DATA.classic.length)}（Classic）`;
}

void BLOCK_ITEM_IDS;
void rerender;
