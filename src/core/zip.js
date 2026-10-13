// zip.js —— 零依赖 ZIP 读取器，基于浏览器原生 DecompressionStream
// 用途：直接在本机读取 .minecraft/versions/<ver>/<ver>.jar（客户端 jar 就是 zip）
// 不引入 JSZip / fflate 等任何第三方库。

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export const supportsZip = typeof DecompressionStream !== 'undefined';

export class ZipReader {
  constructor(buffer) {
    this.buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    this.u8 = new Uint8Array(this.buf);
    this.dv = new DataView(this.buf);
    this.entries = new Map();
    this._dec = new TextDecoder('utf-8');
    this._cache = new Map();
    this._parseCentralDirectory();
  }

  _findEOCD() {
    const dv = this.dv;
    const min = Math.max(0, this.u8.length - 66000);
    for (let i = this.u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('不是合法的 ZIP/JAR：找不到中央目录结尾记录');
  }

  _parseCentralDirectory() {
    const dv = this.dv;
    const eocd = this._findEOCD();
    let count = dv.getUint16(eocd + 10, true);
    let cdOffset = dv.getUint32(eocd + 16, true);
    let cdSize = dv.getUint32(eocd + 12, true);

    // ZIP64 兜底
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc64 = eocd - 20;
      for (let i = eocd - 20; i >= 0; i--) {
        if (dv.getUint32(i, true) === SIG_EOCD64) {
          const z = i;
          count = Number(dv.getBigUint64(z + 32, true));
          cdSize = Number(dv.getBigUint64(z + 40, true));
          cdOffset = Number(dv.getBigUint64(z + 48, true));
          break;
        }
      }
      void loc64;
    }

    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > this.u8.length || dv.getUint32(p, true) !== SIG_CD) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const rawSize = dv.getUint32(p + 24, true);
      const fnLen = dv.getUint16(p + 28, true);
      const exLen = dv.getUint16(p + 30, true);
      const cmLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = this._dec.decode(this.u8.subarray(p + 46, p + 46 + fnLen));
      this.entries.set(name, { name, method, compSize, rawSize, localOff });
      p += 46 + fnLen + exLen + cmLen;
    }
  }

  list(prefix = '') {
    const out = [];
    for (const k of this.entries.keys()) if (!prefix || k.startsWith(prefix)) out.push(k);
    return out;
  }

  has(name) { return this.entries.has(name); }
  get size() { return this.entries.size; }

  /** 读取并解压单个条目，返回 Uint8Array */
  async read(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    const e = this.entries.get(name);
    if (!e) throw new Error(`jar 中没有 ${name}`);
    const dv = this.dv;
    const lo = e.localOff;
    if (dv.getUint32(lo, true) !== SIG_LOCAL) throw new Error(`条目 ${name} 的本地头损坏`);
    const fnLen = dv.getUint16(lo + 26, true);
    const exLen = dv.getUint16(lo + 28, true);
    const start = lo + 30 + fnLen + exLen;
    const sliced = this.u8.subarray(start, start + e.compSize);

    let out;
    if (e.method === 0) {
      out = sliced.slice();
    } else if (e.method === 8) {
      if (!supportsZip) throw new Error('当前浏览器不支持 DecompressionStream，无法解压 jar');
      const ds = new DecompressionStream('deflate-raw');
      const blob = new Blob([sliced]);
      const stream = blob.stream().pipeThrough(ds);
      out = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`不支持的压缩方式 ${e.method}（${name}）`);
    }
    this._cache.set(name, out);
    return out;
  }

  async readText(name) { return new TextDecoder('utf-8').decode(await this.read(name)); }

  async readJSON(name) { return JSON.parse(await this.readText(name)); }

  /** 以 Blob URL 形式读取二进制（用于贴图） */
  async readBlobURL(name, mime = null) {
    const m = mime || (name.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    const data = await this.read(name);
    const blob = new Blob([data], { type: m });
    const url = URL.createObjectURL(blob);
    this._urls = this._urls || [];
    this._urls.push(url);
    return url;
  }

  dispose() {
    for (const u of this._urls || []) URL.revokeObjectURL(u);
    this._urls = []; this._cache.clear();
  }
}
