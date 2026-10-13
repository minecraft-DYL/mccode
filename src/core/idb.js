// idb.js —— IndexedDB 最小封装（单库单表 KV），不支持 / 被拒绝时自动退回内存 Map
//
// 为什么需要它：注册表的「基线 + 增量差异」缓存必须跨刷新存活。
//   · localStorage 只有 5MB 且同步阻塞、只能存字符串，放物品表必然爆配额；
//   · CacheStorage 只能存 Request/Response，不适合结构化数据；
//   · IndexedDB 异步、配额按磁盘比例给、能直接存对象 —— 是浏览器侧唯一合适的选择。
//
// 纪律：本模块在任何环境下都必须能 import（Node 里也要能跑，用于纯逻辑测试），
// 因此不访问 window / document；没有 indexedDB 时静默退回内存实现（kind = 'memory'）。

const handles = new Map();

/** IndexedDB 是否可用（Node / 隐私模式 / 被策略禁用时返回 false） */
export function idbSupported() {
  try { return typeof indexedDB !== 'undefined' && indexedDB != null; }
  catch { return false; }
}

function clone(v) {
  // 内存模式：JSON 往返克隆，避免调用方拿到同一引用后互相污染
  try { return v == null ? v : JSON.parse(JSON.stringify(v)); } catch { return v; }
}

function reqDone(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('IndexedDB 请求失败'));
  });
}

class MemoryKv {
  constructor(name) {
    this.kind = 'memory';
    this.name = name;
    this.map = new Map();
  }
  async get(k) { const v = this.map.get(String(k)); return v === undefined ? null : clone(v); }
  async put(k, v) { this.map.set(String(k), clone(v)); return true; }
  async del(k) { return this.map.delete(String(k)); }
  async has(k) { return this.map.has(String(k)); }
  async keys() { return Array.from(this.map.keys()); }
  async all() { return Array.from(this.map.values()).map(clone); }
  async clear() { const n = this.map.size; this.map.clear(); return n; }
  async count() { return this.map.size; }
}

class IdbKv {
  constructor(db, storeName, dbName) {
    this.kind = 'indexeddb';
    this.db = db;
    this.store = storeName;
    this.name = dbName;
  }
  _os(mode) { return this.db.transaction(this.store, mode).objectStore(this.store); }
  async get(k) { try { const v = await reqDone(this._os('readonly').get(String(k))); return v === undefined ? null : v; } catch { return null; } }
  async put(k, v) { try { await reqDone(this._os('readwrite').put(v, String(k))); return true; } catch { return false; } }
  async del(k) { try { await reqDone(this._os('readwrite').delete(String(k))); return true; } catch { return false; } }
  async has(k) { return (await this.get(k)) != null; }
  async keys() { try { return (await reqDone(this._os('readonly').getAllKeys())) || []; } catch { return []; } }
  async all() { try { return (await reqDone(this._os('readonly').getAll())) || []; } catch { return []; } }
  async clear() { const n = await this.count(); try { await reqDone(this._os('readwrite').clear()); } catch { /* noop */ } return n; }
  async count() { try { return (await reqDone(this._os('readonly').count())) || 0; } catch { return 0; } }
}

/**
 * 打开（并缓存）一个 KV 句柄。
 * @param {{db?:string, store?:string, version?:number}} o
 * @returns {Promise<MemoryKv|IdbKv>}
 */
export async function openKv({ db = 'mce-registry', store = 'cache', version = 1 } = {}) {
  const key = `${db}/${store}`;
  if (handles.has(key)) return handles.get(key);

  let h = null;
  if (idbSupported()) {
    try {
      const idb = await new Promise((res, rej) => {
        const req = indexedDB.open(db, version);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(store)) d.createObjectStore(store);
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error || new Error('indexedDB.open 失败'));
        req.onblocked = () => rej(new Error('indexedDB.open 被其它标签页阻塞'));
      });
      h = new IdbKv(idb, store, db);
      // 老旧连接被其它标签页升级顶掉时，下次访问失败 → 交给调用方兜底
      h.db.onversionchange = () => { try { h.db.close(); } catch { /* noop */ } handles.delete(key); };
    } catch (e) {
      console.warn(`[idb] IndexedDB 不可用，退回内存存储（${e && e.message}）`);
      h = new MemoryKv(key);
    }
  } else {
    h = new MemoryKv(key);
  }
  handles.set(key, h);
  return h;
}

/** 当前存储引擎（'indexeddb' | 'memory'）—— 只在需要向用户解释时用 */
export async function kvEngine(opts) { return (await openKv(opts)).kind; }

/** 丢弃已缓存的句柄（测试用；不影响数据） */
export function forgetKvHandles() { handles.clear(); }
