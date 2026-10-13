// graph/json-graph.js —— 通用「JSON/NBT 对象 ⇄ 节点图」适配器
//
// 给别的编辑器（NBT 编辑器 / 物品组件编辑器 …）复用：
//   import { jsonToGraphData, graphToJson, jsonGraphTypes, jsonGraphPorts } from './json-graph.js';
//   import { createGraph } from './nodegraph.js';
//   const graph = createGraph(host, {
//     types: jsonGraphTypes(), ports: jsonGraphPorts(), nodes: jsonToGraphData(nbt).nodes, links: ...,
//     onEmit: (g) => { const back = graphToJson(g); /* 写回你的 SNBT */ },
//   });
//
// 映射规则（可逆）：
//   · 对象       → 一个 json_object 节点：每个键是一个 object 输入端口（端口名 = 键名）
//   · 数组       → 一个 json_array  节点：每个下标是一个 object 输入端口（端口名 = 下标）
//   · 标量       → 一个 json_field  节点：节点上有该标量类型的输入端口 + 一个同类型输出端口
//   · 嵌套容器   → 子节点 → 父节点的「键名」端口，用 object 类型连线
//   · 根节点     → 没有入线的那个容器节点；jsonToGraphData 会把它放在最右侧
// 所以 jsonToGraphData → graphToJson 是恒等（往返不丢数据、不改类型）。

// NBTNumber / NBTString / NBTBoolean 这些是 Number/String/Boolean 的子类，
// typeof 全部是 'object'。不排除的话一个 1b 会被当成容器走对象分支，
// 读 Object.keys 得到 ['suffix']，往返出来变成 {suffix:"b"} —— 实测过。
// NBTArray extends Array 是例外：数组本来就该当容器，所以不排除 Array。
const isBoxed = (v) => v instanceof Number || v instanceof String || v instanceof Boolean;

const T = (v) => {
  if (v === null || v === undefined) return 'nullable';
  if (v instanceof Boolean) return 'bool';
  if (v instanceof String) return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number' || v instanceof Number) return Number.isInteger(Number(v)) ? 'int' : 'float';
  if (typeof v === 'string') return 'string';
  return 'object';   // 对象 / 数组
};

const isContainer = (v) => v !== null && typeof v === 'object' && !isBoxed(v);

/** 端口类型补充表：JSON 用到的端口类型统一在这里声明一次 */
export function jsonGraphPorts() {
  return { value: 'any', out: 'any' };
}

/** 生成 JSON 图所需的节点类型（json_object / json_array / json_field） */
export function jsonGraphTypes() {
  return {
    json_object: {
      title: '对象 {}', color: '#c586c0', kind: 'value', nodeCat: 'value',
      desc: '一个 JSON/NBT 复合标签。每个键是左边一个 object 输入端口，由对应的子节点喂数据。',
      outType: 'object',
      fields: [],                        // 实际端口由每个节点自己的 fields 动态声明
      resolve: (n, g) => {
        const out = {};
        for (const f of n.fields || []) {
          const v = g(n.id, f.key);
          if (v !== undefined) out[f.key] = v;
        }
        return out;
      },
    },
    json_array: {
      title: '列表 []', color: '#c586c0', kind: 'value', nodeCat: 'value',
      desc: '一个 JSON/NBT 列表标签。每个下标是左边一个 object 输入端口，按顺序拼回数组。',
      outType: 'object',
      fields: [],
      resolve: (n, g) => {
        const idx = (n.fields || []).map((f) => f.key).sort((a, b) => Number(a) - Number(b));
        return idx.map((k) => g(n.id, k));
      },
    },
    json_field: {
      title: '字段', color: '#8fd6a0', kind: 'value', nodeCat: 'value',
      desc: '一个标量字段：左边是「上游连过来的值」，右边输出该值。',
      outType: 'any',
      fields: [{ key: 'value', label: '值', port: true, portType: 'any', type: 'text', default: '' }],
      resolve: (n, g) => {
        const linked = g(n.id, 'value');
        return linked === undefined ? n.values.value : linked;
      },
    },
  };
}

/**
 * 任意 JSON 对象 → 节点图数据
 * @param {any} obj 要编辑的对象（对象或数组）
 * @param {object} o { rootTitle, gapX=320, gapY=90, x=40, y=40 }
 * @returns {{nodes:Array, links:Array, sequence:Array}} 可直接喂给 createGraph / graph.fromJSON
 */
export function jsonToGraphData(obj, o = {}) {
  const nodes = [];
  const links = [];
  const gapX = o.gapX ?? 320;
  const gapY = o.gapY ?? 90;
  let seq = 0;
  let uid = 0;
  const nid = () => `j${++uid}`;

  // 先算深度（根最深，放最右），再排版
  const depthOf = (v, d = 0) => {
    if (!isContainer(v)) return d;
    const vals = Array.isArray(v) ? v : Object.values(v);
    return vals.reduce((m, x) => Math.max(m, depthOf(x, d + 1)), d + 1);
  };
  const maxDepth = depthOf(obj);
  const rowOfDepth = new Map();

  function walk(value, key, parentId, depth) {
    const kind = T(value);
    const id = nid();
    const x = (maxDepth - depth) * gapX + (o.x ?? 40);
    let row = rowOfDepth.get(depth) || 0;
    rowOfDepth.set(depth, row + 1);
    const y = row * gapY + (o.y ?? 40);

    if (kind === 'object') {
      const isArr = Array.isArray(value);
      const keys = isArr ? value.map((_, i) => String(i)) : Object.keys(value);
      const fields = keys.map((k) => ({
        key: k, label: k, port: true, portType: T(value[k]), type: 'port',
      }));
      nodes.push({
        id, type: isArr ? 'json_array' : 'json_object', x, y,
        values: {}, fields,
        title: isArr ? `${key || o.rootTitle || 'root'} [${keys.length}]` : `${key || o.rootTitle || 'root'}`,
      });
      if (parentId) links.push({ from: { node: id, port: '__out' }, to: { node: parentId, port: key } });
      void seq;
      for (const k of keys) walk(value[k], k, id, depth + 1);
      return id;
    }

    const portType = kind === 'nullable' ? 'nullable' : kind;
    nodes.push({
      id, type: 'json_field', x, y,
      values: { value: value === null || value === undefined ? '' : String(value) },
      fields: [{ key: 'value', label: String(value === null ? 'null' : kind), port: true, portType, type: kind === 'bool' ? 'bool' : kind === 'string' ? 'text' : 'text' }],
      outPorts: [{ port: '__out', type: portType, label: '值' }],
      title: String(key),
    });
    if (parentId) links.push({ from: { node: id, port: '__out' }, to: { node: parentId, port: key } });
    return id;
  }

  const rootId = walk(obj, '', null, 0);
  // 根节点标出来，反向还原时不必再猜
  const root = nodes.find((n) => n.id === rootId);
  if (root) root.isRoot = true;
  return { nodes, links, sequence: [] };
}

/** 节点图 → JSON 对象（jsonToGraphData 的逆运算） */
export function graphToJson(graph) {
  const nodes = graph.nodes instanceof Map ? graph.nodes : new Map(Object.entries(graph.nodes || {}));
  const links = graph.links || [];
  const valOf = (node, key) => {
    const l = links.find((x) => x.to.node === node.id && x.to.port === key);
    if (!l) return undefined;
    const up = nodes.get(l.from.node);
    return up ? build(up) : undefined;
  };
  const cache = new Map();
  function build(node) {
    if (cache.has(node.id)) return cache.get(node.id);
    cache.set(node.id, undefined);
    let out;
    if (node.type === 'json_object') {
      out = {};
      for (const f of node.fields || []) {
        const v = valOf(node, f.key);
        if (v !== undefined) out[f.key] = v;
      }
    } else if (node.type === 'json_array') {
      const keys = (node.fields || []).map((f) => f.key).sort((a, b) => Number(a) - Number(b));
      out = keys.map((k) => valOf(node, k));
    } else {
      const linked = valOf(node, 'value');
      const raw = linked === undefined ? node.values.value : linked;
      out = coerce(raw, (node.fields && node.fields[0] && node.fields[0].portType) || 'string');
    }
    cache.set(node.id, out);
    return out;
  }
  // 根 = 没有入线的容器节点；没有就退回第一个容器
  const containers = Array.from(nodes.values()).filter((n) => n.type === 'json_object' || n.type === 'json_array');
  const rootNode = containers.find((n) => n.isRoot)
    || containers.find((n) => !links.some((l) => l.from.node === n.id))
    || containers[0];
  if (!rootNode) return {};
  return build(rootNode);
}

function coerce(raw, type) {
  if (type === 'int') { const n = parseInt(raw, 10); return Number.isFinite(n) ? n : 0; }
  if (type === 'float') { const n = Number(raw); return Number.isFinite(n) ? n : 0; }
  if (type === 'bool') return raw === true || raw === 'true' || raw === 1 || raw === '1';
  if (type === 'nullable') return raw === '' || raw === 'null' ? null : raw;
  return raw === undefined ? '' : String(raw);
}

/** 便捷：直接在一个 host 上建一张「编辑这个 JSON 对象」的图 */
export function createJsonGraph(host, obj, { createGraph, onEmit, ...rest } = {}) {
  if (typeof createGraph !== 'function') throw new Error('createJsonGraph 需要传入 createGraph');
  const data = jsonToGraphData(obj);
  return createGraph(host, {
    types: jsonGraphTypes(),
    ports: jsonGraphPorts(),
    nodes: data.nodes, links: data.links, sequence: [],
    onEmit: (g) => { if (onEmit) onEmit(graphToJson(g), g); },
    ...rest,
  });
}

/** 节点图数据 → 通用 JSON（给宿主自己序列化用） */
export function serializeGraph(graph) {
  return graph && typeof graph.toJSON === 'function' ? graph.toJSON() : null;
}

/* -------------------- 别名（与宿主约定的接口名，父代理可直接用） -------------------- */

/**
 * graphFromJson(obj) —— JSON / NBT 对象 → 图数据 {nodes, links, sequence}
 * 用法：
 *   const graph = createGraph(host, {
 *     types: jsonGraphTypes(),
 *     ...graphFromJson(nbt),                 // nodes + links
 *     onEmit: (g) => saveSNBT(jsonFromGraph(g)),
 *   });
 */
export const graphFromJson = jsonToGraphData;

/** jsonFromGraph(graph) —— 图 → JSON / NBT 对象（graphFromJson 的逆运算，往返恒等） */
export const jsonFromGraph = graphToJson;
