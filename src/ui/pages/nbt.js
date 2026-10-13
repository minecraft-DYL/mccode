// pages/nbt.js —— NBT 编辑器：SNBT 文本 + 结构树 + 真实 .dat 文件读写

import { h, clear, esc, dl, copy, bytes } from '../../core/util.js';
import { state, notify, capAvailable, capLabel, saveDrafts } from '../../core/store.js';
import { parseSNBT, toSNBT, formatSNBT, highlightSNBT, readDat, writeDat, NBTNumber, NBTArray, NBT_SNIPPETS, TAG_NAME } from '../../core/nbt.js';
import { button, textBox, badge, infoBar, combo, codeBlock, toast, dialog, emptyState, toggleSwitch, copyButton, downloadButton } from '../controls.js';
import { buildSetblock, buildSummon, stackSyntax } from '../../core/commands.js';
import { highlightArea } from '../snbt-highlight.js';
import { enableSnbtAutocomplete, nbtLookup, nbtTypeLabel, ensureStyles } from '../autocomplete.js';
import { NBT_LABEL_SOURCES } from '../../data/nbt-labels.js';
import { createGraph } from '../../graph/nodegraph.js';
import { createJsonGraph, graphFromJson, jsonFromGraph, jsonGraphTypes, jsonGraphPorts } from '../../graph/json-graph.js';
import { nbtToPlain, plainToNbt } from '../nbt-json-bridge.js';

export const meta = {
  id: 'nbt',
  title: 'NBT 编辑器',
  subtitle: 'SNBT 语法校验、结构树编辑，以及直接打开 level.dat / playerdata 的二进制 NBT',
  icon: 'tag',
};

let draft = null;
let showTree = true;
let loadedFile = null;
let lastParse = null;
/** 视图模式：'text' = 原来的文本 + JSON 高亮；'graph' = 节点图。文本高亮在任何模式下都不删除。 */
let viewMode = 'text';

export function render(root) {
  clear(root);
  if (draft === null) draft = state.nbtDraft || '{\n  CustomName: \'{"text":"我的物品"}\',\n  Unbreakable: 1b,\n  Enchantments: [{id:"minecraft:sharpness", lvl:5s}]\n}';

  const available = capAvailable('nbt');
  if (!available) {
    root.appendChild(infoBar({ level: 'error', title: `当前版本 ${state.version} 不支持 NBT 编辑`, text: `能力状态：${capLabel('nbt')}。1.8 之前命令无法读写 NBT。` }));
  } else if (capLabel('nbt') === '已变更') {
    root.appendChild(infoBar({
      level: 'warning',
      title: '当前版本的物品数据已改用「数据组件」',
      text: `1.20.5（24w09a）起物品堆叠属性由 NBT 改为数据组件。<b>实体与方块实体仍然使用 NBT</b>；物品请改用「物品组件」页，或用 <code>custom_data</code> 组件承载旧数据。`,
      actions: [button({ label: '去物品组件页', variant: 'accent', small: true, onClick: () => { state.page = 'components'; notify('navigate'); } })],
    }));
  }

  root.appendChild(editorCard());
  if (showTree) root.appendChild(treeCard());
  root.appendChild(toolsCard());
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

/* ============================ 编辑器 ============================ */

function editorCard() {
  ensureStyles();
  // 高亮层 + 透明输入层叠加：保留原有 SNBT 实时高亮的观感，同时保留真实 textarea 语义。
  // 这里用「对象返回值」形式（不传 attach）：图模式回写草稿时需要调 hl.sync() 重画高亮，
  // 只拿 textarea 是拿不到 sync 的。见下方 highlightArea 的返回值约定。
  const hl = highlightArea(draft, {
    mode: 'snbt', rows: 12, autoGrow: true, mono: 12.5,
    onInput: (v) => { draft = v; state.nbtDraft = draft; saveDrafts(); updatePreview(); },
  });
  const ta = hl.ta;
  ta.style.minHeight = '220px';

  // 键盘补全：复合标签内按已输入前缀弹候选（中文名 + 英文 key + 类型）
  enableSnbtAutocomplete(ta, { mode: 'snbt' });

  // Tab 仍然插入两个空格；补全浮层打开时它先接管 Tab 做确认（defaultPrevented）
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.defaultPrevented) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
      draft = ta.value; state.nbtDraft = draft; saveDrafts(); updatePreview();
    }
  });

  const preview = h('div.code', { style: { maxHeight: '190px', marginTop: '8px' } });
  const status = h('div.row', { style: { marginTop: '8px' } });

  // ── 视图容器：文本视图与节点图视图同时存在，只切换显示，绝不销毁文本高亮 ──
  const textView = h('div', null, [
    hl.box,
    status,
    h('div.tiny.muted', { style: { margin: '10px 0 4px' }, text: '实时高亮预览' }),
    preview,
  ]);
  const graphHost = h('div.nbt-graph-host', { dataset: { nbtGraph: '1' } });
  const graphNote = h('div.tiny.muted', { style: { marginTop: '6px' } });
  const graphView = h('div', { style: { display: 'none' } }, [graphHost, graphNote]);
  let graph = null;

  /** 把当前 draft 渲染成节点图。文本改过之后重新进入图模式会走这里重建。 */
  function mountGraph() {
    const r = parseSNBT(draft);
    clear(graphHost);
    graph = null;
    if (!r.ok) {
      graphNote.textContent = 'SNBT 语法有错，先修好文本再看节点图：' + (r.error || '');
      return;
    }
    // 进图前必须把 NBT 值降级成纯 JSON：宿主的 graphFromJson 用
    // `typeof v === 'object'` 判容器，而 NBTNumber extends Number 的 typeof 正是 'object'，
    // 于是 `N:1b` 会被当成 {suffix:"b"}。nbtToPlain 同时记下类型，出图时还原。
    const { plain, types } = nbtToPlain(r.value);
    const data = graphFromJson(plain);
    graphNote.textContent = `NBT 对象 → ${data.nodes.length} 个节点、${data.links.length} 条连线（json_object / json_array / json_field）。图上改值会实时回写 SNBT 文本，数值后缀与 B/I/L 数组类型都会保留。`;
    graph = createGraph(graphHost, {
      types: jsonGraphTypes(),
      ports: jsonGraphPorts(),
      nodes: data.nodes, links: data.links, sequence: data.sequence || [],
      // 图 → 文本：回写 draft 并重画高亮与结构树
      onEmit: (g) => {
        let obj;
        try { obj = plainToNbt(jsonFromGraph(g), types); } catch (err) { graphNote.textContent = '图 → NBT 失败：' + err.message; return; }
        const snbt = toSNBT(obj);
        const pretty = formatSNBT(snbt);
        draft = pretty.ok ? pretty.text : snbt;
        state.nbtDraft = draft;
        saveDrafts();
        ta.value = draft;
        hl.autosize(); hl.sync();          // 文本视图的高亮保持同步
        updatePreview();
        if (showTree) rerender();          // 结构树跟着重建
      },
    });
  }

  /** 文本 → 图：每次切到图模式都重建，保证图一定反映最新文本 */
  function showGraph(on) {
    viewMode = on ? 'graph' : 'text';
    textView.style.display = on ? 'none' : '';
    graphView.style.display = on ? '' : 'none';
    if (on) mountGraph();
    else if (graph) { graph.destroy && graph.destroy(); graph = null; }
  }

  const textBtn = button({
    label: '文本 + JSON 高亮', small: true,
    title: '原来的 SNBT 文本编辑器，保留实时 JSON 高亮',
    onClick: () => { showGraph(false); syncViewButtons(); },
  });
  const graphBtn = button({
    label: '节点图', small: true,
    title: '把 NBT 对象显示成节点图：对象 / 数组 / 字段各成节点，值可在图上直接改',
    onClick: () => { showGraph(true); syncViewButtons(); },
  });
  const viewToggle = h('div.row', { style: { gap: '6px' } }, [textBtn, graphBtn]);
  /** 用 btn-accent / btn-subtle 表达当前视图（button() 的 variant 就是映射到这两个 class） */
  function syncViewButtons() {
    const setV = (el, active) => {
      el.classList.toggle('btn-accent', active);
      el.classList.toggle('btn-subtle', !active);
      el.setAttribute('aria-pressed', String(active));
    };
    setV(textBtn, viewMode === 'text');
    setV(graphBtn, viewMode === 'graph');
  }

  function updatePreview() {
    const r = parseSNBT(draft);
    lastParse = r;
    clear(preview);
    preview.innerHTML = highlightSNBT(draft);
    clear(status);
    if (r.ok) {
      status.appendChild(badge('语法正确', 'ok'));
      const deep = depthOf(r.value);
      status.appendChild(badge(`嵌套深度 ${deep}`, ''));
      status.appendChild(badge(ishint(r.value), ''));
      const named = countNamed(r.value);
      status.appendChild(badge(`键名已汉化 ${named.hit}/${named.total}`, named.hit === named.total ? 'ok' : ''));
    } else {
      status.appendChild(badge('语法错误', 'degraded'));
      status.appendChild(h('span.tiny', { style: { color: '#ff8a80' }, text: r.error || '' }));
    }
  }
  setTimeout(() => { updatePreview(); showGraph(viewMode === 'graph'); syncViewButtons(); }, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: 'SNBT 源文本' }),
        h('p.card-sub', { text: '支持完整 SNBT：化合物 {} / 列表 [] / 字节数组 [B;] / 数值后缀 b s i l f d。输入键名前缀会弹出中文名候选：↑↓ 选择，Enter/Tab 确认，Esc 关闭。' }),
      ]),
      h('div.row', null, [
        copyButton(() => draft, '复制'),
        button({
          label: '格式化', variant: 'default', small: true, iconName: 'check',
          onClick: () => {
            const r = formatSNBT(draft);
            if (!r.ok) { toast('格式化失败：' + r.error, 'error'); return; }
            draft = r.text; state.nbtDraft = draft; saveDrafts(); rerender();
          },
        }),
        button({
          label: '压缩成一行', variant: 'subtle', small: true,
          onClick: () => {
            const r = parseSNBT(draft);
            if (!r.ok) { toast('压缩失败：' + r.error, 'error'); return; }
            draft = toSNBT(r.value); state.nbtDraft = draft; saveDrafts(); rerender();
          },
        }),
        toggleSwitch({ label: '结构树', checked: showTree, onChange: (v) => { showTree = v; rerender(); } }),
      ]),
    ]),
    h('div.row', { style: { marginBottom: '8px' } }, [h('span.tiny.muted', { text: '视图：' }), viewToggle]),
    textView,
    graphView,
  ]);
}

function ishint(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.some((k) => ['Enchantments', 'CustomName', 'display', 'AttributeModifiers', 'Unbreakable'].includes(k))) return '像物品 NBT';
    if (keys.some((k) => ['id', 'Pos', 'Motion', 'Health', 'Attributes'].includes(k))) return '像实体 NBT';
    if (keys.some((k) => ['Items', 'id', 'x', 'y', 'z'].includes(k))) return '像方块实体';
  }
  return '通用 NBT';
}

function depthOf(v, d = 0) {
  if (v == null || typeof v !== 'object') return d;
  if (v instanceof NBTNumber) return d;   // 数字字面量是叶子，别因内部 suffix 字段多算一层
  let m = d;
  const vals = Array.isArray(v) ? v : Object.values(v);
  for (const x of vals) m = Math.max(m, depthOf(x, d + 1));
  return m;
}

/* ============================ 结构树 ============================ */

/**
 * 统计整棵 NBT 树里有多少个键能追溯到 wiki 中文名。
 * 结构树底部那行「中文名覆盖 x/y 个键」要用它。
 * 口径：只统计复合标签（对象）的键；列表本身的下标不算键。
 * 查不到中文名的键计入 total 但不计入 hit —— 这正是「未取证」的可视化。
 */
function countNamed(value) {
  let hit = 0;
  let total = 0;
  const walk = (v, depth) => {
    if (depth > 12 || v == null || typeof v !== 'object') return;
    // 关键守卫：NBTNumber extends Number，typeof 同样是 'object'。
    // 漏掉这行会让每个数字字面量贡献一个幻影键 'suffix'（Object.keys(1s) === ['suffix']），
    // 把 total 灌水 —— 实测同一份 NBT 会报成 16/26，真实是 16/16。
    if (v instanceof NBTNumber) return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    for (const k of Object.keys(v)) {
      total += 1;
      try { if (nbtLookup(k)) hit += 1; } catch { /* 查表失败按未取证处理 */ }
      walk(v[k], depth + 1);
    }
  };
  walk(value, 0);
  return { hit, total };
}

function treeCard() {
  const r = parseSNBT(draft);
  const body = h('div');
  if (!r.ok) {
    body.appendChild(infoBar({ level: 'error', title: '无法生成结构树', text: esc(r.error || '') }));
  } else {
    body.appendChild(treeView(r.value, '$', 0, null));
    const named = countNamed(r.value);
    body.appendChild(h('div.tiny.muted', {
      style: { marginTop: '10px' },
      text: `中文名覆盖：${named.hit}/${named.total} 个键可追溯到 wiki；未取证的键显示「未取证」而不猜译名。`,
    }));
  }
  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '结构树' }),
      h('span.tiny.muted', { text: '点击键值可折叠 / 展开；每个键显示中文名与 NBT 类型' }),
    ]),
    body,
    h('div.sep'),
    labelSourceNote(),
  ]);
}

/** 出处说明：把 wiki 来源列出来，避免「中文名从哪来的」说不清 */
function labelSourceNote() {
  const rows = NBT_LABEL_SOURCES.map((s) => h('div', { style: { padding: '2px 0' } }, [
    h('span.tiny', { style: { color: 'var(--accent)' }, text: s.scope + '：' }),
    h('span.tiny.muted', { text: `${s.page} 第 ${s.section} 节 ` }),
    h('a.tiny', { href: s.url, target: '_blank', rel: 'noreferrer', text: s.url }),
  ]));
  return h('details', null, [
    h('summary.tiny.muted', { style: { cursor: 'default' }, text: `中文名出处（zh.minecraft.wiki，共 ${NBT_LABEL_SOURCES.length} 个取证页）` }),
    h('div', { style: { marginTop: '6px' } }, rows),
  ]);
}

/**
 * 键中文名解析：先用键名查；查不到再用推断出的作用域重查一次。
 * 都不中返回 null → UI 显示「未取证」。绝不编译名。
 */
function resolveKeyInfo(key, scopeHint) {
  if (!key || /^\d+$/.test(key)) return null;
  // 先用作用域消歧；命中不了再退回全表首条（可能是通用条目），最后才是 null
  if (scopeHint) {
    const hit = nbtLookup(key, { scope: scopeHint });
    if (hit) return hit;
  }
  return nbtLookup(key);
}

/** 由兄弟键推断这个复合标签属于哪一类（用于消歧同名键，如 id / color / Name） */
function inferScope(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj);
  const has = (...ks) => ks.some((k) => keys.includes(k));
  if (has('Pos', 'Motion', 'UUID', 'Passengers')) return '实体';
  if (has('Health', 'attributes', 'active_effects', 'Brain')) return '生物';
  if (has('Items', 'LootTable', 'LootTableSeed')) return '容器方块实体';
  if (has('x', 'y', 'z') && has('id')) return '方块实体';
  if (has('id') && has('lvl')) return '物品（1.20.5 前）';
  if (has('Enchantments', 'Unbreakable', 'display', 'AttributeModifiers', 'Damage')) return '物品（1.20.5 前）';
  if (has('Count', 'tag')) return '物品（1.20.5 前）';
  if (has('count', 'components') || has('id_item')) return '物品';
  if (has('amplifier', 'duration', 'show_particles')) return '效果';
  return null;
}

/** 生成一个键的首行：英文键 + 中文名 + 类型 */
function keyLine(key, scopeHint) {
  const info = resolveKeyInfo(key, scopeHint);
  const label = info ? info.name : null;
  const typeTxt = info ? nbtTypeLabel(info.type) : '';
  const title = info
    ? `${info.name}（${info.scope}）类型 ${info.type}${info.since ? ` · 引入 ${info.since}` : ''}\n${info.desc}`
    : '未取证：该键在 zh.minecraft.wiki 的 NBT 表格里没有查到，故不给中文名';
  const nodes = [h('span.mono', { style: { color: 'var(--accent)' }, text: key + ': ' })];
  if (label) nodes.push(h('span', { style: { color: 'var(--text-primary)', fontSize: '12.5px' }, text: label }));
  else nodes.push(h('span', { style: { color: 'var(--text-tertiary)', fontSize: '12px' }, text: '未取证' }));
  if (typeTxt) nodes.push(h('span.tiny.muted', { style: { marginLeft: '6px' }, text: `[${typeTxt}]` }));
  return { nodes, title, info };
}

function treeView(value, key, depth, scopeHint) {
  const wrap = h('div', { style: { marginLeft: depth ? '14px' : '0', borderLeft: depth ? '1px solid var(--divider-stroke)' : 'none', paddingLeft: depth ? '8px' : '0' } });
  if (value == null || typeof value !== 'object') {
    const line = keyLine(key, scopeHint);
    wrap.appendChild(h('div', { style: { padding: '3px 0', fontSize: '12.5px' }, title: line.title }, [
      ...line.nodes,
      h('span.mono', { text: toSNBT(value) }),
      h('span.tiny.muted', { style: { marginLeft: '8px' }, text: typeName(value) }),
    ]));
    return wrap;
  }
  const isArr = Array.isArray(value) || value instanceof NBTArray;
  const entries = isArr ? Array.from(value).map((v, i) => [String(i), v]) : Object.entries(value);
  const line = keyLine(key, scopeHint);
  const head = h('div', {
    style: { padding: '3px 0', fontSize: '12.5px', cursor: 'default', fontWeight: '600' }, title: line.title,
  }, [
    ...line.nodes,
    h('span.tiny.muted', { text: `${isArr ? (value instanceof NBTArray ? `[${value.kind};] 数组` : '列表') : '化合物'} · ${entries.length} 项` }),
  ]);
  const inner = h('div');
  // 推断本容器的类型特征，传给子键做消歧（同名 id / color / Name 在物品、实体、效果里含义不同）。
  // 数组容器自身说明不了作用域，于是把「元素对象」的特征与父作用域一起下传，
  // 这样 Enchantments:[{id,lvl}] 里的 id 会解析到「魔咒的命名空间 ID」而不是实体的 id。
  const elemFeature = isArr ? (Array.from(value).find((x) => x && typeof x === 'object' && !Array.isArray(x)) || null) : null;
  const childScope = isArr ? (inferScope(elemFeature) || scopeHint || null) : (inferScope(value) || scopeHint || null);
  for (const [k, v] of entries) inner.appendChild(treeView(v, k, depth + 1, childScope));
  head.addEventListener('click', () => { inner.style.display = inner.style.display === 'none' ? '' : 'none'; });
  wrap.appendChild(head);
  wrap.appendChild(inner);
  return wrap;
}

function typeName(v) {
  if (v instanceof NBTNumber) return TAG_NAME[v.tagType ? { byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6 }[v.tagType] : 3] || 'INT';
  if (typeof v === 'string') return 'STRING';
  if (v === true || v === false) return 'BYTE(布)';
  if (v === null) return 'NULL';
  return '';
}

/* ============================ 工具 ============================ */

function toolsCard() {
  const snippetRow = h('div.row', { style: { flexWrap: 'wrap' } });
  for (const s of NBT_SNIPPETS) {
    snippetRow.appendChild(button({ label: s.label, variant: 'default', small: true, onClick: () => { draft = s.snbt; state.nbtDraft = draft; saveDrafts(); rerender(); } }));
  }

  const fileInput = h('input', { type: 'file', accept: '.dat,.nbt', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const { name, value } = await readDat(f);
      draft = toSNBT(value, { pretty: true });
      state.nbtDraft = draft; saveDrafts();
      loadedFile = { name: f.name, rootName: name, size: f.size };
      toast(`已读取 ${f.name}（根标签 ${name || '空'}）`);
      rerender();
    } catch (e) { toast('读取失败：' + e.message, 'error'); }
  });

  const cmdPreview = h('div.code', { style: { marginTop: '8px' } });
  const genKind = h('span');

  const gen = (kind) => {
    const r = parseSNBT(draft);
    if (!r.ok) { toast('SNBT 有语法错误，无法生成命令', 'error'); return; }
    const snbt = toSNBT(r.value);
    const V = state.version;
    let out = '';
    if (kind === 'data-merge') out = `data merge entity @s ${snbt}`;
    else if (kind === 'setblock') out = buildSetblock(V, { pos: '~ ~ ~', block: 'minecraft:chest', nbt: snbt });
    else if (kind === 'summon') out = buildSummon(V, { entity: 'minecraft:pig', pos: '~ ~ ~', nbt: snbt });
    else if (kind === 'give') {
      const style = stackSyntax(V);
      out = style === 'components'
        ? `give @s minecraft:stone[custom_data=${snbt}]`
        : `give @s minecraft:stone 1 0 ${snbt}`;
    }
    clear(cmdPreview); cmdPreview.textContent = out;
    clear(genKind); genKind.textContent = '';
  };

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '片段 · 文件 · 生成命令' }),
      loadedFile ? badge(`已载入 ${loadedFile.name}`, 'ok') : null,
    ]),

    h('div.tiny.muted', { text: '常用 NBT 片段（点击替换编辑器内容）' }),
    snippetRow,

    h('div.sep'),

    h('div.tiny.muted', { text: '二进制 NBT 文件（自动识别 gzip，可读写 level.dat / playerdata/*.dat）' }),
    h('div.row', { style: { marginTop: '6px' } }, [
      fileInput,
      button({ label: '打开 .dat 文件', variant: 'default', small: true, iconName: 'box', onClick: () => fileInput.click() }),
      button({
        label: '导出为 .dat', variant: 'default', small: true, iconName: 'save',
        onClick: async () => {
          const r = parseSNBT(draft);
          if (!r.ok) { toast('SNBT 有语法错误', 'error'); return; }
          try {
            const bytesOut = await writeDat(r.value, { name: loadedFile ? loadedFile.rootName : '', compress: true });
            dl(loadedFile ? loadedFile.name : 'output.dat', new Blob([bytesOut], { type: 'application/octet-stream' }));
            toast(`已导出 ${bytes(0)}`.replace('0 B', bytesOut.length));
          } catch (e) { toast('导出失败：' + e.message, 'error'); }
        },
      }),
      button({
        label: '导出未压缩 NBT', variant: 'subtle', small: true,
        onClick: async () => {
          const r = parseSNBT(draft);
          if (!r.ok) { toast('SNBT 有语法错误', 'error'); return; }
          const { writeNBT } = await import('../../core/nbt.js');
          const out = writeNBT(r.value, { name: loadedFile ? loadedFile.rootName : '' });
          dl('output.nbt', new Blob([out], { type: 'application/octet-stream' }));
        },
      }),
      loadedFile ? h('span.tiny.muted', { text: `根标签：${loadedFile.rootName || '(无)'}` }) : null,
    ]),

    h('div.sep'),

    h('div.tiny.muted', { text: '生成命令（按当前版本自动选择 NBT / 组件语法）' }),
    h('div.row', { style: { marginTop: '6px' } }, [
      genKind,
      button({ label: '/data merge', variant: 'default', small: true, onClick: () => gen('data-merge') }),
      button({ label: '/setblock', variant: 'default', small: true, onClick: () => gen('setblock') }),
      button({ label: '/summon', variant: 'default', small: true, onClick: () => gen('summon') }),
      button({ label: '/give', variant: 'default', small: true, onClick: () => gen('give') }),
      button({ label: '复制结果', variant: 'subtle', small: true, iconName: 'copy', onClick: async () => { if (!cmdPreview.textContent) return toast('先生成命令', 'error'); (await copy(cmdPreview.textContent)) ? toast('已复制') : toast('复制失败', 'error'); } }),
    ]),
    cmdPreview,
  ]);
}

void combo; void codeBlock; void dialog; void emptyState; void downloadButton;
