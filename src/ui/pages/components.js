// pages/components.js —— 物品组件编辑器（Data Components，1.20.5 / 24w09a 起）
// 版本感知：< 1.20.5 时提示改用 NBT；>= 1.20.5 生成 [key=value,...] 语法

import { h, clear, copy, esc } from '../../core/util.js';
import { state, notify, capAvailable, capLabel, saveDrafts } from '../../core/store.js';
import { stackSyntax, buildGive, nbtToComponents, componentsToNbt, splitTopLevel, indexOfTopLevel } from '../../core/commands.js';
import { parseSNBT, toSNBT, COMPONENT_SNIPPETS } from '../../core/nbt.js';
import { button, textBox, badge, infoBar, combo, toast, emptyState } from '../controls.js';
import { ALL_COMPONENTS, toCatalogEntry, componentById, searchComponents } from '../../data/components-wiki.js';
import { highlightArea, highlightJSONish } from '../snbt-highlight.js';
import { enableSnbtAutocomplete, componentKeyCandidates, ensureStyles } from '../autocomplete.js';
import { createGraph } from '../../graph/nodegraph.js';
import { graphFromJson, jsonFromGraph, jsonGraphTypes, jsonGraphPorts } from '../../graph/json-graph.js';
import { nbtToPlain, plainToNbt } from '../nbt-json-bridge.js';

/* ---- 组件值高亮层的样式（同样幂等注入，绝不改 src/app.css） ---- */
const COMP_CSS = `
.comp-val-wrap { position: relative; display: block; }
.comp-val-wrap .comp-val-hl {
  position: absolute; inset: 0; pointer-events: none; overflow: hidden; white-space: pre;
  padding: 6px 11px; box-sizing: border-box;
  font-family: var(--font-mono, Consolas, monospace); font-size: 12.5px; line-height: 20px;
  border: 1px solid transparent; color: var(--text-primary); border-radius: var(--radius-md, 6px);
}
.comp-val-wrap .comp-val-edit {
  position: relative; background: transparent; color: transparent; caret-color: var(--text-primary);
  font-family: var(--font-mono, Consolas, monospace);
}
.comp-val-wrap .comp-val-edit::selection { background: rgba(0,103,192,.42); }
.comp-val-wrap .comp-val-edit::placeholder { color: var(--text-tertiary, #888); }
`;
function ensureCompStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('mce-comp-style')) return;
  document.head.appendChild(h('style#mce-comp-style', { text: COMP_CSS }));
}

/**
 * 组件键输入框：自绘 WinUI 控件 + NBT 键补全（候选带中文名）。
 * 原先是纯 textBox，这里加一层补全，不改它的外观与 .value 语义。
 */
function componentKeyInput(comp, onInput) {
  const el = textBox({ value: comp.key, onInput, width: '190px' });
  el.classList.add('mono');
  enableSnbtAutocomplete(el, { mode: 'component-key' });
  return el;
}

/**
 * 组件值输入框：JSON/SNBT 高亮 + 值补全。
 * 做法是「单行输入框 + 下层高亮浮层」：输入框文字透明、高亮层显示着色后的同一段文本，
 * 同字体同内边距同 white-space，所以光标位置严格对齐 —— 既有高亮又保住单行输入手感。
 */
function componentValueInput(comp, onInput, catalog) {
  ensureCompStyles();
  const wrap = h('div.comp-val-wrap');
  const paint = h('div.comp-val-hl', { 'aria-hidden': 'true' });
  const el = textBox({
    value: comp.value, mono: true,
    placeholder: catalog ? `例：${catalog.sample}` : '值（SNBT / JSON）',
    onInput: (v) => { paint.innerHTML = highlightJSONish(v) + '&nbsp;'; onInput(v); },
  });
  el.classList.add('comp-val-edit');
  paint.innerHTML = highlightJSONish(comp.value || '') + '&nbsp;';
  el.addEventListener('scroll', () => { paint.scrollLeft = el.scrollLeft; });
  wrap.appendChild(paint);
  wrap.appendChild(el);
  enableSnbtAutocomplete(el, { mode: 'component-value' });
  return wrap;
}

export const meta = {
  id: 'components',
  title: '物品组件',
  subtitle: '1.20.5 起取代物品 NBT 的数据组件：结构化编辑 + 一键迁移旧 NBT',
  icon: 'puzzle',
};

/** 物品数据组件目录 —— 全量 121 条（89 常规 + 29 实体变种 + 3 临时）
 *  逐条抄自 zh.minecraft.wiki「数据组件」section=6「数据组件类型」，不再手工挑常用项。 */
const COMPONENT_CATALOG = ALL_COMPONENTS.map(toCatalogEntry);

let comps = null; // [{key, value}]
let itemId = 'minecraft:diamond_sword';
let count = 1;

export function render(root) {
  clear(root);
  if (comps === null) comps = parseDraft(state.componentDraft) || [
    { key: 'custom_name', value: '"我的物品"' },
    { key: 'enchantments', value: '{levels:{"minecraft:sharpness":5}}' },
  ];

  const style = stackSyntax(state.version);
  if (style === 'nbt') {
    root.appendChild(infoBar({
      level: 'warning',
      title: `${state.version} 还不支持数据组件`,
      text: `数据组件自 1.20.5（24w09a）起引入；当前版本请使用 NBT 语法（<code>item{NBT}</code>）。下面仍会按旧语法生成命令，或者你可以在下方把组件反向转换成 NBT。`,
      actions: [button({ label: '去 NBT 编辑器', small: true, variant: 'accent', onClick: () => { state.page = 'nbt'; notify('navigate'); } })],
    }));
  } else if (!capAvailable('components')) {
    root.appendChild(infoBar({ level: 'error', title: '当前版本不支持物品组件', text: `能力状态：${capLabel('components')}` }));
  }

  root.appendChild(itemCard());
  root.appendChild(componentCard());
  root.appendChild(graphCard());
  root.appendChild(migrateCard());
}

/* ============================ 组件节点图视图 ============================ */
// 用户要求「所有编辑器都换成节点图，但只保留原有的 JSON 高亮」——
// 所以这里做成【可切换视图】：组件列表照旧（值仍有 JSON 高亮），另加一个节点图视图。
// 组件对象 {key: 值} → 节点图；图上改值 → 回写 comps 并重渲染命令。

let compGraphOn = false;

function graphCard() {
  ensureStyles();
  const host = h('div.comp-graph-host', { dataset: { compGraph: '1' } });
  const note = h('div.tiny.muted', { style: { marginTop: '6px' } });
  const hostWrap = h('div', { style: { display: compGraphOn ? '' : 'none' } }, [host, note]);

  const toggle = button({
    label: compGraphOn ? '收起节点图' : '节点图',
    small: true, variant: compGraphOn ? 'accent' : 'subtle',
    title: '把 {组件: 值} 显示成节点图；在图上改值会回写组件列表',
    onClick: () => { compGraphOn = !compGraphOn; rerender(); },
  });

  function mount() {
    clear(host);
    if (!compGraphOn) return;
    // 组件的值本身是 SNBT/JSON 文本，尽量解析成对象再建图；解析不了就记下来按原文回写。
    // 注意：进图前统一走 nbtToPlain —— 宿主的 graphFromJson 会把 NBTNumber（typeof 是 object）
    // 误判成容器，把 `1b` 变成 `{suffix:"b"}`；降级成纯 JSON 后还得靠类型表还原。
    const obj = {};
    const rawKeys = new Set();
    for (const c of comps) {
      if (!c.key) continue;
      const r = parseSNBT(c.value);
      if (r.ok) obj[c.key] = r.value;
      else { obj[c.key] = c.value; rawKeys.add(c.key); }
    }
    const { plain, types } = nbtToPlain(obj);
    const data = graphFromJson(plain);
    note.textContent = `组件对象 → ${data.nodes.length} 个节点、${data.links.length} 条连线。`
      + (rawKeys.size ? ` 其中 ${rawKeys.size} 个组件的值不是合法 SNBT（${[...rawKeys].join(', ')}），按文本字段处理。` : '');
    createGraph(host, {
      types: jsonGraphTypes(),
      ports: jsonGraphPorts(),
      nodes: data.nodes, links: data.links, sequence: data.sequence || [],
      onEmit: (g) => {
        let next;
        try { next = plainToNbt(jsonFromGraph(g), types); } catch (e) { note.textContent = '图 → 组件失败：' + e.message; return; }
        comps = Object.entries(next).map(([key, v]) => ({
          key,
          value: rawKeys.has(key) ? String(v) : toSNBT(v),
        }));
        state.componentDraft = compsToText(comps);
        saveDrafts();
        rerender();
      },
    });
  }
  setTimeout(mount, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '组件节点图' }),
        h('p.card-sub', { text: '把「组件 ID → 值」画成节点图；组件列表视图与 JSON 高亮完整保留，两个视图随时来回切。' }),
      ]),
      h('div.row', null, [toggle]),
    ]),
    hostWrap,
  ]);
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

function parseDraft(text) {
  if (!text || !text.trim()) return null;
  try {
    const list = splitTopLevel(text.replace(/^\[|\]$/g, ''), ',');
    return list.map((p) => {
      const i = indexOfTopLevel(p, '=');
      if (i < 0) return { key: p.trim(), value: '' };
      return { key: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
    }).filter((c) => c.key);
  } catch { return null; }
}

/* ============================ 物品 ============================ */

function itemSearchBox() {
  const reg = state.registry;
  const suggestion = h('div.list', { style: { maxHeight: '160px', overflow: 'auto', marginTop: '6px', display: 'none' } });
  const tb = textBox({
    placeholder: state.registry ? '搜索物品 ID（已检索注册表）' : '注册表未检索，可手动输入物品 ID',
    onInput: (v) => {
      itemId = v.includes(':') || !v ? v : `minecraft:${v}`;
      if (!reg) return;
      const q = v.trim().toLowerCase();
      clear(suggestion);
      if (!q) { suggestion.style.display = 'none'; return; }
      const hits = reg.items.filter((e) => e.id.includes(q) || (e.name && e.name.toLowerCase().includes(q))).slice(0, 40);
      suggestion.style.display = hits.length ? '' : 'none';
      for (const it of hits) {
        const li = h('div.li', { style: { cursor: 'default' } });
        const ico = h('div.pk-ico', { style: { width: '22px', height: '22px' } });
        if (it.icon) ico.appendChild(h('img', { src: it.icon, style: { width: '22px', height: '22px', imageRendering: 'pixelated' } }));
        li.appendChild(ico);
        li.appendChild(h('span.li-id', { text: it.id }));
        li.appendChild(h('span.tiny.muted', { text: it.name }));
        li.addEventListener('click', () => {
          itemId = `minecraft:${it.id}`; count = 1;
          suggestion.style.display = 'none';
          rerender();
        });
        suggestion.appendChild(li);
      }
    },
  });
  tb.value = itemId.replace(/^minecraft:/, '');
  return h('div', null, [tb, suggestion]);
}

function itemCard() {
  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '目标物品' }),
      state.registry ? badge(`注册表 ${state.registry.items.length} 项`, 'ok') : badge('注册表未检索', 'no'),
    ]),
    h('div.row', null, [
      h('div', { style: { flex: '1', minWidth: '220px' } }, itemSearchBox()),
      combo({
        options: [{ value: '1', label: '数量 1' }, { value: '16', label: '数量 16' }, { value: '32', label: '数量 32' }, { value: '64', label: '数量 64' }],
        value: String(count),
        onChange: (v) => { count = Number(v); rerender(); },
      }),
      state.registry ? button({
        label: '去选择器挑物品', variant: 'subtle', small: true, iconName: 'box',
        onClick: () => { state.page = 'pickers'; state.pickerKind = 'items'; notify('navigate'); },
      }) : null,
    ]),
    h('div.tiny.muted', { style: { marginTop: '6px' }, text: `当前识别：${itemId}` }),
  ]);
}

/* ============================ 组件列表 ============================ */

function componentCard() {
  const list = h('div', { style: { marginTop: '8px' } });

  comps.forEach((c, i) => {
    const row = h('div.row', { style: { marginBottom: '6px', alignItems: 'flex-start' } });
    const catalog = COMPONENT_CATALOG.find((x) => x.key === c.key);
    const kInput = componentKeyInput(c, (v) => { c.key = v; update(); });
    const vInput = componentValueInput(c, (v) => { c.value = v; update(); }, catalog);
    row.appendChild(h('div', { style: { width: '190px', flex: '0 0 190px' } }, kInput));
    row.appendChild(h('div', { style: { flex: '1', minWidth: '160px' } }, vInput));
    row.appendChild(button({ iconName: 'trash', variant: 'subtle', small: true, iconOnly: true, title: '删除该组件', onClick: () => { comps.splice(i, 1); rerender(); } }));
    if (catalog) row.appendChild(h('span.tiny.muted', { style: { alignSelf: 'center', width: '190px' }, text: catalog.desc }));
    list.appendChild(row);
  });

  if (!comps.length) list.appendChild(emptyState('还没有组件', '从下面的目录里挑一个，或点「添加空组件」自己写'));

  // 组件选择：121 条用下拉选不动，改成「搜索 + 点选」，同时满足补全需求
  const addRow = h('div.row', { style: { flexWrap: 'wrap', marginTop: '10px', alignItems: 'center' } });
  const searchInput = textBox({
    placeholder: '搜组件：ID 或中文名，如 lore / 描述 / 附魔',
    onInput: (v) => { drawPicker(v); },
    width: '300px',
  });
  searchInput.classList.add('mono');
  addRow.appendChild(searchInput);
  addRow.appendChild(button({ label: '添加空组件', variant: 'default', small: true, iconName: 'plus', onClick: () => { comps.push({ key: '', value: '' }); rerender(); } }));
  addRow.appendChild(button({ label: '清空', variant: 'subtle', small: true, iconName: 'trash', onClick: () => { comps = []; rerender(); } }));

  const pickList = h('div.comp-pick');
  function drawPicker(q) {
    clear(pickList);
    const hits = searchComponents(q || '', 24);
    if (!hits.length) {
      pickList.appendChild(h('div.tiny.muted', { style: { padding: '8px' }, text: '没有匹配的组件' }));
      return;
    }
    for (const c of hits) {
      const item = h('button.comp-pick-item', { type: 'button', title: c.id });
      item.appendChild(h('span.comp-pick-name', { text: c.name }));
      item.appendChild(h('span.comp-pick-id', { text: c.id }));
      item.appendChild(h('span.comp-pick-tag' + (c.since ? '' : '.is-warn'), {
        text: c.since ? `${c.since}+` : '版本未取证',
        title: c.since ? `${c.since} 起可用` : 'wiki 的「数据组件类型」一节未标注引入版本，本编辑器不猜测',
      }));
      item.addEventListener('click', () => { comps.push({ key: c.id, value: c.sample || '' }); rerender(); });
      pickList.appendChild(item);
    }
  }
  drawPicker('');

  const snippetRow = h('div.row', { style: { flexWrap: 'wrap', marginTop: '8px' } });
  for (const s of COMPONENT_SNIPPETS) {
    snippetRow.appendChild(button({ label: s.label, variant: 'subtle', small: true, onClick: () => { applySnippet(s.snbt); } }));
  }

  const cmdBox = h('div.code', { style: { marginTop: '10px' } });
  function update() {
    state.componentDraft = compsToText(comps); saveDrafts();
    const r = buildGive(state.version, { targets: '@s', item: itemId, count, componentList: comps.filter((c) => c.key).map((c) => `${c.key}=${c.value}`) });
    clear(cmdBox); cmdBox.textContent = r;
  }
  setTimeout(update, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '组件列表' }),
        h('p.card-sub', { text: `语法：item[${comps.map((c) => c.key || '…').join(',')}]` }),
      ]),
      h('div.row', null, [
        button({ label: '复制命令', variant: 'default', small: true, iconName: 'copy', onClick: async () => { (await copy(cmdBox.textContent)) ? toast('已复制') : toast('复制失败', 'error'); } }),
        button({
          label: '送进节点图', variant: 'subtle', small: true, iconName: 'link',
          onClick: async () => {
            const { defaultCommandGraph } = await import('../../graph/command-graph.js');
            if (!state.graph) state.graph = defaultCommandGraph(state.version);
            const data = comps.filter((c) => c.key).map((c) => `${c.key}=${c.value}`).join(',');
            state.graph.nodes.push({ id: `comp_${Date.now().toString(36)}`, type: 'give', x: 360, y: 320 + state.graph.nodes.length * 18, values: { targets: '@s', item: itemId, data, count } });
            notify('graph');
            state.page = 'commands';
            notify('navigate');
          },
        }),
      ]),
    ]),
    list,
    addRow,
    h('div.tiny.muted', { style: { margin: '6px 0 4px' }, text: `组件目录：共 ${COMPONENT_CATALOG.length} 条（来源：zh.minecraft.wiki「数据组件」）` }),
    pickList,
    h('div.sep'),
    h('div.tiny.muted', { text: '内置片段' }),
    snippetRow,
    h('div.sep'),
    h('div.tiny.muted', { text: '生成的 /give 命令（随版本自动切换 NBT / 组件语法）' }),
    cmdBox,
  ]);
}

function applySnippet(snbt) {
  const i = indexOfTopLevel(snbt, '=');
  if (i < 0) return;
  const key = snbt.slice(0, i).trim(), value = snbt.slice(i + 1).trim();
  const exist = comps.find((c) => c.key === key);
  if (exist) exist.value = value; else comps.push({ key, value });
  rerender();
}

function compsToText(list) {
  return '[' + list.filter((c) => c.key).map((c) => `${c.key}=${c.value}`).join(',') + ']';
}

/* ============================ 迁移 ============================ */

function migrateCard() {
  ensureStyles();
  // 迁移输入框同样走高亮：JSON / SNBT 都能着色，半截内容也有颜色。
  // 统一改成「对象返回值」形式（拿 hl.box / hl.ta / hl.sync），全项目只用这一种写法，
  // 免得再出现「以为拿到的是 textarea，其实是 {box,ta,…}」那类 TypeError。
  const hl = highlightArea('', {
    mode: 'json', rows: 5, autoGrow: true, mono: 12.5,
    placeholder: '粘贴旧版物品 NBT，例如：{CustomName:\'{"text":"剑"}\',Enchantments:[{id:"minecraft:sharpness",lvl:5s}],Unbreakable:1b}',
  });
  const ta = hl.ta;
  ta.style.minHeight = '110px';
  // 键补全：在这个框里也按 NBT 键取证表给中文名候选
  enableSnbtAutocomplete(ta, { mode: 'snbt' });
  const out = h('div.code', { style: { marginTop: '8px' } });

  const doMigrate = (dir) => {
    const text = ta.value.trim();
    if (!text) { toast('请先粘贴内容', 'error'); return; }
    if (dir === 'n2c') {
      const r = parseSNBT(text);
      if (!r.ok) { toast('NBT 语法错误：' + r.error, 'error'); return; }
      const c = nbtToComponents(r.value);
      const keys = Object.keys(c);
      if (!keys.length) { out.textContent = '没有可迁移的字段（支持的映射：CustomName / Lore / Enchantments / Unbreakable / CustomModelData / CustomData）'; return; }
      comps = keys.map((k) => ({ key: k, value: c[k] }));
      out.textContent = `已迁移 ${keys.length} 个组件：\n` + compsToText(comps);
      toast(`已迁移 ${keys.length} 个组件，已填入上方列表`);
    } else {
      const list = parseDraft(text.replace(/^\[|\]$/g, ''));
      if (!list) { toast('组件语法解析失败', 'error'); return; }
      const obj = {};
      for (const c of list) obj[c.key] = c.value;
      const nbt = componentsToNbt(obj);
      out.textContent = toSNBT(nbt, { pretty: true });
      state.nbtDraft = out.textContent; saveDrafts();
      toast('已生成 NBT，可复制到 NBT 编辑器');
    }
  };

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: 'NBT ⇄ 组件 迁移' }),
      h('p.card-sub', { text: '版本升级 / 降级时最需要的一步：把旧物品 NBT 转成组件，或反向转换' }),
    ]),
    hl.box,
    h('div.row', { style: { marginTop: '8px' } }, [
      button({ label: 'NBT → 组件', variant: 'accent', small: true, onClick: () => doMigrate('n2c') }),
      button({ label: '组件 → NBT', variant: 'default', small: true, onClick: () => doMigrate('c2n') }),
      button({
        label: '复制结果', variant: 'subtle', small: true, iconName: 'copy',
        onClick: async () => { if (!out.textContent) return toast('没有可复制内容', 'error'); (await copy(out.textContent)) ? toast('已复制') : toast('复制失败', 'error'); },
      }),
      button({ label: '清空', variant: 'subtle', small: true, onClick: () => { ta.value = ''; out.textContent = ''; } }),
    ]),
    out,
  ]);
}

void esc;
