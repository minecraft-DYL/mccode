// wiki-probe.mjs —— 用真实浏览器（Edge headless + CDP）过 Cloudflare 挑战后抓 wiki 原始 wikitext
// 用法: node tools/wiki-probe.mjs <url> [waitMs]
// 说明：zh.minecraft.wiki 前置 Cloudflare JS 挑战，纯 HTTP 客户端一律 403（见 tools/fetch-wiki.py 留档）。
//       真实浏览器执行挑战脚本后带着 cf_clearance cookie 再请求，才能拿到内容。
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2];
const waitMs = Number(process.argv[3] || 12000);
if (!url) { console.error('用法: node tools/wiki-probe.mjs <url> [waitMs]'); process.exit(2); }
const PORT = 9600 + Math.floor(Math.random() * 300);
const profile = `${process.env.TEMP}\\edge-wikiprobe-${PORT}`;

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1400,1000',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
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

const target = await waitTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 60000);
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(waitMs);

// 已过挑战：直接取 body 文本
const pick = async () => {
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body ? document.body.innerText : '';
      return JSON.stringify({ len: t.length, challenged: /quick browser check|Enable JavaScript and cookies/i.test(t), text: t });
    })()`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
};

let got = await pick();
// 挑战页会自行刷新，最多再等 25s 看是否跳到真内容
for (let i = 0; i < 10 && got.challenged; i++) {
  await sleep(2500);
  got = await pick();
}

console.log(JSON.stringify({ url, challenged: got.challenged, len: got.len }, null, 2));
console.log('----- BODY -----');
console.log(got.text.slice(0, 120000));

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(got.challenged ? 3 : 0);
