// wiki-get.mjs —— 过 Cloudflare 抓 zh.minecraft.wiki 的 api.php JSON，并做干净输出
// 用法:
//   node tools/wiki-get.mjs sections <页面>
//   node tools/wiki-get.mjs raw <页面> [section]
//   node tools/wiki-get.mjs search <词>
// 依赖：复用 tools/wiki-probe.mjs 的真实浏览器通道（Edge headless + CDP）。
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const [mode, arg1, arg2] = process.argv.slice(2);

function apiUrl() {
  const base = 'https://zh.minecraft.wiki/api.php?format=json&formatversion=2';
  if (mode === 'sections') return `${base}&action=parse&page=${encodeURIComponent(arg1)}&prop=sections`;
  if (mode === 'raw') {
    const sec = arg2 ? `&section=${encodeURIComponent(arg2)}` : '';
    return `${base}&action=parse&page=${encodeURIComponent(arg1)}&prop=wikitext${sec}`;
  }
  if (mode === 'search') return `${base}&action=query&list=search&srsearch=${encodeURIComponent(arg1)}&srnamespace=0&srlimit=30`;
  if (mode === 'url') return arg1;
  throw new Error('未知模式: ' + mode);
}

const PORT = 9700 + Math.floor(Math.random() * 250);
const profile = `${process.env.TEMP}\\edge-wikiget-${PORT}`;
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1400,1000',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error('CDP target 未就绪');
}

let ws, msgId = 0;
const pending = new Map();
async function connect() {
  const target = await waitTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 60000);
});

await connect();
await send('Page.enable');
await send('Runtime.enable');

const url = apiUrl();
await send('Page.navigate', { url });
await sleep(6000);

// 在浏览器里直接 fetch（已带 cf_clearance），完全绕开 CF 挑战
const expr = `(async () => {
  const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
  const t = await r.text();
  return JSON.stringify({ status: r.status, len: t.length, text: t });
})()`;

let out = null;
for (let i = 0; i < 8; i++) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { await sleep(3000); continue; }
  out = JSON.parse(r.result.value);
  if (out.status === 200 && out.len > 2) break;
  await sleep(3000);
}

try { ws.close(); } catch { /* ignore */ }
try { child.kill(); } catch { /* ignore */ }

if (!out || out.status !== 200) {
  console.error('抓取失败: ' + JSON.stringify(out && { status: out.status, len: out.len }));
  process.exit(3);
}

let data;
try { data = JSON.parse(out.text); } catch (e) { console.error('非 JSON 响应'); console.log(out.text.slice(0, 2000)); process.exit(4); }

if (mode === 'sections') {
  if (data.error) { console.error('API 错误: ' + JSON.stringify(data.error)); process.exit(5); }
  const secs = (data.parse && data.parse.sections) || [];
  console.log(`# ${data.parse.title} — ${secs.length} 节`);
  for (const s of secs) console.log(`${s.index}\tL${s.level}\t${s.line}`);
} else if (mode === 'raw') {
  if (data.error) { console.error('API 错误: ' + JSON.stringify(data.error)); process.exit(5); }
  const wt = data.parse && data.parse.wikitext;
  console.log(`# ${data.parse.title} / section ${arg2 || '(全文)'} — ${wt ? wt.length : 0} 字符`);
  console.log(wt || '(空)');
} else if (mode === 'search') {
  const hits = (data.query && data.query.search) || [];
  console.log(`# 搜索「${arg1}」 — ${hits.length} 条`);
  for (const h of hits) console.log(`${h.title}\t${h.wordcount}词\t${String(h.snippet || '').replace(/<[^>]+>/g, '').slice(0, 90)}`);
} else {
  console.log(out.text);
}
process.exit(0);
