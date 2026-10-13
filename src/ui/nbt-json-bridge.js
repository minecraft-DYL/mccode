// nbt-json-bridge.js —— NBT 值与「纯 JSON」之间的无损桥。
//
// 【为什么需要它】
// 宿主交付的 src/graph/json-graph.js 声明「jsonToGraphData → graphToJson 往返恒等」，
// 但那只对**纯 JSON** 成立。NBT 的标量不是纯 JSON：
//   NBTNumber extends Number  ⇒ typeof === 'object'
// 而 json-graph.js 第 27 行是
//   const isContainer = (v) => v !== null && typeof v === 'object';
// 于是 NBTNumber 被判成「容器」，走对象分支，读 Object.keys(nbtNumber) ——
// 实测 `Object.keys(new NBTNumber(1,'b'))` === ['suffix']，
// 结果 `N:1b` 在图上变成一个叫 suffix 的字段，回写出来是 `N:{suffix:"b"}`。
// NBTArray extends Array 同理，会丢掉 B/I/L 的数组类型。
//
// 【本文件的做法】不改宿主的 src/graph/*（不在我的可改范围内），
// 而是在进图之前把 NBT 值降级成纯 JSON，并逐路径记下类型；出图后再按类型还原。
// 这样：
//   ① 宿主拿到的一定是纯 JSON，往返恒等的前提成立；
//   ② 数值后缀（b/s/l/f/d）与数组类型（B/I/L）不会丢；
//   ③ 顺带把 JSON 标量在图上被存成字符串这件事也修正了（json_field 存的是 String(value)）。
//
// 【路径约定】path 用字符串键，段之间用 \u0000 连接（对象键/数组下标都可能含普通字符，
// 用不可见字符避免歧义）。

import { NBTNumber, NBTArray } from '../core/nbt.js';

const SEP = '\u0000';
const pk = (path) => path.join(SEP);
const unpk = (k) => (k === '' ? [] : k.split(SEP));

/**
 * NBT 值 → { plain, types }
 * plain 是纯 JSON（可以安全交给 graphFromJson），types 记录每个标量/数组的类型。
 */
export function nbtToPlain(value) {
  const types = new Map();

  function conv(v, path) {
    if (v instanceof NBTNumber) {
      types.set(pk(path), { t: 'num', suffix: v.suffix == null ? null : String(v.suffix) });
      return Number(v);
    }
    if (v instanceof NBTArray) {
      types.set(pk(path), { t: 'arr', kind: v.kind == null ? null : String(v.kind) });
      return Array.from(v).map((x, i) => conv(x, [...path, i]));
    }
    if (Array.isArray(v)) {
      // 普通 JS 数组（parseSNBT 里没有显式类型的 List）
      return v.map((x, i) => conv(x, [...path, i]));
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = conv(v[k], [...path, k]);
      return out;
    }
    if (v === null || v === undefined) { types.set(pk(path), { t: 'null' }); return null; }
    if (typeof v === 'boolean') { types.set(pk(path), { t: 'bool' }); return v; }
    if (typeof v === 'number') { types.set(pk(path), { t: 'num', suffix: null }); return v; }
    types.set(pk(path), { t: 'str' });
    return String(v);
  }

  return { plain: conv(value, []), types };
}

/** 把图上回来的字符串按记录的类型还原成 NBT 标量 */
function rebuildScalar(raw, desc) {
  if (!desc) return raw;
  switch (desc.t) {
    case 'num': {
      // 图上标量一律是字符串（json_field 存 String(value)），这里按数值还原
      if (typeof raw === 'number') return desc.suffix ? new NBTNumber(raw, desc.suffix) : raw;
      const s = String(raw).trim();
      if (s === '') return desc.suffix ? new NBTNumber(0, desc.suffix) : 0;
      const n = Number(s);
      if (!Number.isFinite(n)) return raw;                 // 用户写坏了就原样交回去，让 SNBT 校验去报错
      return desc.suffix ? new NBTNumber(n, desc.suffix) : n;
    }
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      return String(raw).toLowerCase() === 'true' || String(raw) === '1';
    case 'null':
      return raw === '' || raw === null || String(raw).toLowerCase() === 'null' ? null : raw;
    case 'str':
      return raw === null || raw === undefined ? '' : String(raw);
    default:
      return raw;
  }
}

/**
 * 安全地造一个 NBTArray。
 *
 * 【为什么不能直接 new NBTArray(kind, items)】
 * src/core/nbt.js 里是
 *   class NBTArray extends Array { constructor(kind, items = []) { super(...items); this.kind = kind; } }
 * 当 items 恰好只有**一个数字**时，`super(...items)` 等价于 `super(100)`，
 * 而 `Array(100)` 会造出「长度 100 的稀疏数组」而不是「含一个元素的数组」——
 * 实测 `new NBTArray('L', [100]).length === 100`，toSNBT 出来是 `[L;NaNl ×100]`。
 * （parseSNBT 自己不受影响，它是 new 完再 push 的。）
 * src/core/* 不在我的可改范围内，所以这里绕开：先造空的再逐个 push。
 */
function makeNBTArray(kind, items) {
  const arr = new NBTArray(kind || 'B');
  for (const it of items) arr.push(it);
  return arr;
}

/**
 * { plain, types } → NBT 值。
 * 只按 types 里记录过的路径还原；用户在图里新增的键没有记录，保持原样。
 */
export function plainToNbt(plain, types) {
  const map = types instanceof Map ? types : new Map(Object.entries(types || {}));

  function conv(v, path) {
    const desc = map.get(pk(path));
    if (desc && desc.t === 'arr' && Array.isArray(v)) {
      const items = v.map((x, i) => conv(x, [...path, i]));
      return makeNBTArray(desc.kind, items);
    }
    if (Array.isArray(v)) return v.map((x, i) => conv(x, [...path, i]));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = conv(v[k], [...path, k]);
      return out;
    }
    if (desc && desc.t === 'arr' && !Array.isArray(v)) return v;   // 结构被改坏，别硬套
    return rebuildScalar(v, desc);
  }

  return conv(plain, []);
}

/** 便捷：一次往返，用于自测 */
export function roundTrip(value) {
  const { plain, types } = nbtToPlain(value);
  return plainToNbt(plain, types);
}

/** 调试用：把类型表转成可读数组 */
export function dumpTypes(types) {
  const map = types instanceof Map ? types : new Map(Object.entries(types || {}));
  return [...map.entries()].map(([k, v]) => ({ path: unpk(k), ...v }));
}
