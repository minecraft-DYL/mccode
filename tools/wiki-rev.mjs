// wiki-rev.mjs —— 取 zh.minecraft.wiki 某页面的历史修订 wikitext（用于取证已改版的旧格式定义）
// 用法: node tools/wiki-rev.mjs <页面> <ISO时间戳>  → 取该时间点之前的最后一个修订
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const [page, ts] = process.argv.slice(2);
if (!page || !ts) { console.error('用法: node tools/wiki-rev.mjs <页面> <ISO时间戳，如 2024-06-01T00:00:00Z>'); process.exit(2); }

const base = 'https://zh.minecraft.wiki/api.php?format=json&formatversion=2';
const q = `${base}&action=query&prop=revisions&titles=${encodeURIComponent(page)}&rvlimit=1&rvprop=ids|timestamp|content&rvslots=main&rvstart=${encodeURIComponent(ts)}&rvdir=older`;

const PORT = 9950 + Math.floor(Math.random() * 40);
const profile = `${process.env.TEMP}\\edge-wikirev-${PORT}`;
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--window-size=1400,1000`,
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

let msgId = 0; const pending = new Map();
const target = await waitTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 60000);
});

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: q });
await sleep(6000);

let out = null;
for (let i = 0; i < 8; i++) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { const r = await fetch(${JSON.stringify(q)}, { credentials: 'include' }); return JSON.stringify({ status: r.status, text: await r.text() }); })()`,
    returnByValue: true, awaitPromise: true,
  });
  if (!r.exceptionDetails) { out = JSON.parse(r.result.value); if (out.status === 200) break; }
  await sleep(3000);
}
try { ws.close(); } catch { /* ignore */ }
try { child.kill(); } catch { /* ignore */ }

if (!out || out.status !== 200) { console.error('抓取失败'); process.exit(3); }
const data = JSON.parse(out.text);
const pages = (data.query && data.query.pages) || [];
const rev = pages[0] && pages[0].revisions && pages[0].revisions[0];
if (!rev) { console.error('没有找到 ' + ts + ' 之前的修订'); process.exit(4); }
const content = rev.slots && rev.slots.main && rev.slots.main.content;
console.log(`# ${page} rev ${rev.revid} @ ${rev.timestamp}`);
console.log(content || '(空)');
process.exit(0);
