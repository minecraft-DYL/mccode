// tools/cdp-legacy-id.mjs —— 「1.13 之前的数字 ID 选择器」验收
//
// 两段：
//   A. node 级：直接 import src/data/legacy-ids.js，断言数字 ID ↔ 中文名 ↔ 数据值的映射
//      （每条断言都对应 wiki 上能查到的事实，不是随手写的期望值）
//   B. 浏览器级：CDP 起 Edge headless，真的切版本、真的搜、真的点、真的读命令框
//
// 用法： node tools/cdp-legacy-id.mjs [url]（默认 http://127.0.0.1:8777/）
//
// 与 tools/cdp-test.mjs 的关系：复用它的 CDP 连接方式，但断言写在这里，不改动它。

import { spawn } from 'node:child_process';
import {
  LEGACY_IDS, LEGACY_META, LEGACY_NAME_ALIASES,
  byLegacyId, searchLegacy, legacyCoverageText, parseLegacyIdText,
} from '../src/data/legacy-ids.js';

const URL_ = process.argv[2] || 'http://127.0.0.1:8777/';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 200);

let pass = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fails.push(extra === undefined ? label : `${label} —— ${extra}`);
  return false;
}
function eq(got, want, label) { return ok(got === want, label, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }

/* ============================ A. node 级 ============================ */
console.log('══════ A. 数据表（node 级） ══════');
console.log(`LEGACY_IDS ${LEGACY_IDS.length} 条 · ${legacyCoverageText()}`);
console.log(`别名 ${Object.keys(LEGACY_NAME_ALIASES).length} 条 · 未取证数据值 ${LEGACY_META.counts.dataUnknown} 条`);
console.log(`来源页面：\n  ${LEGACY_META.sources.join('\n  ')}\n`);

eq(LEGACY_IDS.filter((e) => e.kind === 'block').length > 0, true, '含方块条目');
eq(LEGACY_IDS.filter((e) => e.kind === 'item').length > 0, true, '含物品条目');
ok(LEGACY_IDS.every((e) => Number.isFinite(e.num) && e.id && e.name), '每条都有 num/id/name');
ok(LEGACY_IDS.every((e) => !(e.data !== undefined && e.dataUnknown)), 'data 与 dataUnknown 不同时出现');

const brief = (n, d) => byLegacyId(n, d).map((e) => `${e.id}@${e.data}`).join(',');
eq(brief(1, 0), 'stone@0', '1:0 → minecraft:stone（石头）');
eq(brief(2), 'grass_block@undefined', '2 → grass_block（1.12.2 叫 grass）');
eq(brief(35, 14), 'red_wool@14', '35:14 → red_wool（红色羊毛）');
eq(brief(35, 0), 'white_wool@0', '35:0 → white_wool');
eq(brief(80), 'snow_block@undefined', '80 → snow_block（1.12.2 叫 snow）');
eq(brief(276), 'diamond_sword@undefined', '276 → diamond_sword（钻石剑）');
eq(brief(351, 1), 'rose_red@1', '351:1 → rose_red');
eq(brief(351, 15), 'bone_meal@15', '351:15 → bone_meal（扁平化表是倒排的，按名字查才对）');
eq(brief(159, 15), 'black_terracotta@15', '159:15 → black_terracotta');
eq(brief(6, 1), '', '6:1 未取证 → 空结果（不猜数据值）');
eq(byLegacyId(6).length, 6, '6 有 6 个子项（树苗）');
ok(byLegacyId(6).every((e) => e.dataUnknown === true), '6 的子项都标 dataUnknown');

eq(LEGACY_NAME_ALIASES.grass, '2', '旧名 grass → 2');
eq(LEGACY_NAME_ALIASES.snow, '80', '旧名 snow → 80（新名 snow 属于 78，旧名优先）');
eq(LEGACY_NAME_ALIASES.snow_layer, '78', '旧名 snow_layer → 78');
eq(LEGACY_NAME_ALIASES.log2, '162', '旧名 log2 → 162');
eq(LEGACY_NAME_ALIASES.red_wool, '35:14', '新名 red_wool → 35:14');

console.log('— 搜索 —');
const byNum = searchLegacy('35');
ok(byNum.some((e) => e.id === 'red_wool'), '按数字 35 搜到 red_wool', byNum.slice(0, 3).map((e) => e.id).join(','));
eq(searchLegacy('35:14').map((e) => e.id).join(','), 'red_wool', '按 35:14 精确搜');
const byCn = searchLegacy('红色羊毛');
eq(byCn[0] && byCn[0].id, 'red_wool', '按中文名「红色羊毛」搜，首条是 red_wool', byCn.slice(0, 3).map((e) => e.id).join(','));
const byCn2 = searchLegacy('钻石剑');
eq(byCn2[0] && byCn2[0].id, 'diamond_sword', '按中文名「钻石剑」搜');
const byEn = searchLegacy('grass');
eq(byEn[0] && byEn[0].id, 'grass_block', '按英文旧名 grass 搜');
const wools = searchLegacy('羊毛').filter((e) => e.name.includes('羊毛'));
ok(wools.length >= 16, '按中文名「羊毛」搜出 ≥16 条', String(wools.length));
console.log(`  35 → ${byNum.length} 条；红色羊毛 → ${byCn.length} 条；羊毛 → ${wools.length} 条；grass → ${byEn.length} 条`);

console.log(`\nA 段：通过 ${pass}，失败 ${fails.length}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); }

/* ============================ B. 浏览器级 ============================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = `${process.env.TEMP}\\edge-cdp-legacy-${PORT}`;
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1050',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('CDP target 未就绪');
}

const target = await waitTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const exceptions = [];
const errorLogs = [];

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
    exceptions.push(`${d.url || ''}:${d.lineNumber} ${(d.exception && (d.exception.description || d.exception.value)) || d.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errorLogs.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errorLogs.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
  }
};

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面内异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}

/**
 * 等外壳挂载完。启动要拉 launchermeta 的版本清单，网络慢时会超过 9 秒，
 * 固定 sleep 会让测试偶发失败 —— 所以轮询到 __MCE__ 真的可用为止。
 */
async function waitForMce(maxMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ready = await evalJs('!!(window.__MCE__ && window.__MCE__.setVersion && window.__MCE__.goto)');
    if (ready) return Date.now() - t0;
    await sleep(700);
  }
  return -1;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(2500);
const mceWait = await waitForMce();
console.log('\n══════ B. 浏览器验收 ══════');
if (mceWait < 0) {
  console.log('❌ 等待 __MCE__ 可用超时（90s）—— 外壳没挂载，后面无法验收');
  ws.close(); try { child.kill(); } catch { /* ignore */ }
  process.exit(1);
}
console.log(`外壳就绪耗时 ${mceWait} ms`);
const boot = await evalJs(`JSON.stringify({ hasMce: !!window.__MCE__, version: window.__MCE__ && window.__MCE__.state.version, title: document.title })`);
console.log('启动状态：' + boot);
ok(JSON.parse(boot).hasMce, '页面已加载 __MCE__');

/** 切到选择器页并等它画完 */
async function gotoPickers(version) {
  await evalJs(`(async () => {
    if (${JSON.stringify(version)}) { window.__MCE__.setVersion(${JSON.stringify(version)}); }
    window.__MCE__.goto('pickers');
    return true;
  })()`);
  await sleep(1200);
  // 选择器页每个版本都要等矩阵/注册表状态稳定
  await sleep(600);
}

const probeDom = `JSON.stringify({
  version: window.__MCE__.state.version,
  hasLegacyGrid: !!document.querySelector('#legacy-grid'),
  hasLegacyQ: !!document.querySelector('#legacy-q'),
  hasLegacyCmd: !!document.querySelector('#legacy-cmd'),
  hasGiveBox: !!document.querySelector('.give-box'),
  hasIntro: document.body.innerText.includes('1.13 之前：数字 ID 模式'),
  hasNotice: !!document.querySelector('#block-item-notice'),
  notice: (document.querySelector('#block-item-notice') || {}).innerText ? (document.querySelector('#block-item-notice').innerText.replace(/\\s+/g,' ')) : null,
  text: document.querySelector('#pageView') ? document.querySelector('#pageView').innerText.replace(/\\s+/g,' ').slice(0, 400) : null
})`;

/**
 * 把「显示方块物品」开关设成指定状态。
 * 这是个跨版本、跨模式共享的用户偏好（模块级 ui.hideBlockItems），
 * 所以每个断言段落前必须显式设定，不能指望上一步留下的状态。
 */
async function setShowBlocks(show) {
  const r = await evalJs(`(() => {
    const el = [...document.querySelectorAll('.tsw')].find(e => e.textContent.includes('显示方块物品'));
    if (!el) return 'NO_TOGGLE';
    const before = el.classList.contains('on');
    if (before !== ${show ? 'true' : 'false'}) el.click();
    return before + '→' + ${show ? 'true' : 'false'};
  })()`);
  await sleep(700);
  return r;
}

/** 在数字 ID 搜索框里输入并等结果重画 */
async function legacySearch(q) {
  await evalJs(`(() => { const el = document.querySelector('#legacy-q'); if (!el) return false; el.value = ${JSON.stringify(q)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(500);
  return JSON.parse(await evalJs(`JSON.stringify({
    ids: [...document.querySelectorAll('#legacy-grid .lg-cell')].map(c => c.dataset.legacyId),
    names: [...document.querySelectorAll('#legacy-grid .lg-cell .lg-name')].map(c => c.textContent),
    count: document.querySelectorAll('#legacy-grid .lg-cell').length
  })`));
}

/* --- B1: 1.12.2 → 数字 ID 模式出现 --- */
await gotoPickers('1.12.2');
let d = JSON.parse(await evalJs(probeDom));
console.log('\n[B1] 1.12.2：' + JSON.stringify(d));
ok(d.hasLegacyGrid, 'B1 切到 1.12.2 后出现数字 ID 选择器（#legacy-grid）');
ok(d.hasLegacyQ, 'B1 数字 ID 搜索框存在（#legacy-q）');
ok(d.hasLegacyCmd, 'B1 /give 输入框存在（#legacy-cmd）');
ok(d.hasIntro, 'B1 页面出现「1.13 之前：数字 ID 模式」说明');

/* --- B1b: 数字 ID 模式默认把方块条目滤掉 --- */
const beforeToggle = await setShowBlocks(false);   // 显式设成「隐藏方块」
d = JSON.parse(await evalJs(probeDom));
console.log(`[B1b] 提示条=${JSON.stringify(d.notice)}（开关 ${beforeToggle}）`);
ok(d.hasNotice, 'B1 数字 ID 模式也有「已隐藏 N 个方块物品」提示条');
ok(/已隐藏\s*[\d,]+\s*个方块物品/.test(d.notice || ''), 'B1b 提示条写明隐藏了多少个方块物品', d.notice);
ok(/已隐藏\s*5\d\d\s*个方块物品/.test((d.notice || '').replace(/,/g, '')), 'B1b 1.12.2 隐藏条数是 5xx（方块占多数）', d.notice);
ok(JSON.parse(await evalJs(`JSON.stringify({ toggles: [...document.querySelectorAll('.tsw')].some(e => e.textContent.includes('显示方块物品')), jump: [...document.querySelectorAll('#block-item-notice button')].some(b => b.textContent.includes('方块')) })`)).toggles, 'B1b 有「显示方块物品」开关');
ok(JSON.parse(await evalJs(`JSON.stringify({ jump: [...document.querySelectorAll('#block-item-notice button')].some(b => b.textContent.includes('方块')) })`)).jump, 'B1b 有跳去「方块」页的按钮');

const sword = await legacySearch('276');
console.log(`[B1b] 默认（隐藏方块）搜 276 → ${JSON.stringify(sword.ids.slice(0, 5))}`);
ok(sword.ids.includes('276'), 'B1b 非方块物品（钻石剑 276）默认可见');
const woolHidden = await legacySearch('35');
console.log(`[B1b] 默认（隐藏方块）搜 35 → ${JSON.stringify(woolHidden.ids.slice(0, 6))}`);
ok(!woolHidden.ids.includes('35:14'), 'B1b 方块条目 35:14 默认被隐藏', woolHidden.ids.slice(0, 10).join(' '));

/* --- B1c: 开关打开 → 方块条目回来 --- */
console.log(`[B1c] 开关 ${await setShowBlocks(true)}`);
const woolShown = await legacySearch('35');
const noticeShown = JSON.parse(await evalJs(`JSON.stringify((document.querySelector('#block-item-notice') || {}).innerText || null)`));
console.log(`[B1c] 打开开关后搜 35 → ${JSON.stringify(woolShown.ids.slice(0, 6))}；提示条=${JSON.stringify(noticeShown)}`);
ok(woolShown.ids.includes('35:14'), 'B1c 打开「显示方块物品」后 35:14 可见', woolShown.ids.slice(0, 10).join(' '));
ok(/已隐藏\s*0\s*个/.test((noticeShown || '').replace(/,/g, '')), 'B1c 打开后提示条变成「已隐藏 0 个」', noticeShown);

/* --- B2: 按数字搜索 --- */
const numSearch = await evalJs(`(() => {
  const el = document.querySelector('#legacy-q');
  el.value = '35';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
void numSearch;
await sleep(500);
const numRes = await evalJs(`JSON.stringify({
  count: document.querySelectorAll('#legacy-grid .lg-cell').length,
  ids: [...document.querySelectorAll('#legacy-grid .lg-cell')].map(c => c.dataset.legacyId),
  names: [...document.querySelectorAll('#legacy-grid .lg-cell .lg-name')].map(c => c.textContent),
  badge: (document.querySelector('.badge.ok') || {}).textContent || null
})`);
const nr = JSON.parse(numRes);
console.log(`[B2] 数字搜 35 → ${nr.count} 条，badge=${nr.badge}，前几个：${nr.ids.slice(0, 6).join(' ')}`);
ok(nr.count > 0, 'B2 按数字 35 搜到结果');
ok(nr.ids.includes('35:14'), 'B2 结果里含 35:14', nr.ids.slice(0, 20).join(' '));
ok(nr.names.some((n) => n.includes('羊毛')), 'B2 结果里含羊毛中文名');

/* --- B3: 按中文名搜索 --- */
await evalJs(`(() => { const el = document.querySelector('#legacy-q'); el.value = '红色羊毛'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(500);
const cnRes = JSON.parse(await evalJs(`JSON.stringify({
  count: document.querySelectorAll('#legacy-grid .lg-cell').length,
  ids: [...document.querySelectorAll('#legacy-grid .lg-cell')].map(c => c.dataset.legacyId),
  names: [...document.querySelectorAll('#legacy-grid .lg-cell .lg-name')].map(c => c.textContent)
})`));
console.log(`[B3] 中文名搜「红色羊毛」→ ${cnRes.count} 条：${cnRes.ids.slice(0, 5).join(' ')} / ${cnRes.names.slice(0, 5).join(' ')}`);
ok(cnRes.count > 0, 'B3 按中文名搜到结果');
ok(cnRes.ids.includes('35:14'), 'B3 中文名搜索命中 35:14', cnRes.ids.join(' '));

/* --- B4: 点选 → 生成的命令是旧语法（带数字 ID） --- */
await evalJs(`(() => {
  const cell = [...document.querySelectorAll('#legacy-grid .lg-cell')].find(c => c.dataset.legacyId === '35:14');
  if (!cell) throw new Error('找不到 35:14 的单元格');
  cell.click();
  return true;
})()`);
await sleep(500);
const cmd = await evalJs(`document.querySelector('#legacy-cmd').value`);
console.log(`[B4] 选中 35:14 后 #legacy-cmd = ${JSON.stringify(cmd)}`);
ok(/^give\s+@s\s+35\s+1\s+14$/.test(String(cmd).trim()), 'B4 生成的是 1.13 之前的旧语法命令', String(cmd));
ok(!/minecraft:/.test(String(cmd)), 'B4 命令里没有命名空间 ID（旧语法才用数字 ID）');
ok(/\b35\b/.test(String(cmd)), 'B4 命令里带了数字 ID 35');

{
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('tools/legacy-id-1.12.2.png', Buffer.from(s.data, 'base64'));
  console.log('[B4] 截图已存 tools/legacy-id-1.12.2.png');
}

/* --- B5: 命令框可改 + 「重新填充」能恢复 --- */
const edited = await evalJs(`(() => {
  const el = document.querySelector('#legacy-cmd');
  el.value = 'give @s 35 1 99';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`);
console.log(`[B5] 手动改成：${JSON.stringify(edited)}`);
eq(edited, 'give @s 35 1 99', 'B5 命令框可编辑');
await evalJs(`document.querySelector('#legacy-refill').click()`);
await sleep(400);
const refilled = await evalJs(`document.querySelector('#legacy-cmd').value`);
console.log(`[B5] 点「重新填充」后：${JSON.stringify(refilled)}`);
eq(refilled, 'give @s 35 1 14', 'B5 「重新填充」按当前选择恢复命令');

/* --- B6: 未取证的条目必须提示、且不编数据值 --- */
await evalJs(`(() => { const el = document.querySelector('#legacy-q'); el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(500);
const unknownCell = await evalJs(`(() => {
  const cell = [...document.querySelectorAll('#legacy-grid .lg-cell')].find(c => c.dataset.legacyId === '6' && c.querySelector('.lg-warn'));
  if (!cell) return null;
  cell.click();
  return cell.querySelector('.lg-name').textContent;
})()`);
await sleep(400);
const unknownCmd = await evalJs(`document.querySelector('#legacy-cmd').value`);
const unknownWarn = await evalJs(`!!document.querySelector('#pageView').innerText.match(/数据值未取证/)`);
console.log(`[B6] 选中未取证条目「${unknownCell}」→ 命令 ${JSON.stringify(unknownCmd)}，页面有未取证提示=${unknownWarn}`);
ok(unknownCell !== null, 'B6 存在标记「数据值未取证」的单元格');
ok(/^give\s+@s\s+6\s+1$/.test(String(unknownCmd).trim()), 'B6 未取证时不编数据值（命令省略 <data> 参数）', String(unknownCmd));
ok(unknownWarn, 'B6 页面明确提示数据值未取证');

/* --- B7: 切回 1.13 → 数字模式消失，/give 输入框还在 --- */
await gotoPickers('1.13');
d = JSON.parse(await evalJs(probeDom));
console.log('\n[B7] 1.13：' + JSON.stringify({ version: d.version, hasLegacyGrid: d.hasLegacyGrid, hasLegacyCmd: d.hasLegacyCmd, hasGiveBox: d.hasGiveBox }));
ok(!d.hasLegacyGrid, 'B7 1.13 数字 ID 选择器消失');
ok(!d.hasLegacyCmd, 'B7 1.13 旧语法命令框消失');
ok(d.hasGiveBox, 'B7 1.13 的 /give 输入框（give-box）仍在');

/* --- B8: 1.20.5 → 同上 --- */
await gotoPickers('1.20.5');
d = JSON.parse(await evalJs(probeDom));
console.log(`\n[B8] 1.20.5：hasLegacyGrid=${d.hasLegacyGrid} hasGiveBox=${d.hasGiveBox}`);
ok(!d.hasLegacyGrid, 'B8 1.20.5 数字 ID 选择器消失');
ok(d.hasGiveBox, 'B8 1.20.5 的 /give 输入框仍在');

/* --- B8b: 1.13+ 物品列表滤掉方块物品（用真实注册表数据断言） --- */
if (!(await evalJs(`!!(window.__MCE__.state.registry && window.__MCE__.state.registry.items && window.__MCE__.state.registry.items.length)`))) {
  console.log('[B8b] 注册表未加载，点「立即检索」…');
  await evalJs(`(() => { const b = [...document.querySelectorAll('#pageView button')].find(x => x.textContent.includes('立即检索')); if (b) b.click(); return !!b; })()`);
  for (let i = 0; i < 90; i++) {
    if (await evalJs(`!!(window.__MCE__.state.registry && window.__MCE__.state.registry.items && window.__MCE__.state.registry.items.length)`)) break;
    await sleep(1000);
  }
}
console.log(`[B8b] 开关 ${await setShowBlocks(false)}（显式设回隐藏方块，上一段的偏好会跨版本保留）`);
const bf = JSON.parse(await evalJs(`(async () => {
  const m = await import('/src/data/blocks.js');
  const st = window.__MCE__.state;
  const items = (st.registry && st.registry.items) || [];
  const kept = items.filter((i) => !m.isBlockItem(i.id)).map((i) => i.id);
  const hidden = items.filter((i) => m.isBlockItem(i.id)).map((i) => i.id);
  const tabs = [...document.querySelectorAll('.tabs .tab')].map((t) => t.textContent).join(' | ');
  return JSON.stringify({
    version: st.version, total: items.length, hiddenCount: hidden.length, keptCount: kept.length,
    mustBeGone: ['stone', 'dirt', 'diamond_block'].filter((id) => kept.includes(id)),
    mustKeep: ['beetroot', 'lava_bucket', 'melon_seeds', 'water_bucket'].filter((id) => kept.includes(id)),
    wronglyHidden: ['beetroot', 'lava_bucket', 'melon_seeds', 'water_bucket'].filter((id) => hidden.includes(id)),
    tabs,
    notice: (document.querySelector('#block-item-notice') || {}).innerText.replace(/\\s+/g, ' ') || null,
  });
})()`));
console.log(`[B8b] ${bf.version} 注册表物品 ${bf.total} 条 → 滤掉方块物品 ${bf.hiddenCount} 条，剩 ${bf.keptCount} 条`);
console.log(`[B8b] tabs=${bf.tabs}`);
console.log(`[B8b] notice=${JSON.stringify(bf.notice)}`);
console.log(`[B8b] 应消失却还在=${JSON.stringify(bf.mustBeGone)} 应保留命中=${JSON.stringify(bf.mustKeep)} 被误删=${JSON.stringify(bf.wronglyHidden)}`);
ok(bf.total > 0, 'B8b 注册表已加载');
ok(bf.mustBeGone.length === 0, 'B8b 过滤后不含 stone / dirt / diamond_block', bf.mustBeGone.join(','));
ok(bf.mustKeep.length === 4, 'B8b 必含 beetroot / lava_bucket / melon_seeds / water_bucket', bf.mustKeep.join(','));
ok(bf.wronglyHidden.length === 0, 'B8b 种子/桶没有被误判成方块物品', bf.wronglyHidden.join(','));
ok(bf.hiddenCount > 0 && bf.hiddenCount < bf.total, 'B8b 隐藏条数介于 0 与总数之间', `${bf.hiddenCount}/${bf.total}`);
ok(bf.notice && bf.notice.includes(String(bf.hiddenCount)), 'B8b 界面提示的隐藏条数与实际一致', bf.notice);
ok(bf.tabs.includes(`物品（${bf.keptCount}）`), 'B8b 物品页签显示的是过滤后的条数', bf.tabs);
{
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('tools/block-filter-1.20.5.png', Buffer.from(s.data, 'base64'));
  console.log('[B8b] 截图已存 tools/block-filter-1.20.5.png');
}

// 页面上验证：搜 stone 搜不到（方块物品已滤掉），开开关后能搜到
await evalJs(`(() => { const el = document.querySelector('.pk-toolbar input.tb'); if (el) { el.value = 'stone'; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(600);
const stoneHidden = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pageView .pk-cell')].map((c) => c.title.split('\\n')[1]))`));
ok(!stoneHidden.includes('stone'), 'B8b 物品页搜 stone 搜不到（方块物品被滤掉）', stoneHidden.slice(0, 6).join(' '));

const toggle13 = await setShowBlocks(true);
const stoneShown = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pageView .pk-cell')].map((c) => c.title.split('\\n')[1]))`));
console.log(`[B8b] 开关(${toggle13}) 打开后搜 stone → ${JSON.stringify(stoneShown.slice(0, 6))}`);
ok(stoneShown.includes('stone'), 'B8b 打开开关后 stone 回来了', stoneShown.slice(0, 8).join(' '));

// 复原：清空搜索 + 关掉开关，别把偏好留给后面的断言
await evalJs(`(() => { const el = document.querySelector('.pk-toolbar input.tb'); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
await sleep(300);
await setShowBlocks(false);

/* --- B9: 版本边界 17w43a / b1.7.3 --- */
await gotoPickers('17w43a');
d = JSON.parse(await evalJs(probeDom));
console.log(`\n[B9] 17w43a（扁平化起始快照）：hasLegacyGrid=${d.hasLegacyGrid}`);
ok(!d.hasLegacyGrid, 'B9 17w43a 已扁平化 → 不进数字 ID 模式');

await gotoPickers('1.12.2');
await sleep(400);
await gotoPickers('b1.7.3');
d = JSON.parse(await evalJs(probeDom));
const ancientText = await evalJs(`document.querySelector('#pageView').innerText.replace(/\\s+/g,' ').slice(0, 200)`);
console.log(`[B9] b1.7.3（远古）：hasLegacyGrid=${d.hasLegacyGrid}；页面：${ancientText.slice(0, 90)}`);
// 远古版本不自动进数字 ID 模式（表是 1.12.2 的，会误导），要用户点按钮才进
const ancientBtn = await evalJs(`(() => { const b = [...document.querySelectorAll('#pageView button')].find(x => x.textContent.includes('数字 ID')); if (!b) return null; b.click(); return b.textContent.trim(); })()`);
await sleep(800);
d = JSON.parse(await evalJs(probeDom));
console.log(`[B9] 点「${ancientBtn}」后 hasLegacyGrid=${d.hasLegacyGrid}`);
ok(ancientBtn !== null, 'B9 远古版本给出进入数字 ID 模式的按钮');
ok(d.hasLegacyGrid, 'B9 点了按钮后能进数字 ID 模式');

/* --- B10: 「去『方块』页查看」按钮真的能跳过去 --- */
const jump = await evalJs(`(() => {
  const b = [...document.querySelectorAll('#block-item-notice button')].find(x => x.textContent.includes('方块'));
  if (!b) return 'NO_BUTTON';
  b.click();
  return b.textContent.trim();
})()`);
await sleep(1200);
const afterJump = JSON.parse(await evalJs(`JSON.stringify({
  page: window.__MCE__.state.page,
  title: (document.querySelector('#pageTitle') || {}).textContent || null,
  hasBlockPage: /方块数据|方块/.test(document.querySelector('#pageView').innerText.slice(0, 200))
})`));
console.log(`\n[B10] 点「${jump}」→ state.page=${afterJump.page} 标题=${afterJump.title} 是方块页=${afterJump.hasBlockPage}`);
ok(jump !== 'NO_BUTTON', 'B10 提示条上有跳转按钮');
eq(afterJump.page, 'blocks', 'B10 点击后 state.page 变成 blocks');
ok(afterJump.hasBlockPage, 'B10 页面真的切到了方块页', afterJump.title);

/* --- 截图留证 --- */
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('tools/legacy-id-shot.png', Buffer.from(shot.data, 'base64'));
console.log('\n截图已存 tools/legacy-id-shot.png（跳转后的方块页）');

/* --- 异常统计 --- */
console.log(`\n未捕获异常：${exceptions.length}`);
for (const e of exceptions.slice(0, 10)) console.log('  ✗ ' + e);
console.log(`console.error / log error：${errorLogs.length}`);
for (const e of errorLogs.slice(0, 10)) console.log('  ✗ ' + e);
ok(exceptions.length === 0, 'B 全程 0 个未捕获异常', exceptions.join(' | '));

ws.close();
try { child.kill(); } catch { /* ignore */ }

console.log('\n════════════════════════════════');
console.log(`  通过 ${pass} / 失败 ${fails.length}`);
console.log('════════════════════════════════');
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
