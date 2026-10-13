// graph-theme.js —— 节点图的类型系统 / 配色 / 自包含样式注入
// 参考蓝图：PVZ 融合版「超级自定义关卡 / 关卡事件」事件编辑器
//   https://wiki.biligame.com/pvzrh/超级自定义关卡/关卡事件
//   节点标题在上方，输入端口在左、输出端口在右，端口按数据类型着色。
//
// 本模块不依赖 app.css（父代理正在并行改那个文件），所有新样式通过 ensureStyles()
// 幂等注入一段 <style id="mce-graph-style">，因此零冲突、可自测。

import { h } from '../core/util.js';

/* ============================ 端口类型 ============================ */

/** 端口数据类型 → 颜色（逐字取自参考蓝图的端口配色） */
export const PORT_COLORS = {
  trigger: '#ffcc31', // 触发
  int: '#66ccff',     // Int
  float: '#66ff98',   // Float
  bool: '#ff4b80',    // Bool
  string: '#ff99ca',  // String
  object: '#808080',  // object
  any: '#9aa0a6',     // 万能（仅用于极少数的透传端口）
};

export const PORT_LABELS = {
  trigger: '触发', int: 'Int', float: 'Float', bool: 'Bool', string: 'String', object: 'object', any: '任意',
};

export const PORT_TYPE_KEYS = Object.keys(PORT_COLORS);

/** 端口颜色查询（未知类型按 object 处理，绝不静默变成主色） */
export function portColor(t) { return PORT_COLORS[t] || PORT_COLORS.object; }
export function portLabel(t) { return PORT_LABELS[t] || PORT_LABELS.object; }

/** 数据类端口（非触发） */
export function isDataPort(t) { return t !== 'trigger'; }

/**
 * 唯一的数值放宽例外：整数是浮点的子集，允许 int → float 向上兼容。
 * 除此之外一律要求同类型（float → int、string → int 等都被拒绝）。
 * 该例外是显式表格，不是"看起来差不多就放行"。
 */
export const PORT_SUBTYPES = { int: ['float'] };

/**
 * 连接规则（蓝图第 3 条）：
 *   · 触发 → 触发   ✅
 *   · 触发 ↔ 数据   ❌
 *   · 数据 → 同类型 ✅（any 视为兼容一切；int → float 为唯一的数值放宽）
 *   · 数据 → 不同类型 ❌
 * @returns {{ok:boolean, reason:string}}
 */
export function checkPortCompat(fromType, toType) {
  const a = fromType || 'object';
  const b = toType || 'object';
  const aTrigger = a === 'trigger', bTrigger = b === 'trigger';
  if (aTrigger || bTrigger) {
    return aTrigger && bTrigger
      ? { ok: true, reason: '触发 → 触发' }
      : { ok: false, reason: `触发端口不能接到数据端口（${portLabel(a)} → ${portLabel(b)}）` };
  }
  if (a === 'any' || b === 'any') return { ok: true, reason: '任意类型端口' };
  if (a === b) return { ok: true, reason: `同类型（${portLabel(a)}）` };
  if ((PORT_SUBTYPES[a] || []).includes(b)) return { ok: true, reason: `${portLabel(a)} → ${portLabel(b)}（数值放宽）` };
  return { ok: false, reason: `数据类型不同：${portLabel(a)} → ${portLabel(b)}` };
}

/**
 * 同一个输入端口能否被多条线连接（蓝图第 3 条）：
 *   · 触发可以 many-to-one ✅
 *   · 数据不能 many-to-one ❌
 */
export function canManyToOne(inputType) { return inputType === 'trigger'; }

/* ============================ 节点类别 ============================ */

/** 节点类别 → 颜色 + 中文名 */
export const NODE_CATS = {
  event: { label: '事件触发', color: '#ff6666' },
  action: { label: '行为', color: '#7ec8ff' },
  value: { label: '值', color: '#66ff98' },
  compare: { label: '比较', color: '#ff99ca' },
};

export const NODE_CAT_ORDER = ['event', 'action', 'value', 'compare'];

export function nodeCatOf(def) {
  if (!def) return NODE_CATS.action;
  const key = def.nodeCat || (def.kind === 'value' ? 'value' : 'action');
  return NODE_CATS[key] || NODE_CATS.action;
}

/** 类别对应到 CSS class 后缀 */
export function nodeCatClass(def) {
  const key = def && (def.nodeCat || (def.kind === 'value' ? 'value' : 'action'));
  return 'mce-cat-' + (NODE_CATS[key] ? key : 'action');
}

/* ============================ 样式 ============================ */

export const GRAPH_CSS = `
/* ---- 端口按类型着色（内联 background 由 JS 写，这里只做形状与高亮） ---- */
.node-port { box-shadow: 0 0 0 2px rgba(0,0,0,.35); transition: transform .08s ease; }
.node-port.is-data { border-radius: 50%; }
.node-port.is-trigger { border-radius: 2px; }
.node-port.mce-linkable { transform: scale(1.3); box-shadow: 0 0 0 2px var(--accent,#0067c0); }
.node-port.mce-dragging { transform: scale(1.45); }

/* ---- 节点类别色条 ---- */
.node.mce-node { border-top: 3px solid var(--mce-cat, var(--accent,#0067c0)); }
.node.mce-node .node-title { font-size: 12.5px; }
.mce-cat-event { --mce-cat: #ff6666; }
.mce-cat-action { --mce-cat: #7ec8ff; }
.mce-cat-value { --mce-cat: #66ff98; }
.mce-cat-compare { --mce-cat: #ff99ca; }
.node .mce-cat-tag { font-size: 10px; padding: 0 5px; border-radius: 6px; color: #10100f;
  background: var(--mce-cat,#888); opacity: .9; white-space: nowrap; }

/* ---- 端口弹出菜单（拖到空白处松手） ---- */
.mce-portmenu { position: fixed; z-index: 1400; min-width: 230px; max-height: 380px; overflow: auto;
  background: var(--card-bg, #232326); border: 1px solid var(--card-stroke, rgba(128,128,128,.35));
  border-radius: 9px; box-shadow: 0 14px 38px rgba(0,0,0,.45); padding: 5px; }
.mce-pm-head { font-size: 11px; color: var(--text-tertiary,#9aa0a6); padding: 5px 8px 7px;
  display: flex; align-items: center; gap: 6px; }
.mce-pm-swatch { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
.mce-pm-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
  font-size: 12.5px; color: var(--text-primary,#e8e8e8); cursor: pointer; }
.mce-pm-item:hover, .mce-pm-item.is-hi { background: var(--ctrl-fill-secondary, rgba(128,128,128,.2)); }
.mce-pm-item .mce-pm-port { font-size: 10.5px; color: var(--text-tertiary,#9aa0a6); margin-left: auto; }
.mce-pm-sec { font-size: 10.5px; color: var(--text-tertiary,#9aa0a6); padding: 7px 8px 3px;
  border-top: 1px solid var(--divider-stroke, rgba(128,128,128,.18)); margin-top: 4px; }
.mce-pm-empty { padding: 10px; font-size: 12px; color: var(--text-secondary); }

/* ---- 框选 ---- */
.mce-marquee { position: absolute; border: 1px solid var(--accent,#0067c0);
  background: rgba(0,103,192,.14); border-radius: 2px; pointer-events: none; z-index: 3; }

/* ---- 选中节点信息面板 ---- */
.mce-info { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline;
  border: 1px solid var(--card-stroke, rgba(128,128,128,.22)); border-radius: 8px;
  padding: 9px 12px; margin-top: 10px; background: var(--ctrl-fill-tertiary, rgba(128,128,128,.07)); }
.mce-info .mce-info-title { font-weight: 600; font-size: 13px; }
.mce-info .mce-info-id { font-family: var(--font-mono, Consolas, monospace); font-size: 11.5px;
  color: var(--text-tertiary,#9aa0a6); }
.mce-info .mce-info-desc { font-size: 12px; color: var(--text-secondary,#b9bcc0); width: 100%; }

/* ---- 命令页左右分栏 ---- */
.mce-cmd-layout { display: grid; grid-template-columns: 264px minmax(0,1fr); gap: 14px; align-items: start; }
@media (max-width: 1080px) { .mce-cmd-layout { grid-template-columns: 1fr; } }
.mce-cmd-side { border: 1px solid var(--card-stroke, rgba(128,128,128,.22)); border-radius: 9px;
  padding: 10px; background: var(--ctrl-fill-tertiary, rgba(128,128,128,.05)); }
.mce-cmd-side h3 { margin: 0 0 8px; font-size: 12.5px; }
.mce-cat-list { display: flex; flex-direction: column; gap: 3px; margin-bottom: 9px; }
.mce-cat-item { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 6px;
  font-size: 12.5px; cursor: pointer; color: var(--text-primary,#e8e8e8); }
.mce-cat-item:hover { background: var(--ctrl-fill-secondary, rgba(128,128,128,.16)); }
.mce-cat-item.is-active { background: var(--accent,#0067c0); color: #fff; }
.mce-cat-item .mce-cat-count { margin-left: auto; font-size: 11px; opacity: .75; }
.mce-cmd-list { display: flex; flex-direction: column; gap: 3px; max-height: 420px; overflow: auto; }
.mce-cmd-row { display: flex; flex-direction: column; gap: 2px; padding: 5px 8px; border-radius: 6px;
  cursor: pointer; border: 1px solid transparent; }
.mce-cmd-row:hover { background: var(--ctrl-fill-secondary, rgba(128,128,128,.16)); }
.mce-cmd-row.is-sel { border-color: var(--accent,#0067c0); background: rgba(0,103,192,.16); }
.mce-cmd-row .mce-cmd-name { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.mce-cmd-row .mce-cmd-desc { font-size: 11px; color: var(--text-tertiary,#9aa0a6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mce-cmd-row .mce-cmd-meta { font-size: 10px; color: var(--text-tertiary,#9aa0a6); }
.mce-side-actions { display: flex; gap: 6px; margin-top: 9px; flex-wrap: wrap; }

/* ---- Scratch 模式 ---- */
.mce-scratch { display: grid; grid-template-columns: 218px minmax(0,1fr); gap: 14px; align-items: start; }
@media (max-width: 1080px) { .mce-scratch { grid-template-columns: 1fr; } }
.mce-scratch-stage { min-height: 420px; padding: 16px 20px 26px; border-radius: 10px;
  background: repeating-linear-gradient(0deg, rgba(128,128,128,.09) 0 1px, transparent 1px 26px),
              repeating-linear-gradient(90deg, rgba(128,128,128,.09) 0 1px, transparent 1px 26px),
              var(--ctrl-fill-tertiary, rgba(128,128,128,.05));
  border: 1px solid var(--card-stroke, rgba(128,128,128,.22)); }
.mce-blk { position: relative; width: fit-content; max-width: 100%; min-width: 210px;
  border-radius: 7px; padding: 8px 46px 8px 13px; margin-bottom: 2px;
  color: #10100f; font-size: 12.5px; box-shadow: 0 2px 0 rgba(0,0,0,.28); }
.mce-blk::after { content: ''; position: absolute; left: 10px; bottom: -6px; width: 20px; height: 6px;
  border-radius: 0 0 4px 4px; background: inherit; }
.mce-blk-hat { border-radius: 16px 16px 7px 7px; padding-top: 13px; }
.mce-blk-hat::before { content: ''; position: absolute; left: 22px; top: -9px; width: 46px; height: 18px;
  border-radius: 50% 50% 0 0; background: inherit; }
.mce-blk:last-child::after { display: none; }
.mce-blk-head { display: flex; align-items: center; gap: 7px; }
.mce-blk-title { font-weight: 700; font-size: 12.5px; }
.mce-blk-seq { font-size: 10.5px; opacity: .65; }
.mce-blk-args { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.mce-arg { display: inline-flex; align-items: center; gap: 4px; }
.mce-arg > span.mce-arg-lbl { font-size: 10.5px; opacity: .7; }
.mce-arg select, .mce-arg input { font-size: 11.5px; padding: 2px 5px; border-radius: 10px;
  border: 1px solid rgba(0,0,0,.35); background: rgba(255,255,255,.86); color: #10100f;
  font-family: inherit; max-width: 190px; }
.mce-arg input[type=number] { width: 66px; }
.mce-blk-preview { margin-top: 7px; font-family: var(--font-mono, Consolas, monospace); font-size: 11px;
  background: rgba(0,0,0,.72); color: #e6e6e6; padding: 4px 7px; border-radius: 5px;
  overflow-x: auto; white-space: pre; }
.mce-blk-ops { position: absolute; right: 6px; top: 6px; display: flex; gap: 3px; }
.mce-blk-ops button { width: 20px; height: 20px; border-radius: 5px; border: none; cursor: pointer;
  background: rgba(0,0,0,.28); color: #10100f; font-size: 12px; line-height: 1; font-weight: 700; }
.mce-blk-ops button:hover { background: rgba(0,0,0,.45); color: #fff; }
.mce-dropzone { margin-top: 12px; padding: 16px; border: 2px dashed var(--card-stroke, rgba(128,128,128,.45));
  border-radius: 9px; text-align: center; font-size: 12px; color: var(--text-secondary,#b9bcc0); }
.mce-dropzone.is-over { border-color: var(--accent,#0067c0); background: rgba(0,103,192,.14); }
.mce-scratch-pal { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.mce-sb { padding: 5px 11px; border-radius: 6px; font-size: 12px; cursor: grab; color: #10100f;
  box-shadow: 0 2px 0 rgba(0,0,0,.28); user-select: none; }
.mce-sb:active { cursor: grabbing; }

/* ---- 命令方块（2D 链） ---- */
.mce-mcb-plane { position: relative; overflow-x: auto; padding: 22px 14px 16px; border-radius: 10px;
  border: 1px solid var(--card-stroke, rgba(128,128,128,.22));
  background: repeating-linear-gradient(0deg, rgba(128,128,128,.07) 0 1px, transparent 1px 22px),
              repeating-linear-gradient(90deg, rgba(128,128,128,.07) 0 1px, transparent 1px 22px),
              var(--ctrl-fill-tertiary, rgba(128,128,128,.04)); }
.mce-mcb-row { display: flex; align-items: center; gap: 0; position: relative; min-height: 96px; }
.mce-mcb { position: relative; width: 92px; flex: 0 0 92px; text-align: center; }
.mce-mcb-cube { position: relative; width: 74px; height: 74px; margin: 0 auto; border-radius: 5px;
  border: 2px solid rgba(0,0,0,.45); box-shadow: inset 0 0 0 5px rgba(0,0,0,.22), 0 4px 10px rgba(0,0,0,.35); }
.mce-mcb-cube::before { content: ''; position: absolute; inset: 12px; border-radius: 3px;
  background: rgba(0,0,0,.24); }
.mce-mcb-cube::after { content: ''; position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
  border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 12px solid rgba(0,0,0,.5); }
.mce-mcb-arrow-up::after { top: auto; bottom: 8px; border-bottom: none; border-top: 12px solid rgba(0,0,0,.5); }
.mce-mcb-repeat::after { border-radius: 50%; width: 20px; height: 20px; inset: auto; left: 50%; top: 50%;
  transform: translate(-50%,-50%); background: rgba(0,0,0,.45); border: none; }
.mce-mcb-chain::after { border: none; width: 22px; height: 6px; background: rgba(0,0,0,.5); top: 50%;
  transform: translate(-50%,-50%); border-radius: 3px; }
.mce-mcb-cond { box-shadow: inset 0 0 0 5px rgba(0,0,0,.22), 0 0 0 2px #ffcc31, 0 4px 10px rgba(0,0,0,.35); }
.mce-mcb-label { font-size: 11px; margin-top: 5px; color: var(--text-secondary,#b9bcc0); }
.mce-mcb-cmd { font-family: var(--font-mono, Consolas, monospace); font-size: 10.5px; color: var(--text-tertiary,#9aa0a6);
  margin-top: 2px; max-width: 118px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: auto; margin-right: auto; }
.mce-mcb-link { flex: 0 0 34px; height: 3px; background: var(--text-tertiary,#9aa0a6); position: relative; }
.mce-mcb-link::after { content: ''; position: absolute; right: -1px; top: -5px;
  border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  border-left: 9px solid var(--text-tertiary,#9aa0a6); }
.mce-mcb-axis { position: absolute; left: 10px; top: 6px; font-size: 10.5px; color: var(--text-tertiary,#9aa0a6); }
.mce-mcb-rec { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mce-mcb-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 11px;
  color: var(--text-secondary,#b9bcc0); align-items: center; }
.mce-port-legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  font-size: 11.5px; color: var(--text-secondary,#b9bcc0); margin: 6px 0 4px; }
.mce-port-legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 4px; }
`;

/** 幂等注入样式：同一文档只插一次 */
export function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('mce-graph-style')) return;
  const el = h('style#mce-graph-style', { type: 'text/css' });
  el.textContent = GRAPH_CSS;
  document.head.appendChild(el);
}

/** 端口类型图例（页面上用，说明配色含义） */
export function portLegend() {
  const box = h('div.mce-port-legend');
  for (const k of PORT_TYPE_KEYS) {
    if (k === 'any') continue;
    box.appendChild(h('span', null, [
      h('i', { style: { background: portColor(k) } }),
      document.createTextNode(`${portLabel(k)}  ${k === 'trigger' ? '（触发，可多连一）' : k === 'object' ? '（对象）' : ''}`),
    ]));
  }
  return box;
}
