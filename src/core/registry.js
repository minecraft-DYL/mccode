// registry.js —— 注册表检索：物品 / 实体 / 粒子（ID + 显示名 + 图标）
//
// 三条数据源，按可用性自动降级，全部实现在浏览器侧，无需后端：
//   ① github  —— GitHub API 取资源文件树（1 次请求拿到全部路径）+ jsDelivr CDN 取 lang 与图标（懒加载）
//   ② remotejar —— 从 Mojang 官方 CDN 下载 client jar，本地解压（最权威，可离线复用）
//   ③ localjar —— 用户手动指定本机 .minecraft/versions 下的 jar
//
// 关键事实（已实测）：
//   · api.github.com 的 tree 接口可一次返回 minecraft-assets@<version> 的全部路径（1MB 级）
//   · cdn.jsdelivr.net 的 gh 通道对 minecraft-assets 全部 tag 可访问，CORS 全开
//   · 1.21.4 起物品模型入口为 assets/minecraft/items/*.json；更早为 assets/minecraft/models/item/*.json

import { fetchJSON, fetchT, pool, bytes as fmtBytes } from './util.js';
import { cdnGh, ASSET_REPO, CDN_HOSTS, currentCdnHost, resolveCdnHost } from './cdn.js';
import { ZipReader, supportsZip } from './zip.js';
import {
  registryCacheRead, registryCacheWrite, registryCacheBaselines, registryCacheStats,
  registryCacheChain, registryCachePeek, invalidateRegistryCache, clearAllRegistryCache,
  packRegistry, unpackData, probeVersionHasAssets, CACHE_SOURCE,
} from './registry-cache.js';

// CDN 端点选择统一放在 cdn.js，registry-cache.js 的探测路径也用它，
// 避免两处各写一份地址构造而漂移（曾经就漂过：加了多端点回退，探测那条路还在打死掉的端点）。
export { ASSET_REPO, CDN_HOSTS, currentCdnHost, resolveCdnHost };

export const CDN_GH = (ver, path) => cdnGh(ver, path);
export const GITHUB_TREE = (ver) => `https://api.github.com/repos/${ASSET_REPO}/git/trees/${encodeURIComponent(ver)}?recursive=1`;

export const SOURCE_LABEL = {
  github: '网络资源仓库（GitHub + jsDelivr）',
  remotejar: 'Mojang 官方 client jar',
  localjar: '本机 jar（手动指定）',
};

/** 图标颜色（用于实体/粒子等没有直接贴图的条目） */
export function hashColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 62% 58%)`;
}

export function initials(nameOrId) {
  const s = String(nameOrId || '?').replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '');
  return (s[0] || '?').toUpperCase() + (s.length > 2 && /[A-Z]/.test(s[0]) ? (s[1] || '') : '');
}

export class Registry {
  constructor({ version, source, items = [], entities = [], particles = [], lang = {}, note = '' }) {
    this.version = version;
    this.source = source;
    this.items = items;
    this.entities = entities;
    this.particles = particles;
    this.lang = lang;
    this.note = note;
    this.builtAt = Date.now();
  }

  get counts() { return { items: this.items.length, entities: this.entities.length, particles: this.particles.length }; }

  /** 按 id 前缀/名称检索 */
  search(kind, q, limit = 400) {
    const list = this[kind] || [];
    if (!q) return list.slice(0, limit);
    const needle = q.toLowerCase().trim();
    const idHit = [], nameHit = [];
    for (const e of list) {
      if (e.id.includes(needle)) idHit.push(e);
      else if (e.name && e.name.toLowerCase().includes(needle)) nameHit.push(e);
      if (idHit.length >= limit) break;
    }
    return idHit.concat(nameHit).slice(0, limit);
  }

  byId(kind, id) { return (this[kind] || []).find((e) => e.id === id) || null; }
}

const memCache = new Map();

/** jar 数据源的条目带 iconLoader 闭包（绑在 zip 上），无法序列化，因此只走内存缓存 */
const JAR_CACHE_NOTE = {
  hit: false, level: 'network', stored: false, kind: 'full', base: null, chain: [],
  deltaStats: null, bytes: 0, dataBytes: 0, fullBytes: 0, savedBytes: 0,
  persistent: false, note: 'jar 数据源只做内存缓存：条目自带 iconLoader 闭包，无法写入 IndexedDB',
};

/** 只清内存里已检索好的 Registry 实例（不动持久缓存）。不传 version 清全部。 */
export function clearMemoryRegistryCache(version) {
  if (version) memCache.delete(version); else memCache.clear();
}

/**
 * 清缓存（对外语义：删掉这个版本的所有缓存痕迹）。
 * 同步返回，持久层（IndexedDB）的删除与「派生版本失效」异步进行 —— 见 dropRegistryCache 的 await 版。
 */
export function clearRegistryCache(version) {
  clearMemoryRegistryCache(version);
  void dropRegistryCache(version).catch(() => { /* 持久层不可用时无需打断调用方 */ });
}

/**
 * 同上但可 await：删除持久条目，并把所有（直接/间接）以它为基线的版本标为待重建。
 * @returns {Promise<{removed:boolean|number, invalidated:string[]}>}
 */
export async function dropRegistryCache(version) {
  if (version) {
    clearMemoryRegistryCache(version);
    return await invalidateRegistryCache(version);
  }
  clearMemoryRegistryCache();
  const r = await clearAllRegistryCache();
  return { removed: r.removed, invalidated: [] };
}

/**
 * 构建注册表
 * @param {object} o
 * @param {string} o.version   版本 id（同时作为资源仓库 tag）
 * @param {'github'|'remotejar'|'localjar'|'auto'} o.source
 * @param {versionIndex} o.index
 * @param {function} o.onStatus
 * @param {ArrayBuffer|File} o.jar  当 source = localjar 时必须
 * @param {object} o.versionDetail  当 source = remotejar 时需要（含 downloads.client.url）
 * @param {boolean} o.useCache    是否先查缓存（force 场景传 false）
 * @param {boolean} o.storeCache  检索结果是否写回增量缓存（纯对照检索时传 false）
 * @param {boolean} o.allowJarFallback  github 失败时是否退回下载官方 jar（启动预热传 false，避免首屏拉 25MB）
 */
export async function buildRegistry({
  version, source = 'auto', index = null, onStatus = () => {}, jar = null, versionDetail = null,
  useCache = true, storeCache = true, allowJarFallback = true,
}) {
  if (useCache) {
    const c = memCache.get(version);
    if (c && c.source === source) {
      c.cache = { ...(c.cache || {}), hit: true, level: 'memory' };
      onStatus(`使用已检索结果（内存）：${version}`);
      return c;
    }
  }

  if (source === 'localjar') {
    const reg = await fromJar({ version, jar, source: 'localjar', onStatus, versionDetail });
    reg.cache = JAR_CACHE_NOTE;
    memCache.set(version, reg); return reg;
  }

  if (source === 'remotejar') {
    const reg = await fromRemoteJar({ version, versionDetail, index, onStatus });
    reg.cache = JAR_CACHE_NOTE;
    memCache.set(version, reg); return reg;
  }

  if (source === 'github' || source === 'auto') {
    // ⓪ 先确定一个可达的 jsDelivr 端点。已解析过就立即返回（不发请求），
    //    但图标是渲染时按 CDN_GH 拼的，所以端点必须在返回注册表之前就定下来。
    await resolveCdnHost();

    // ① 先试「基线 + 增量差异」持久缓存（命中则 0 网络请求）
    if (useCache) {
      const hit = await readFromIncrementalCache(version, { onStatus });
      if (hit) { memCache.set(version, hit); return hit; }
    }
    // ② 真实检索 → 写回缓存
    try {
      const t0 = Date.now();
      const reg = await fromGitHub({ version, index, onStatus });
      const buildMs = Date.now() - t0;
      if (storeCache) await writeToIncrementalCache(reg, version, { index, onStatus, buildMs });
      else reg.cache = { hit: false, level: 'network', stored: false, buildMs };
      memCache.set(version, reg); return reg;
    } catch (e) {
      // ⓪b CDN 端点是这条链路上最不稳的一环：换一个端点重试一次，再考虑降级到 jar。
      const before = currentCdnHost();
      const swapped = await resolveCdnHost({ force: true });
      if (swapped && swapped !== before) {
        onStatus(`资源 CDN ${before} 不可达（${e.message}），改用 ${swapped} 重试…`);
        try {
          const t0 = Date.now();
          const reg2 = await fromGitHub({ version, index, onStatus });
          const buildMs = Date.now() - t0;
          if (storeCache) await writeToIncrementalCache(reg2, version, { index, onStatus, buildMs });
          else reg2.cache = { hit: false, level: 'network', stored: false, buildMs };
          memCache.set(version, reg2); return reg2;
        } catch { /* 换端点也不行，继续走下面的降级 */ }
      }
      if (source === 'github' || !allowJarFallback) throw e;
      onStatus(`网络资源检索失败（${e.message}），改用官方 client jar…`);
      const reg = await fromRemoteJar({ version, versionDetail, index, onStatus });
      memCache.set(version, reg); return reg;
    }
  }
  throw new Error(`未知数据源：${source}`);
}

/* ==================== 增量缓存的读写适配（数据层 → Registry） ==================== */

const CACHE_MISS_TEXT = {
  miss: '该版本还没有缓存',
  stale: '缓存已按依赖关系失效',
  'chain-broken': '增量链断裂（基线缺失）',
  'base-changed': '基线内容已变更',
  integrity: '重建结果与缓存记录的内容哈希不一致',
  'source-mismatch': '缓存来自另一种数据源',
};

const pct = (part, all) => (all > 0 ? `${Math.round((1 - part / all) * 100)}%` : '—');

/** 缓存命中 → 直接用存下来的条目表重建 Registry（图标按该版本自己的 tag 重新拼 CDN 地址） */
async function readFromIncrementalCache(version, { onStatus }) {
  let hit;
  try {
    hit = await registryCacheRead(version, { onStatus });
  } catch (e) {
    onStatus(`增量缓存读取异常（${e.message}），改为真实检索：${version}`, 'warning');
    return null;
  }
  if (!hit.ok) {
    if (hit.reason && hit.reason !== 'miss') {
      onStatus(`增量缓存未命中（${CACHE_MISS_TEXT[hit.reason] || hit.reason}），改为真实检索：${version}`);
    }
    return null;
  }
  const lists = unpackData(hit.data, hit.tag);
  const e = hit.entry || {};
  const reg = new Registry({
    version: hit.tag,
    source: 'github',
    items: lists.items,
    entities: lists.entities,
    particles: lists.particles,
    note: e.note || '',
  });
  reg.tag = hit.tag;
  // 语言表本身（几百 KB）不随缓存保存；物品/实体/粒子的显示名已逐条存进条目表
  reg.langOmitted = true;
  const delta = e.deltaStats || null;
  reg.cache = {
    hit: true,
    level: 'indexeddb',
    tier: e.kind === 'full' ? 'baseline' : 'delta',
    kind: e.kind || 'full',
    base: e.base || null,
    chain: hit.chain || [version],
    chainDepth: (hit.chain || []).length,
    bytes: e.entryBytes || 0,
    dataBytes: e.dataBytes || 0,
    fullBytes: e.fullDataBytes || 0,
    savedBytes: Math.max(0, (e.fullDataBytes || 0) - (e.dataBytes || 0)),
    deltaStats: delta,
    counts: e.counts || null,
    unknown: !!e.unknown,
    resolvedTag: hit.tag,
    storedAt: e.storedAt || null,
    buildMs: e.buildMs == null ? null : e.buildMs,
  };
  onStatus(describeCacheHit(version, reg.cache));
  return reg;
}

function describeCacheHit(version, c) {
  const size = fmtBytes(c.bytes);
  if (c.kind === 'full') {
    return `增量缓存命中：${version}（基线整份记录 ${size}，0 次网络请求${c.unknown ? ' · 该版本标记 unknown' : ''}）`;
  }
  const d = c.deltaStats || { added: 0, removed: 0, changed: 0 };
  const chain = (c.chain || []).join(' ← ');
  return `增量缓存命中：${version}（增量记录 ${size}，基线链 ${chain}，增 ${d.added} / 删 ${d.removed} / 改 ${d.changed}，若整份存需 ${fmtBytes(c.fullBytes)}）`;
}

/** 真实检索结果 → 打包成条目表写进缓存（自动挑基线、算差异、必要时让派生版本失效） */
async function writeToIncrementalCache(reg, version, { index, onStatus, buildMs }) {
  const data = packRegistry(reg);
  let res;
  try {
    res = await registryCacheWrite(version, {
      data,
      source: CACHE_SOURCE,
      resolvedTag: reg.tag || version,
      note: reg.note || '',
      counts: reg.counts,
      index,
      onStatus,
      buildMs,
    });
  } catch (e) {
    onStatus(`增量缓存写入失败（${e.message}）；本次结果仍可用于当前会话`, 'warning');
    reg.cache = { hit: false, level: 'network', stored: false, buildMs };
    return;
  }
  const d = res.deltaStats || { added: 0, removed: 0, changed: 0 };
  reg.cache = {
    hit: false,
    level: 'network',
    stored: true,
    kind: res.kind,
    base: res.base,
    baseAxis: res.baseAxis,
    baseDistance: res.baseDistance,
    deltaStats: res.deltaStats,
    bytes: res.entryBytes,
    dataBytes: res.dataBytes,
    fullBytes: res.fullDataBytes,
    savedBytes: Math.max(0, res.fullDataBytes - res.dataBytes),
    invalidated: res.invalidated,
    unknown: res.unknown,
    buildMs,
  };
  const tag = reg.tag || version;
  if (res.unknown) {
    onStatus(`真实检索 ${version}：未取到权威物品数据（已标 unknown 记录，不参与增量比对）`, 'warning');
  } else if (res.kind === 'full') {
    onStatus(`真实检索 ${version}（tag=${tag}）：写入基线整份缓存 ${fmtBytes(res.entryBytes)}，耗时 ${buildMs} ms`);
  } else {
    onStatus(`真实检索 ${version}（tag=${tag}）：写入增量缓存，基线 ${res.base}（增 ${d.added} / 删 ${d.removed} / 改 ${d.changed}），记录 ${fmtBytes(res.dataBytes)}，若整份存需 ${fmtBytes(res.fullDataBytes)}（省 ${pct(res.dataBytes, res.fullDataBytes)}），耗时 ${buildMs} ms`);
  }
}

/* ==================== 启动预热：自动检索「第一个有物品的版本」 ==================== */

const warmup = { status: 'idle', result: null, promise: null, cancelled: false };

export function cancelRegistryWarmup() { warmup.cancelled = true; }

/**
 * 启动预热：找出 manifest 里「第一个能取到物品列表的版本」，整份存成增量缓存基线。
 * · 非阻塞调用方（store.js 在首屏渲染后 fire-and-forget）；
 * · 已有基线 → 直接复用，0 网络请求；
 * · 候选版本先用 jsDelivr HEAD 轻量探测（不花 GitHub 60 次/小时的配额），最多试 maxProbe 个；
 * · 失败静默（console.warn），绝不弹错误框、不重启重试风暴。
 */
export async function warmupRegistryBaseline({ index = null, onStatus = () => {}, maxProbe = 4, force = false } = {}) {
  if (warmup.promise && !force) return warmup.promise;
  warmup.cancelled = false;
  warmup.status = 'running';
  warmup.promise = (async () => {
    const t0 = Date.now();
    try {
      // ⓪ 先定一个可达的 CDN 端点。预热会用 probeVersionHasAssets 逐个试版本，
      //    那条路径拼地址靠 cdn.js 的当前端点 —— 不先解析的话它会打默认端点（本机已被重置），
      //    结果就是「按 manifest 顺序试过前 4 个版本，都没有物品数据」的假失败。
      await resolveCdnHost();

      // ① 已有基线：直接复用
      const bases = await registryCacheBaselines();
      if (bases.length && !force) {
        const r = {
          ok: true, reused: true, reason: '已有基线缓存',
          version: bases[0].version, items: bases[0].items, ms: Date.now() - t0, requests: 0,
        };
        warmup.status = 'done'; warmup.result = r;
        onStatus(`启动预热：已有基线缓存 ${r.version}（${r.items} 物品），本轮 0 次网络请求`);
        return r;
      }

      // ② 按 manifest 顺序（新 → 旧）找第一个真的有物品资源的版本
      const list = index && index.versions ? index.versions.map((v) => v.id) : [];
      if (!list.length) throw new Error('版本清单不可用，跳过预热');
      const tried = [];
      for (const id of list.slice(0, maxProbe)) {
        if (warmup.cancelled) {
          const r = { ok: false, cancelled: true, ms: Date.now() - t0, tried };
          warmup.status = 'cancelled'; warmup.result = r;
          return r;
        }
        const probe = await probeVersionHasAssets(id);
        if (!probe.ok) { tried.push(`${id}: 资源仓库无物品资源（${probe.tried.join(' ')}）`); continue; }
        const reg = await buildRegistry({
          version: id, source: 'github', index, onStatus,
          useCache: true, storeCache: true, allowJarFallback: false,
        });
        if (reg && reg.items && reg.items.length) {
          const r = {
            ok: true, reused: !!reg.cache.hit, reason: reg.cache.hit ? '检索前已有缓存' : '新建基线',
            version: id, tag: reg.tag, items: reg.items.length,
            entities: reg.entities.length, particles: reg.particles.length,
            probePath: probe.path, tried, ms: Date.now() - t0, cache: reg.cache,
          };
          warmup.status = 'done'; warmup.result = r;
          onStatus(`启动预热完成：基线版本 ${id}（物品 ${r.items}，${fmtBytes(reg.cache.bytes || 0)}，耗时 ${r.ms} ms）`, 'success');
          return r;
        }
        tried.push(`${id}: 检索成功但物品数为 0`);
      }
      throw new Error(`按 manifest 顺序试过前 ${maxProbe} 个版本，都没有物品数据`);
    } catch (e) {
      const r = { ok: false, error: e && e.message ? e.message : String(e), ms: Date.now() - t0 };
      warmup.status = 'failed'; warmup.result = r;
      // 静默：只进控制台，不进状态栏、不弹窗
      console.warn('[registry] 启动预热失败（静默处理，不影响使用）：', r.error);
      return r;
    }
  })();
  return warmup.promise;
}

/** 预热状态（供 __MCE__ / 自动化测试读取） */
export function registryWarmupStatus() { return { status: warmup.status, result: warmup.result }; }

/* ==================== 缓存能力再导出（store.js / UI 直接用） ==================== */

export {
  registryCacheStats, registryCacheChain, registryCachePeek,
  clearAllRegistryCache, invalidateRegistryCache, registryCacheBaselines,
  packRegistry, unpackData, probeVersionHasAssets,
};


/* ============================ 源 ① GitHub + jsDelivr ============================ */

/** 找出最接近的、确实存在的资源 tag（新快照常常已发布） */
async function resolveTag(version, index, onStatus) {
  const candidates = [];
  candidates.push(version);
  // 本机目录名可能带后缀，规范化
  const clean = String(version).replace(/[-_]+v\d*[-_]*$/i, '');
  if (clean !== version) candidates.push(clean);
  // 同系列的正式版兜底：26.3-snapshot-2 → 26.3 → 26.2 …
  const m = /^(\d+(?:\.\d+)*)/.exec(clean);
  if (m && index) {
    const sameMajor = index.versions.filter((v) => v.id.startsWith(m[1] + '.') || v.id === m[1]).map((v) => v.id);
    candidates.push(...sameMajor.slice(0, 12));
    const base = m[1].split('.');
    if (base.length >= 2) {
      const minor = parseInt(base[base.length - 1], 10);
      for (let i = 1; i <= 6; i++) candidates.push(base.slice(0, -1).concat(minor - i).join('.'));
    }
    candidates.push(...index.releases(8).map((v) => v.id));
  }

  const tried = new Set();
  for (const c of candidates) {
    if (!c || tried.has(c)) continue;
    tried.add(c);
    onStatus(`探测资源 tag：${c} …`);
    try {
      const r = await fetchT(GITHUB_TREE(c), { headers: { Accept: 'application/vnd.github+json' } }, 25000);
      if (r.status === 404) continue;
      if (r.status === 403) throw new Error('GitHub API 触发限流（403），请稍后再试或改用 jar 数据源');
      if (!r.ok) continue;
      const data = await r.json();
      if (data && Array.isArray(data.tree) && data.tree.length > 100) return { tag: c, tree: data.tree };
    } catch (e) {
      if (/限流/.test(e.message)) throw e;
    }
  }
  throw new Error(`在资源仓库中找不到与 ${version} 匹配的 tag`);
}

async function fromGitHub({ version, index, onStatus }) {
  const { tag, tree } = await resolveTag(version, index, onStatus);
  onStatus(`已获取 ${tag} 的资源文件树（${tree.length} 个条目），正在解析…`);

  const paths = [];
  for (const t of tree) if (t.type === 'blob') paths.push(t.path);
  const pathSet = new Set(paths);

  const listBy = (prefix, ext) => paths
    .filter((p) => p.startsWith(prefix) && p.endsWith(ext))
    .map((p) => p.slice(prefix.length, p.length - ext.length));

  const itemsDir = listBy('assets/minecraft/items/', '.json');
  const modelItems = listBy('assets/minecraft/models/item/', '.json');
  const texItems = listBy('assets/minecraft/textures/item/', '.png');
  const texBlocks = listBy('assets/minecraft/textures/block/', '.png');
  const particlesDir = listBy('assets/minecraft/particles/', '.json');

  // lang：优先中文，其次英文
  let lang = {}, langEn = {};
  const tryLang = async (name) => {
    const url = () => CDN_GH(tag, `assets/minecraft/lang/${name}.json`);
    try { return JSON.parse(await (await fetchT(url(), {}, 25000)).text()); }
    catch {
      // 换一个 CDN 端点重试一次。语言文件失败会让物品名静默退回纯 ID（看起来「能用」但全是英文键名），
      // 所以不能像原来那样直接吞异常返回 {} 就算完。
      try {
        const now = await resolveCdnHost({ force: true });
        onStatus(`语言文件 ${name} 拉取失败，改用 CDN 端点 ${now} 重试…`);
        return JSON.parse(await (await fetchT(url(), {}, 25000)).text());
      } catch { return {}; }
    }
  };
  lang = await tryLang('zh_cn');
  if (!Object.keys(lang).length) lang = await tryLang('en_us');
  langEn = await tryLang('en_us');
  // 如实报告：0 条时不要说成「已载入」，那会让「名字全是键名」这个真问题被掩盖
  if (Object.keys(lang).length) onStatus(`语言文件已载入：${Object.keys(lang).length} 条（zh_cn）`);
  else onStatus('语言文件未载入（显示名将退回 ID 本身）；通常是资源 CDN 不可达，可换数据源或手动选 jar');

  const iconUrl = (kind, id) => CDN_GH(tag, `assets/minecraft/textures/${kind}/${id}.png`);

  const registry = new Registry({
    version: tag,
    source: 'github',
    note: `资源仓库 tag = ${tag}${tag !== version ? `（${version} 无独立 tag，使用最接近版本）` : ''}`,
  });
  registry.pathSet = pathSet;
  registry.tag = tag;

  // ---------- 物品 ----------
  const itemSet = new Map(); // id → {iconKind, iconId}
  const addItem = (id, iconKind, iconId) => {
    if (!id || id.startsWith('_') || /^(template|base|empty|debug)/.test(id)) return;
    if (!itemSet.has(id)) itemSet.set(id, { iconKind, iconId });
  };
  // 1.21.4+ ：items/ 是权威入口
  // —— 与 fromJar 同一规则：语言表才是「注册物品」的权威判据 ——
  // items/ 与 textures/item/ 里含大量模型变体与内部状态（bow_pulling_0、clock_00、
  // chainmail_boots_diamond_trim、black_bundle_open_front…），它们没有语言键，
  // 直接收录就会出现「只有键名没中文名的条目」。
  const itemsSet = new Set(itemsDir);
  const modelSet = new Set(modelItems);
  const langItemIds = new Set();
  for (const k of Object.keys(lang)) {
    if (k.startsWith('item.minecraft.')) langItemIds.add(k.slice('item.minecraft.'.length));
    else if (k.startsWith('block.minecraft.')) langItemIds.add(k.slice('block.minecraft.'.length));
  }

  if (langItemIds.size) {
    for (const id of langItemIds) {
      if (!id || id.includes('.') || id.startsWith('_')) continue;
      const ik = pathSet.has(`assets/minecraft/textures/item/${id}.png`) ? 'item'
        : pathSet.has(`assets/minecraft/textures/block/${id}.png`) ? 'block' : null;
      if (ik) addItem(id, ik, id);
      // 有语言键、且在物品定义/模型入口里，但无贴图 → 收录，UI 用文字替代图标
      else if (itemsSet.has(id) || modelSet.has(id)) addItem(id, null, null);
    }
  } else {
    for (const id of itemsDir) addItem(id, pathSet.has(`assets/minecraft/textures/item/${id}.png`) ? 'item' : 'block', id);
    for (const id of modelItems) addItem(id, pathSet.has(`assets/minecraft/textures/item/${id}.png`) ? 'item' : 'block', id);
    for (const id of texItems) if (!itemSet.has(id)) itemSet.set(id, { iconKind: 'item', iconId: id });
  }

  registry.items = Array.from(itemSet.entries()).map(([id, meta]) => ({
    id,
    name: lang[`item.minecraft.${id}`] || lang[`block.minecraft.${id}`] || langEn[`item.minecraft.${id}`] || langEn[`block.minecraft.${id}`] || id,
    kind: 'item',
    iconKind: meta.iconKind,
    icon: meta.iconKind ? (meta.iconKind === 'item' ? iconUrl('item', meta.iconId) : iconUrl('block', meta.iconId)) : null,
  })).sort((a, b) => a.id.localeCompare(b.id));

  // ---------- 实体 ----------
  const entityKeys = Object.keys(lang).filter((k) => k.startsWith('entity.minecraft.'));
  const entityNames = new Set(entityKeys.map((k) => k.slice('entity.minecraft.'.length)));
  // 纹理目录里的实体名（补 lang 缺失）
  for (const p of paths) {
    const m = /^assets\/minecraft\/textures\/entity\/([a-z0-9_]+)\//.exec(p);
    if (m) entityNames.add(m[1]);
  }
  const entityIcon = (id) => {
    const cands = [
      `assets/minecraft/textures/entity/${id}/${id}.png`,
      `assets/minecraft/textures/entity/${id}.png`,
    ];
    for (const c of cands) if (pathSet.has(c)) return CDN_GH(tag, c);
    return null;
  };
  registry.entities = Array.from(entityNames).filter((id) => !id.startsWith('_')).map((id) => ({
    id,
    name: lang[`entity.minecraft.${id}`] || langEn[`entity.minecraft.${id}`] || id,
    kind: 'entity',
    icon: entityIcon(id),
  })).sort((a, b) => a.id.localeCompare(b.id));

  // ---------- 粒子 ----------
  registry.particles = particlesDir.filter((id) => !id.startsWith('_')).map((id) => ({
    id,
    name: lang[`particle.minecraft.${id}`] || id,
    kind: 'particle',
    icon: pathSet.has(`assets/minecraft/textures/particle/${id}.png`) ? CDN_GH(tag, `assets/minecraft/textures/particle/${id}.png`) : null,
  })).sort((a, b) => a.id.localeCompare(b.id));

  const c = registry.counts;
  onStatus(`检索完成：物品 ${c.items} · 实体 ${c.entities} · 粒子 ${c.particles}`);
  return registry;
}

/* ============================ 源 ② / ③ jar 解压 ============================ */

async function fromRemoteJar({ version, versionDetail, index, onStatus }) {
  if (!supportsZip) throw new Error('当前浏览器不支持 DecompressionStream，无法解压 jar');
  let detail = versionDetail;
  if (!detail) {
    const { fetchVersionDetail } = await import('./versions.js');
    detail = await fetchVersionDetail(index, version);
  }
  const url = detail?.downloads?.client?.url;
  if (!url) throw new Error(`版本 ${version} 的 version.json 中没有 client 下载地址`);
  onStatus(`正在下载官方 client jar（${(detail.downloads.client.size / 1048576).toFixed(0)} MB）…`);
  const r = await fetchT(url, {}, 300000);
  if (!r.ok) throw new Error(`jar 下载失败：HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  onStatus('下载完成，正在解压…');
  return fromJar({ version, jar: buf, source: 'remotejar', onStatus, versionDetail });
}

/**
 * 从官方资源索引取语言表。
 * 实测结论：客户端 jar 里【没有】zh_cn.json（26.3 只有 3 个 lang 条目、1.21.1 / 1.20.4 各 1 个，
 * 且都只有 en_us）。非英语语言放在资源索引指向的对象目录里，必须走
 * assetIndex.url → objects['minecraft/lang/zh_cn.json'].hash → resources.download.minecraft.net 才能拿到。
 * 这是取得中文物品名的官方途径；mod jar 不在官方清单里，只能退回 jar 自带的 en_us。
 */
export async function fetchLangFromAssetIndex(versionDetail, langCode = 'zh_cn', onStatus = () => {}) {
  const idx = versionDetail && versionDetail.assetIndex;
  if (!idx || !idx.url) return null;
  onStatus('从官方资源索引取中文语言表…');
  let index = null;
  try { index = await fetchJSON(idx.url, {}, 60000); } catch { return null; }
  const obj = index && index.objects && index.objects[`minecraft/lang/${langCode}.json`];
  if (!obj || !obj.hash) return null;
  const url = `https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`;
  try { return await fetchJSON(url, {}, 60000); } catch { return null; }
}

export async function fromJar({ version, jar, source, onStatus, versionDetail = null }) {
  if (!jar) throw new Error('未提供 jar 文件');
  let buf = jar;
  if (jar instanceof File || jar instanceof Blob) {
    onStatus(`读取 ${jar.name || 'jar'}（${(jar.size / 1048576).toFixed(1)} MB）…`);
    buf = await jar.arrayBuffer();
  }
  onStatus('解析 jar 中央目录…');
  const zip = new ZipReader(buf);
  onStatus(`jar 内含 ${zip.size} 个条目，正在提取注册表…`);

  const paths = zip.list();
  const pathSet = new Set(paths);
  const has = (p) => pathSet.has(p);

  const listBy = (prefix, ext) => paths
    .filter((p) => p.startsWith(prefix) && p.endsWith(ext))
    .map((p) => p.slice(prefix.length, p.length - ext.length));

  // —— 命名空间扫描：原版在 assets/minecraft/，mod jar 在 assets/<模组id>/ ——
  // 之前只扫 minecraft，mod jar 会被整包忽略。现在把所有 assets/<ns>/ 都纳入。
  const namespaces = new Set();
  for (const p of paths) {
    const m = /^assets\/([a-z0-9_.\-]+)\//.exec(p);
    if (m && m[1] !== 'lang') namespaces.add(m[1]);
  }
  if (!namespaces.size) namespaces.add('minecraft');
  namespaces.add('minecraft');

  const readLang = async (ns, n) => {
    try { return JSON.parse(await zip.readText(`assets/${ns}/lang/${n}.json`)); } catch { return {}; }
  };
  // 语言表：原版优先 zh_cn；mod 一般只带 en_us，此时用 en_us 兜底
  const LANGS = new Map();
  for (const ns of namespaces) {
    const zh = await readLang(ns, 'zh_cn');
    const en = await readLang(ns, 'en_us');
    LANGS.set(ns, Object.keys(zh).length ? { ...en, ...zh } : en);
  }
  const langOf = (ns) => LANGS.get(ns) || {};

  // ★ jar 内通常只有 en_us；中文名必须从官方资源索引补（否则物品名全是英文）
  {
    const mc = LANGS.get('minecraft') || {};
    const hasChinese = Object.keys(mc).some((k) => /[\u4e00-\u9fff]/.test(mc[k]));
    if (!hasChinese) {
      const zh = await fetchLangFromAssetIndex(versionDetail, 'zh_cn', onStatus);
      if (zh && Object.keys(zh).length) {
        LANGS.set('minecraft', { ...mc, ...zh });
        onStatus(`已从官方资源索引补入中文语言表（${Object.keys(zh).length} 键）`);
      } else {
        onStatus('未取得中文语言表：物品名将显示为英文（该版本不在官方清单内时属正常）');
      }
    }
  }

  // 识别 jar 类型：原版 / 各类 mod 加载器（供 UI 标注，也用于判断"扫到的命名空间是模组还是原版"）
  const modLoader = has('fabric.mod.json') ? 'Fabric'
    : has('META-INF/neoforge.mods.toml') ? 'NeoForge'
      : has('META-INF/mods.toml') ? 'Forge'
        : has('quilt.mod.json') ? 'Quilt'
          : has('version.json') ? '原版' : '未识别加载器';

  const registry = new Registry({
    version, source,
    note: `${modLoader} jar，共 ${zip.size} 个条目，命名空间 ${namespaces.size} 个（${Array.from(namespaces).slice(0, 6).join(', ')}${namespaces.size > 6 ? '…' : ''}）`,
  });
  registry.zip = zip;
  registry.tag = version;
  registry.modLoader = modLoader;
  registry.namespaces = Array.from(namespaces).sort();

  // 图标：按需从 jar 里解出 blob URL（惰性）
  const iconCache = new Map();
  const iconFromJar = (ns, kind, id) => {
    const key = `${ns}/${kind}/${id}`;
    return () => {
      if (!iconCache.has(key)) {
        const p = `assets/${ns}/textures/${kind}/${id}.png`;
        iconCache.set(key, has(p) ? zip.readBlobURL(p) : Promise.resolve(null));
      }
      return iconCache.get(key);
    };
  };

  // 原版物品用裸 id（minecraft:stone → stone），与命令语法一致；mod 物品保留 ns:name
  const fullId = (ns, id) => (ns === 'minecraft' ? id : `${ns}:${id}`);

  const itemMap = new Map();
  const addItem = (ns, id, kind) => {
    if (!id || id.startsWith('_') || id.includes('/')) return;
    const fid = fullId(ns, id);
    if (!itemMap.has(fid)) itemMap.set(fid, { ns, id, kind });
  };

  for (const ns of namespaces) {
    const A = `assets/${ns}`;
    const itemsDir = listBy(`${A}/items/`, '.json');
    const modelItems = listBy(`${A}/models/item/`, '.json');
    const texItems = listBy(`${A}/textures/item/`, '.png');
    const lang = langOf(ns);

    const iconKindOf = (id) => (has(`${A}/textures/item/${id}.png`) ? 'item'
      : has(`${A}/textures/block/${id}.png`) ? 'block' : null);

    // —— 物品判定规则 ——
    // ✗ 旧做法：把 items/*.json、models/item/*.json、textures/item/*.png 一律当物品。
    //   实测 26.3：这会把 549 个「模型变体 / 内部状态」当成物品 —— bow_pulling_0、
    //   chainmail_boots_diamond_trim、black_bundle_open_front、clock_00、brush_brushing_1、
    //   amethyst_bud…… 它们没有任何语言键，正是用户报障的「只有键名没中文名的条目」。
    // ✓ 新做法：语言表里的 item.<ns>.* / block.<ns>.* 才是注册物品，资源文件只用来确认图标；
    //   若某命名空间完全没有语言键（精简的 mod jar），才退回资源扫描。
    const itemsSet = new Set(itemsDir);
    const modelSet = new Set(modelItems);
    const langItemIds = new Set();
    for (const k of Object.keys(lang)) {
      const itemP = `item.${ns}.`, blockP = `block.${ns}.`;
      let id = null;
      if (k.startsWith(itemP)) id = k.slice(itemP.length);
      else if (k.startsWith(blockP)) id = k.slice(blockP.length);
      if (!id || id.includes('.') || id.startsWith('_')) continue;
      langItemIds.add(id);
    }

    if (langItemIds.size) {
      for (const id of langItemIds) {
        const kind = iconKindOf(id);
        if (kind) addItem(ns, id, kind);
        // 有语言键、且在物品定义/模型入口里，但没有对应贴图 → 仍收录，UI 用文字替代图标
        else if (itemsSet.has(id) || modelSet.has(id)) addItem(ns, id, null);
      }
    } else {
      for (const id of itemsDir) addItem(ns, id, iconKindOf(id) || 'item');
      for (const id of modelItems) addItem(ns, id, iconKindOf(id) || 'item');
      for (const id of texItems) addItem(ns, id, 'item');
    }
  }

  registry.items = Array.from(itemMap.entries()).map(([fid, it]) => {
    const lang = langOf(it.ns);
    return {
      id: fid,
      name: lang[`item.${it.ns}.${it.id}`] || lang[`block.${it.ns}.${it.id}`] || it.id,
      kind: 'item',
      iconKind: it.kind,
      icon: null,
      iconLoader: it.kind ? iconFromJar(it.ns, it.kind, it.id) : null,
      namespace: it.ns,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const entityMap = new Map();
  for (const ns of namespaces) {
    const A = `assets/${ns}`;
    const lang = langOf(ns);
    const prefix = `entity.${ns}.`;
    for (const k of Object.keys(lang)) {
      if (!k.startsWith(prefix)) continue;
      const id = k.slice(prefix.length);
      entityMap.set(fullId(ns, id), { ns, id, name: lang[k] });
    }
    for (const p of paths) {
      const m = new RegExp(`^assets/${ns}/textures/entity/([a-z0-9_]+)/`).exec(p);
      if (!m) continue;
      const id = m[1];
      const fid = fullId(ns, id);
      if (!entityMap.has(fid)) entityMap.set(fid, { ns, id, name: lang[prefix + id] || id });
    }
  }
  registry.entities = Array.from(entityMap.entries())
    .filter(([, e]) => !e.id.startsWith('_'))
    .map(([fid, e]) => {
      const p = `assets/${e.ns}/textures/entity/${e.id}/${e.id}.png`;
      return {
        id: fid, name: e.name || e.id, kind: 'entity', icon: null,
        iconLoader: has(p) ? () => zip.readBlobURL(p) : null,
        namespace: e.ns,
      };
    }).sort((a, b) => a.id.localeCompare(b.id));

  const particleMap = new Map();
  for (const ns of namespaces) {
    const lang = langOf(ns);
    for (const id of listBy(`assets/${ns}/particles/`, '.json')) {
      if (id.startsWith('_') || id.includes('/')) continue;
      particleMap.set(fullId(ns, id), { ns, id, name: lang[`particle.${ns}.${id}`] || id });
    }
  }
  registry.particles = Array.from(particleMap.entries())
    .map(([fid, p]) => ({ id: fid, name: p.name, kind: 'particle', icon: null, namespace: p.ns }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const c = registry.counts;
  onStatus(`jar 检索完成：物品 ${c.items} · 实体 ${c.entities} · 粒子 ${c.particles}（命名空间 ${namespaces.size} 个）`);
  return registry;
}

/** 让本机 .minecraft/versions 里的 jar 可被选择（File System Access 优先，退回 input[type=file]） */
export async function pickDirectory() {
  if (window.showDirectoryPicker) {
    const dir = await window.showDirectoryPicker({ id: 'mc-versions', mode: 'read' });
    const found = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'directory') continue;
      const jarName = `${name}.jar`;
      let jarHandle = null;
      try { jarHandle = await handle.getFileHandle(jarName); } catch { /* 目录名与 jar 名不一致 */ }
      if (!jarHandle) {
        for await (const [fname, fh] of handle.entries()) {
          if (fh.kind === 'file' && fname.toLowerCase().endsWith('.jar')) { jarHandle = fh; break; }
        }
      }
      if (jarHandle) found.push({ id: name, name: jarName, handle: jarHandle });
    }
    return { mode: 'fsapi', entries: found, dirName: dir.name };
  }
  return { mode: 'input', entries: [], dirName: '' };
}

/** 从文件名推断版本 id：26.3.jar → 26.3；BBS.jar → BBS */
export function jarIdFromName(name) {
  return String(name || '').replace(/\.jar$/i, '').trim();
}

/**
 * 直接选择一个或多个 .jar 文件（原版 jar 与 mod jar 都行）。
 * 之前只能选整个 versions 文件夹、且要求目录名与 jar 名严格一致 —— 用户报障要求改为直接选 jar 文件。
 */
export async function pickJars() {
  if (window.showOpenFilePicker) {
    const handles = await window.showOpenFilePicker({
      id: 'mc-jars',
      multiple: true,
      excludeAcceptAllOption: false,
      types: [{ description: 'Minecraft jar / mod jar', accept: { 'application/java-archive': ['.jar'] } }],
    });
    const entries = [];
    for (const h of handles) {
      const f = await h.getFile();
      entries.push({ id: jarIdFromName(f.name), name: f.name, handle: h, file: f, size: f.size });
    }
    return { mode: 'fsapi', entries };
  }
  return { mode: 'input', entries: [] };
}

/** 判断 jar 类型：原版 / Fabric / Forge / NeoForge / Quilt —— 供 UI 标注 */
export async function jarKind(zip) {
  const has = (p) => zip.has(p);
  if (has('fabric.mod.json')) return 'Fabric';
  if (has('META-INF/neoforge.mods.toml')) return 'NeoForge';
  if (has('META-INF/mods.toml')) return 'Forge';
  if (has('quilt.mod.json')) return 'Quilt';
  if (has('version.json')) return '原版';
  if (has('META-INF/MANIFEST.MF')) return 'Java 归档（未识别加载器）';
  return '未知 jar';
}

/** 兼容旧调用：返回 input[type=file] 需要接受的扩展名 */
export const JAR_ACCEPT = '.jar';

export async function readHandle(entry) {
  if (entry.handle && entry.handle.getFile) return entry.handle.getFile();
  return entry.file;
}

/** 预热图标（并发受限） */
export async function warmIcons(entries, limit = 6, onEach = null) {
  return pool(entries.filter((e) => e.iconLoader), limit, async (e) => {
    const url = await e.iconLoader();
    if (onEach) onEach(e, url);
    return url;
  });
}
