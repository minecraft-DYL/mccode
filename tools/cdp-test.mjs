// cdp-test.mjs —— 零依赖 CDP 驱动：启动 Edge headless，抓 console/异常/网络失败 + 页面状态快照
// 用法: node tools/cdp-test.mjs <url> [waits] [--click=SELECTOR] [--eval=EXPR]
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] || 'http://127.0.0.1:8777/';
const waitMs = Number(process.argv[3] || 9000);
const clickSel = (process.argv.find((a) => a.startsWith('--click=')) || '').slice(8);
const evalExpr = (process.argv.find((a) => a.startsWith('--eval=')) || '').slice(7);
const showShot = (process.argv.find((a) => a.startsWith('--shot=')) || '').slice(7);
const afterMs = Number((process.argv.find((a) => a.startsWith('--after=')) || '').slice(8) || 1200);
const PORT = 9333 + Math.floor(Math.random() * 200);

const profile = `${process.env.TEMP}\\edge-cdp-${PORT}`;
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1050',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
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
const logs = [];
const exceptions = [];
const netFails = [];

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    logs.push({ type: m.params.type, text: args });
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push({
      text: d.exception && (d.exception.description || d.exception.value),
      line: d.lineNumber, url: d.url,
    });
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' || e.level === 'warning') logs.push({ type: 'log:' + e.level, text: `${e.text} ${e.url || ''}` });
  } else if (m.method === 'Network.loadingFailed') {
    netFails.push({ err: m.params.errorText, type: m.params.type });
  }
};

// CDP 单条命令的超时。默认 30s，探针要等预热/网络时可用 MCE_CDP_TIMEOUT_MS 放大。
// 注意：这不是「任务失败」计时器，只是防止一条挂死的 CDP 命令把脚本永远卡住。
const CDP_TIMEOUT_MS = Number(process.env.MCE_CDP_TIMEOUT_MS || 30000);

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, CDP_TIMEOUT_MS);
  });
}

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

const probe = `
(() => {
  const q = (s) => document.querySelector(s);
  const st = (window.__MCE__ && window.__MCE__.state) || null;
  return JSON.stringify({
    title: document.title,
    navItems: q('#navItems') ? q('#navItems').children.length : -1,
    pageViewChildren: q('#pageView') ? q('#pageView').children.length : -1,
    pageTitle: q('#pageTitle') ? q('#pageTitle').textContent : null,
    pageViewText: q('#pageView') ? q('#pageView').innerText.replace(/\\s+/g,' ').slice(0, 300) : null,
    statusBar: q('#statusBar') ? q('#statusBar').innerText.replace(/\\n/g, ' | ') : null,
    state: st ? {
      version: st.version,
      hasIndex: !!st.versionIndex,
      indexCount: st.versionIndex ? st.versionIndex.versions.length : 0,
      page: st.page,
      registry: st.registry ? { items: st.registry.items.length, entities: st.registry.entities.length, particles: st.registry.particles.length, source: st.registry.source } : null,
      segments: st.matrix ? st.matrix.segments.length : 0,
      matrixFrom: st.matrix ? st.matrix.loadedFrom : null,
      status: (st.status || []).slice(0, 10).map(s => s.level + ': ' + s.text),
    } : 'no __MCE__',
  }, null, 2);
})()
`;

if (clickSel) {
  await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSel)}); if (!el) return 'NOT_FOUND'; el.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  await sleep(afterMs);
}
const probeRes = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
let customEval = null;
if (evalExpr) {
  const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) customEval = '❌ ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  else customEval = r.result && r.result.value;
}

if (showShot) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(showShot, Buffer.from(shot.data, 'base64'));
}

console.log('=== 探针 ===');
console.log(probeRes.result.value);
if (customEval !== null) {
  console.log('=== --eval ===');
  console.log(typeof customEval === 'string' ? customEval : JSON.stringify(customEval, null, 2));
}
console.log('=== 未捕获异常 (' + exceptions.length + ') ===');
for (const e of exceptions.slice(0, 15)) console.log(`[${e.url}:${e.line}] ${String(e.text).split('\n').slice(0, 4).join('\n    ')}`);
console.log('=== console 错误/警告 (' + logs.filter((l) => l.type !== 'log').length + ') ===');
for (const l of logs.slice(0, 25)) console.log(`${l.type}: ${String(l.text).slice(0, 300)}`);
console.log('=== 网络失败 (' + netFails.length + ') ===');
for (const f of netFails.slice(0, 15)) console.log(`${f.type} ${f.err}`);

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(0);
