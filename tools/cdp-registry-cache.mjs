// cdp-registry-cache.mjs —— 注册表增量缓存的真实验收（CDP 驱动 Edge headless，零依赖）
//
// 用法: node tools/cdp-registry-cache.mjs [baseUrl]
//       node tools/cdp-registry-cache.mjs --keep-profile   # 保留浏览器 profile（默认每次全新，保证冷启动）
//
// 实测并断言：
//   ① 首次检索某版本 → hit:false，记录耗时
//   ② 刷新页面后再次检索同一版本 → hit:true 且明显更快、0 次外部网络请求
//   ③ 清空缓存后再检索 → hit:false 且能重新拿到完整列表
//   ④ ≥3 个不同版本的真实增量检索，打印缓存占用字节数与「若全量存储」的对比
//   ⑤ 增量重建必须与直接检索结果完全一致（无损）
//   ⑥ 版本序关系导致的依赖失效（含"内容没变就不该失效"的反向断言）
//   ⑦ 全程 0 未捕获异常
//
// 说明：使用 CDP 单次 Runtime.evaluate 有 30s 上限，因此长流程被拆成多次调用，每次只干一件事；
//       Node 侧的网络事件计数用来证明「命中缓存时确实没发请求」。

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:8777/';
const KEEP_PROFILE = process.argv.includes('--keep-profile');
const PORT = 9800 + Math.floor(Math.random() * 180);
const PROFILE = join(process.env.TEMP || '.', `edge-regcache-${PORT}`);
const SHOT_DIR = 'D:\\ku\\traecode\\mccode\\.shots';
mkdirSync(SHOT_DIR, { recursive: true });
if (!KEEP_PROFILE) { try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* noop */ } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

/* ------------------------------ 断言台账 ------------------------------ */
const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
}
const section = (t) => console.log(`\n──────── ${t} ────────`);

/* ------------------------------ 启动浏览器 ------------------------------ */
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1050',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP target 未就绪（Edge 没起来？）');
}

const target = await waitTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const logErrors = [];
const requests = [];   // {url, ts}
const netFails = [];

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`${(d.exception && (d.exception.description || d.exception.value)) || d.text} @${String(d.url || '').split('/').pop()}:${d.lineNumber}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logErrors.push(`${m.params.entry.text} ${String(m.params.entry.url || '').split('/').pop()}`.slice(0, 300));
  } else if (m.method === 'Network.requestWillBeSent') {
    requests.push({ url: m.params.request.url, ts: Date.now() });
  } else if (m.method === 'Network.loadingFailed') {
    netFails.push(`${m.params.type} ${m.params.errorText}`);
  }
};

function send(method, params = {}, timeoutMs = 60000) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, timeoutMs);
  });
}

// 注意：jsDelivr 的端点可能是 cdn / fastly / gcore 任意一个（产品侧会按可达性切换），
// 这里只认 cdn.jsdelivr.net 会把 fastly 的请求漏掉，计数直接变成 0 —— 曾经就这么漏过。
const EXTERNAL_RE = /api\.github\.com|jsdelivr\.net|launchermeta\.mojang\.com|resources\.download\.minecraft\.net|bmclapi/;
const extSince = (from) => requests.slice(from).filter((r) => EXTERNAL_RE.test(r.url)).length;
const extUrls = (from) => requests.slice(from).filter((r) => EXTERNAL_RE.test(r.url)).map((r) => {
  try { const u = new URL(r.url); return `${u.host}${u.pathname}`; } catch { return r.url; }
});

async function ev(body, timeoutMs = 60000) {
  const expression = `(async () => { ${body} })()`;
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) {
    return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  }
  const v = r.result && r.result.value;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

const READY = `
  const store = await import('/src/core/store.js');
  const cache = await import('/src/core/registry-cache.js');
  const ensure = async () => { if (!store.state.versionIndex) await store.initVersions({}); };
`;
const ok = (r) => r && !r.__error;
const err = (r) => (r && r.__error) ? r.__error : '';

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');

/* ------------------------------ 0. 环境 ------------------------------ */
section('0. 环境与限流');
let rate = null;
try {
  const r = await fetch('https://api.github.com/rate_limit', { headers: { 'User-Agent': 'mccode-cdp-test' } });
  rate = (await r.json()).resources.core;
} catch (e) { rate = { error: e.message }; }
console.log(`  GitHub 匿名配额：${JSON.stringify(rate)}`);
console.log(`  Edge profile（每次全新，保证冷启动）：${PROFILE}`);

await send('Page.navigate', { url: BASE });
await sleep(6000);

/* ------------------------------ 1. 冷启动：initVersions 自动预热 ------------------------------ */
section('1. 冷启动 + 启动自动预热（IndexedDB 为空）');
let n0 = requests.length;
const boot = await ev(`${READY}
  const t0 = performance.now();
  if (!store.state.versionIndex) await store.initVersions({});
  return JSON.stringify({
    ms: Math.round(performance.now() - t0),
    manifest: store.state.versionIndex.versions.length,
    version: store.state.version,
    warmupScheduled: store.state.registryWarmupStatus,
    hasMCE: !!window.__MCE__,
    externalReq: ${'0'},
  });
`);
console.log(`  initVersions: ${JSON.stringify(boot)}`);
console.log(`  initVersions 期间外部请求 ${extSince(n0)} 次`);

// 轮询预热（initVersions 里 setTimeout(0) 触发，非阻塞）
let warm = { status: 'idle' };
const wDeadline = Date.now() + 150000;
let wReq0 = requests.length;
while (Date.now() < wDeadline) {
  warm = await ev(`${READY}
    return JSON.stringify({ status: store.state.registryWarmupStatus, result: store.state.registryWarmupResult });`);
  if (warm.status && warm.status !== 'idle' && warm.status !== 'running') break;
  await sleep(1500);
}
const warmReq = extSince(wReq0);
console.log(`  预热状态：${warm.status}`);
console.log(`  预热结果：${JSON.stringify(warm.result)}`);
console.log(`  预热期间外部请求 ${warmReq} 次：${extUrls(wReq0).join(', ')}`);

check('启动后自动触发预热（initVersions 内调度）', warm.status === 'done', `status=${warm.status}`);
const warmResult = warm.result || {};
check('预热找到「第一个有物品的版本」并取到物品', warmResult.ok === true && warmResult.items > 0,
  `version=${warmResult.version} items=${warmResult.items}`);
check('预热期间确实发生了真实网络检索', warmReq > 0, `${warmReq} 次外部请求`);
const statusCheck = await ev(`${READY}
  await ensure();
  return JSON.stringify({
    errors: store.state.status.filter((s) => s.level === 'error').map((s) => s.text),
    registryRelated: store.state.status.filter((s) => /预热|注册表|缓存/.test(s.text)).slice(0, 8).map((s) => s.level + ': ' + s.text),
  });`);
check('预热/检索过程没有产生 error 级状态（失败也不弹错）',
  (statusCheck.errors || []).filter((t) => /预热|注册表|缓存|registry/i.test(t)).length === 0,
  `error 级状态：${JSON.stringify((statusCheck.errors || []).slice(0, 3))}`);
console.log('  预热相关状态栏：');
for (const l of (statusCheck.registryRelated || []).slice(0, 6)) console.log(`    · ${l}`);

const BASELINE = warmResult.version;
console.log(`  基线版本 = ${BASELINE}`);

/* ------------------------------ 2. 首次检索 3 个不同版本（真实网络 + 真实差异） ------------------------------ */
section('2. 首次检索不同版本（真实网络检索 → 写入增量缓存）');
const PICKS = ['1.21.4', '1.21.1', '1.20.4'].filter((v) => v !== BASELINE).slice(0, 3);
console.log(`  对照版本：${PICKS.join(', ')}（基线 ${BASELINE}）`);

async function retrieve(v, { useCache = true, storeCache = true } = {}) {
  const from = requests.length;
  const r = await ev(`${READY}
    await ensure();
    const V = ${JSON.stringify(v)};
    const t0 = performance.now();
    const reg = await store.loadRegistry({ version: V, source: 'github', useCache: ${useCache}, storeCache: ${storeCache} });
    const ms = Math.round(performance.now() - t0);
    if (!reg) return JSON.stringify({ V, ok: false, ms, status: store.state.status.slice(0, 5) });
    return JSON.stringify({ V, ok: true, ms, hit: reg.cache.hit, level: reg.cache.level, kind: reg.cache.kind,
      base: reg.cache.base, chain: reg.cache.chain, delta: reg.cache.deltaStats,
      dataBytes: reg.cache.dataBytes, bytes: reg.cache.bytes, fullBytes: reg.cache.fullBytes,
      savedBytes: reg.cache.savedBytes, invalidated: reg.cache.invalidated,
      items: reg.items.length, entities: reg.entities.length, particles: reg.particles.length,
      tag: reg.tag, note: reg.note });
  `, 90000);
  r.externalReq = extSince(from);
  r.external = extUrls(from);
  r.consoleTail = null;
  return r;
}

const first = {};
for (const v of PICKS) {
  const r = await retrieve(v);
  first[v] = r;
  if (!ok(r)) { console.log(`  ❌ ${v} 检索失败：${err(r)}`); continue; }
  console.log(`  ${v.padEnd(9)} 耗时 ${String(r.ms).padStart(6)}ms  hit=${r.hit}  kind=${r.kind}  base=${String(r.base)}  增${r.delta ? r.delta.added : 0}/删${r.delta ? r.delta.removed : 0}/改${r.delta ? r.delta.changed : 0}  记录 ${fmt(r.dataBytes)}  若全量 ${fmt(r.fullBytes)}  外部请求 ${r.externalReq}`);
}
for (const v of PICKS) {
  check(`${v} 首次检索 hit=false（真实网络检索）`, ok(first[v]) && first[v].hit === false, `hit=${first[v] && first[v].hit} ms=${first[v] && first[v].ms}`);
  check(`${v} 首次检索确实发了外部请求`, (first[v].externalReq || 0) > 0, `${first[v].externalReq} 次`);
  check(`${v} 取到非空物品表`, (first[v].items || 0) > 0, `items=${first[v].items}`);
  check(`${v} 写入增量差异（非基线）或成为基线`, ok(first[v]) && (first[v].kind === 'delta' || first[v].kind === 'full'), `kind=${first[v].kind} base=${first[v].base}`);
}
const deltaVersions = PICKS.filter((v) => first[v] && first[v].kind === 'delta');
check('至少一个版本用增量方式缓存', deltaVersions.length > 0, `增量版本：${deltaVersions.join(', ')}`);

// 「真实检索」的可读日志（刷新页面后 state.status 会重置，所以必须在这里先取证）
const retrievalLogs = await ev(`${READY}
  await ensure();
  return JSON.stringify(store.state.status.filter((s) => /真实检索|增量缓存命中/.test(s.text)).slice(0, 6).map((s) => s.level + ': ' + s.text));`);
console.log('  真实检索阶段的状态栏日志：');
for (const l of (retrievalLogs || [])) console.log(`    · ${l}`);

/* ------------------------------ 3. 刷新页面 → 同版本应命中持久缓存 ------------------------------ */
section('3. 刷新页面后再次检索同一版本（内存缓存已清空，只剩 IndexedDB）');
const V2 = PICKS[0];
const beforeReload = first[V2];
await send('Page.reload', {});
await sleep(6000);
const memCleared = await ev(`${READY}
  await ensure();
  return JSON.stringify({ memRegistry: !!store.state.registry, index: !!store.state.versionIndex });`);
console.log(`  刷新后页面状态：${JSON.stringify(memCleared)}`);

const hitRuns = [];
for (const v of [V2, ...PICKS.slice(1)]) {
  const from = requests.length;
  const r = await ev(`${READY}
    await ensure();
    const V = ${JSON.stringify(v)};
    const t0 = performance.now();
    const reg = await store.loadRegistry({ version: V, source: 'github' });
    const ms = Math.round(performance.now() - t0);
    if (!reg) return JSON.stringify({ V, ok: false, ms });
    return JSON.stringify({ V, ok: true, ms, hit: reg.cache.hit, level: reg.cache.level, kind: reg.cache.kind,
      base: reg.cache.base, chain: reg.cache.chain, delta: reg.cache.deltaStats,
      dataBytes: reg.cache.dataBytes, bytes: reg.cache.bytes, fullBytes: reg.cache.fullBytes,
      items: reg.items.length, entities: reg.entities.length, particles: reg.particles.length });
  `, 30000);
  r.externalReq = extSince(from);
  r.external = extUrls(from);
  hitRuns.push(r);
  console.log(`  ${v.padEnd(16)} 耗时 ${String(r.ms).padStart(5)}ms  hit=${r.hit}  level=${r.level}  kind=${r.kind}  链=${(r.chain || []).join('←')}  外部请求 ${r.externalReq}`);
}
for (const r of hitRuns) {
  check(`${r.V} 刷新后命中持久缓存 hit=true`, ok(r) && r.hit === true, `hit=${r.hit} level=${r.level}`);
  check(`${r.V} 命中时 0 次外部网络请求`, r.externalReq === 0, `${r.externalReq} 次 ${r.external.join(',')}`);
  check(`${r.V} 命中耗时明显快于真实检索`, r.ms < (first[r.V] ? first[r.V].ms : Infinity),
    `命中 ${r.ms}ms < 检索 ${first[r.V] ? first[r.V].ms : '?'}ms`);
  check(`${r.V} 命中后物品表非空`, (r.items || 0) > 0, `items=${r.items}`);
}
// 状态栏可读日志
const statusLog = await ev(`${READY}
  await ensure();
  const reg = await store.loadRegistry({ version: ${JSON.stringify(BASELINE)}, source: 'github' });
  return JSON.stringify({ hit: reg.cache.hit, lines: store.state.status.filter(s => /缓存命中|真实检索|注册表就绪/.test(s.text)).slice(0, 6).map(s => s.level + ': ' + s.text) });`);
console.log('  状态栏日志：');
for (const l of (statusLog.lines || [])) console.log(`    · ${l}`);
const hitLogCount = (statusLog.lines || []).filter((l) => /缓存命中/.test(l)).length;
const retrievalLogCount = (retrievalLogs || []).filter((l) => /真实检索/.test(l)).length;
check('命中缓存与真实检索都能 pushStatus 可读日志', hitLogCount > 0 && retrievalLogCount > 0,
  `命中 ${hitLogCount} 条（本次）+ 真实检索 ${retrievalLogCount} 条（检索阶段，刷新前已取证）`);

/* ------------------------------ 4. 无损性：增量重建 vs 直接检索 ------------------------------ */
section('4. 增量重建无损性（缓存重建 ≡ 直接检索）');
const allVersions = [BASELINE, ...PICKS];
const lossless = [];
for (const v of allVersions) {
  const r = await ev(`${READY}
    await ensure();
    const V = ${JSON.stringify(v)};
    // 先清掉内存实例，确保下面这次读必定走 IndexedDB 的增量链重建（而不是内存里现成的对象）
    store.clearMemoryRegistryCache(V);
    const cached = await store.loadRegistry({ version: V, source: 'github' });
    if (!cached) return JSON.stringify({ V, ok: false, why: '缓存重建失败' });
    const oracle = await store.loadRegistry({ version: V, source: 'github', useCache: false, storeCache: false });
    if (!oracle) return JSON.stringify({ V, ok: false, why: '直接检索失败' });
    const proj = (r) => JSON.stringify({
      items: r.items.map((e) => [e.id, e.name, e.icon, e.iconKind]),
      entities: r.entities.map((e) => [e.id, e.name, e.icon]),
      particles: r.particles.map((e) => [e.id, e.name, e.icon]),
    });
    const a = proj(cached), b = proj(oracle);
    const same = a === b;
    let firstDiff = null;
    if (!same) {
      const ca = cached.items, cb = oracle.items;
      for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
        const x = JSON.stringify(ca[i] && [ca[i].id, ca[i].name, ca[i].icon, ca[i].iconKind]);
        const y = JSON.stringify(cb[i] && [cb[i].id, cb[i].name, cb[i].icon, cb[i].iconKind]);
        if (x !== y) { firstDiff = { at: i, cached: x, oracle: y }; break; }
      }
      if (!firstDiff) firstDiff = { at: 'entities/particles' };
    }
    return JSON.stringify({ V, ok: true, same,
      cachedHit: cached.cache.hit, cachedLevel: cached.cache.level, cachedKind: cached.cache.kind, chain: cached.cache.chain,
      counts: { items: cached.items.length, entities: cached.entities.length, particles: cached.particles.length },
      oracleCounts: { items: oracle.items.length, entities: oracle.entities.length, particles: oracle.particles.length },
      firstDiff });
  `, 90000);
  lossless.push(r);
  if (!ok(r)) { console.log(`  ❌ ${v} 对照失败：${err(r)}`); continue; }
  console.log(`  ${v.padEnd(16)} 重建(${r.cachedKind}/${(r.chain || []).length}层链) 物品 ${r.counts.items} vs 直接检索 ${r.oracleCounts.items}  实体 ${r.counts.entities}/${r.oracleCounts.entities}  粒子 ${r.counts.particles}/${r.oracleCounts.particles}  → ${r.same ? '完全一致' : '不一致 ' + JSON.stringify(r.firstDiff)}`);
}
for (const r of lossless) {
  check(`${r.V} 增量重建与直接检索完全一致（无损）`, ok(r) && r.same === true,
    ok(r) ? `items ${r.counts.items}=${r.oracleCounts.items}, entities ${r.counts.entities}=${r.oracleCounts.entities}, particles ${r.counts.particles}=${r.oracleCounts.particles}` : err(r));
}

/* ------------------------------ 5. 体积对比 ------------------------------ */
section('5. 缓存体积：增量 vs 全量（真实字节数）');
const stats = await ev(`${READY}
  const s = await cache.registryCacheStats();
  const sum = await store.registryCacheSummary();
  return JSON.stringify({ engine: s.engine, count: s.count, fullCount: s.fullCount, deltaCount: s.deltaCount,
    staleCount: s.staleCount, unknownCount: s.unknownCount,
    dataBytes: s.dataBytes, entryBytes: s.entryBytes, fullDataBytes: s.fullDataBytes,
    savingRatio: s.savingRatio, overheadRatio: s.overheadRatio, entries: s.entries, chains: s.chains,
    text: sum.text, projection: s.projection });`);
console.log(`  存储引擎：${stats.engine}`);
console.log(`  已缓存版本：${stats.count}（基线 ${stats.fullCount} · 增量 ${stats.deltaCount} · stale ${stats.staleCount} · unknown ${stats.unknownCount}）`);
console.log(`  实际占用：payload ${fmt(stats.dataBytes)} / 记录总计 ${fmt(stats.entryBytes)}`);
console.log(`  若这 ${stats.count} 个版本都整份存：${fmt(stats.fullDataBytes)}`);
console.log(`  体积比：全量 / 增量 = ${stats.savingRatio}×`);
console.log('  逐版本明细：');
console.log('    版本              类型   基线                增/删/改        实际记录     若全量      链路深度');
for (const e of stats.entries) {
  const d = e.deltaStats ? `${e.deltaStats.added}/${e.deltaStats.removed}/${e.deltaStats.changed}` : '—';
  const depth = (stats.chains.find((c) => c.version === e.version) || {}).depth || 1;
  console.log(`    ${String(e.version).padEnd(17)} ${String(e.kind).padEnd(6)} ${String(e.base || '（基线）').padEnd(19)} ${d.padEnd(14)} ${fmt(e.dataBytes).padStart(9)} ${fmt(e.fullDataBytes).padStart(10)}   ${depth}`);
}
console.log(`  链结构：${stats.chains.map((c) => `${c.version}(${c.depth}层: ${c.chain.join('←')})`).join('  ') || '（无多层链）'}`);
console.log(`  一行摘要：${stats.text}`);
check('缓存记录了每版的 base 与增删改', stats.entries.every((e) => e.base !== undefined && (e.kind === 'full' || e.deltaStats)),
  `${stats.entries.filter((e) => e.kind === 'delta' && e.deltaStats).length} 个增量条目带增删改明细`);
check('存在多层增量链（差异基于任意已缓存邻近版本）', stats.chains.some((c) => c.depth >= 3),
  `最深 ${Math.max(1, ...stats.chains.map((c) => c.depth))} 层`);
check(`增量缓存实际占用小于全量（${stats.savingRatio}×）`, stats.dataBytes < stats.fullDataBytes,
  `增量 ${stats.dataBytes} B < 全量 ${stats.fullDataBytes} B`);
check('缓存引擎是真正的 IndexedDB（跨刷新存活）', stats.engine === 'indexeddb', `engine=${stats.engine}`);

/* ------------------------------ 6. 依赖失效（版本序关系） ------------------------------ */
section('6. 版本序关系导致的缓存失效');
// 6a. 反例：内容没变时，重新检索旧版本不得误伤比它新的版本
const invalid = { A: stats.chains.find((c) => c.depth >= 3) ? stats.chains.find((c) => c.depth >= 3).chain[1] : PICKS[1] };
console.log(`  旧版本 = ${invalid.A}（它被更晚的版本当作 base）`);
const noChange = await ev(`${READY}
  await ensure();
  const A = ${JSON.stringify(invalid.A)};
  const before = await cache.registryCacheStats();
  const chainBefore = await cache.registryCacheChain(A);
  const reg = await store.loadRegistry({ version: A, source: 'github', useCache: false, storeCache: true });
  const after = await cache.registryCacheStats();
  const chainAfter = await cache.registryCacheChain(A);
  return JSON.stringify({ A, hit: reg.cache.hit, kind: reg.cache.kind, invalidated: reg.cache.invalidated || [],
    staleBefore: before.staleCount, staleAfter: after.staleCount,
    chainBefore, chainAfter,
    staleEntries: after.entries.filter((e) => e.stale).map((e) => e.version),
    indexOrder: { self: store.state.versionIndex.order.get(A), base: store.state.versionIndex.order.get(reg.cache.base) } });`, 90000);
console.log(`  重新检索 ${noChange.A}：kind=${noChange.kind} base=${noChange.chainAfter && noChange.chainAfter[1] ? noChange.chainAfter[1].version : '（无）'}  invalidated=${JSON.stringify(noChange.invalidated)}  stale ${noChange.staleBefore} → ${noChange.staleAfter}`);
console.log(`  链前后：${JSON.stringify((noChange.chainBefore || []).map((x) => x.version))} → ${JSON.stringify((noChange.chainAfter || []).map((x) => x.version))}`);
check('内容未变 → 不误伤派生版本（无级联重建）', (noChange.invalidated || []).length === 0 && noChange.staleAfter === noChange.staleBefore,
  `invalidated=${(noChange.invalidated || []).length}, stale=${noChange.staleAfter}`);
check('重新检索后增量链保持稳定（base 不变、不退化成整份）',
  JSON.stringify(noChange.chainBefore) === JSON.stringify(noChange.chainAfter) && noChange.kind === 'delta',
  `kind=${noChange.kind}, 链 ${JSON.stringify((noChange.chainAfter || []).map((x) => `${x.version}(${x.kind})`))}`);

// 6b. 正例：内容真的变了 → 依赖它的版本必须被标 stale，读取时拒绝用旧差异
const dependent = await ev(`${READY}
  await ensure();
  const A = ${JSON.stringify(invalid.A)};
  const all = [];
  const s0 = await cache.registryCacheStats();
  for (const e of s0.entries) if (e.base === A) all.push(e.version);
  return JSON.stringify({ A, direct: all });`);
const depVersion = (dependent.direct || [])[0] || PICKS[0];
console.log(`  直接依赖 ${invalid.A} 的版本 = ${depVersion}`);

const injected = await ev(`${READY}
  await ensure();
  const A = ${JSON.stringify(invalid.A)};
  const D = ${JSON.stringify(depVersion)};
  // 读出 A 的真实完整条目表，改动 1 个物品名 → 内容哈希真实改变（模拟"cdN 上的资源被更新/重新检索到不同数据"）
  const readA = await cache.registryCacheRead(A);
  if (!readA.ok) return JSON.stringify({ ok: false, why: 'A 读不到：' + readA.reason });
  const data = JSON.parse(JSON.stringify(readA.data));
  const target = data.items[Math.floor(data.items.length / 2)];
  const before = target[1];
  target[1] = before + '（注入测试）';
  const w = await cache.registryCacheWrite(A, {
    data, source: 'github', resolvedTag: readA.tag, note: '注入式失效验证',
    counts: { items: data.items.length, entities: data.entities.length, particles: data.particles.length },
    index: store.state.versionIndex, buildMs: 0,
  });
  const peekD = await cache.registryCachePeek(D);
  const readD = await cache.registryCacheRead(D);
  return JSON.stringify({ ok: true, A, D, injectedItem: target[0], before, after: target[1],
    changedHash: w.entry.contentHash, invalidated: w.invalidated,
    dependentsStale: peekD ? { stale: !!peekD.stale, reason: peekD.staleReason } : null,
    readD: { ok: readD.ok, reason: readD.reason || null } });`, 60000);
console.log(`  注入改动：${injected.injectedItem}「${injected.before}」→「${injected.after}」`);
console.log(`  失效结果：invalidated=${JSON.stringify(injected.invalidated)}  ${injected.D}.stale=${injected.dependentsStale && injected.dependentsStale.stale}（${injected.dependentsStale && injected.dependentsStale.reason}）`);
console.log(`  读取 ${injected.D} → ok=${injected.readD && injected.readD.ok} reason=${injected.readD && injected.readD.reason}`);
check('旧版本内容变更 → 派生版本被标 stale', (injected.invalidated || []).includes(depVersion) && injected.dependentsStale && injected.dependentsStale.stale === true,
  `invalidated=${JSON.stringify(injected.invalidated)}`);
check('stale 条目的旧差异被拒绝使用（读取回退为 miss）', injected.readD && injected.readD.ok === false,
  `reason=${injected.readD && injected.readD.reason}`);

// 6c. 自愈：重新真实检索 → 链重建 → 再次无损
const heal = await ev(`${READY}
  await ensure();
  const A = ${JSON.stringify(invalid.A)};
  const D = ${JSON.stringify(depVersion)};
  const rA = await store.loadRegistry({ version: A, source: 'github', useCache: false, storeCache: true });
  const rD = await store.loadRegistry({ version: D, source: 'github', useCache: false, storeCache: true });
  store.clearMemoryRegistryCache(D);
  const cached = await store.loadRegistry({ version: D, source: 'github' });
  const oracle = await store.loadRegistry({ version: D, source: 'github', useCache: false, storeCache: false });
  const proj = (r) => JSON.stringify({ items: r.items.map((e) => [e.id, e.name, e.icon]),
    entities: r.entities.map((e) => [e.id, e.name, e.icon]), particles: r.particles.map((e) => [e.id, e.name, e.icon]) });
  const peekD = await cache.registryCachePeek(D);
  return JSON.stringify({ A, D, rAInvalidated: (rA.cache.invalidated || []).length, rDkind: rD.cache.kind, rDbase: rD.cache.base,
    staleAfterHeal: !!(peekD && peekD.stale), chain: await cache.registryCacheChain(D),
    cachedHit: cached.cache.hit, same: proj(cached) === proj(oracle),
    items: cached.items.length, oracleItems: oracle.items.length });`, 120000);
console.log(`  自愈：${heal.A} 重新检索（失效 ${heal.rAInvalidated} 个）→ ${heal.D} 重新检索（kind=${heal.rDkind} base=${heal.rDbase}）`);
console.log(`  ${heal.D} 链路：${JSON.stringify(heal.chain)}`);
check('重建后链恢复、stale 清除', heal.staleAfterHeal === false && (heal.chain || []).length >= 2,
  `stale=${heal.staleAfterHeal} 链深=${(heal.chain || []).length}`);
check('重建后缓存命中且仍无损', heal.cachedHit === true && heal.same === true,
  `hit=${heal.cachedHit} items ${heal.items}=${heal.oracleItems}`);

/* ------------------------------ 7. 清空缓存 → 再检索能重新工作 ------------------------------ */
section('7. 清空缓存（删掉 temp）→ 重新检索');
const cleared = await ev(`${READY}
  await ensure();
  const before = await cache.registryCacheStats();
  const res = await cache.clearAllRegistryCache();
  const after = await cache.registryCacheStats();
  const bs = await cache.registryCacheBaselines();
  store.clearMemoryRegistryCache();   // 「清缓存后重新检索」必须是真冷读：内存 + IndexedDB 都空
  const t0 = performance.now();
  const reg = await store.loadRegistry({ version: ${JSON.stringify(V2)}, source: 'github' });
  const ms = Math.round(performance.now() - t0);
  const post = await cache.registryCacheStats();
  return JSON.stringify({
    before: { count: before.count, dataBytes: before.dataBytes, entryBytes: before.entryBytes, fullDataBytes: before.fullDataBytes },
    cleared: { removed: res.removed, engine: res.engine },
    after: { count: after.count, dataBytes: after.dataBytes, entryBytes: after.entryBytes },
    baselinesAfterClear: bs.map((b) => b.version),
    reRetrieve: { ms, hit: reg && reg.cache.hit, kind: reg && reg.cache.kind, items: reg && reg.items.length,
      entities: reg && reg.entities.length, particles: reg && reg.particles.length, level: reg && reg.cache.level },
    post: { count: post.count, fullCount: post.fullCount, deltaCount: post.deltaCount, dataBytes: post.dataBytes },
  });`, 90000);
console.log(`  清空前：${cleared.before.count} 个版本，实际占用 ${fmt(cleared.before.entryBytes)}（payload ${fmt(cleared.before.dataBytes)}），全量需 ${fmt(cleared.before.fullDataBytes)}`);
console.log(`  清空 removed=${cleared.cleared.removed}（engine=${cleared.cleared.engine}）→ 清空后 ${cleared.after.count} 个版本，占用 ${cleared.after.entryBytes} B`);
console.log(`  清空后基线列表：${JSON.stringify(cleared.baselinesAfterClear)}`);
console.log(`  清空后重新检索 ${V2}：耗时 ${cleared.reRetrieve.ms}ms hit=${cleared.reRetrieve.hit} kind=${cleared.reRetrieve.kind} 物品 ${cleared.reRetrieve.items} 实体 ${cleared.reRetrieve.entities} 粒子 ${cleared.reRetrieve.particles}`);
console.log(`  清空后重建缓存：${JSON.stringify(cleared.post)}`);
check('一键清空删掉了全部条目', cleared.after.count === 0 && cleared.cleared.removed === cleared.before.count && cleared.before.count > 0,
  `清空前 ${cleared.before.count} 个 → removed=${cleared.cleared.removed} → 剩 ${cleared.after.count} 个`);
check('清空后基线也没了', (cleared.baselinesAfterClear || []).length === 0, JSON.stringify(cleared.baselinesAfterClear));
check('清空后重新检索 hit=false 且拿到完整列表', cleared.reRetrieve.hit === false && cleared.reRetrieve.items > 0,
  `hit=${cleared.reRetrieve.hit} items=${cleared.reRetrieve.items}`);
check('清空后重新写入缓存（重新工作）', cleared.post.count === 1 && cleared.post.fullCount === 1,
  `count=${cleared.post.count} full=${cleared.post.fullCount}`);

/* ------------------------------ 8. 「检索更旧的版本 → 重构比它新的版本」 ------------------------------ */
section('8. 用户原话的方向：检索更旧的版本 → 比它新的派生版本被重构');
const OLD = '1.20.4', NEWV = '1.21.4';
const dirA = await ev(`${READY}
  await ensure();
  await cache.clearAllRegistryCache();
  store.clearMemoryRegistryCache();
  const t0 = performance.now();
  const r = await store.loadRegistry({ version: ${JSON.stringify(OLD)}, source: 'github', useCache: false, storeCache: true });
  return JSON.stringify({ ms: Math.round(performance.now() - t0), kind: r.cache.kind, base: r.cache.base,
    items: r.items.length, stats: await cache.registryCacheStats() });`, 120000);
console.log(`  清空后先检索更旧的 ${OLD}：kind=${dirA.kind} base=${dirA.base} 物品 ${dirA.items} 耗时 ${dirA.ms}ms`);
const dirB = await ev(`${READY}
  await ensure();
  store.clearMemoryRegistryCache();
  const t0 = performance.now();
  const r = await store.loadRegistry({ version: ${JSON.stringify(NEWV)}, source: 'github', useCache: false, storeCache: true });
  const chain = await cache.registryCacheChain(${JSON.stringify(NEWV)});
  return JSON.stringify({ ms: Math.round(performance.now() - t0), kind: r.cache.kind, base: r.cache.base, items: r.items.length,
    chain, isNewer: store.state.versionIndex.isAtLeast(${JSON.stringify(NEWV)}, ${JSON.stringify(OLD)}),
    orderOld: store.state.versionIndex.order.get(${JSON.stringify(OLD)}), orderNew: store.state.versionIndex.order.get(${JSON.stringify(NEWV)}) });`, 120000);
console.log(`  再检索比它新的 ${NEWV}：kind=${dirB.kind} base=${dirB.base} 物品 ${dirB.items} 耗时 ${dirB.ms}ms`);
console.log(`  VersionIndex.isAtLeast(${NEWV}, ${OLD}) = ${dirB.isNewer}（manifest 序位 ${dirB.orderNew} 早于 ${dirB.orderOld} = 更新）`);
console.log(`  链：${JSON.stringify((dirB.chain || []).map((x) => `${x.version}(${x.kind})`))}`);
check('更早检索的旧版本成为新版本的 base（新的依赖旧的）', dirB.base === OLD && (dirB.chain || []).length === 2,
  `base=${dirB.base} 链深=${(dirB.chain || []).length}`);
check('版本新旧用 VersionIndex.isAtLeast 判定（没自造字符串比较）', dirB.isNewer === true,
  `isAtLeast(${NEWV},${OLD})=${dirB.isNewer}`);

const dirC = await ev(`${READY}
  await ensure();
  const readOld = await cache.registryCacheRead(${JSON.stringify(OLD)});
  const data = JSON.parse(JSON.stringify(readOld.data));
  data.items[0][1] = data.items[0][1] + '（注入测试）';
  const w = await cache.registryCacheWrite(${JSON.stringify(OLD)}, {
    data, source: 'github', resolvedTag: readOld.tag, note: '注入式方向验证',
    counts: { items: data.items.length, entities: data.entities.length, particles: data.particles.length },
    index: store.state.versionIndex, buildMs: 0,
  });
  const peek = await cache.registryCachePeek(${JSON.stringify(NEWV)});
  const read = await cache.registryCacheRead(${JSON.stringify(NEWV)});
  return JSON.stringify({ invalidated: w.invalidated, stale: peek ? { stale: !!peek.stale, reason: peek.staleReason } : null,
    readNew: { ok: read.ok, reason: read.reason || null } });`, 60000);
console.log(`  注入改动更旧版本 ${OLD} 的内容 → invalidated=${JSON.stringify(dirC.invalidated)}`);
console.log(`  比它新的 ${NEWV}：stale=${dirC.stale && dirC.stale.stale}（${dirC.stale && dirC.stale.reason}）读取 ok=${dirC.readNew.ok} reason=${dirC.readNew.reason}`);
check('检索/变更更旧的版本 → 比它新的派生版本被标 stale 并拒绝旧差异',
  (dirC.invalidated || []).includes(NEWV) && dirC.stale && dirC.stale.stale === true && dirC.readNew.ok === false,
  `invalidated=${JSON.stringify(dirC.invalidated)}, read=${dirC.readNew.reason}`);

const cleanup = await ev(`${READY}
  const res = await cache.clearAllRegistryCache();
  store.clearMemoryRegistryCache();
  return JSON.stringify({ removed: res.removed });`);
console.log(`  注入测试数据已丢弃（clearAll removed=${cleanup.removed}），不会把假数据留在缓存里`);

/* ------------------------------ 9. 异常统计 ------------------------------ */
section('9. 未捕获异常 / 错误日志 / 网络失败');
console.log(`  未捕获异常 ${exceptions.length} 条`);
exceptions.slice(0, 8).forEach((e) => console.log(`    ✗ ${e}`));
console.log(`  console 错误/警告 ${consoleErrors.length} 条`);
consoleErrors.slice(0, 8).forEach((e) => console.log(`    · ${e}`));
console.log(`  Log.entryAdded(error) ${logErrors.length} 条`);
logErrors.slice(0, 8).forEach((e) => console.log(`    · ${e}`));
console.log(`  网络加载失败 ${netFails.length} 条`);
netFails.slice(0, 8).forEach((e) => console.log(`    · ${e}`));
console.log(`  外部请求总计 ${extSince(0)} 次`);
const UI_EXC = /autocomplete|src\/ui\/|pages\//;
const externalExc = exceptions.filter((e) => UI_EXC.test(e));
const ownExc = exceptions.filter((e) => !UI_EXC.test(e));
check('数据层（core/*）0 未捕获异常', ownExc.length === 0, ownExc.length ? ownExc.slice(0, 3).join(' | ') : '0 条');
check('全程 0 未捕获异常（含 UI 页面）', exceptions.length === 0,
  externalExc.length ? `有 ${externalExc.length} 条来自 src/ui 的既有 import 错误（不是本次改动，已单列）：${externalExc[0]}` : '0 条');

/* ------------------------------ 10. 结论 ------------------------------ */
let rate2 = null;
try {
  const r = await fetch('https://api.github.com/rate_limit', { headers: { 'User-Agent': 'mccode-cdp-test' } });
  rate2 = (await r.json()).resources.core;
} catch (e) { rate2 = { error: e.message }; }

const passCount = checks.filter((c) => c.ok).length;
section(`断言汇总：${passCount}/${checks.length} 通过`);
for (const c of checks) if (!c.ok) console.log(`  ❌ ${c.name} — ${c.detail}`);
console.log(`\nGitHub 配额：开始 ${JSON.stringify(rate)} → 结束 ${JSON.stringify(rate2)}`);

const report = {
  at: new Date().toISOString(), url: BASE, baseline: BASELINE, picks: PICKS,
  warmup: warmResult, first, hitRuns, lossless, stats, noChange, injected, heal, cleared,
  checks, exceptions, consoleErrors, logErrors, netFails,
  rateStart: rate, rateEnd: rate2,
};
writeFileSync(join(SHOT_DIR, 'registry-cache-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`报告已写入：${join(SHOT_DIR, 'registry-cache-report.json')}`);

ws.close();
try { child.kill(); } catch { /* noop */ }
process.exit(passCount === checks.length ? 0 : 1);
