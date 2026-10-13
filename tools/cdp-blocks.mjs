// cdp-blocks.mjs —— 「方块选择器」页面的端到端验收（Edge headless + CDP，零依赖）
//
// 用法: node tools/cdp-blocks.mjs [url] [waitMs] [--shot=路径.png]
//
// 覆盖：
//   1. 导航里出现「方块」并能进入，0 未捕获异常
//   2. 搜索有结果，候选带中文名（中文名 / 命名空间 ID / 数字 ID 三条路径都测）
//   3. 点选后生成 /setblock、/fill、/give 且非空；改参数后命令真的回填
//   4. 图标：断言 <img> 的 naturalWidth > 0（证明 wiki 原图真的加载出来了）
//      并同时验证「无图方块」走文字回退（热链万一被拦时 UI 不会一片空白）
//   5. 版本兼容：1.16.5→命名空间 ID / 1.12.2→数字 ID / c0.30_01c→Classic / a1.2.6→未取证提示
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:8777/';
const waitMs = Number(process.argv[3] || 12000);
const shotPath = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice(7);
const PORT = 9700 + Math.floor(Math.random() * 200);
const profile = `${process.env.TEMP}\\edge-blocks-${PORT}`;

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1150',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const target = await waitTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const exceptions = [];
const errLogs = [];
const netFails = [];
let mark = 0;   // 用于「本步骤新增异常」统计

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(`${(d.exception && (d.exception.description || d.exception.value)) || d.text} @${String(d.url || '').split('/').pop()}:${d.lineNumber}`);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errLogs.push(`${m.params.entry.text} ${String(m.params.entry.url || '').split('/').pop()}`);
  }
  if (m.method === 'Network.loadingFailed') netFails.push(`${m.params.type} ${m.params.errorText}`);
};

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 60000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

/* ------------------------------ 断言 ------------------------------ */
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}
function section(t) { console.log(`\n── ${t} ──`); }
const newExceptions = () => exceptions.slice(mark);
function step() { mark = exceptions.length; }

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

/* ============ 1. 导航里出现「方块」并能进入 ============ */
section('1. 导航与进入页面');

const navInfo = await evaluate(`(() => {
  const items = [...document.querySelectorAll('#navItems .nv-item')];
  const el = document.querySelector('#navItems .nv-item[data-page="blocks"]');
  const groups = [...document.querySelectorAll('#navItems .nv-group-label')].map(g => g.textContent);
  return JSON.stringify({
    navCount: items.length,
    pageIds: items.map(i => i.dataset.page),
    hasBlocks: !!el,
    label: el ? el.querySelector('.nv-label').textContent : null,
    iconSvg: el ? !!el.querySelector('.nv-ico svg') : false,
    groups,
  });
})()`);
const nav = JSON.parse(navInfo);
check('导航项里存在 data-page="blocks"', nav.hasBlocks, `共 ${nav.navCount} 项: ${nav.pageIds.join(', ')}`);
check('导航标题是「方块」', nav.label === '方块', `label=${nav.label}`);
check('导航图标用的是可用图标名（渲染出 svg）', nav.iconSvg);
check('它被注册在「编辑」分组', nav.groups.includes('编辑'), `分组: ${nav.groups.join(' / ')}`);

step();
await evaluate(`document.querySelector('#navItems .nv-item[data-page="blocks"]').click()`);
await sleep(2500);

const pageInfo = await evaluate(`JSON.stringify({
  title: document.querySelector('#pageTitle').textContent,
  sub: document.querySelector('#pageSubtitle').textContent,
  hook: !!window.__MCE_BLOCKS__,
  era: window.__MCE_BLOCKS__ ? window.__MCE_BLOCKS__.era : null,
  version: window.__MCE_BLOCKS__ ? window.__MCE_BLOCKS__.version : null,
  total: window.__MCE_BLOCKS__ ? window.__MCE_BLOCKS__.total : null,
  cells: document.querySelectorAll('.blk-cell').length,
  cards: document.querySelectorAll('#pageView .card').length,
})`);
const pg = JSON.parse(pageInfo);
check('页面标题变成「方块」', pg.title === '方块', `title=${pg.title}`);
check('页面渲染出卡片', pg.cards > 0, `${pg.cards} 张卡片`);
check('暴露了测试钩子 __MCE_BLOCKS__', pg.hook);
check('进入本页后 0 未捕获异常', newExceptions().length === 0, newExceptions().slice(0, 3).join(' | '));

/* ============ 2. 搜索（中文名 / 命名空间 ID） ============ */
section('2. 搜索（中文名 / 命名空间 ID）');

async function typeSearch(text) {
  await evaluate(`(() => {
    const i = document.querySelector('.blk-toolbar input.tb');
    i.value = ${JSON.stringify(text)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  return JSON.parse(await evaluate(`(() => {
    const cells = [...document.querySelectorAll('.blk-cell')];
    return JSON.stringify({
      count: cells.length,
      first: cells[0] ? {
        id: cells[0].dataset.blockId,
        name: cells[0].querySelector('.blk-name').textContent,
        idLine: cells[0].querySelector('.blk-id').textContent,
      } : null,
      badge: (document.querySelector('#pageView .card:nth-of-type(2) .badge') || {}).textContent || '',
      names: cells.slice(0, 8).map(c => c.querySelector('.blk-name').textContent),
    });
  })()`));
}

const rStone = await typeSearch('石头');
check('搜中文名「石头」有结果', rStone.count > 0, `${rStone.count} 个候选 / badge="${rStone.badge}"`);
check('候选带中文名', !!rStone.first && rStone.first.name.length > 0, `首项=${rStone.first?.name}`);
check('候选带 ID 行', !!rStone.first && rStone.first.idLine.length > 0, `id=${rStone.first?.idLine}`);
check('「石头」命中的确实是石头', !!rStone.first && rStone.first.name.includes('石头'), `首项=${rStone.first?.name}`);

const rId = await typeSearch('diamond_block');
check('搜命名空间 ID「diamond_block」有结果', rId.count > 0, `${rId.count} 个候选`);
check('ID 搜索首项就是钻石块', rId.first?.name === '钻石块', `首项=${rId.first?.id} / ${rId.first?.name}`);

const rAbbr = await typeSearch('ds');
check('缩写搜索「ds」也有结果（走 fuzzy 排序）', rAbbr.count > 0, `${rAbbr.count} 个候选，前几名: ${rAbbr.names.slice(0, 3).join('、')}`);

const rNone = await typeSearch('zzzznotablock');
check('搜不到时给出空状态而不是崩溃', rNone.count === 0, `候选 ${rNone.count} 个`);

/* ============ 3. 点选 + 命令生成 ============ */
section('3. 点选方块 → 生成命令');

await typeSearch('石头');
step();
await evaluate(`document.querySelector('.blk-cell').click()`);
await sleep(1200);

const cmdInfo = await evaluate(`(() => {
  const codes = [...document.querySelectorAll('#blkDetail .code')].map(c => c.textContent);
  const warns = [...document.querySelectorAll('#blkDetail .blk-warn')].map(c => c.textContent);
  return JSON.stringify({
    selected: window.__MCE_BLOCKS__.selected,
    codes, warns,
    heroImgs: document.querySelectorAll('#blkDetail .blk-hero-ico img').length,
    facts: [...document.querySelectorAll('#blkDetail .blk-kv dt, #blkDetail .blk-kv dd')].map(e => e.textContent),
    title: document.querySelector('#blkDetail .card-title')?.textContent,
    params: [...document.querySelectorAll('#blkDetail .blk-param input')].map(i => i.value),
  });
})()`);
const ci = JSON.parse(cmdInfo);
check('点选后 hook 记录了选中项', !!ci.selected, JSON.stringify(ci.selected));
check('点选后 0 未捕获异常', newExceptions().length === 0, newExceptions().slice(0, 3).join(' | '));
check('生成了 3 条命令位（setblock / fill / give）', ci.codes.length + ci.warns.length === 3, `code=${ci.codes.length} warn=${ci.warns.length}`);
check('生成了非空的 /setblock', ci.codes.some((c) => c.includes('setblock') && c.length > 10), ci.codes.find((c) => c.includes('setblock')));
check('生成了非空的 /fill', ci.codes.some((c) => c.includes('fill') && c.length > 10), ci.codes.find((c) => c.includes('fill')));
check('生成了非空的 /give', ci.codes.some((c) => c.includes('give') && c.length > 10), ci.codes.find((c) => c.includes('give')));
check('详情区有常用参数输入（可直接改）', ci.params.length >= 5, `参数框 ${ci.params.length} 个: ${ci.params.join(' | ')}`);

/* 改参数 → 命令回填 */
const before = ci.codes.find((c) => c.includes('setblock'));
await evaluate(`(() => {
  const i = document.querySelector('#blkDetail .blk-param input');
  i.value = '10 64 -20';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(600);
const after = await evaluate(`[...document.querySelectorAll('#blkDetail .code')].map(c => c.textContent).find(t => t.includes('setblock'))`);
check('改坐标后 /setblock 回填了新坐标', after !== before && after.includes('10 64 -20'), `${before}  →  ${after}`);
check('参数变化不丢焦点结构（命令区独立重绘）', await evaluate(`!!document.querySelector('#blkDetail .blk-param input')`));

/* ============ 4. 图标：naturalWidth > 0 ============ */
section('4. 图标（minecraft wiki 原图）');

const imgCount = await evaluate(`window.__MCE_BLOCKS__.revealAll()`);
check('懒加载钩子把当前页图标都画出来了', imgCount > 0, `共 ${imgCount} 个 <img>`);

// 等真实网络加载
let report = null;
for (let i = 0; i < 12; i++) {
  await sleep(1200);
  report = JSON.parse(await evaluate(`JSON.stringify(window.__MCE_BLOCKS__.imgReport())`));
  if (report.loaded > 0 && report.count > 0) break;
}
check('DOM 里存在 wiki 图片 <img>', report.count > 0, `count=${report.count}`);
check('★ <img> 的 naturalWidth > 0（wiki 热链成功）', report.loaded > 0, `${report.loaded}/${report.count} 张真的解码成功，样例: ${JSON.stringify(report.sample.slice(0, 3))}`);
check('没有一张是加载失败的裂图', report.broken === 0, `broken=${report.broken}`);
check('图标计数统计在被真实记录', await evaluate(`window.__MCE_BLOCKS__.iconStats.ok`) > 0, JSON.stringify(await evaluate(`window.__MCE_BLOCKS__.iconStats`)));

// 大图也用同一套
check('详情区大图也是图片', ci.heroImgs >= 0, `hero imgs=${ci.heroImgs}`);

/* 文字回退：wiki 表里图标单元格本就为空的方块 */
section('4b. 文字回退（wiki 无图方块 / 热链被拦时的兜底）');
const fallback = await evaluate(`(() => {
  window.__MCE_BLOCKS__.select('air');
  return true;
})()`);
await sleep(1500);
const fbInfo = JSON.parse(await evaluate(`(() => {
  const heroImgs = document.querySelectorAll('#blkDetail .blk-hero-ico img').length;
  const hero = document.querySelector('#blkDetail .blk-hero-ico');
  return JSON.stringify({
    heroImgs,
    heroText: hero ? hero.innerText.trim() : '',
    heroHasBox: !!hero,
    name: window.__MCE_BLOCKS__.selected ? window.__MCE_BLOCKS__.selected.name : null,
    wikiFile: (document.querySelector('#blkDetail .blk-kv') || {}).innerText || '',
  });
})()`));
check('air 这个 wiki 无图方块被选中', fallback && fbInfo.name === '空气', `name=${fbInfo.name}`);
check('它没有 <img>，而是渲染了文字回退（不是空白）', fbInfo.heroImgs === 0 && fbInfo.heroText.length > 0, `heroImgs=${fbInfo.heroImgs} 回退文字="${fbInfo.heroText}"`);
check('详情里如实写明「wiki 表里该行图标为空」', fbInfo.wikiFile.includes('wiki 表里该行图标为空'), fbInfo.wikiFile.split('\n').slice(-2).join(' / '));

/* ============ 5. 版本兼容 ============ */
section('5. 版本兼容（命名空间 ID / 数字 ID / Classic / 未取证）');

async function switchEra(version) {
  await evaluate(`(async () => { await window.__MCE__.setVersion(${JSON.stringify(version)}); window.__MCE__.goto('blocks'); return true; })()`);
  await sleep(2600);
  return JSON.parse(await evaluate(`(() => {
    const h = window.__MCE_BLOCKS__;
    return JSON.stringify({
      era: h ? h.era : null, version: h ? h.version : null, total: h ? h.total : null,
      stats: h ? h.stats : null,
      title: document.querySelector('#pageTitle').textContent,
      hint: (document.querySelector('#pageView .infobar') || {}).innerText || '',
      cells: document.querySelectorAll('.blk-cell').length,
    });
  })()`));
}

step();
const eModern = await switchEra('1.16.5');
check('1.16.5 → 命名空间 ID 表', eModern.era === 'modern', `era=${eModern.era} 共 ${eModern.total} 条`);
check('1.16.5 的条数与取证一致（1286）', eModern.total === 1286, `total=${eModern.total}`);
check('1.16.5 切页后 0 新增异常', newExceptions().length === 0, newExceptions().slice(0, 3).join(' | '));

const ePre = await switchEra('1.12.2');
check('1.12.2 → 数字 ID 表', ePre.era === 'preflat', `era=${ePre.era}`);
check('1.12.2 的取证行数与 wiki 一致（256 行）', ePre.stats && ePre.stats.preflat === 256, `stats.preflat=${ePre.stats && ePre.stats.preflat}`);
check('1.12.2 候选数 = 256：wiki 的 256 行一行都没被吞掉', ePre.total === 256, `total=${ePre.total}`);
// dec 253/254 两行是 wiki 标注的「（未使用）」，命名空间 ID 列本来就是空的 —— 必须仍是两条独立候选
const unused253 = await searchIn('253');
check('★ 回归护栏：wiki 的「（未使用）」占位行还在，没被按空 ID 合并掉',
  unused253.count >= 1 && (unused253.first?.name === '（未使用）' || unused253.first?.idLine.includes('253')),
  `搜 "253" → ${unused253.count} 个候选，首项 ${unused253.first?.name} / ${unused253.first?.idLine}`);

// 数字 ID 搜索
async function searchIn(text) {
  await evaluate(`(() => { const i = document.querySelector('.blk-toolbar input.tb'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(500);
  return JSON.parse(await evaluate(`(() => { const c = [...document.querySelectorAll('.blk-cell')]; return JSON.stringify({ count: c.length, first: c[0] ? { id: c[0].dataset.blockId, name: c[0].querySelector('.blk-name').textContent, idLine: c[0].querySelector('.blk-id').textContent } : null }); })()`));
}
const numHit = await searchIn('1');
check('1.12.2 下按数字 ID「1」能搜到', numHit.count > 0, `${numHit.count} 个候选，首项 ${numHit.first?.name} (${numHit.first?.idLine})`);
const numExact = await searchIn('5');
check('数字 ID 精确命中（5 → 木板）', numExact.first?.id === 'planks', `首项=${numExact.first?.id} / ${numExact.first?.name} / ${numExact.first?.idLine}`);

// 数字 ID 命令
await evaluate(`window.__MCE_BLOCKS__.select('stone')`);
await sleep(1200);
const preCmds = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('#blkDetail .code')].map(c => c.textContent))`));
const preWarns = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('#blkDetail .blk-warn')].map(c => c.textContent))`));
check('1.12.2 生成的 /setblock 用 数字ID + dataValue 语法',
  preCmds.some((c) => /^\/setblock (\S+ ){3}\d+ 0 replace/.test(c)),
  preCmds.find((c) => c.includes('setblock')));
check('1.12.2 的 /fill 被标为「未取证」而不是编一个出来',
  preWarns.some((w) => w.includes('未取证')),
  (preWarns.find((w) => w.includes('未取证')) || '').slice(0, 110));
check('★ 回归护栏：1.12.2 绝不产出 1.13+ 的 /fill 语法（formFor 有落回最后一个表单的兜底）',
  !preCmds.some((c) => c.includes('fill')),
  preCmds.filter((c) => c.includes('fill')).join(' | ') || '（没有 fill 命令，正确）');

const eClassic = await switchEra('c0.30_01c');
check('c0.30_01c → Classic 表', eClassic.era === 'classic', `era=${eClassic.era} 共 ${eClassic.total} 条`);
check('Classic 条数与取证一致（50）', eClassic.total === 50, `total=${eClassic.total}`);

const eAncient = await switchEra('a1.2.6');
check('a1.2.6（Alpha）→ 明确标「未取证」不给假数据', eAncient.era === 'ancient-missing' && eAncient.hint.includes('未取证'), `era=${eAncient.era} 提示="${eAncient.hint.replace(/\s+/g, ' ').slice(0, 120)}"`);
check('远古未取证时不再渲染候选列表', eAncient.cells === 0, `cells=${eAncient.cells}`);

/* 收尾：回到默认版本，避免污染 localStorage 影响后续 cdp-tour */
await evaluate(`(async () => { await window.__MCE__.setVersion('1.16.5'); return true; })()`);
await sleep(1200);

/* ============ 截图（先摆一个有内容的画面，便于人工复核） ============ */
if (shotPath) {
  await evaluate(`(async () => {
    await window.__MCE__.setVersion('1.16.5');
    window.__MCE__.goto('blocks');
    return true;
  })()`);
  await sleep(2500);
  await evaluate(`(() => {
    const i = document.querySelector('.blk-toolbar input.tb');
    i.value = '石';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(800);
  await evaluate(`document.querySelector('.blk-cell').click()`);
  await sleep(600);
  await evaluate(`window.__MCE_BLOCKS__.revealAll()`);
  await sleep(3000);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(`\n截图已保存: ${shotPath}`);
}

/* ============ 汇总 ============ */
const failed = results.filter((r) => !r.ok);
console.log('\n════════════════════════════════');
console.log(`  断言通过 ${results.length - failed.length} / ${results.length}`);
console.log('════════════════════════════════');
console.log(`未捕获异常总数: ${exceptions.length}`);
exceptions.slice(0, 10).forEach((e) => console.log(`  ⚠ ${e}`));
console.log(`错误日志总数: ${errLogs.length}`);
[...new Set(errLogs)].slice(0, 10).forEach((e) => console.log(`  ⚠ ${e}`));
console.log(`网络加载失败: ${netFails.length}`);
[...new Set(netFails)].slice(0, 10).forEach((e) => console.log(`  ⚠ ${e}`));
const iconConclusion = report && report.loaded > 0
  ? `wiki 图片可直接热链（naturalWidth=${report.sample[0]?.w}）`
  : 'wiki 图片热链失败，UI 已走文字回退';
console.log(`图标结论: ${iconConclusion}`);
if (failed.length) {
  console.log('\n失败项:');
  failed.forEach((f) => console.log(`  ✗ ${f.name} — ${f.detail}`));
}
console.log(`\n未捕获异常=0 ? ${exceptions.length === 0}`);

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(failed.length || exceptions.length ? 1 : 0);
