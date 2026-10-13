// nbt-graph-adapter.js —— 「NBT 对象 → 节点图」纯数据适配（零 DOM、零副作用）
//
// 定位：这是给将来「NBT 编辑器 / 物品组件编辑器切节点图模式」用的中间层。
//   它只做数据变换：解析结果（NBT 值树）→ 节点图可消费的 { types, data } 结构。
//   不碰 document、不 import 任何 UI 模块，因此可以在 Node 里直接单测（见文件末尾 __selftest）。
//
// 目标结构与 src/graph/nodegraph.js 对齐：
//   节点定义 def   : { type, title, color, desc, fields: [...], outPorts?: [...] }
//   节点实例 node  : { id, type, x, y, values: { fieldKey: value }, fields?, outPorts? }
//   字段 field     : { key, label, port: true, portType, type?, mono?, placeholder?, default? }
//   连线通过 port 名（field.key 为输入端口名）匹配，见 nodegraph.js 的 portCompat。
//
// 与真实注册表的出入口（父代理后续接宿主时用这两个签名）：
//   nbtToGraph(value, opts)          → { types, data, meta }
//   graphToNbt(data, opts)           → { ok, value, errors }
//
// 中文名来自 src/data/nbt-labels.js（wiki 取证表），查不到就显示「未取证」，不编。

import { NBTNumber, NBTArray, toSNBT } from '../core/nbt.js';
import { nbtLookup, nbtTypeLabel } from '../data/nbt-labels.js';

/* ============================== 类型判定 ============================== */

/**
 * 判定一个值的「图端口类型」。
 * 端口类型刻意与现有节点图保持同一套字面量：string / int / float / bool / object / list / trigger
 */
export function portTypeOf(value) {
  if (value instanceof NBTArray) return 'list';       // 字节/整型/长整型数组统一走列表端口
  if (value instanceof NBTNumber) {
    const s = value.suffix;
    if (s === 'b') return 'bool';          // 字节型在 NBT 里最常用作布尔
    if (s === 's' || s === 'i' || s === 'l') return 'int';
    return 'float';                         // f / d
  }
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'string';
  if (value && typeof value === 'object') return 'object';
  return 'string';
}

/** 值 → 图上显示的一行摘要（长的截断） */
export function previewOf(value, max = 60) {
  if (value == null) return '（空）';
  if (value && typeof value === 'object') {
    const n = Array.isArray(value) ? value.length : Object.keys(value).length;
    return Array.isArray(value) ? `[${n} 项]` : `{${n} 个键}`;
  }
  const s = toSNBT(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** NBT 类型名（中文）——直接给节点副标题用 */
export function typeLabelOf(value) {
  if (value instanceof NBTNumber) return nbtTypeLabel(value.tagType);
  if (value instanceof NBTArray) return nbtTypeLabel({ B: 'BYTE_ARRAY', I: 'INT_ARRAY', L: 'LONG_ARRAY' }[value.kind]);
  if (Array.isArray(value)) return '列表';
  if (value && typeof value === 'object') return '复合标签';
  if (typeof value === 'string') return '字符串';
  if (typeof value === 'boolean') return '布尔（字节型）';
  return nbtTypeLabel('INT');
}

/* ============================== 路径工具 ============================== */

/**
 * 是不是「叶子」值。
 * 关键：NBTNumber（带 b/s/i/l/f/d 后缀的数字）与 NBTArray 都是对象，
 * 但它们必须是叶子 —— 否则遍历会钻进 .suffix / .items 内部，生成一堆假节点。
 */
export function isLeaf(value) {
  if (value == null) return true;
  if (value instanceof NBTNumber || value instanceof NBTArray) return true;
  if (typeof value !== 'object') return true;
  return false;
}

/** 容器是不是列表（普通数组或 NBTArray） */
export function isListLike(value) {
  return Array.isArray(value) || value instanceof NBTArray;
}

/** 容器长度 */
export function sizeOf(value) {
  if (isListLike(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

/** 键路径拼接：父子之间用 '.'，数组下标用 '[]' */
export function joinPath(parent, key, isIndex) {
  if (!parent) return isIndex ? '[]' : String(key);
  return isIndex ? `${parent}[]` : `${parent}.${key}`;
}

/** 去掉数组下标，用于查表取中文名 */
function lookupFor(path, key) {
  return nbtLookup(key || path);
}

/**
 * 由上下文容器推断作用域，用于消歧同名键（id / color / Name / type 在不同作用域含义不同）。
 * 与 src/ui/pages/nbt.js 的 inferScope 保持同一套规则 —— 两处必须一致，否则同一个键
 * 在结构树和节点图里会显示成不同中文名。
 */
export function inferScope(obj) {
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
  if (has('count', 'components')) return '物品';
  if (has('amplifier', 'duration', 'show_particles')) return '效果';
  return null;
}

/** 中文名 + 类型 + 说明（查不到就是「未取证」） */
export function labelOf(path, key, scopeHint) {
  let hit = null;
  if (scopeHint) hit = nbtLookup(key || path, { scope: scopeHint });
  if (!hit) hit = lookupFor(path, key);
  if (!hit) return { name: null, label: '未取证', type: '', desc: '', scope: '', since: null };
  return {
    name: hit.name,
    label: hit.name,
    type: hit.type,
    desc: hit.desc,
    scope: hit.scope,
    since: hit.since,
  };
}

/* ============================== 主入口：NBT → 图 ============================== */

const PALETTE = {
  复合: '#4cc2ff', 列表: '#d6a2ff', 数组: '#ffcc80',
  字符串: '#ffcc80', 数值: '#b5e8a0', 布尔: '#7ec8ff', 未取证: '#888888',
};

/**
 * NBT 值树 → 节点图数据。
 *
 * @param {*} value   parseSNBT() 的结果（或任意 NBT 值树）
 * @param {object} [opts]
 *   opts.rootName      根节点标题（默认 'NBT 根标签'）
 *   opts.rootId        根节点 id（默认 'nbt_root'）
 *   opts.maxDepth      最深展开层数，默认 6；超过则折叠为一个占位节点
 *   opts.collapseKeys  这些键名下的子树只折叠展示（默认空数组）
 *   opts.x / opts.y    根节点坐标（默认 80 / 60）
 *   opts.dx / opts.dy  子节点步进（默认 300 / 120）
 *   opts.includeLeafFields  叶子节点是否额外给一个「值」输出端口，默认 true
 * @returns {{ types: object[], data: {nodes: object[]}, meta: object }}
 */
export function nbtToGraph(value, opts = {}) {
  const {
    rootName = 'NBT 根标签',
    rootId = 'nbt_root',
    maxDepth = 6,
    collapseKeys = [],
    x = 80, y = 60,
    dx = 300, dy = 120,
    includeLeafFields = true,
  } = opts;

  const types = [];
  const nodes = [];
  const meta = {
    keyCount: 0, namedCount: 0, unnamed: [],           // 未取证的键，交给 UI 如实提示
    maxDepthSeen: 0, truncated: [], rootType: typeLabelOf(value),
  };
  let seq = 0;
  const nextId = (p) => `${rootId}_${slug(p)}_${++seq}`;

  const typeCache = new Map();
  function ensureType({ type, title, color, desc, fields, outPorts }) {
    if (typeCache.has(type)) return typeCache.get(type);
    const def = { type, title, color, desc, fields };
    if (outPorts) def.outPorts = outPorts;
    typeCache.set(type, def);
    types.push(def);
    return def;
  }

  function colorFor(kind) {
    return PALETTE[kind] || PALETTE.复合;
  }

  /**
   * 建一个「子标签」节点。
   * 复合/列表节点带一个对象输出端口；叶子节点可选带值输出端口。
   */
  function makeNode(path, key, val, depth, isIndex, scopeHint) {
    const leaf = isLeaf(val);
    const listLike = !leaf && isListLike(val);
    const kind = leaf ? '叶子' : (listLike ? '列表' : '复合');
    const info = labelOf(path, key, scopeHint);
    const zh = info.name || '未取证';
    const nbtType = typeLabelOf(val);
    meta.keyCount++;
    if (info.name) meta.namedCount++;
    else if (!isIndex && path) meta.unnamed.push(path);

    const typeId = `nbt_${kind === '复合' ? 'compound' : kind === '列表' ? 'list' : 'leaf'}`;
    const portType = portTypeOf(val);

    const fields = [];
    // 输入端口：把父节点的「子标签」输出接进来（数组元素接到「元素」端口）
    fields.push({
      key: isIndex ? 'item' : 'parent',
      label: isIndex ? '元素' : '父标签',
      port: true, portType: 'object',
      placeholder: '接父节点的「子标签」输出',
    });
    // 键名 / 中文名只读展示
    fields.push({ key: 'key', label: '键名', type: 'text', mono: true, default: isIndex ? String(key) : String(key) });
    fields.push({ key: 'name', label: '中文名', type: 'text', default: info.name || '' });
    fields.push({ key: 'type', label: 'NBT 类型', type: 'text', default: nbtType });

    if (leaf) {
      fields.push({
        key: 'value', label: '值', port: true, portType,
        type: 'text', mono: true, default: toSNBT(val), placeholder: `${nbtType} 字面量`,
      });
    } else {
      fields.push({ key: 'size', label: kind === '列表' ? '元素数' : '子键数', type: 'number', default: sizeOf(val) });
    }
    fields.push({ key: 'desc', label: '说明', type: 'text', default: info.desc || (info.name ? '' : 'zh.minecraft.wiki 未收录此键，故不给中文名') });
    if (info.scope) fields.push({ key: 'scope', label: '作用域', type: 'text', default: info.scope });
    if (info.since) fields.push({ key: 'since', label: '引入版本', type: 'text', default: info.since });

    ensureType({
      type: typeId,
      title: kind === '列表' ? 'NBT 列表项' : kind === '复合' ? 'NBT 复合标签' : 'NBT 叶子标签',
      color: colorFor(kind),
      desc: '由 NBT 结构树生成的节点；中文名与类型来自 zh.minecraft.wiki 取证表。',
      fields: fields.filter((f) => !(f.key === 'value' && !includeLeafFields)),
      // 复合/列表额外给一个对象输出，供子键输入端口连接
      outPorts: leaf && !includeLeafFields ? undefined : [
        { port: '__nbt', type: leaf ? portType : 'object', label: leaf ? '值' : '子标签' },
      ],
    });

    const node = {
      id: nextId(path),
      type: typeId,
      x: x + depth * dx,
      y: y + (nodes.length % 24) * dy,
      values: {
        key: isIndex ? String(key) : String(key),
        name: info.name || '',
        type: nbtType,
        ...(leaf ? { value: toSNBT(val) } : { size: sizeOf(val) }),
        desc: info.desc || '',
        ...(info.scope ? { scope: info.scope } : {}),
        ...(info.since ? { since: info.since } : {}),
      },
      __path: path,
      __isIndex: !!isIndex,
      __label: isIndex ? `${key} 项 · ${nbtType}` : `${zh} · ${nbtType}`,
      __preview: previewOf(val),
    };
    nodes.push(node);
    meta.maxDepthSeen = Math.max(meta.maxDepthSeen, depth);
    return node;
  }

  function walk(val, path, key, depth, isIndex, scopeHint) {
    const node = makeNode(path, key, val, depth, isIndex, scopeHint);
    if (isLeaf(val)) return { node, children: [] };

    if (depth >= maxDepth) {
      meta.truncated.push({ path, depth });
      node.__truncated = true;
      node.__preview = `${previewOf(val)}（已到展开上限 ${maxDepth} 层，未继续展开）`;
      return { node, children: [] };
    }
    if (!isIndex && collapseKeys.includes(key)) {
      node.__collapsed = true;
      node.__preview = `${previewOf(val)}（按配置折叠）`;
      return { node, children: [] };
    }

    const listLike = isListLike(val);
    const entries = listLike
      ? Array.from(val).map((v, i) => [String(i), v, true])
      : Object.entries(val).map(([k, v]) => [k, v, false]);

    // 作用域下传：自身容器的特征优先；列表容器本身说明不了作用域，改看「元素对象」的特征。
    // 于是 Enchantments:[{id,lvl}] 里的 id 会解析成「魔咒的命名空间 ID」而不是实体的 id。
    const elemFeature = listLike ? (Array.from(val).find((x) => x && typeof x === 'object' && !isLeaf(x)) || null) : null;
    const childScope = inferScope(elemFeature) || inferScope(val) || scopeHint || null;

    const children = [];
    for (const [k, v, idx] of entries) {
      const childPath = joinPath(path, k, idx);
      const r = walk(v, childPath, k, depth + 1, idx, childScope);
      children.push(r.node);
    }
    // 父 → 子 连线：用 port 名表达（nodegraph 用 port 名匹配）
    node.__children = children.map((c) => ({ id: c.id, port: c.__isIndex ? 'item' : 'parent' }));
    return { node, children };
  }

  const root = walk(value, '', rootName, 0, false, null);
  root.node.type = 'nbt_root';
  root.node.id = rootId;
  // 根节点定义覆盖成专用类型（标题更好看）
  types.unshift({
    type: 'nbt_root',
    title: rootName,
    color: colorFor('复合'),
    desc: 'NBT 结构树根节点。中文名来自 zh.minecraft.wiki 取证表；未收录的键如实显示「未取证」。',
    fields: [
      { key: 'rootType', label: '根类型', type: 'text', default: meta.rootType },
      { key: 'keys', label: '子键数', type: 'number', default: meta.keyCount },
      { key: 'named', label: '已汉化', type: 'text', default: `${meta.namedCount}/${meta.keyCount}` },
      { key: 'unnamed', label: '未取证键', type: 'text', default: meta.unnamed.slice(0, 5).join(', ') || '（无）' },
    ],
    outPorts: [{ port: '__nbt', type: 'object', label: '子标签' }],
  });

  return { types, data: { nodes }, meta };
}

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24) || 'n';
}

/* ============================== 反向：图 → NBT ============================== */

/**
 * 节点图数据 → NBT 值树。用于「在节点图里改完再写回 SNBT」。
 * 只认本适配器生成的节点（带 __path 与 key/value 字段）。
 *
 * @param {{nodes:object[]}} data
 * @returns {{ok:boolean, value:*, errors:string[], warnings:string[]}}
 */
export function graphToNbt(data, opts = {}) {
  const { preferParsed = null } = opts;
  const errors = [];
  const warnings = [];
  const nodes = (data && data.nodes) || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => n.type === 'nbt_root') || nodes[0];
  if (!root) return { ok: false, value: null, errors: ['图里没有任何节点'], warnings };

  /** 把节点的 values.value 文本还原成 NBT 值 */
  function valueFromNode(n) {
    if (!n) return '';
    const raw = n.values && n.values.value;
    if (raw == null || raw === '') return '';
    if (preferParsed) {
      const parsed = preferParsed(raw, n);
      if (parsed !== undefined) return parsed;
    }
    // 惰性解析：这里有循环依赖风险，故只在真正需要时动态 import 已由调用方保证可用
    return raw;
  }

  const out = Object.create(null);
  const childrenOf = (n) => (n.__children || []).map((c) => byId.get(c.id)).filter(Boolean);
  const stack = new Set();
  function build(n) {
    if (!n) return null;
    if (stack.has(n.id)) { errors.push(`检测到环：${n.id}`); return null; }
    stack.add(n.id);
    const kids = childrenOf(n);
    const isList = n.type === 'nbt_list';
    if (!kids.length && !isList) {
      // 叶子：优先用值文本
      if (n.values && 'value' in n.values && n.values.value !== '') return valueFromNode(n);
      // 没有值的复合标签
      return Object.create(null);
    }
    if (isList) {
      const arr = [];
      for (const k of kids) arr.push(build(k));
      stack.delete(n.id);
      return arr;
    }
    const obj = Object.create(null);
    for (const k of kids) {
      const key = (k.values && k.values.key) || k.__path;
      obj[key] = build(k);
    }
    stack.delete(n.id);
    return obj;
  }

  const value = build(root);
  if (!value || typeof value !== 'object') {
    errors.push('根节点没有可还原的子键（叶子节点的值请直接编辑 SNBT 文本）');
  }
  return { ok: errors.length === 0, value, errors, warnings };
}

/* ============================== 自检（node 直接跑本文件） ============================== */

export const __adapterApi = {
  portTypeOf, previewOf, typeLabelOf, labelOf, joinPath, nbtToGraph, graphToNbt,
};
