// nbt.js —— NBT / SNBT 完整实现（零依赖）
//   ① SNBT 文本 → 值树（带数值类型后缀）    ② 值树 → SNBT 文本
//   ③ SNBT 格式化 / 语法高亮                 ④ 二进制 NBT（tag 0..12）读写
//   ⑤ gzip 解压 / 压缩（浏览器原生 API）—— 于是可以真正打开 level.dat / playerdata/*.dat
//
// 表示法：
//   compound → 普通对象（保序，用 Object.create(null)）
//   list     → Array
//   数值     → NBTNumber（Number 子类，带 suffix: b/s/i/l/f/d）
//   字符串   → string      布尔 → boolean
//   字节/整数/长整数数组 → NBTArray（Array 子类，带 kind: 'B'|'I'|'L'）

export class NBTNumber extends Number {
  constructor(v, suffix = 'i') { super(v); this.suffix = suffix; }
  get tagType() {
    return { b: 'byte', s: 'short', i: 'int', l: 'long', f: 'float', d: 'double' }[this.suffix];
  }
}

export class NBTArray extends Array {
  // ⚠️ 不能写 `super(...items)`：items 恰好只有一个数字时，super(100) 等价于 Array(100)，
  // 造出的是「长度 100 的稀疏数组」而不是「含一个元素的数组」。
  // 实测 new NBTArray('L',[100]).length === 100，toSNBT 出来是 100 个 NaN。
  //
  // 同时必须兼容 Array 子类的内部调用：map/slice/filter 会通过 ArraySpeciesCreate
  // 以「单个数字 = 新数组长度」的形式调用构造器，那种调用要原样交给 super(length)。
  constructor(kind, items) {
    if (typeof kind === 'number' && items === undefined) { super(kind); return; }
    super();
    this.kind = kind;
    for (const it of items || []) this.push(it);
  }
}

const UNQUOTED = /^[A-Za-z0-9._+\-]+$/;

/* ============================== SNBT 解析 ============================== */

class Lexer {
  constructor(s) { this.s = s; this.i = 0; }
  ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  peek(n = 0) { return this.s[this.i + n]; }
  eof() { this.ws(); return this.i >= this.s.length; }
}

export function parseSNBT(input) {
  const lx = new Lexer(String(input ?? ''));
  const errs = [];
  const fail = (msg) => { const e = new Error(`${msg}（位置 ${lx.i}）`); e.pos = lx.i; throw e; };

  function parseValue() {
    lx.ws();
    const c = lx.peek();
    if (c === undefined) fail('意外的结尾，期待一个值');
    if (c === '{') return parseCompound();
    if (c === '[') return parseList();
    if (c === '"' || c === "'") return parseQuoted();
    return parseBare();
  }

  function parseCompound() {
    lx.i++; // {
    const obj = Object.create(null);
    lx.ws();
    if (lx.peek() === '}') { lx.i++; return obj; }
    for (;;) {
      lx.ws();
      const k = (lx.peek() === '"' || lx.peek() === "'") ? parseQuoted() : parseBareKey();
      lx.ws();
      if (lx.peek() !== ':') fail('期待 ":"');
      lx.i++;
      obj[k] = parseValue();
      lx.ws();
      const n = lx.peek();
      if (n === ',') { lx.i++; lx.ws(); if (lx.peek() === '}') { lx.i++; break; } continue; }
      if (n === '}') { lx.i++; break; }
      fail('化合物里期待 "," 或 "}"');
    }
    return obj;
  }

  function parseList() {
    lx.i++; // [
    lx.ws();
    // 类型化数组：[B; ...] [I; ...] [L; ...]
    const m = /^([BIL]);/.exec(lx.s.slice(lx.i, lx.i + 3));
    if (m) {
      const kind = m[1];
      lx.i += 2;
      const arr = new NBTArray(kind);
      lx.ws();
      if (lx.peek() === ']') { lx.i++; return arr; }
      for (;;) {
        arr.push(toPlainNumber(parseValue()));
        lx.ws();
        const n = lx.peek();
        if (n === ',') { lx.i++; continue; }
        if (n === ']') { lx.i++; break; }
        fail('数组里期待 "," 或 "]"');
      }
      return arr;
    }
    const arr = [];
    lx.ws();
    if (lx.peek() === ']') { lx.i++; return arr; }
    for (;;) {
      arr.push(parseValue());
      lx.ws();
      const n = lx.peek();
      if (n === ',') { lx.i++; continue; }
      if (n === ']') { lx.i++; break; }
      fail('列表里期待 "," 或 "]"');
    }
    return arr;
  }

  function parseQuoted() {
    const q = lx.peek(); lx.i++;
    let out = '';
    while (lx.i < lx.s.length) {
      const c = lx.s[lx.i];
      if (c === '\\') {
        const n = lx.s[lx.i + 1];
        out += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0' }[n] ?? n);
        lx.i += 2; continue;
      }
      if (c === q) { lx.i++; return out; }
      out += c; lx.i++;
    }
    fail('字符串没有闭合');
    return out;
  }

  function parseBareKey() {
    const start = lx.i;
    while (lx.i < lx.s.length && /[A-Za-z0-9._+\-]/.test(lx.s[lx.i])) lx.i++;
    if (lx.i === start) fail('期待一个键名');
    return lx.s.slice(start, lx.i);
  }

  function parseBare() {
    const start = lx.i;
    while (lx.i < lx.s.length && !/[\s,\]\}:]/.test(lx.s[lx.i])) lx.i++;
    const raw = lx.s.slice(start, lx.i);
    if (raw === '') fail('期待一个值');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;

    // 后缀必须是 NBT 的六种数值类型：b 字节 / s 短整 / i 整型 / l 长整 / f 浮点 / d 双精度
    // （曾经漏掉 i，导致 toSNBT 生成的 "3i" 被回读成字符串 "3i"，往返不一致）
    const num = /^([+-]?)(\d*\.?\d+)([eE][+-]?\d+)?([bBsSlLfFdDiI])?$/.exec(raw);
    if (num) {
      const suffix = (num[4] || '').toLowerCase() || (/[.eE]/.test(num[2]) ? 'd' : 'i');
      const v = parseFloat((num[1] || '') + num[2] + (num[3] || ''));
      if (Number.isNaN(v)) fail(`不是合法数字：${raw}`);
      const norm = { b: 'b', s: 's', i: 'i', l: 'l', f: 'f', d: 'd' }[suffix] || 'i';
      return new NBTNumber(norm === 'l' ? BigIntOrNum(v) : v, norm);
    }
    return raw; // 未加引号的字符串
  }

  function BigIntOrNum(v) { return v; }

  if (lx.eof()) return { ok: false, error: '输入为空', value: null };
  try {
    const value = parseValue();
    lx.ws();
    if (lx.i < lx.s.length) errs.push(`尾部有多余内容：${JSON.stringify(lx.s.slice(lx.i, lx.i + 20))}`);
    return { ok: errs.length === 0, error: errs[0] || null, value };
  } catch (e) {
    return { ok: false, error: e.message, value: null, pos: e.pos };
  }
}

function toPlainNumber(v) {
  if (v instanceof NBTNumber) return v.valueOf();
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

/* ============================== SNBT 生成 ============================== */

export function toSNBT(value, { space = '', pretty = false, level = 0 } = {}) {
  const pad = pretty ? '  '.repeat(level) : '';
  const padIn = pretty ? '  '.repeat(level + 1) : '';
  const nl = pretty ? '\n' : '';

  if (value === null || value === undefined) return '""';
  if (typeof value === 'boolean') return value ? '1b' : '0b';
  if (value instanceof NBTNumber) return `${value.valueOf()}${value.suffix}`;
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}i` : `${value}d`;
  if (typeof value === 'string') return quote(value);
  if (value instanceof NBTArray) {
    // 三种数组的后缀规则并不相同（见 https://minecraft.wiki/w/NBT_format#SNBT_format）：
    //   字节数组 [B;1b,2b,3b]  元素带 b
    //   整型数组 [I;1,2,3]     元素不带后缀（也接受 [I;1b,2s,3i]）
    //   长整数组 [L;1l,2l,3l]  元素带 l
    const sfx = { B: 'b', I: '', L: 'l' }[value.kind] ?? '';
    const inner = Array.from(value).map((x) => `${Number(x)}${sfx}`);
    return `[${value.kind};${inner.join(`,${pretty ? ' ' : ''}`)}]`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return pretty ? '[]' : '[]';
    if (pretty) return `[${nl}${value.map((v) => padIn + toSNBT(v, { pretty, level: level + 1 })).join(',\n')}${nl}${pad}]`;
    return `[${value.map((v) => toSNBT(v, { pretty, level: level + 1 })).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    if (pretty) {
      return `{${nl}${keys.map((k) => `${padIn}${quoteKey(k)}: ${toSNBT(value[k], { pretty, level: level + 1 })}`).join(',\n')}${nl}${pad}}`;
    }
    return `{${keys.map((k) => `${quoteKey(k)}:${toSNBT(value[k], { pretty, level: level + 1 })}`).join(',')}}`;
  }
  void space;
  return quote(String(value));
}

function quote(s) {
  const str = String(s);
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function quoteKey(k) { return UNQUOTED.test(k) ? k : quote(k); }

export function formatSNBT(input) {
  const r = parseSNBT(input);
  if (!r.ok) return { ok: false, error: r.error, text: String(input) };
  return { ok: true, text: toSNBT(r.value, { pretty: true }) };
}

/* ============================== SNBT 语法高亮 ============================== */

const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function highlightSNBT(text) {
  const src = String(text ?? '');
  let out = '';
  let i = 0;
  const isKeyPos = (upto) => {
    // 粗略判断：这一层下一个非空字符是 ':' 则当前 token 是键
    let j = upto;
    while (j < src.length && /\s/.test(src[j])) j++;
    return src[j] === ':';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const start = i; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      const raw = src.slice(start, i);
      out += `<span class="k-str">${escHtml(raw)}</span>`;
      continue;
    }
    if (/[\[\]{}:;,]/.test(c)) { out += `<span class="k-lit">${escHtml(c)}</span>`; i++; continue; }
    if (/[-\d]/.test(c) && /^[-\d]/.test(src.slice(i))) {
      const m = /^-?\d*\.?\d+([eE][+-]?\d+)?([bBsSlLfFdD])?/.exec(src.slice(i));
      if (m) { out += `<span class="k-num">${escHtml(m[0])}</span>`; i += m[0].length; continue; }
    }
    const m = /^[A-Za-z0-9._+\-]+/.exec(src.slice(i));
    if (m) {
      const tok = m[0];
      if (isKeyPos(i + tok.length)) out += escHtml(tok);
      else if (tok === 'true' || tok === 'false' || tok === 'null') out += `<span class="k-num">${tok}</span>`;
      else out += `<span class="k-sel">${escHtml(tok)}</span>`;
      i += tok.length; continue;
    }
    out += escHtml(c); i++;
  }
  return out;
}

/* ============================== 二进制 NBT ============================== */

export const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};
export const TAG_NAME = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));
const NUM_TAG = { 1: 'b', 2: 's', 3: 'i', 4: 'l', 5: 'f', 6: 'd' };

export function readNBT(bytes, { littleEndian = false } = {}) {
  const dv = new DataView(bytes instanceof ArrayBuffer ? bytes : bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
  let p = 0;
  const rd = {
    u8: () => dv.getUint8(p++),
    i8: () => dv.getInt8(p++),
    i16: () => { const v = dv.getInt16(p, littleEndian); p += 2; return v; },
    i32: () => { const v = dv.getInt32(p, littleEndian); p += 4; return v; },
    i64: () => { const v = dv.getBigInt64(p, littleEndian); p += 8; return v; },
    f32: () => { const v = dv.getFloat32(p, littleEndian); p += 4; return v; },
    f64: () => { const v = dv.getFloat64(p, littleEndian); p += 8; return v; },
    str: () => { const len = dv.getUint16(p, littleEndian); p += 2; const s = new TextDecoder('utf-8').decode(new Uint8Array(dv.buffer, dv.byteOffset + p, len)); p += len; return s; },
  };

  function readPayload(type) {
    switch (type) {
      case TAG.BYTE: return new NBTNumber(rd.i8(), 'b');
      case TAG.SHORT: return new NBTNumber(rd.i16(), 's');
      case TAG.INT: return new NBTNumber(rd.i32(), 'i');
      case TAG.LONG: return new NBTNumber(Number(rd.i64()), 'l');
      case TAG.FLOAT: return new NBTNumber(rd.f32(), 'f');
      case TAG.DOUBLE: return new NBTNumber(rd.f64(), 'd');
      case TAG.BYTE_ARRAY: { const n = rd.i32(); const a = new NBTArray('B'); for (let k = 0; k < n; k++) a.push(rd.i8()); return a; }
      case TAG.STRING: return rd.str();
      case TAG.LIST: {
        const et = rd.u8(); const n = rd.i32(); const a = [];
        for (let k = 0; k < n; k++) a.push(readPayload(et));
        return a;
      }
      case TAG.COMPOUND: {
        const o = Object.create(null);
        for (;;) { const t = rd.u8(); if (t === TAG.END) break; const name = rd.str(); o[name] = readPayload(t); }
        return o;
      }
      case TAG.INT_ARRAY: { const n = rd.i32(); const a = new NBTArray('I'); for (let k = 0; k < n; k++) a.push(rd.i32()); return a; }
      case TAG.LONG_ARRAY: { const n = rd.i32(); const a = new NBTArray('L'); for (let k = 0; k < n; k++) a.push(Number(rd.i64())); return a; }
      default: throw new Error(`未知的 NBT 标签类型 ${type}`);
    }
  }

  const rootType = rd.u8();
  let name = '';
  if (rootType !== TAG.END) name = rd.str();
  const value = rootType === TAG.END ? null : readPayload(rootType);
  return { name, value, rootType, bytesRead: p };
}

export function writeNBT(root, { name = '', rootType = null, littleEndian = false } = {}) {
  const chunks = [];
  const push = (b) => chunks.push(b instanceof Uint8Array ? b : new Uint8Array([b]));
  /** 写定长整数（字节序跟随 littleEndian） */
  const writeNum = (byteWidth, value, setter) => {
    const ab = new ArrayBuffer(byteWidth);
    new DataView(ab)[setter](0, value, littleEndian);
    push(new Uint8Array(ab));
  };

  function typeOf(v) {
    if (v instanceof NBTNumber) return { b: TAG.BYTE, s: TAG.SHORT, i: TAG.INT, l: TAG.LONG, f: TAG.FLOAT, d: TAG.DOUBLE }[v.suffix] ?? TAG.INT;
    if (v instanceof NBTArray) return { B: TAG.BYTE_ARRAY, I: TAG.INT_ARRAY, L: TAG.LONG_ARRAY }[v.kind] ?? TAG.INT_ARRAY;
    if (typeof v === 'boolean') return TAG.BYTE;
    if (typeof v === 'string') return TAG.STRING;
    if (Array.isArray(v)) return TAG.LIST;
    if (v === null) return TAG.STRING;
    if (typeof v === 'object') return TAG.COMPOUND;
    if (typeof v === 'number') return Number.isInteger(v) ? TAG.INT : TAG.DOUBLE;
    return TAG.STRING;
  }

  function encStr(s) {
    const b = new TextEncoder().encode(String(s));
    writeNum(2, b.length, 'setUint16');
    push(b);
  }

  function encPayload(v, forceType = null) {
    const t = forceType ?? typeOf(v);
    switch (t) {
      case TAG.BYTE: push(new Uint8Array([(v instanceof NBTNumber ? v.valueOf() : v ? 1 : 0) & 0xff])); break;
      case TAG.SHORT: writeNum(2, Number(v), 'setInt16'); break;
      case TAG.INT: writeNum(4, Number(v), 'setInt32'); break;
      case TAG.LONG: writeNum(8, BigInt(Math.trunc(Number(v))), 'setBigInt64'); break;
      case TAG.FLOAT: writeNum(4, Number(v), 'setFloat32'); break;
      case TAG.DOUBLE: writeNum(8, Number(v), 'setFloat64'); break;
      case TAG.STRING: encStr(v == null ? '' : String(v)); break;
      case TAG.BYTE_ARRAY: {
        writeNum(4, v.length, 'setInt32');
        push(new Uint8Array(Array.from(v).map((x) => Number(x) & 0xff)));
        break;
      }
      case TAG.INT_ARRAY: {
        writeNum(4, v.length, 'setInt32');
        const ab = new ArrayBuffer(4 * v.length); const dv = new DataView(ab);
        Array.from(v).forEach((x, i) => dv.setInt32(i * 4, Number(x), littleEndian));
        push(new Uint8Array(ab));
        break;
      }
      case TAG.LONG_ARRAY: {
        writeNum(4, v.length, 'setInt32');
        const ab = new ArrayBuffer(8 * v.length); const dv = new DataView(ab);
        Array.from(v).forEach((x, i) => dv.setBigInt64(i * 8, BigInt(Math.trunc(Number(x))), littleEndian));
        push(new Uint8Array(ab));
        break;
      }
      case TAG.LIST: {
        const et = v.length ? typeOf(v[0]) : TAG.END;
        push(new Uint8Array([et]));
        writeNum(4, v.length, 'setInt32');
        for (const item of v) encPayload(item, v.length ? et : null);
        break;
      }
      case TAG.COMPOUND: {
        for (const k of Object.keys(v)) {
          const ct = typeOf(v[k]);
          push(new Uint8Array([ct]));
          encStr(k);
          encPayload(v[k], ct);
        }
        push(new Uint8Array([TAG.END]));
        break;
      }
      default: throw new Error(`无法写入的标签类型 ${t}`);
    }
  }

  const t = rootType ?? typeOf(root);
  push(new Uint8Array([t]));
  if (t !== TAG.END) { encStr(name); encPayload(root, t); }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/* ============================== gzip ============================== */

export async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('浏览器不支持 DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') throw new Error('浏览器不支持 CompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 自动判断是否 gzip（魔数 1f 8b）并解压 */
export async function maybeGunzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) return gunzip(u8);
  return u8;
}

/** 读取 .dat 文件（自动 gzip）→ { name, value } */
export async function readDat(blobOrBuffer) {
  const raw = blobOrBuffer instanceof Blob ? new Uint8Array(await blobOrBuffer.arrayBuffer()) : new Uint8Array(blobOrBuffer);
  const bytes = await maybeGunzip(raw);
  return readNBT(bytes);
}

/** 写出 .dat（gzip 压缩） */
export async function writeDat(root, { name = '', compress = true } = {}) {
  const bytes = writeNBT(root, { name });
  return compress ? gzip(bytes) : bytes;
}

/* ============================== 常用模板 ============================== */

/** 物品 NBT/组件常见片段（供编辑器一键插入） */
export const NBT_SNIPPETS = [
  { label: '自定义名称', snbt: '{CustomName:\'{"text":"我的物品"}\'}' },
  { label: '附魔（锋利 V）', snbt: '{Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}' },
  { label: '不可破坏', snbt: '{Unbreakable:1b}' },
  { label: '隐藏标签', snbt: '{HideFlags:63}' },
  { label: '属性修饰符', snbt: '{AttributeModifiers:[{AttributeName:"minecraft:generic.attack_damage",Name:"x",Amount:10,Operation:0,UUID:[I;1,2,3,4]}]}' },
  { label: '自定义数据', snbt: '{CustomData:{my_key:1}}' },
  { label: '展示实体', snbt: '{EntityTag:{id:"minecraft:pig"}}' },
];

export const COMPONENT_SNIPPETS = [
  { label: '自定义名称', snbt: 'custom_name={"text":"我的物品"}' },
  { label: '文本说明', snbt: 'lore=[{"text":"第一行"}]' },
  { label: '附魔', snbt: 'enchantments={levels:{"minecraft:sharpness":5}}' },
  { label: '不可破坏', snbt: 'unbreakable={}' },
  { label: '自定义模型数据', snbt: 'custom_model_data=123' },
  { label: '最大堆叠 64', snbt: 'max_stack_size=64' },
  { label: '荧光（附魔光效）', snbt: 'enchantment_glint_override=true' },
  { label: '自定义数据', snbt: 'custom_data={my_key:1}' },
  { label: '稀有度', snbt: 'rarity="epic"' },
  { label: '物品名称（不改显示）', snbt: 'item_name="内部名"' },
];
