// cdp-tour.mjs —— 逐页巡测：点击每个导航项，抓 DOM 状态 / 异常 / 截图
// 用法: node tools/cdp-tour.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const base = process.argv[2] || 'http://127.0.0.1:8777/';
const SHOT_DIR = 'D:\\ku\\traecode\\mccode\\.shots';
mkdirSync(SHOT_DIR, { recursive: true });

const PORT = 9600 + Math.floor(Math.random() * 300);
const profile = `${process.env.TEMP}\\edge-tour-${PORT}`;
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
let exceptions = [];
let errLogs = [];

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
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errLogs.push(`${m.params.entry.text} ${String(m.params.entry.url || '').split('/').pop()}`);
  }
};

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 40000);
  });
}

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: base });
await sleep(11000); // 等 manifest + 矩阵就绪

// 从导航 DOM 真实读取页面清单，不硬编码。
// 之前这里写死 8 页，后来新增的「方块」页就完全漏测了 —— 漏测的页面等于没验。
const PAGES = JSON.parse(await evaluate(`(() => {
  const items = Array.from(document.querySelectorAll('.nv-item[data-page]'));
  return JSON.stringify(items.map((el) => el.dataset.page).filter(Boolean));
})()`));
if (!PAGES.length) {
  console.error('❌ 导航里没读到任何页面（data-page 属性不存在？），巡测无法进行');
  process.exit(1);
}
console.log(`巡测页面 ${PAGES.length} 个（来源：导航实时读取）：${PAGES.join(', ')}`);
const results = [];

for (const p of PAGES) {
  const before = exceptions.length;
  const clicked = await evaluate(`(() => { const el = document.querySelector('.nv-item[data-page="${p}"]'); if (!el) return 'NOT_FOUND'; el.click(); return 'ok'; })()`);
  await sleep(1800);
  const probe = await evaluate(`(() => {
    const v = document.querySelector('#pageView');
    return JSON.stringify({
      title: document.querySelector('#pageTitle').textContent,
      children: v.children.length,
      textLen: v.innerText.length,
      head: v.innerText.replace(/\\s+/g,' ').slice(0, 220),
      nodes: v.querySelectorAll('.node').length,
      cells: v.querySelectorAll('.pk-cell').length,
      tlCells: v.querySelectorAll('.tl-cell').length,
      tables: v.querySelectorAll('table').length,
      cards: v.querySelectorAll('.card').length,
      errCard: !!v.querySelector('.code') && /出错|Error/.test(v.innerText.slice(0, 300)),
    });
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOT_DIR}\\tour-${p}.png`, Buffer.from(shot.data, 'base64'));
  results.push({ page: p, clicked, probe: JSON.parse(probe), newExceptions: exceptions.slice(before) });
}

console.log('\n=========== 逐页巡测结果 ===========\n');
for (const r of results) {
  const p = r.probe;
  console.log(`■ ${r.page.padEnd(11)} click=${r.clicked}  标题=${p.title}  卡片=${p.cards}  子节点=${p.children}  文本=${p.textLen}字  异常=${r.newExceptions.length}`);
  console.log(`   内容: ${p.head}`);
  const extra = [];
  if (p.nodes) extra.push(`节点图节点=${p.nodes}`);
  if (p.cells) extra.push(`选择器格子=${p.cells}`);
  if (p.tlCells) extra.push(`时间轴色块=${p.tlCells}`);
  if (p.tables) extra.push(`表格=${p.tables}`);
  if (extra.length) console.log(`   ${extra.join('  ')}`);
  if (r.newExceptions.length) console.log(`   ⚠ ${r.newExceptions.join('\n   ⚠ ')}`);
  console.log('');
}

const stateProbe = await evaluate(`(() => { const s = window.__MCE__.state; return JSON.stringify({
  version: s.version, page: s.page,
  indexVersions: s.versionIndex ? s.versionIndex.versions.length : 0,
  segments: s.matrix ? s.matrix.segments.length : 0,
  matrixFrom: s.matrix ? s.matrix.loadedFrom : null,
  registry: s.registry ? { items: s.registry.items.length, entities: s.registry.entities.length, particles: s.registry.particles.length, source: s.registry.source } : null,
  status: s.status.slice(0,10).map(x => x.level + ': ' + x.text),
}); })()`);
console.log('=========== 全局状态 ===========');
console.log(stateProbe);
console.log('\n=========== 未捕获异常 (' + exceptions.length + ') ===========');
exceptions.slice(0, 20).forEach((e) => console.log('  ' + e));
console.log('=========== 错误日志 (' + errLogs.length + ') ===========');
[...new Set(errLogs)].slice(0, 20).forEach((e) => console.log('  ' + e));

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(0);
