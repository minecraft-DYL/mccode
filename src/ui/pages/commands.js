// pages/commands.js —— 命令编辑器：节点图 / Scratch / 文本 / 浏览器 四种视图 + 左侧命令分类栏 + 顶部命令方块链

import { h, clear, copy, esc } from '../../core/util.js';
import { state, notify, capAvailable, capLabel, saveDrafts } from '../../core/store.js';
import {
  COMMANDS, CATEGORIES, commandsFor, formFor, highlightCommand, validateCommand,
  buildGive, buildItemArg, stackSyntax, SELECTOR_VARS,
  ALL_COMMANDS, findCommand, CMD_CATEGORIES, commandsInCategory, searchCommands,
  CMD_SCOPE_LABEL, PERM_LABEL, commandName, describeArgType,
} from '../../core/commands.js';
import { createGraph, OUT_PORT, VALUE_NODE_TYPES } from '../../graph/nodegraph.js';
import { commandNodeTypes, commandsFromGraph, defaultCommandGraph, COMMAND_NODE_GROUPS } from '../../graph/command-graph.js';
import { ensureStyles, portLegend, portColor, portLabel, NODE_CATS } from '../../graph/graph-theme.js';
import { button, textBox, badge, infoBar, combo, toast, emptyState, codeBlock, statCard, toggleSwitch } from '../controls.js';
import { renderScratch } from './scratch.js';

export const meta = {
  id: 'commands',
  title: '命令编辑器',
  subtitle: '节点图 / Scratch / 文本 / 浏览器四种视图，共用同一份数据，输出到 .mcfunction、命令方块或聊天框',
  icon: 'terminal',
};

/* ------------------------------ 模块级状态（跨重渲染保持） ------------------------------ */

let mode = 'graph';               // graph | scratch | text | browse
let textValue = null;
let graph = null;                 // NodeGraph 单例（节点图与 Scratch 共用）
let graphHost = null;             // 该单例的宿主元素（在视图之间搬移，不重建）
let typesVersion = null;          // 建图时使用的版本
let firstBlockKind = 'impulse';   // 命令方块链首块：脉冲 / 循环
let sideCat = 'all';              // 左侧分类栏当前分类
let sideQ = '';                   // 左侧搜索词
const sideSel = new Set();        // 左侧多选（命令名）
let browseCat = '';
let browseQ = '';
let browseCatCtl = null;
let browseQCtl = null;

/** 当前渲染用到的 DOM 引用（每次 render 重新赋值） */
const refs = { outBox: null, statRow: null, plane: null, rec: null, info: null, sideList: null };

/* ============================ 页面 ============================ */

export function render(root) {
  ensureStyles();
  clear(root);
  if (textValue === null) textValue = state.commandDraft || '/give @s minecraft:diamond_sword';
  refs.outBox = null; refs.statRow = null; refs.plane = null; refs.rec = null; refs.info = null; refs.sideList = null;

  if (!capAvailable('command')) {
    root.appendChild(infoBar({ level: 'error', title: `当前版本 ${state.version} 命令能力受限`, text: `能力状态：${capLabel('command')}` }));
  }

  ensureGraph();                    // 先建图：命令方块链要知道现在有哪些命令

  root.appendChild(chainCard());    // 页面上方：2D 命令方块链
  root.appendChild(modeBar());

  const layout = h('div.mce-cmd-layout');
  layout.appendChild(sidebarCard());
  layout.appendChild(viewCard());
  root.appendChild(layout);

  refs.info = h('div.mce-info', null, h('span.tiny.muted', { text: '在节点图里点一个节点，这里显示它的标题 / 描述 / ID。' }));
  root.appendChild(refs.info);

  refreshAll();
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

/* ------------------------------ 图实例 ------------------------------ */

/** 给没有富表单的命令合成一个通用节点类型（标题/描述逐字来自 wiki 命令表） */
function genericNodeType(cmd) {
  const scopeColor = {
    player: '#7ec8ff', mobs: '#8fd6a0', blocks: '#ff9db0', world: '#ffcc80',
  }[cmd.scopes[0]] || '#9aa0a6';
  return {
    title: `/${cmd.name}`,
    color: cmd.dedicated || cmd.debug ? '#9aa0a6' : scopeColor,
    kind: 'action', nodeCat: 'action', rich: false,
    category: cmd.category,
    hiddenInMenu: true,   // 102 条通用命令从左侧分类栏加，不塞进右键菜单/节点面板
    desc: `wiki：${cmd.desc}（权限等级 ${cmd.perm}${cmd.scopes.length ? '，作用域：' + cmd.scopes.map((s) => CMD_SCOPE_LABEL[s] || s).join('/') : ''}）`,
    fields: [
      { key: 'trigger', label: '触发', type: 'port', port: true, portType: 'trigger' },
      { key: 'args', label: '参数', port: true, portType: 'string', placeholder: '按 wiki 语法补参数' },
    ],
    outPorts: [
      { port: OUT_PORT, type: 'trigger', label: '触发' },
      { port: '__cmd', type: 'string', label: '命令' },
    ],
    compute: (n, r) => {
      const args = String(r('args') ?? n.values.args ?? '').trim();
      return args ? `${cmd.name} ${args}` : cmd.name;
    },
  };
}

function buildTypes() {
  const rich = commandNodeTypes(state.version);
  const all = { ...rich };
  for (const c of ALL_COMMANDS) {
    if (rich[c.name]) continue;
    const key = 'cmd:' + c.name;
    if (!all[key]) all[key] = genericNodeType(c);
  }
  return all;
}

function nodeTypeForCommand(name) {
  if (!graph) return null;
  const rich = commandNodeTypes(state.version);
  if (rich[name]) return name;
  const key = 'cmd:' + name;
  return graph.types.has(key) ? key : null;
}

function ensureGraph() {
  if (graph && typesVersion === state.version) return graph;
  if (graphHost && graphHost.parentNode) graphHost.parentNode.removeChild(graphHost);
  if (graph) { graph.destroy(); graph = null; }
  const host = h('div.graph-wrap');
  graphHost = host;
  typesVersion = state.version;
  graph = createGraph(
    host,
    buildTypes(),
    state.graph || defaultCommandGraph(state.version),
    onGraphChange,
    onGraphSelect,
    (text, level) => { if (level === 'error') toast(text, 'error'); },
  );
  exposeDebug();
  return graph;
}

function onGraphChange() {
  if (graph) { state.graph = graph.toJSON(); saveDrafts(); }
  refreshAll();
}

function onGraphSelect(ids) { renderInfo(ids); }

/** 调试 / 自动化测试入口（挂在既有 __MCE__ 上，不改 main.js） */
function exposeDebug() {
  if (typeof window === 'undefined' || !window.__MCE__) return;
  window.__MCE__.commandGraph = {
    get graph() { return graph; },
    get mode() { return mode; },
    setMode(m) { mode = m; rerender(); },
    commandsFromGraph: () => commandsFromGraph(graph, state.version),
    scriptNodes: () => graph.scriptNodes(),
    types: () => buildTypes(),
    nodeTypeForCommand,
    appendCommand(name) { const t = nodeTypeForCommand(name); if (t) graph.appendScriptNode(t); return !!t; },
    addCommand(name) { const t = nodeTypeForCommand(name); if (!t) return false; graph.addNode(t, 300 + Math.random() * 120, 80 + Math.random() * 160); return true; },
    chainOf: () => graph.scriptNodes().map((n) => n.id),
  };
}

/* ------------------------------ 视图切换 ------------------------------ */

function modeBar() {
  const row = h('div.tabs');
  for (const it of [
    { key: 'graph', label: '节点图' },
    { key: 'scratch', label: 'Scratch' },
    { key: 'text', label: '文本编辑' },
    { key: 'browse', label: '命令浏览器' },
  ]) {
    const t = h('button.tab' + (it.key === mode ? '.is-active' : ''), { type: 'button', dataset: { modeTab: it.key } });
    t.textContent = it.label;
    t.addEventListener('click', () => { mode = it.key; rerender(); });
    row.appendChild(t);
  }
  const wrap = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
    row,
    h('span.tiny.muted', {
      text: mode === 'scratch'
        ? 'Scratch 模式：命令块按顺序堆叠，参数是可点的下拉框；顺序写入节点图的触发链。'
        : '节点图与 Scratch 共用同一份数据（同一批节点、同一个顺序），只换呈现方式。',
    }),
  ]);
  wrap.appendChild(portLegend());
  return wrap;
}

function viewCard() {
  if (mode === 'graph') return graphCard();
  if (mode === 'scratch') return scratchCard();
  if (mode === 'text') return textCard();
  return browseCard();
}

/* ============================ 命令方块链（2D，页面上方） ============================ */

/** wiki 权限等级字段可能是数字，也可能是 "0（不涉及序列）/ 2（涉及序列）" 这样的文本 */
function permsOf(perm) {
  if (typeof perm === 'number') return [perm];
  const found = String(perm || '').match(/\d+/g);
  return found ? Array.from(new Set(found.map(Number))) : [];
}

/**
 * 「适合放在哪种命令方块上」的判定。
 * 硬依据：命令方块以权限等级 2 执行命令，因此 wiki 标注权限等级高于 2 的命令在命令方块里会被拒绝；
 *         wiki 标注「仅专用服务端」/「调试命令」的条目同样拿不到。
 * 其余（脉冲 / 循环 / 连锁）是位置与用途的建议，UI 里明确标成"建议"。
 */
function blockAdvice(cmdNameText, index) {
  const name = commandName(cmdNameText);
  const cmd = findCommand(name);
  const reasons = [];
  if (!cmd) {
    return {
      name, usable: null,
      perms: [],
      reason: [`/${name} 不在 wiki 命令表里（可能是模组命令），无法按权限等级判定。`],
      kind: index === 0 ? (firstBlockKind === 'repeat' ? 'repeat' : 'impulse') : 'chain',
    };
  }
  const perms = permsOf(cmd.perm);
  const maxPerm = perms.length ? Math.max(...perms) : null;
  let usable = true;
  if (cmd.dedicated) { usable = false; reasons.push('wiki 标注「仅专用服务端」，命令方块拿不到这条命令。'); }
  if (cmd.debug) { usable = false; reasons.push('wiki 标注「调试命令」，需要开启调试工具，命令方块里通常不可用。'); }
  if (maxPerm != null && maxPerm > 2) {
    usable = false;
    reasons.push(`wiki 权限等级 ${cmd.perm}（${perms.map((p) => PERM_LABEL[p] || p).join(' / ')}），高于命令方块执行时的权限等级 2。`);
  }
  if (usable) {
    reasons.push(`wiki 权限等级 ${cmd.perm} —— 不高于命令方块执行时的权限等级 2，可以放进命令方块。`);
  }
  const scopes = cmd.scopes.map((s) => CMD_SCOPE_LABEL[s] || s).join(' / ') || '（wiki 未标注作用域）';
  return { name, usable, perms, cmd, scopes, reason: reasons, kind: index === 0 ? (firstBlockKind === 'repeat' ? 'repeat' : 'impulse') : 'chain' };
}

const BLOCK_LABEL = { impulse: '脉冲命令方块', repeat: '循环命令方块', chain: '连锁命令方块' };

function chainCard() {
  const plane = h('div.mce-mcb-plane');
  const rec = h('div.mce-mcb-rec');
  refs.plane = plane; refs.rec = rec;

  const kindCtl = combo({
    options: [
      { value: 'impulse', label: '首块：脉冲（红石激活一次）' },
      { value: 'repeat', label: '首块：循环（每刻执行）' },
    ],
    value: firstBlockKind,
    title: '链条第一条用哪种命令方块',
    onChange: (v) => { firstBlockKind = v; refreshAll(); },
  });

  return h('div.card', { dataset: { mcbCard: '1' } }, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '命令方块链（2D）' }),
        h('p.card-sub', { text: '按当前编辑器里的命令顺序，用 2D 平面画出命令方块链：方块之间的箭头是执行顺序（连锁方块按指向依次执行）。' }),
      ]),
      h('div.row', null, [kindCtl]),
    ]),
    plane,
    h('div.mce-mcb-legend', null, [
      h('span', { text: '方块外观：箭头朝上 = 脉冲，中心圆点 = 循环，横条 = 连锁；金色描边 = 条件制约（条件成立才执行）。' }),
    ]),
    h('div.tiny.muted', { style: { marginTop: '12px' }, text: '适合放在哪种命令方块上' }),
    rec,
  ]);
}

function buildChain() {
  const plane = refs.plane, rec = refs.rec;
  if (!plane) return;
  const { lines } = commandsFromGraph(graph, state.version);
  clear(plane);
  plane.appendChild(h('div.mce-mcb-axis', { text: '执行顺序 →' }));
  if (!lines.length) {
    plane.appendChild(h('div.tiny.muted', { style: { padding: '22px 8px' }, text: '（还没有命令：在节点图里放一个命令节点，或在左侧命令栏点一条命令）' }));
  }
  const shown = lines.slice(0, 24);
  const row = h('div.mce-mcb-row');
  shown.forEach((l, i) => {
    const advice = blockAdvice(l.cmd, i);
    const kind = i > 0 ? 'chain' : advice.kind;
    const node = l.node;
    const isExecuteCond = node && node.type === 'execute' && String(node.values.condition || '').trim() !== '';
    const cube = h('div.mce-mcb-cube.mce-mcb-' + kind + (isExecuteCond ? '.mce-mcb-cond' : ''), {
      title: `${BLOCK_LABEL[kind]}${isExecuteCond ? ' · 条件制约' : ''}\n/${l.cmd}`,
    });
    const blk = h('div.mce-mcb', { dataset: { mcbNode: String(i), blockKind: kind, cmd: l.cmd } }, [
      cube,
      h('div.mce-mcb-label', { text: BLOCK_LABEL[kind] + (isExecuteCond ? ' · 条件' : '') }),
      // 方块下面只写命令名，避免长命令被省略号截断；完整命令在 title 与「实时生成的命令」里
      h('div.mce-mcb-cmd', { title: '/' + l.cmd, text: '/' + commandName(l.cmd) }),
    ]);
    row.appendChild(blk);
    if (i < shown.length - 1) row.appendChild(h('div.mce-mcb-link'));
  });
  plane.appendChild(row);
  if (lines.length > shown.length) {
    plane.appendChild(h('div.tiny.muted', { style: { marginTop: '8px' }, text: `还有 ${lines.length - shown.length} 条未画出（只画前 ${shown.length} 条）` }));
  }

  // 建议面板：优先看当前选中的节点，否则看第一条
  if (!rec) return;
  clear(rec);
  const ids = Array.from(graph.selected);
  const selNode = ids.length === 1 ? graph.nodes.get(ids[0]) : null;
  let idx = 0;
  let target = lines[0];
  if (selNode) {
    const k = lines.findIndex((l) => l.node.id === selNode.id);
    if (k >= 0) { idx = k; target = lines[k]; }
  }
  if (!target) {
    rec.appendChild(h('span.tiny.muted', { text: '先有命令，才能判断它适合放在哪种命令方块上。' }));
    return;
  }
  const a = blockAdvice(target.cmd, idx);
  rec.appendChild(badge(`/${a.name}`, a.usable === false ? 'no' : a.usable ? 'ok' : ''));
  rec.appendChild(badge(BLOCK_LABEL[a.kind === 'repeat' ? 'repeat' : a.kind === 'chain' ? 'chain' : 'impulse'], 'accent'));
  rec.appendChild(badge(`链中位置 ${idx + 1}`, ''));
  if (a.usable === false) rec.appendChild(badge('命令方块不可用', 'no'));
  else if (a.usable) rec.appendChild(badge('命令方块可用', 'ok'));
  const list = h('div', { style: { width: '100%' } });
  for (const r of a.reason) list.appendChild(h('div.tiny.muted', { text: '· ' + r }));
  if (idx > 0) list.appendChild(h('div.tiny.muted', { text: '· 建议：链条里第 2 条起用连锁命令方块 + 保持开启，才能接在前一个方块执行之后。' }));
  else list.appendChild(h('div.tiny.muted', { text: `· 建议：第 1 条用${BLOCK_LABEL[a.kind === 'repeat' ? 'repeat' : 'impulse']}；需要每刻重复执行就切到「循环」。` }));
  rec.appendChild(list);
}

function scratchCard() {
  const host = renderScratch({
    graph,
    registry: state.registry,
    onDirty: () => { state.graph = graph.toJSON(); saveDrafts(); refreshAll(); },
    onNotice: (t) => toast(t),
  });
  const card = h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: 'Scratch 脚本' }),
        h('p.card-sub', { text: '命令块按顺序堆叠；块上的下拉参数直接写进节点数据，切回节点图看到的是同一批节点和同一条触发链。' }),
      ]),
      h('div.row', null, [
        button({
          label: '追加到脚本末尾（示例）', variant: 'subtle', small: true, iconName: 'plus',
          onClick: () => { graph.appendScriptNode('particle'); rerender(); },
        }),
      ]),
    ]),
    host,
    outBlock(),
  ]);
  return card;
}

/* ============================ 节点图 ============================ */

function graphCard() {
  const wrap = graphHost || h('div.graph-wrap');
  const cardBody = h('div');
  cardBody.appendChild(wrap);

  // 非命令节点面板（值 / 事件触发 / 比较）——命令由左侧分类栏提供
  const palette = h('div.node-palette', { dataset: { nodePalette: '1' } });
  const allTypes = graph.types;
  for (const g of COMMAND_NODE_GROUPS) {
    for (const [type, def] of allTypes) {
      const cat = def.nodeCat || (def.kind === 'value' ? 'value' : 'action');
      if (cat !== g.key) continue;
      if (cat === 'action' && !def.rich && def.kind === 'action') continue;   // 通用命令节点走左侧栏
      if (cat === 'action' && def.kind === 'sink') continue;
      const el = h('div.pal-item', { title: def.desc || def.title, dataset: { palType: type } }, [
        h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: g.color } }),
        h('span', { text: def.title }),
      ]);
      el.addEventListener('click', () => { graph.addNode(type, 200 + Math.random() * 260, 60 + Math.random() * 220); rerender(); });
      palette.appendChild(el);
    }
  }

  const toolbar = h('div.graph-toolbar');
  toolbar.appendChild(button({ iconName: 'plus', iconOnly: true, small: true, title: '添加一个 /give 节点', onClick: () => { graph.addNode('give', 260, 40); refreshAll(); } }));
  toolbar.appendChild(button({ iconName: 'zoom', iconOnly: true, small: true, title: '适应视图', onClick: () => graph.fit() }));
  toolbar.appendChild(button({
    iconName: 'layers', small: true, title: '重置为示例图',
    onClick: () => { graph.fromJSON(defaultCommandGraph(state.version)); graph.render(); onGraphChange(); },
  }));
  toolbar.appendChild(button({ iconName: 'trash', iconOnly: true, small: true, title: '删除选中节点（Delete）', onClick: () => { graph.deleteSelected(); onGraphChange(); } }));
  cardBody.appendChild(toolbar);
  cardBody.appendChild(h('div.graph-hint', { text: '左键拖节点/框选 · Ctrl+左键加点 · 从圆点拖到空白处弹兼容节点菜单 · 中键拖平移 · 滚轮缩放 · 中键点节点清空其连线 · 右键节点删除 · 右键空白创建/粘贴 · Delete 删除选中' }));
  graph.render();   // Scratch 里改过参数 → 回到节点图要把输入框刷新成最新值

  setTimeout(() => { graph.render(); refreshAll(); }, 40);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '命令节点图' }),
        h('p.card-sub', { text: '节点 = 命令片段；触发端口（黄）决定先后，数据端口（蓝/绿/红/粉/灰）传参数。端口类型不匹配连不上，数据输入端只能有一条线。' }),
      ]),
      h('div.row', null, [
        button({ label: '复制全部命令', variant: 'default', small: true, iconName: 'copy', onClick: async () => { (await copy((refs.outBox && refs.outBox.textContent) || '')) ? toast('已复制') : toast('复制失败', 'error'); } }),
        button({ label: '发送到输出', variant: 'accent', small: true, iconName: 'export', onClick: () => { state.commandDraft = state.commandDraft || ''; state.page = 'output'; notify('navigate'); } }),
      ]),
    ]),
    h('div.tiny.muted', { style: { marginBottom: '6px' }, text: '节点面板（值 / 事件触发 / 比较；命令节点请用左侧命令分类栏）' }),
    palette,
    cardBody,
    outBlock(),
  ]);
}

/** 实时命令输出 + 统计 */
function outBlock() {
  const outBox = h('div.code', { style: { marginTop: '10px', maxHeight: '260px' }, dataset: { cmdOut: '1' } });
  const statRow = h('div.row', { style: { marginTop: '8px' } });
  refs.outBox = outBox; refs.statRow = statRow;
  return h('div', null, [
    statRow,
    h('div.tiny.muted', { style: { marginTop: '10px' }, text: '实时生成的命令' }),
    outBox,
  ]);
}

function refreshAll() {
  if (!graph) return;
  const { lines, sinks } = commandsFromGraph(graph, state.version);
  const outBox = refs.outBox;
  if (outBox) {
    clear(outBox);
    if (sinks.length) {
      outBox.appendChild(h('div.tiny.muted', { text: '输出到聊天框：' }));
      outBox.appendChild(h('div.mono', { text: sinks.map((s) => s.cmd).join('\n') }));
    }
    outBox.appendChild(h('div.tiny.muted', { style: { marginTop: sinks.length ? '8px' : '0' }, text: `逐行命令（${lines.length} 条）` }));
    outBox.appendChild(h('div.mono', { text: lines.length ? lines.map((l) => l.cmd).join('\n') : '（把命令节点连起来，或直接放置命令节点）' }));
  }
  if (lines.length) state.commandDraft = [...lines.map((l) => l.cmd), ...sinks.map((s) => s.cmd)].join('\n');
  const statRow = refs.statRow;
  if (statRow) {
    clear(statRow);
    statRow.appendChild(badge(`节点 ${graph.nodes.size}`, ''));
    statRow.appendChild(badge(`连线 ${graph.links.length}`, ''));
    statRow.appendChild(badge(`命令 ${lines.length}`, lines.length ? 'ok' : 'no'));
    statRow.appendChild(badge(`脚本块 ${graph.scriptNodes().length}`, ''));
    statRow.appendChild(badge(mode === 'scratch' ? 'Scratch 模式' : mode === 'graph' ? '节点图模式' : mode === 'text' ? '文本模式' : '浏览器模式', 'accent'));
  }
  buildChain();
  renderInfo(Array.from(graph.selected));
}

function renderInfo(ids) {
  const box = refs.info;
  if (!box) return;
  clear(box);
  if (!ids.length) {
    box.appendChild(h('span.tiny.muted', { text: '未选中节点。点一个节点看它的标题 / 描述 / ID；Ctrl+左键可加选多个，Delete 删除。' }));
    return;
  }
  const primary = graph.infoFor(ids[0]);
  if (!primary) return;
  box.appendChild(h('span.mce-info-title', { text: primary.title }));
  box.appendChild(h('span.mce-info-id', { text: `ID ${primary.id}` }));
  box.appendChild(badge(`类别 ${primary.cat}`, ''));
  box.appendChild(badge(`类型 ${primary.type}`, ''));
  if (ids.length > 1) box.appendChild(badge(`共选中 ${ids.length} 个`, 'accent'));
  box.appendChild(h('div.mce-info-desc', { text: primary.desc || '（该节点没有描述）' }));
  const ports = h('div.row', { style: { gap: '6px' } });
  for (const p of primary.inputs) {
    ports.appendChild(h('span', {
      class: 'badge', title: `输入端口 ${p.key}`,
      style: { borderLeft: `4px solid ${portColor(p.type)}` },
      text: `${p.label} · ${portLabel(p.type)}`,
    }));
  }
  if (primary.output) {
    ports.appendChild(h('span', {
      class: 'badge', title: '输出端口',
      style: { borderLeft: `4px solid ${portColor(primary.output)}` },
      text: `输出 · ${portLabel(primary.output)}`,
    }));
  }
  box.appendChild(ports);
}

/* ============================ 左侧命令分类栏 ============================ */

function sidebarCard() {
  const list = h('div.mce-cmd-list', { dataset: { cmdSideList: '1' } });
  refs.sideList = list;

  const catList = h('div.mce-cat-list');
  for (const c of CMD_CATEGORIES) {
    const n = commandsInCategory(c.key).length;
    const el = h('div.mce-cat-item' + (sideCat === c.key ? '.is-active' : ''), {
      dataset: { catKey: c.key }, title: c.desc,
    }, [
      h('span', { text: c.label }),
      h('span.mce-cat-count', { text: String(n) }),
    ]);
    el.addEventListener('click', () => { sideCat = c.key; sideQ = ''; if (sideSearchCtl) sideSearchCtl.value = ''; rerender(); });
    catList.appendChild(el);
  }

  const sideSearchCtl = textBox({
    value: sideQ, placeholder: '搜索命令名 / 中文描述…',
    onInput: (v) => { sideQ = v; fillSideList(); },
  });

  fillSideList(list);

  const actions = h('div.mce-side-actions');
  const addBtn = button({
    label: '加入选中的 0 条', variant: 'accent', small: true, dataset: { addSelected: '1' },
    onClick: () => addSelectedCommands(),
  });
  addBtn.dataset.addSelected = '1';
  const refreshBtn = () => {
    const b = actions.querySelector('[data-add-selected]');
    if (b) b.querySelector('span').textContent = `加入选中的 ${sideSel.size} 条`;
  };
  addBtn.addEventListener('click', refreshBtn);
  actions.appendChild(addBtn);
  actions.appendChild(button({ label: '清空选择', variant: 'subtle', small: true, onClick: () => { sideSel.clear(); rerender(); } }));

  const card = h('div.mce-cmd-side', { dataset: { cmdSidebar: '1' } }, [
    h('h3', { text: '命令分类栏（按 wiki 作用域 / 权限）' }),
    catList,
    sideSearchCtl,
    h('div.tiny.muted', { style: { margin: '8px 0 4px' }, text: '单击 = 加到画布/脚本；Ctrl+单击 = 多选。' }),
    list,
    actions,
  ]);
  return card;
}

function fillSideList(list) {
  const target = list || refs.sideList;
  if (!target) return;
  clear(target);
  const rows = sideQ.trim()
    ? searchCommands(sideQ)
    : commandsInCategory(sideCat);
  let shown = 0;
  for (const c of rows) {
    const type = nodeTypeForCommand(c.name);
    const selected = sideSel.has(c.name);
    const row = h('div.mce-cmd-row' + (selected ? '.is-sel' : ''), {
      dataset: { cmd: c.name, hasNode: type ? '1' : '0' }, title: `${c.desc}\n权限等级 ${c.perm}`,
    }, [
      h('span.mce-cmd-name', { text: '/' + c.name }),
      h('span.mce-cmd-desc', { text: c.desc }),
      h('span.mce-cmd-meta', { text: `权限 ${c.perm} · ${c.scopes.map((s) => CMD_SCOPE_LABEL[s] || s).join('/') || '未标注'}${c.since ? ' · 自 ' + c.since : ' · 引入版本未核实'}${type ? '' : ' · 无节点类型'}` }),
    ]);
    row.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (sideSel.has(c.name)) sideSel.delete(c.name); else sideSel.add(c.name);
        rerender();
        return;
      }
      if (!type) { toast(`/${c.name} 没有对应节点类型`, 'error'); return; }
      sideSel.clear();
      sideSel.add(c.name);
      addSelectedCommands();
    });
    target.appendChild(row);
    shown++;
  }
  if (!shown) target.appendChild(h('div.tiny.muted', { style: { padding: '10px 4px' }, text: '没有匹配的命令。' }));
  const counter = target.parentNode && target.parentNode.querySelector('.mce-side-actions [data-add-selected] span');
  if (counter) counter.textContent = `加入选中的 ${sideSel.size} 条`;
}

function addSelectedCommands() {
  const names = Array.from(sideSel);
  if (!names.length) { toast('先在左边选命令（Ctrl+单击可多选）', 'error'); return; }
  let n = 0;
  let i = 0;
  for (const name of names) {
    const type = nodeTypeForCommand(name);
    if (!type) continue;
    if (mode === 'scratch') graph.appendScriptNode(type);
    else graph.addNode(type, 300 + (i % 4) * 240, 60 + Math.floor(i / 4) * 190);
    n++; i++;
  }
  toast(`已加入 ${n} 条命令`, n ? 'info' : 'error');
  refreshAll();
  if (mode === 'graph') graph.render();
  if (mode === 'scratch') rerender();
}

/* ============================ 文本编辑 ============================ */

function textCard() {
  const ta = h('textarea.tb.mono', { rows: 6, spellcheck: false, style: { minHeight: '120px', fontSize: '13px', lineHeight: '1.7' } });
  ta.value = textValue;
  ta.addEventListener('input', () => { textValue = ta.value; state.commandDraft = textValue; saveDrafts(); update(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); update(); } });

  const hl = h('div.code', { style: { marginTop: '8px' } });
  const check = h('div');
  const formBox = h('div');

  function update() {
    hl.innerHTML = highlightCommand(textValue, state.version);
    const r = validateCommand(textValue, state.version);
    clear(check);
    check.appendChild(infoBar({
      level: r.level === 'ok' ? 'success' : r.level === 'warning' ? 'warning' : 'error',
      title: r.ok ? '语法检查通过' : '语法检查',
      text: esc(r.message),
    }));
    clear(formBox);
    if (r.cmd && r.form) {
      formBox.appendChild(h('div.tiny.muted', { text: `当前版本（${state.version}）下 /${r.cmd.name} 的语法形式：` }));
      formBox.appendChild(h('div.code', { text: r.form.syntax }));
      formBox.appendChild(h('div.tiny.muted', { style: { marginTop: '8px' }, text: '参数（中文名 · 类型）：' }));
      const row = h('div.row', { style: { flexWrap: 'wrap' } });
      const hints = [];
      for (const a of (r.form.args || [])) {
        const d = describeArgType(a);
        const chip = badge(d.known ? `${a} · ${d.label}` : `${a}`, d.known ? '' : 'no');
        if (d.hint) chip.title = d.hint;          // 悬停给完整说明
        row.appendChild(chip);
        if (d.known && d.hint) hints.push(`${d.placeholder || a} —— ${d.hint}`);
      }
      formBox.appendChild(row);
      if (hints.length) {
        const box = h('div.tiny.muted', { style: { marginTop: '6px', lineHeight: '1.7' } });
        for (const t of hints) box.appendChild(h('div', { text: t }));
        formBox.appendChild(box);
      }
    }
  }
  setTimeout(update, 0);

  const quick = h('div.row', { style: { flexWrap: 'wrap', marginTop: '8px' } });
  const samples = [
    `/give @s minecraft:diamond_sword${stackSyntax(state.version) === 'components' ? '[custom_name="神剑",enchantments={levels:{"minecraft:sharpness":5}}]' : '{CustomName:\'{"text":"神剑"}\',Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}'}`,
    '/summon minecraft:pig ~ ~ ~ {NoAI:1b}',
    '/setblock ~ ~1 ~ minecraft:chest{Items:[]}',
    '/particle minecraft:flame ~ ~1 ~ 0.2 0.2 0.2 1 10 normal',
    '/data get entity @s SelectedItem',
    '/execute as @a at @s run particle minecraft:cloud ~ ~1 ~ 0.1 0.1 0.1 0 5 normal',
  ];
  for (const s of samples) {
    quick.appendChild(button({
      label: s.split(' ')[0] + '…', variant: 'subtle', small: true,
      onClick: () => { textValue = s; state.commandDraft = s; saveDrafts(); rerender(); },
    }));
  }

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '命令文本' }),
        h('p.card-sub', { text: 'Ctrl/⌘ + Enter 重新校验；语法按当前版本判定参数形式。' }),
      ]),
      h('div.row', null, [
        button({ label: '复制', variant: 'default', small: true, iconName: 'copy', onClick: async () => { (await copy(textValue)) ? toast('已复制') : toast('复制失败', 'error'); } }),
        button({ label: '发送到输出', variant: 'accent', small: true, iconName: 'export', onClick: () => { state.commandDraft = textValue; state.page = 'output'; notify('navigate'); } }),
      ]),
    ]),
    ta,
    quick,
    h('div.tiny.muted', { style: { margin: '10px 0 4px' }, text: '语法高亮' }),
    hl,
    h('div', { style: { marginTop: '10px' } }, check),
    h('div', { style: { marginTop: '10px' } }, formBox),
  ]);
}

/* ============================ 命令浏览器 ============================ */

function browseCard() {
  const avail = commandsFor(state.version);
  const catOptions = [{ value: '', label: '全部分类' }, ...CMD_CATEGORIES.filter((c) => c.key !== 'all').map((c) => ({ value: c.key, label: c.label }))];
  browseCatCtl = combo({
    options: catOptions,
    value: browseCat,
    onChange: (v) => { browseCat = v; rerender(); },
  });
  browseQCtl = textBox({
    value: browseQ, placeholder: '搜索命令名或中文描述…',
    onInput: (v) => { browseQ = v; const l = document.getElementById('browseList'); if (l) fillBrowseList(l); },
  });
  setTimeout(() => { const l = document.getElementById('browseList'); if (l) fillBrowseList(l); }, 0);
  const list = h('div#browseList');

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: `命令浏览器（${avail.length} / ${ALL_COMMANDS.length} 条可用于 ${state.version}）` }),
        h('p.card-sub', { text: '只列出该版本确实存在的命令；语法形式随版本自动切换（例如 /give 在 1.20.5 前后是两套写法）。搜索与分类按钮是真的在过滤。' }),
      ]),
      h('div.row', null, [browseCatCtl, browseQCtl]),
    ]),
    list,
  ]);
}

function browseRows() {
  const avail = new Set(commandsFor(state.version).map((c) => c.name));
  let rows = ALL_COMMANDS.filter((c) => avail.has(c.name));
  if (browseCat) rows = rows.filter((c) => commandsInCategory(browseCat).some((x) => x.name === c.name));
  if (browseQ.trim()) {
    const hits = new Set(searchCommands(browseQ).map((c) => c.name));
    rows = rows.filter((c) => hits.has(c.name));
  }
  return rows;
}

function fillBrowseList(list) {
  clear(list);
  const rows = browseRows();
  list.appendChild(h('div.tiny.muted', { style: { marginBottom: '8px' }, text: `匹配 ${rows.length} 条命令` }));
  for (const cmd of rows) {
    const form = formFor(cmd, state.version);
    const type = nodeTypeForCommand(cmd.name);
    list.appendChild(h('div.card.tight', { style: { marginBottom: '8px' }, dataset: { browseCmd: cmd.name } }, [
      h('div.card-head', { style: { marginBottom: '4px' } }, [
        h('h2.card-title', { style: { fontSize: '13.5px' } }, [
          h('span.mono', { text: '/' + cmd.name }),
          badge(cmd.category, ''),
          badge(`权限 ${cmd.perm}`, ''),
          cmd.sinceKnown ? badge(`自 ${cmd.since}`, '') : badge('引入版本未核实', 'partial'),
        ]),
        h('div.row', null, [
          button({
            label: '插入示例', variant: 'subtle', small: true,
            onClick: () => {
              const sample = sampleFor(cmd, state.version);
              textValue = sample; state.commandDraft = sample; mode = 'text'; saveDrafts(); rerender();
            },
          }),
          button({
            label: '加到画布', variant: 'subtle', small: true, disabled: !type,
            onClick: () => { if (!type) return; graph.addNode(type, 300 + Math.random() * 200, 80 + Math.random() * 200); refreshAll(); toast('已加入节点图'); },
          }),
          button({
            label: '追加到脚本', variant: 'subtle', small: true, disabled: !type,
            onClick: () => { if (!type) return; graph.appendScriptNode(type); refreshAll(); toast('已追加到脚本'); },
          }),
        ]),
      ]),
      h('p.card-sub', { text: cmd.desc }),
      h('div.code', { style: { maxHeight: '80px' }, text: form ? form.syntax : `/${cmd.name}（wiki 未收录富表单，参数按 wiki 语法手填）` }),
    ]));
  }
  if (!rows.length) list.appendChild(emptyState('没有匹配的命令', '换个关键词，或把分类切回「全部分类」。'));
}

function sampleFor(cmd, version) {
  switch (cmd.name) {
    case 'give': return buildGive(version, { targets: '@s', item: 'minecraft:diamond_sword', count: 1, componentList: stackSyntax(version) === 'components' ? ['custom_name="神剑"'] : [], nbt: '{CustomName:\'{"text":"神剑"}\'}' });
    case 'setblock': return '/setblock ~ ~1 ~ minecraft:chest{Items:[]}';
    case 'summon': return '/summon minecraft:pig ~ ~ ~ {NoAI:1b}';
    case 'particle': return '/particle minecraft:flame ~ ~1 ~ 0.2 0.2 0.2 1 10 normal';
    case 'data': return '/data get entity @s SelectedItem';
    case 'execute': return '/execute as @a at @s run particle minecraft:cloud ~ ~1 ~ 0.1 0.1 0.1 0 5 normal';
    case 'tellraw': return '/tellraw @a {"text":"你好"}';
    case 'title': return '/title @s title {"text":"标题"}';
    case 'scoreboard': return '/scoreboard objectives add obj dummy';
    case 'function': return '/function mypack:main';
    default: return `/${cmd.name}`;
  }
}

/* 保留导出：这些仍被其它页面 / 调试入口按名字引用 */
void SELECTOR_VARS; void buildItemArg; void statCard; void toggleSwitch; void codeBlock;
void NODE_CATS; void CATEGORIES; void COMMANDS; void VALUE_NODE_TYPES;
