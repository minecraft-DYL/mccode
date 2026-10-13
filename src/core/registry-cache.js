// registry-cache.js —— 注册表「基线 + 增量差异」持久缓存（IndexedDB）
//
// 需求（用户原话）：
//   「检索每次会缓存东西，可以让下次的同样版本不用检索，当然可以删掉 temp；
//     启动会自动检索第一个有物品的版本，之后的版本检索使用增量方式检索来压缩 temp 体积
//     （缓存记录版本、增加啥、删掉啥（基于前面的任意版本）），
//     每次检索比一个版本的版本号小的都会重构比此版本新的版本的索引。」
//
// 落地成四条不变式：
//   ① 一个「基线版本」整份存下来（kind = 'full'，base = null）；
//   ② 其余版本只存与「已缓存的邻近版本」的差异 { base, added, removed, changed }（kind = 'delta'）；
//   ③ 读取时沿 base 链回到基线，再逐层 applyDelta，重建出完整列表并校验内容哈希 —— 无损；
//   ④ 差异全部来自真实检索结果；取不到权威物品数据的版本标 unknown，绝不伪造增删。
//
// 版本序判定【复用】core/versions.js 的 versionOrder / parseVersion，
// 以及 VersionIndex.isAtLeast / VersionIndex.order（manifest 时间倒序），不自己造字符串比较。
//
// 存储形态：IndexedDB 单库单表 KV。key = 版本 id，value = 一条缓存记录（见 buildEntry）。
// 图标不存绝对 URL：只存「相对路径 / iconKind」，读的时候用该版本自己的 tag 重新拼 CDN 地址，
// 否则从基线重建出来的图标会指向基线的 tag（错图）。

import { fetchT } from './util.js';
import { openKv } from './idb.js';
import { versionOrder, parseVersion } from './versions.js';

export const CACHE_DB = 'mce-registry-cache';
export const CACHE_STORE = 'entries';
export const CACHE_SCHEMA = 1;

/** 缓存覆盖的数据源：只有 github（图标是纯 URL，可序列化）。
 *  jar 数据源的条目带 iconLoader 闭包（绑定在 zip 上），无法序列化，继续用 registry.js 的内存缓存。 */
export const CACHE_SOURCE = 'github';

// 地址构造不再在这里复制一份 —— 直接从 cdn.js 取（两边都只依赖 cdn.js，没有循环依赖）。
// 之前注释写着「此处重复一行以避免循环依赖」，结果就是漂移：给 registry.js 加了多端点回退之后，
// probeVersionHasAssets 这条路径仍然在打已经死掉的 cdn.jsdelivr.net。
import { cdnGh, CDN_HOSTS, ASSET_REPO } from './cdn.js';

const KINDS = ['items', 'entities', 'particles'];
const IK_TO_CODE = { item: 0, block: 1 };
const CODE_TO_IK = ['item', 'block', null];

/* ============================== 打包 / 解包 ============================== */
//
// 物品（占绝大多数，必须最省）：[id, name, iconKindCode]  —— github 源里 iconId 恒等于 id
// 实体 / 粒子：[id, name, 相对图标路径 | null]
// 只存「相对路径」的原因同上：绝对 URL 里带着 tag，跨版本重建会串图。

function relIcon(url, tag) {
  if (!url) return null;
  // ⚠️ 前缀必须对「所有已知端点」都成立，不能写死一个。
  // 写死 cdn.jsdelivr.net 时，一旦实际用的是 fastly./gcore.，startsWith 就匹配不上，
  // 于是带 tag 的绝对 URL 被原样存进缓存 —— 正是上面第 47 行警告的「跨版本重建会串图」。
  const marker = `/gh/${ASSET_REPO}@${encodeURIComponent(tag)}/`;
  const i = url.indexOf(marker);
  if (i > 0 && CDN_HOSTS.includes(url.slice(0, i))) return url.slice(i + marker.length);
  return url;
}

function absIcon(p, tag) {
  if (!p) return null;
  return /^https?:/i.test(p) ? p : cdnGh(tag, p);
}

function packOne(kind, e, tag) {
  if (kind === 'items') return [String(e.id), e.name == null ? String(e.id) : String(e.name), IK_TO_CODE[e.iconKind] != null ? IK_TO_CODE[e.iconKind] : 2];
  return [String(e.id), e.name == null ? String(e.id) : String(e.name), relIcon(e.icon, tag)];
}

function unpackOne(kind, t, tag) {
  const id = t[0];
  const name = t[1];
  if (kind === 'items') {
    const ik = CODE_TO_IK[t[2]] || null;
    return { id, name, kind: 'item', iconKind: ik, icon: ik ? cdnGh(tag, `assets/minecraft/textures/${ik}/${id}.png`) : null };
  }
  const kindName = kind === 'entities' ? 'entity' : 'particle';
  return { id, name, kind: kindName, icon: absIcon(t[2], tag) };
}

/** Registry → 可序列化 tuples（按 id 排序，保证哈希稳定） */
export function packRegistry(reg) {
  const out = {};
  for (const kind of KINDS) {
    const list = (reg && reg[kind]) || [];
    out[kind] = list.map((e) => packOne(kind, e, reg.tag || reg.version)).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  return out;
}

/** tuples → 条目对象数组（图标按 tag 重新拼） */
export function unpackData(data, tag) {
  const out = {};
  for (const kind of KINDS) out[kind] = ((data && data[kind]) || []).map((t) => unpackOne(kind, t, tag));
  return out;
}

/* ============================== 哈希 / 差异 ============================== */

/** 双 32 位哈希（FNV-1a + djb2）：用于内容指纹，不是加密用途 */
export function hashText(s) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return h1.toString(16) + '-' + h2.toString(16) + '-' + s.length.toString(36);
}

export function hashData(data) {
  let parts = '';
  for (const kind of KINDS) parts += kind + ':' + JSON.stringify((data && data[kind]) || []) + '\n';
  return hashText(parts);
}

const jsonLen = (v) => JSON.stringify(v == null ? null : v).length;

function sameTuple(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function emptyData() { return { items: [], entities: [], particles: [] }; }

/** 目标相对基线的真实差异（不做任何推测：只比较两边的真实条目表） */
export function diffData(base, target) {
  const out = { added: {}, removed: {}, changed: {} };
  for (const kind of KINDS) {
    const b = new Map(((base && base[kind]) || []).map((t) => [t[0], t]));
    const t = new Map(((target && target[kind]) || []).map((x) => [x[0], x]));
    const added = [], removed = [], changed = [];
    for (const [id, tv] of t) {
      const bv = b.get(id);
      if (!bv) added.push(tv);
      else if (!sameTuple(bv, tv)) changed.push(tv);
    }
    for (const id of b.keys()) if (!t.has(id)) removed.push(id);
    out.added[kind] = added;
    out.removed[kind] = removed;
    out.changed[kind] = changed;
  }
  return out;
}

/** 从基线数据逐层套用差异，重建某版本完整列表 */
export function applyDelta(base, delta) {
  const out = {};
  for (const kind of KINDS) {
    const m = new Map(((base && base[kind]) || []).map((t) => [t[0], t]));
    for (const id of ((delta && delta.removed && delta.removed[kind]) || [])) m.delete(id);
    for (const t of ((delta && delta.changed && delta.changed[kind]) || [])) m.set(t[0], t);
    for (const t of ((delta && delta.added && delta.added[kind]) || [])) m.set(t[0], t);
    out[kind] = Array.from(m.values()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }
  return out;
}

export function deltaStats(delta) {
  const s = { added: 0, removed: 0, changed: 0 };
  for (const kind of KINDS) {
    s.added += ((delta.added && delta.added[kind]) || []).length;
    s.removed += ((delta.removed && delta.removed[kind]) || []).length;
    s.changed += ((delta.changed && delta.changed[kind]) || []).length;
  }
  return s;
}

/* ============================== 链 / 版本序 ============================== */

const kv = () => openKv({ db: CACHE_DB, store: CACHE_STORE, version: 1 });
const asMap = (all) => new Map((all || []).filter((e) => e && e.schema === CACHE_SCHEMA && e.version).map((e) => [e.version, e]));

/** 从 entry 沿 base 回到根；返回 [entry…root]（叶子在前），断裂/成环返回 null */
function chainOf(version, map) {
  const out = [];
  const seen = new Set();
  let cur = map.get(version);
  if (!cur) return null;
  while (cur) {
    if (seen.has(cur.version)) return null;
    seen.add(cur.version);
    out.push(cur);
    if (!cur.base) break;
    const nx = map.get(cur.base);
    if (!nx) return null;
    cur = nx;
  }
  if (!out.length || out[out.length - 1].kind !== 'full') return null;
  return out;
}

/** a 是否不早于 b（复用 VersionIndex.isAtLeast，退化时复用 versionOrder） */
function isNewerOrEqual(a, b, index) {
  if (index && typeof index.isAtLeast === 'function') {
    try { return !!index.isAtLeast(a, b); } catch { /* 落到 versionOrder */ }
  }
  return versionOrder(a) >= versionOrder(b);
}

/** 在 manifest 序轴上量距离；缺失时退回 versionOrder（÷1e9 粗略归一到 manifest 量级） */
function distance(target, cand, index) {
  const it = index && index.order ? index.order.get(target) : null;
  const ic = index && index.order ? index.order.get(cand) : null;
  if (it != null && ic != null) return { axis: 'manifest', d: Math.abs(it - ic) };
  return { axis: 'ordinal', d: Math.abs(versionOrder(target) - versionOrder(cand)) / 1e9 };
}

/**
 * 选增量基线：已缓存、链路完整、未失效、不依赖 target 的版本里，
 * manifest 序轴上离 target 最近的那个（并列时优先「更老」的，符合"基于前面的版本"）。
 *
 * 环路判定只说一件事：候选的链里不能出现 target（否则 target→候选→…→target 成环）。
 * 注意【不要】反过来排除"候选是 target 的祖先" —— target → 自己的祖先 → … → 根，
 * 这是一条完全合法的链；如果把它排掉，重新检索一个有增量的版本时它会退化成整份存储
 * （实测：1.21.1 从 1.5 KB 的增量膨胀回 63 KB 的全量）。
 */
export function pickBase(target, map, index = null) {
  const cands = [];
  for (const e of map.values()) {
    if (e.version === target) continue;
    if (e.source !== CACHE_SOURCE) continue;
    if (e.stale || e.unknown) continue;
    const chain = chainOf(e.version, map);
    if (!chain) continue;
    if (chain.some((x) => x.version === target)) continue; // 会成环
    const { d, axis } = distance(target, e.version, index);
    cands.push({ version: e.version, d, axis, newer: isNewerOrEqual(e.version, target, index) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (a.d !== b.d ? a.d - b.d : (a.newer === b.newer ? 0 : (a.newer ? 1 : -1))));
  return cands[0];
}

/** 纯函数版重建（不碰存储，供 write 时解析基线数据） */
function resolveData(version, map) {
  const entry = map.get(version);
  if (!entry) return { ok: false, reason: 'miss' };
  if (entry.stale) return { ok: false, reason: 'stale', detail: entry.staleReason, at: version };
  const chain = chainOf(version, map);
  if (!chain) return { ok: false, reason: 'chain-broken', at: version };
  const root = chain[chain.length - 1];
  let data = root.data;
  const hashes = new Map([[root.version, root.contentHash]]);
  for (let i = chain.length - 2; i >= 0; i--) {
    const link = chain[i];
    const bh = hashes.get(link.base);
    if (link.baseHash && bh && link.baseHash !== bh) return { ok: false, reason: 'base-changed', detail: link.base, at: link.version };
    data = applyDelta(data, link.data);
    hashes.set(link.version, link.contentHash);
  }
  const h = hashData(data);
  if (h !== entry.contentHash) return { ok: false, reason: 'integrity', detail: `重建哈希 ${h} ≠ 记录 ${entry.contentHash}`, at: version };
  return { ok: true, data, chain: chain.map((e) => e.version), entry };
}

/* ============================== 依赖失效 ============================== */

/** 找出（直接 + 间接）以 version 为 base 的所有缓存版本 */
export function dependentsOf(version, map) {
  const out = [];
  const seen = new Set([version]);
  const queue = [version];
  while (queue.length) {
    const v = queue.shift();
    for (const e of map.values()) {
      if (e.base !== v || seen.has(e.version)) continue;
      seen.add(e.version);
      out.push(e.version);
      queue.push(e.version);
    }
  }
  return out;
}

/** 把以 version 为基线的条目全部标 stale（下次读取即重建） */
export async function markDependentsStale(version, reason, map = null, k = null) {
  const handle = k || await kv();
  const all = map || asMap(await handle.all());
  const deps = dependentsOf(version, all);
  const marked = [];
  for (const v of deps) {
    const e = all.get(v);
    if (!e || e.stale) continue;
    e.stale = true;
    e.staleReason = reason || `基线 ${version} 已变更`;
    e.staleAt = Date.now();
    await handle.put(v, e);
    marked.push(v);
  }
  return marked;
}

/* ============================== 读 ============================== */

/**
 * 读缓存并重建。
 * @returns {Promise<{ok:boolean, reason?:string, data?, chain?:string[], entry?, tag?:string}>}
 */
export async function registryCacheRead(version, { index = null, onStatus = () => {} } = {}) {
  const k = await kv();
  const entry = await k.get(version);
  if (!entry || entry.schema !== CACHE_SCHEMA) return { ok: false, reason: 'miss' };
  if (entry.source !== CACHE_SOURCE) return { ok: false, reason: 'source-mismatch', detail: entry.source };

  const all = asMap(await k.all());
  const res = resolveData(version, all);
  if (!res.ok) {
    // 链路已经不可信 → 就地标 stale，下次写的时候重建（不在这里偷偷重算，避免编数据）
    if (res.reason !== 'miss' && res.at) {
      const bad = all.get(res.at);
      if (bad && !bad.stale) { bad.stale = true; bad.staleReason = `读取失败：${res.reason}（${res.detail || ''}）`; bad.staleAt = Date.now(); await k.put(res.at, bad); }
    }
    onStatus(`增量缓存不可用（${res.reason}${res.detail ? '：' + res.detail : ''}），改为真实检索`);
    return { ok: false, reason: res.reason, detail: res.detail, at: res.at };
  }
  return {
    ok: true,
    data: res.data,
    chain: res.chain,
    entry,
    tag: entry.resolvedTag || entry.version,
    bytes: entry.entryBytes || 0,
    dataBytes: entry.dataBytes || 0,
    fullDataBytes: entry.fullDataBytes || 0,
  };
}

/* ============================== 写 ============================== */

function buildEntry({ version, source, kind, base, baseHash, payload, resolvedTag, note, counts, contentHash, unknown, buildMs }) {
  const e = {
    schema: CACHE_SCHEMA,
    version,
    source,
    kind,
    base: base || null,
    baseHash: baseHash || null,
    contentHash,
    resolvedTag: resolvedTag || version,
    note: note || '',
    counts: counts || null,
    unknown: !!unknown,
    data: payload,
    deltaStats: kind === 'delta' ? deltaStats(payload) : null,
    dataBytes: jsonLen(payload),
    fullDataBytes: jsonLen(payload), // 调用方随后会用「整份数据」的真实长度覆盖
    storedAt: Date.now(),
    buildMs: buildMs == null ? null : Math.round(buildMs),
    stale: false,
    staleReason: null,
  };
  e.entryBytes = jsonLen(e);
  return e;
}

/**
 * 写入某版本：优先与「已缓存的邻近版本」做增量，无可用基线时整份存（基线）。
 * @param {string} version
 * @param {{data:object, source?:string, resolvedTag?:string, note?:string, counts?:object,
 *          index?:object, onStatus?:Function, buildMs?:number, fullData?:object}} o
 */
export async function registryCacheWrite(version, {
  data, source = CACHE_SOURCE, resolvedTag = version, note = '', counts = null,
  index = null, onStatus = () => {}, buildMs = null, fullData = null,
} = {}) {
  const k = await kv();
  const map = asMap(await k.all());
  const prev = map.get(version) || null;
  const contentHash = hashData(data);
  const unknown = !counts || !counts.items;

  let base = null, baseHash = null, delta = null, kind = 'full', basePick = null;
  if (!unknown) {
    basePick = pickBase(version, map, index);
    if (basePick) {
      const bres = resolveData(basePick.version, map);
      if (bres.ok) {
        base = basePick.version;
        baseHash = bres.entry.contentHash;
        delta = diffData(bres.data, data);
        kind = 'delta';
      }
    }
  }

  const payload = kind === 'delta' ? { added: delta.added, removed: delta.removed, changed: delta.changed } : data;
  const fullBytesSource = fullData || data;

  // 内容变了 → 所有（直接/间接）以它为基线的版本必须失效，下次读取时重建。
  // 先算失效、再写自己：这样记录里的 invalidated / entryBytes 都是最终值，只需一次写。
  let invalidated = [];
  if (prev && prev.contentHash !== contentHash) {
    invalidated = await markDependentsStale(version, `基线 ${version} 内容已变更（${prev.contentHash} → ${contentHash}）`, null, k);
    if (invalidated.length) {
      onStatus(`依赖失效：${invalidated.length} 个版本（${invalidated.slice(0, 4).join('、')}${invalidated.length > 4 ? '…' : ''}）以 ${version} 为基线，已标记待重建`);
    }
  }

  const entry = buildEntry({
    version, source, kind, base, baseHash, payload,
    resolvedTag, note, counts, contentHash, unknown, buildMs,
  });
  entry.fullDataBytes = jsonLen(fullBytesSource);  // 该版本「若整份存」的真实字节数
  entry.dataBytes = jsonLen(payload);              // 实际存下去的字节数
  if (invalidated.length) entry.invalidated = invalidated;
  if (unknown) entry.unknownReason = '检索结果物品数为 0：该版本未取得权威物品数据（标记 unknown，不参与增量比对）';
  entry.entryBytes = jsonLen(entry);

  await k.put(version, entry);

  return {
    entry,
    kind,
    base,
    baseAxis: basePick ? basePick.axis : null,
    baseDistance: basePick ? basePick.d : null,
    deltaStats: kind === 'delta' ? deltaStats(delta) : null,
    dataBytes: entry.dataBytes,
    fullDataBytes: entry.fullDataBytes,
    entryBytes: entry.entryBytes,
    invalidated,
    unknown,
  };
}

/* ============================== 查询 / 清空 / 统计 ============================== */

export async function registryCachePeek(version) {
  const k = await kv();
  const e = await k.get(version);
  return e && e.schema === CACHE_SCHEMA ? e : null;
}

/** 某版本的增量链（叶子 → 基线） */
export async function registryCacheChain(version) {
  const k = await kv();
  const map = asMap(await k.all());
  const chain = chainOf(version, map);
  if (!chain) return null;
  return chain.map((e) => ({
    version: e.version, kind: e.kind, base: e.base, dataBytes: e.dataBytes || 0,
    fullDataBytes: e.fullDataBytes || 0, stale: !!e.stale, unknown: !!e.unknown,
  }));
}

/** 现有基线（base = null 的整份条目）——启动预热用它判断"是否已有基线" */
export async function registryCacheBaselines() {
  const k = await kv();
  const all = await k.all();
  return all
    .filter((e) => e && e.schema === CACHE_SCHEMA && !e.base && e.kind === 'full')
    .map((e) => ({ version: e.version, items: e.counts ? e.counts.items : 0, unknown: !!e.unknown, storedAt: e.storedAt, entryBytes: e.entryBytes, stale: !!e.stale }))
    .filter((e) => !e.unknown && !e.stale && e.items > 0)
    .sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0));
}

/** 删掉单个版本的缓存条目，并把它派生出来的版本标 stale。返回 {removed, invalidated} */
export async function invalidateRegistryCache(version) {
  const k = await kv();
  const map = asMap(await k.all());
  const had = map.has(version);
  if (had) await k.del(version);
  const invalidated = await markDependentsStale(version, `基线 ${version} 的缓存已被手动删除`, map, k);
  return { removed: had, invalidated };
}

/** 一键删干净（用户说的"删掉 temp"）。返回删除前后的真实字节数 */
export async function clearAllRegistryCache() {
  const k = await kv();
  const before = await registryCacheStats();
  const removed = await k.clear();
  const after = await registryCacheStats();
  return {
    engine: k.kind,
    removed,
    before: { count: before.count, entryBytes: before.entryBytes, dataBytes: before.dataBytes, fullDataBytes: before.fullDataBytes },
    after: { count: after.count, entryBytes: after.entryBytes, dataBytes: after.dataBytes, fullDataBytes: after.fullDataBytes },
  };
}

/** 缓存统计（真实字节数，全部来自 JSON 序列化后的长度） */
export async function registryCacheStats() {
  const k = await kv();
  const all = (await k.all()).filter((e) => e && e.schema === CACHE_SCHEMA);
  const entries = [];
  let dataBytes = 0, entryBytes = 0, fullDataBytes = 0, fullCount = 0, deltaCount = 0, staleCount = 0, unknownCount = 0;
  for (const e of all) {
    dataBytes += e.dataBytes || 0;
    entryBytes += e.entryBytes || 0;
    fullDataBytes += e.fullDataBytes || 0;
    if (e.kind === 'full') fullCount++; else if (e.kind === 'delta') deltaCount++;
    if (e.stale) staleCount++;
    if (e.unknown) unknownCount++;
    entries.push({
      version: e.version, kind: e.kind, base: e.base, unknown: !!e.unknown, stale: !!e.stale,
      counts: e.counts || null, deltaStats: e.deltaStats || null,
      dataBytes: e.dataBytes || 0, fullDataBytes: e.fullDataBytes || 0, entryBytes: e.entryBytes || 0,
      resolvedTag: e.resolvedTag, storedAt: e.storedAt, buildMs: e.buildMs == null ? null : e.buildMs,
      staleReason: e.staleReason || null,
    });
  }
  entries.sort((a, b) => (b.storedAt || 0) - (a.storedAt || 0));
  const chains = [];
  const map = asMap(all);
  for (const e of all) {
    const ch = chainOf(e.version, map);
    if (ch && ch.length > 1) chains.push({ version: e.version, depth: ch.length, chain: ch.map((x) => x.version) });
  }
  return {
    engine: k.kind,
    count: all.length, fullCount, deltaCount, staleCount, unknownCount,
    dataBytes, entryBytes, fullDataBytes,
    /** 若这些版本每个都整份存，会是多少倍 */
    savingRatio: dataBytes > 0 ? +(fullDataBytes / dataBytes).toFixed(3) : 1,
    overheadRatio: dataBytes > 0 ? +(entryBytes / dataBytes).toFixed(3) : 1,
    /** 把当前缓存策略外推到整个 manifest（纯投影，标注清楚，不当成实测） */
    projection: all.length > 0
      ? {
        note: '外推投影：按当前每个版本的平均增量字节 × manifest 版本数；不是实测值',
        perVersionDataBytes: Math.round(dataBytes / all.length),
        perVersionFullDataBytes: Math.round(fullDataBytes / all.length),
      }
      : null,
    entries,
    chains,
  };
}

/* ============================== 启动预热用的轻量探测 ============================== */

/** 判断某版本在资源仓库里是否真的有物品资源（HEAD 探测，几乎不花 GitHub 配额） */
const PROBE_PATHS = [
  'assets/minecraft/items/stone.json',       // 1.21.4+ 的物品模型入口
  'assets/minecraft/models/item/stone.json', // 1.12 ~ 1.21.3
  'assets/minecraft/lang/en_us.json',        // 更早 / 兜底
];
const probeMemo = new Map();

export async function probeVersionHasAssets(version, { onStatus = () => {}, timeoutMs = 12000 } = {}) {
  if (probeMemo.has(version)) return probeMemo.get(version);
  let hit = { ok: false, version, tried: [] };
  for (const p of PROBE_PATHS) {
    try {
      const r = await fetchT(cdnGh(version, p), { method: 'HEAD' }, timeoutMs);
      hit.tried.push(`${p.split('/').slice(-2).join('/')}=${r.status}`);
      if (r.ok) { hit = { ok: true, version, path: p, tried: hit.tried }; break; }
    } catch (e) { hit.tried.push(`${p.split('/').slice(-2).join('/')}=ERR`); }
  }
  probeMemo.set(version, hit);
  return hit;
}

export function forgetProbeMemo() { probeMemo.clear(); }
