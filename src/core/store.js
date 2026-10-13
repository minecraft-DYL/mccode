// store.js —— 应用状态中枢（单一数据源 + 订阅通知 + 动作封装）

import { store as ls } from './util.js';
import { loadManifest, parseVersion, majorLabel, channelName } from './versions.js';
import { CapabilityMatrix, CAP_KEYS, STATUS_LABEL } from './capabilities.js';
import {
  buildRegistry, clearRegistryCache, clearMemoryRegistryCache, dropRegistryCache, SOURCE_LABEL,
  warmupRegistryBaseline, registryWarmupStatus, cancelRegistryWarmup,
  clearAllRegistryCache, registryCacheStats, registryCacheChain, registryCachePeek,
  invalidateRegistryCache, registryCacheBaselines, packRegistry, unpackData,
} from './registry.js';

export const state = {
  theme: ls.get('theme', 'dark'),
  ready: false,

  versionIndex: null,
  manifestAt: null,
  manifestFromCache: false,

  matrix: null,
  version: ls.get('version', ''),
  registry: null,
  registrySource: ls.get('source', 'github'),
  registryBusy: false,
  /**
   * 切换版本后是否自动按新版本重新检索注册表。
   * 用户要求「实时获取 MC 的所有物品……受版本选择影响」，所以默认开。
   * 注意：这个字段曾经只被 setVersion 读、从来没有被写过，
   * 于是那个分支是死代码 —— 切版本后物品列表会一直停在上一个版本。
   */
  autoRetrieve: ls.get('autoRetrieve', true),

  /** 最近一次检索的缓存信息（命中与否、基线、增删改、字节数） */
  registryCache: null,
  /** 启动预热状态：idle | running | done | failed | cancelled */
  registryWarmupStatus: 'idle',
  registryWarmupResult: null,

  page: 'overview',
  status: [],

  // 草稿区
  nbtDraft: ls.get('nbtDraft', ''),
  componentDraft: ls.get('componentDraft', ''),
  commandDraft: ls.get('commandDraft', '/give @s minecraft:diamond_sword'),
  outputMode: ls.get('outputMode', 'chat'),
  graph: ls.get('graph', null),
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify(what = '*') {
  for (const fn of listeners) { try { fn(what, state); } catch (e) { console.error('[store] 订阅者出错', e); } }
}

/* ------------------------------ 状态提示 ------------------------------ */

export function pushStatus(text, level = 'info') {
  state.status.unshift({ text, level, at: Date.now() });
  if (state.status.length > 60) state.status.pop();
  notify('status');
}

/* ------------------------------ 主题 ------------------------------ */

export function setTheme(t) {
  state.theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('theme-dark', state.theme === 'dark');
  document.documentElement.classList.toggle('theme-light', state.theme === 'light');
  ls.set('theme', state.theme);
  notify('theme');
}
export function toggleTheme() { setTheme(state.theme === 'dark' ? 'light' : 'dark'); }

/* ------------------------------ 版本 ------------------------------ */

export async function initVersions({ force = false } = {}) {
  const { index, fromCache, at, stale } = await loadManifest({ force, onStatus: (s) => pushStatus(s) });
  state.versionIndex = index;
  state.manifestAt = at;
  state.manifestFromCache = !!fromCache;
  state.matrix = await CapabilityMatrix.load(index);
  pushStatus(`能力矩阵已就绪：${state.matrix.segments.length} 个技术分段（来源：${state.matrix.loadedFrom === 'wiki' ? 'wiki 取证' : '内置基线'}）`, state.matrix.loadedFrom === 'wiki' ? 'success' : 'info');
  if (stale) pushStatus('版本清单来自过期缓存（网络不可达）', 'warning');

  // 恢复上次选择的版本；否则默认最新正式版
  const saved = state.version && index.byId.has(state.version) ? state.version : null;
  state.version = saved || index.latest.release;
  ls.set('version', state.version);
  notify('versions');

  // 启动预热：非阻塞。首屏渲染已经完成，这里只是把「第一个有物品的版本」做成增量缓存基线。
  // 失败静默（见 prewarmRegistry / registry.js 的 warmupRegistryBaseline）。
  try {
    setTimeout(() => { void prewarmRegistry(); }, 0);
  } catch (e) { console.warn('[store] 启动预热调度失败（忽略）', e); }

  return index;
}

/**
 * 触发（或复用）启动预热。幂等：内部 promise 去重，重复调用不会重复发请求。
 * @param {{index?:object, maxProbe?:number}} o
 */
export function prewarmRegistry({ index = state.versionIndex, maxProbe = 4 } = {}) {
  if (state.registryWarmupPromise) return state.registryWarmupPromise;
  state.registryWarmupStatus = 'running';
  notify('registry:warmup');
  const p = warmupRegistryBaseline({ index, maxProbe, onStatus: (s, level) => pushStatus(s, level || 'info') })
    .then((r) => {
      state.registryWarmupStatus = r && r.ok ? 'done' : (r && r.cancelled ? 'cancelled' : 'failed');
      state.registryWarmupResult = r;
      notify('registry:warmup');
      return r;
    })
    .catch((e) => {
      state.registryWarmupStatus = 'failed';
      state.registryWarmupResult = { ok: false, error: e && e.message ? e.message : String(e) };
      console.warn('[store] 启动预热异常（已静默）', e);
      notify('registry:warmup');
      return state.registryWarmupResult;
    });
  state.registryWarmupPromise = p;
  return p;
}

/** 预热完成后清掉即可重新预热（测试 / 手动触发用） */
export function resetPrewarm() {
  state.registryWarmupPromise = null;
  state.registryWarmupStatus = 'idle';
  state.registryWarmupResult = null;
}


export async function setVersion(id) {
  if (!id) return;
  const v = state.versionIndex ? state.versionIndex.get(id) : null;
  state.version = id;
  ls.set('version', id);
  if (v) pushStatus(`已切换版本：${id}（${channelName(v.type)}）`, 'success');
  else pushStatus(`已切换版本：${id}（不在官方清单中，按最接近的版本处理）`, 'warning');
  notify('version');
  // 不 await：versions.js / matrix.js 都会 await setVersion，同步等一次检索（首次 3~4 秒）
  // 会让「点一下版本」卡住。loadRegistry 自己在成功/失败两条路上都会 notify('registry')，
  // 所以这里放开手异步跑，页面到时候会自己刷新。
  if (state.autoRetrieve) {
    void loadRegistry({ source: state.registrySource, version: id })
      .catch((e) => pushStatus(`按 ${id} 自动检索失败：${e.message}`, 'warning'));
  }
}

/** 开关：切换版本后自动检索。持久化，跨会话保留。 */
export function setAutoRetrieve(on) {
  state.autoRetrieve = !!on;
  ls.set('autoRetrieve', state.autoRetrieve);
  pushStatus(state.autoRetrieve ? '已开启：切换版本后自动检索' : '已关闭：切换版本后不自动检索', 'info');
  notify('version');
}

/* ------------------------------ 注册表 ------------------------------ */

/**
 * 检索注册表。
 * 返回结构保持不变（Registry | null），新增：
 *   · 传入 version 可覆盖当前所选版本（自动化测试 / 批量预热用）
 *   · 传 useCache:false 只跳过读缓存（force 同义），storeCache:false 只跳过写缓存
 *   · 返回对象上多一个 reg.cache —— { hit, kind, base, chain, deltaStats, bytes, fullBytes, savedBytes, buildMs }
 */
export async function loadRegistry({
  source = null, force = false, jar = null, versionDetail = null, jarId = null,
  version = null, useCache = true, storeCache = true,
} = {}) {
  // 手动选 jar 时用 jar 的文件名作为"版本标签"：mod jar 的版本号往往不在 manifest 里，
  // 强制套用当前所选版本会得到与 jar 不匹配的注册表。
  const ver = jarId || version || state.version;
  if (!ver) { pushStatus('请先选择版本', 'warning'); return null; }
  if (source) state.registrySource = source;
  ls.set('source', state.registrySource);
  // force 只丢弃内存里的实例：持久缓存里的旧记录保留着旧内容哈希，
  // 写回时才能精确判断「内容到底变没变」，只让真正受影响的派生版本失效。
  if (force) clearMemoryRegistryCache(ver);

  state.registryBusy = true;
  notify('registry:busy');
  try {
    const reg = await buildRegistry({
      version: ver,
      source: state.registrySource,
      index: state.versionIndex,
      jar,
      versionDetail,
      useCache: !force && useCache !== false,
      storeCache,
      onStatus: (s, level) => pushStatus(s, level || 'info'),
    });
    reg.jarId = jarId || null;
    state.registry = reg;
    state.registryCache = reg.cache || null;
    const modNote = reg.namespaces && reg.namespaces.length > 1 ? ` · 命名空间 ${reg.namespaces.length} 个` : '';
    const cacheNote = reg.cache
      ? (reg.cache.hit
        ? ` · 缓存命中（${reg.cache.kind === 'delta' ? `增量基线 ${reg.cache.base}` : '基线整份'}，读 ${reg.cache.bytes} 字节）`
        : (reg.cache.stored ? ` · 已缓存（${reg.cache.kind === 'delta' ? `增量基线 ${reg.cache.base}` : '基线整份'}，${reg.cache.dataBytes} 字节）` : ''))
      : '';
    pushStatus(`注册表就绪：物品 ${reg.items.length} · 实体 ${reg.entities.length} · 粒子 ${reg.particles.length}（${SOURCE_LABEL[reg.source] || reg.source}${modNote}${cacheNote}）`, 'success');
    notify('registry');
    notify('registry:cache');
    return reg;
  } catch (e) {
    pushStatus(`注册表检索失败：${e.message}`, 'error');
    notify('registry');
    return null;
  } finally {
    state.registryBusy = false;
    notify('registry:busy');
  }
}

/* ------------------------------ 能力门控 ------------------------------ */

export function capsOf(version = state.version) {
  if (!state.matrix || !version) return null;
  return state.matrix.capsAt(version);
}

export function capStatus(key, version = state.version) {
  const c = capsOf(version);
  return c ? c[key] : 'unsupported';
}

export function capAvailable(key, version = state.version) {
  const s = capStatus(key, version);
  return s === 'ok' || s === 'partial' || s === 'degraded';
}

export function capLabel(key, version = state.version) {
  return STATUS_LABEL[capStatus(key, version)] || '未知';
}

export function versionLabel() {
  if (!state.version) return '未选择版本';
  const v = state.versionIndex ? state.versionIndex.get(state.version) : null;
  return v ? `${v.id} · ${channelName(v.type)}` : state.version;
}

export function versionSummary() {
  if (!state.version) return '';
  const p = parseVersion(state.version);
  return `${majorLabel(state.version)} 系列 · ${channelName(p.kind)}`;
}

/* ------------------------------ 草稿持久化 ------------------------------ */

let saveTimer = null;
export function saveDrafts() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ls.set('nbtDraft', state.nbtDraft);
    ls.set('componentDraft', state.componentDraft);
    ls.set('commandDraft', state.commandDraft);
    ls.set('outputMode', state.outputMode);
    if (state.graph) ls.set('graph', state.graph);
  }, 350);
}

/* ------------------------------ 便捷选择器 ------------------------------ */

export function allVersions() { return state.versionIndex ? state.versionIndex.versions : []; }
export function releases(limit = Infinity) { return state.versionIndex ? state.versionIndex.releases(limit) : []; }
export function capsKeys() { return CAP_KEYS; }

/* ------------------------------ 注册表增量缓存（数据层对外出口） ------------------------------ */
//
// UI 侧接这几个即可：
//   registryCacheStats()        —— 缓存占用/命中结构（真实字节数，见返回的 entries）
//   registryCacheChain(v)       —— 某版本的增量链（叶子 → 基线）
//   registryCacheBaselines()    —— 现有基线版本
//   clearAllRegistryCache()     —— 一键删干净（用户说的"删掉 temp"）；删完再检索能重新工作
//   clearRegistryCache(v)       —— 清某个版本（同步；持久层异步）
//   dropRegistryCache(v)        —— 同上但可 await（返回 {removed, invalidated}）
//   invalidateRegistryCache(v)  —— 只删条目，并把派生版本标 stale
//   registryWarmupStatus()      —— 启动预热状态
//   prewarmRegistry()           —— 手动触发预热（幂等）
//   cancelRegistryWarmup()      —— 取消预热（下一次候选前生效）
//   state.registryCache         —— 最近一次检索：{hit, kind:'full'|'delta', base, chain, deltaStats, bytes, fullBytes, savedBytes}

export {
  clearRegistryCache, clearMemoryRegistryCache, dropRegistryCache,
  clearAllRegistryCache, registryCacheStats, registryCacheChain, registryCachePeek,
  invalidateRegistryCache, registryCacheBaselines, registryWarmupStatus, cancelRegistryWarmup,
  packRegistry, unpackData,
};

/**
 * 一行话的缓存摘要（纯读，不发网络请求），供状态栏 / 版本页展示。
 * @returns {Promise<{engine:string,count:number,deltaCount:number,entryBytes:number,dataBytes:number,
 *                    fullDataBytes:number,savingRatio:number,text:string}>}
 */
export async function registryCacheSummary() {
  const s = await registryCacheStats();
  const bytesText = (n) => {
    if (!Number.isFinite(n)) return '—';
    const u = ['B', 'KB', 'MB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const text = s.count
    ? `增量缓存 ${s.count} 个版本（基线 ${s.fullCount} · 增量 ${s.deltaCount}），占用 ${bytesText(s.entryBytes)}；若全量存储需 ${bytesText(s.fullDataBytes)}（省 ${s.savingRatio}×）`
    : '尚无增量缓存';
  return { ...s, text };
}

