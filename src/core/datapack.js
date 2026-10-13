// datapack.js —— 数据包 / .mcfunction 的产出逻辑（纯逻辑，不碰 DOM，可单测）
//
// pack_format 权威来源（双通道交叉核对，不靠记忆）：
//   1) zh.minecraft.wiki 的 Template:Data pack format（release 分支）
//      https://zh.minecraft.wiki/api.php?action=parse&page=Template%3AData_pack_format&prop=wikitext
//   2) 本机 jar 内 version.json 的 pack_version，用于交叉验证：
//      1.20.1 → data 15 ; 1.20.4 → data 26 ; 1.21.1 → data 48 ;
//      1.21.11 → data_major 94 / minor 1 ; 26.3 → data_major 121 / minor 0
//
// 注意：1.21.9 起编号改为「大.小」两段式，且 pack.mcmeta 改用 min_format / max_format。

import { versionOrder, isDatapackEra } from './versions.js';

/** [版本下界, 数据包版本号]。按版本升序排列；命中「≤ 目标版本的最大下界」。 */
export const PACK_FORMATS = [
  ['1.13', 4],
  ['1.15', 5],
  ['1.16.2', 6],
  ['1.17', 7],
  ['1.18', 8],
  ['1.18.2', 9],
  ['1.19', 10],
  ['1.19.4', 12],
  ['1.20', 15],
  ['1.20.2', 18],
  ['1.20.3', 26],
  ['1.20.5', 41],
  ['1.21', 48],
  ['1.21.2', 57],
  ['1.21.4', 61],
  ['1.21.5', 71],
  ['1.21.6', 80],
  ['1.21.7', 81],
  ['1.21.9', '88.0'],
  ['1.21.11', '94.1'],
  ['26.1', '101.1'],
  ['26.2', '107.1'],
  ['26.3', '121.0'],
];

/** 取某版本的数据包版本号。返回值可能是数字（旧格式）或 '大.小' 字符串（1.21.9+）。 */
export function packFormat(version) {
  const t = versionOrder(version);
  let out = PACK_FORMATS[0][1];
  for (const [v, f] of PACK_FORMATS) {
    if (versionOrder(v) <= t) out = f;
    else break;
  }
  return out;
}

/** 该版本的数据包版本号是从哪个版本开始生效的（用于界面提示） */
export function packFormatSince(version) {
  const t = versionOrder(version);
  let since = PACK_FORMATS[0][0];
  for (const [v] of PACK_FORMATS) {
    if (versionOrder(v) <= t) since = v;
    else break;
  }
  return since;
}

/**
 * 生成 pack.mcmeta 内容。
 * 1.21.9 起：pack_format 变为可选，改用必选的 min_format / max_format。
 */
export function packMeta(version, description) {
  const f = packFormat(version);
  if (typeof f === 'string' && f.includes('.')) {
    const [maj, min] = f.split('.').map((n) => parseInt(n, 10));
    return { pack: { description, min_format: [maj, min], max_format: [maj, min] } };
  }
  return { pack: { pack_format: f, description } };
}

/** 手工构造 store 模式（不压缩）的 ZIP —— 零依赖，浏览器与 Node 都能跑 */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u16 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data));
    const crc = crc32(data);
    const local = [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data];
    const localLen = local.reduce((n, a) => n + a.length, 0);
    for (const a of local) chunks.push(a);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += localLen;
  }

  let cdSize = 0;
  const cdChunks = [];
  for (const c of central) {
    const h = [u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size), u16(c.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset), c.nameBytes];
    for (const a of h) cdChunks.push(a);
    cdSize += h.reduce((n, a) => n + a.length, 0);
  }
  const end = [u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(offset), u16(0)];
  return new Uint8Array([...chunks, ...cdChunks, ...end].reduce((acc, a) => { for (const b of a) acc.push(b); return acc; }, []));
}

/**
 * 组装一个完整数据包。
 * @returns {{ok:boolean, error?:string, bytes?:Uint8Array, fileName?:string, files?:Array, packFormat?:number|string, meta?:object}}
 */
export function buildDatapack({ namespace = 'mypack', functionName = 'main', lines = [], version = '1.20.5' } = {}) {
  if (!isDatapackEra(version)) {
    return { ok: false, error: '1.13 之前没有数据包结构，请直接导出 .mcfunction' };
  }
  const ns = String(namespace || 'mypack').trim() || 'mypack';
  const fn = String(functionName || 'main').trim() || 'main';
  const meta = packMeta(version, `${ns} · 由 MC 编辑器生成`);
  const files = [
    { name: 'pack.mcmeta', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) },
    { name: `data/${ns}/function/${fn}.mcfunction`, data: new TextEncoder().encode((lines.length ? lines.join('\n') + '\n' : '')) },
  ];
  return {
    ok: true,
    files,
    meta,
    bytes: zipStore(files),
    fileName: `${ns}.zip`,
    packFormat: packFormat(version),
  };
}
