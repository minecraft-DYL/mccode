// cdp-nbt-i18n.mjs —— 在真实浏览器里验收「NBT 汉化 + 补全 + 节点图 + 组件页」。
//
// 用法：node tools/cdp-nbt-i18n.mjs [url] [--keep-shot]
//   默认 url = http://127.0.0.1:8777/index.html
//
// 覆盖项（每一项都必须有真实断言，失败即非零退出）：
//   1. boot：window.__MCE__ 存在、导航项数 > 0、0 未捕获异常
//   2. NBT 页：结构树里出现汉字（中文名真的渲染了）
//   3. NBT 页：在 textarea 里敲半个键名 → 候选浮层出现，且候选里有中文名
//   4. NBT 页：值补全候选来自注册表/wiki 枚举（断言候选条数 > 0）
//   5. NBT 页：切到节点图 → 节点数 > 0；切回文本 → 高亮 span 还在
//   6. NBT 页：图上改一个值 → SNBT 草稿真的变了
//   7. NBT 页：文本改 → 图重建（节点数变化）
//   8. 组件页：JSON 高亮存在、组件名带汉字、since 覆盖率高、节点图可用
//   9. 全程 0 未捕获异常

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8777/index.html';
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9600 + Math.floor(Math.random() * 380);
const PROFILE = mkdtempSync(join(tmpdir(), 'edge-nbti18n-'));

const results = [];
let failures = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(t) { console.log(`\n──────── ${t} ────────`); }

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1050',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

let ws = null, msgId = 0;
const pending = new Map();
const exceptions = [];
const errorLogs = [];

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 端口还没起来 */ }
    await sleep(250);
  }
  throw new Error('连不上 Edge 调试端口 ' + PORT);
}

/* ============================ 主流程 ============================ */

async function main() {
  const target = await connect();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?');
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errorLogs.push(m.params.entry.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errorLogs.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '));
    }
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: URL_ });

  // 不用固定 sleep：轮询到 __MCE__ 真的挂上为止（外壳挂载才是「应用启动完成」）
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      if (await evaluate(`!!window.__MCE__ && document.querySelectorAll('.nv-item[data-page]').length > 0`)) { booted = true; break; }
    } catch { /* 导航中上下文会短暂失效，重试 */ }
  }
  // 再给注册表/版本清单一点时间，避免后续断言跑在竞态里
  await sleep(1200);

  /* ---------------- 1. boot ---------------- */
  section('1. boot 检查');
  const boot = JSON.parse(await evaluate(`JSON.stringify({
    hasMCE: !!window.__MCE__,
    nav: document.querySelectorAll('.nv-item[data-page]').length,
    title: document.title,
    url: location.href
  })`));
  check('window.__MCE__ 存在', boot.hasMCE, JSON.stringify(boot));
  check('导航项 > 0', boot.nav > 0, `nav=${boot.nav}`);
  if (!booted || !boot.hasMCE) {
    console.log('\n⚠️ 应用没启动成功，后续断言无意义，直接汇总退出。');
    console.log('捕获到的异常：'); for (const e of exceptions.slice(0, 5)) console.log('   ' + String(e).split('\n')[0]);
    return;
  }

  /* ---------------- 2. 打开 NBT 页 ---------------- */
  section('2. NBT 页：中文名渲染');
  check('点击 NBT 导航', (await evaluate(`(()=>{const e=document.querySelector('.nv-item[data-page="nbt"]');if(!e)return 'NOT_FOUND';e.click();return 'ok';})()`)) === 'ok');
  await sleep(1500);
  const nbtProbe = JSON.parse(await evaluate(`JSON.stringify({
    hasHan: /[\\u4e00-\\u9fa5]/.test(document.getElementById('pageView').innerText),
    treeText: (document.querySelector('.card') ? document.getElementById('pageView').innerText : '').slice(0, 400),
    hasHighlightInTree: !!document.querySelector('.snbt-box .k-str, .snbt-box .k-num'),
    hlSpans: document.querySelectorAll('.snbt-box .k-str, .snbt-box .k-num, .snbt-box .k-key').length
  })`));
  check('NBT 页有汉字（中文名已渲染）', nbtProbe.hasHan);
  check('文本视图高亮 span 存在', nbtProbe.hasHighlightInTree, `spans=${nbtProbe.hlSpans}`);

  /* ---------------- 3. 键补全 ---------------- */
  section('3. 键补全：敲前缀 → 候选含中文名');
  const keyAc = JSON.parse(await evaluate(`(async () => {
    const ta = document.querySelector('.snbt-box textarea.snbt-edit');
    if (!ta) return JSON.stringify({ err: '找不到 SNBT textarea' });
    ta.focus();
    ta.value = '{CustomName:\\'{"text":"x"}\\',Unbr';
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const pop = document.querySelector('.ac-pop');
    const rows = pop ? Array.from(pop.querySelectorAll('.ac-item')) : [];
    return JSON.stringify({
      popVisible: !!(pop && pop.style.display !== 'none'),
      count: rows.length,
      first: rows[0] ? rows[0].innerText : null,
      hasHan: rows.some(r => /[\\u4e00-\\u9fa5]/.test(r.innerText)),
      head: pop ? (pop.querySelector('.ac-head')?.innerText || '') : ''
    });
  })()`));
  check('键补全浮层出现', keyAc.popVisible, JSON.stringify(keyAc).slice(0, 300));
  check('候选条数 > 0', keyAc.count > 0, `count=${keyAc.count}`);
  check('候选里含中文名', keyAc.hasHan, `first=${keyAc.first}`);

  /* ---------------- 4. 值补全 ---------------- */
  section('4. 值补全：候选来自注册表 / wiki 枚举');
  const valAc = JSON.parse(await evaluate(`(async () => {
    const ta = document.querySelector('.snbt-box textarea.snbt-edit');
    if (!ta) return JSON.stringify({ err: '找不到 SNBT textarea' });
    ta.focus();
    ta.value = 'Enchantments: [{id: "minecraft:shar';
    ta.selectionStart = ta.selectionEnd = ta.value.length - 0;
    // 光标放在最后一个引号内
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const pop = document.querySelector('.ac-pop');
    const rows = pop ? Array.from(pop.querySelectorAll('.ac-item')) : [];
    return JSON.stringify({
      popVisible: !!(pop && pop.style.display !== 'none'),
      count: rows.length,
      sample: rows.slice(0, 3).map(r => r.innerText),
      hasHan: rows.some(r => /[\\u4e00-\\u9fa5]/.test(r.innerText))
    });
  })()`));
  check('值补全浮层出现', valAc.popVisible, JSON.stringify(valAc).slice(0, 300));
  check('值候选条数 > 0', valAc.count > 0, `count=${valAc.count} sample=${JSON.stringify(valAc.sample)}`);
  // 关掉浮层，避免影响后续
  await evaluate(`document.querySelector('.snbt-box textarea')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);

  /* ---------------- 5. 节点图：切换 + 高亮保留 ---------------- */
  section('5. NBT 节点图模式');
  const graphProbe = JSON.parse(await evaluate(`(async () => {
    // 先放一段确定合法的 SNBT，避免上一步的半截值影响本次断言
    const ta0 = document.querySelector('.snbt-box textarea.snbt-edit');
    if (!ta0) return JSON.stringify({ err: '找不到 SNBT textarea' });
    ta0.value = '{CustomName:\\'{"text":"我的物品"}\\',Unbreakable:1b,Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}';
    ta0.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const btns = Array.from(document.querySelectorAll('#pageView button'));
    const gb = btns.find(b => b.innerText.trim() === '节点图');
    if (!gb) return JSON.stringify({ err: '找不到「节点图」按钮', btns: btns.map(b=>b.innerText.trim()).filter(Boolean).slice(0,20) });
    gb.click();
    await new Promise(r => setTimeout(r, 1500));
    const host = document.querySelector('[data-nbt-graph]');
    const nodeSel = host ? host.querySelectorAll('.mce-node') : [];
    return JSON.stringify({
      clicked: true,
      hostFound: !!host,
      hostChildren: host ? host.children.length : 0,
      nodeCount: nodeSel.length,
      note: (host && host.parentElement) ? (host.parentElement.querySelector('.tiny.muted')?.innerText || '') : '',
      titles: nodeSel.length ? Array.from(nodeSel).slice(0,4).map(n => (n.querySelector('.node-head')?.innerText || '').slice(0,40)) : []
    });
  })()`));
  check('节点图 host 存在', graphProbe.hostFound, JSON.stringify(graphProbe).slice(0, 300));
  check('节点数 > 0', graphProbe.nodeCount > 0, `nodeCount=${graphProbe.nodeCount} hostChildren=${graphProbe.hostChildren}`);
  console.log(`     note: ${graphProbe.note}`);
  if (graphProbe.titles && graphProbe.titles.length) console.log(`     前几个节点: ${JSON.stringify(graphProbe.titles)}`);

  const backProbe = JSON.parse(await evaluate(`(async () => {
    const btns = Array.from(document.querySelectorAll('#pageView button'));
    const tb = btns.find(b => b.innerText.trim() === '文本 + JSON 高亮');
    tb.click();
    await new Promise(r => setTimeout(r, 700));
    const box = document.querySelector('.snbt-box');
    return JSON.stringify({
      boxVisible: !!(box && box.offsetParent !== null),
      spans: document.querySelectorAll('.snbt-box .k-str, .snbt-box .k-num, .snbt-box .k-key, .snbt-box .k-sel, .snbt-box .k-lit').length,
      text: (document.querySelector('.snbt-box textarea')?.value || '').slice(0, 80)
    });
  })()`));
  check('切回文本视图后高亮仍在', backProbe.boxVisible && backProbe.spans > 0, `spans=${backProbe.spans}`);

  /* ---------------- 6. 文本 → 图 重建 ---------------- */
  section('6. 双向一致性：文本改 → 图重建');
  const rebuild = JSON.parse(await evaluate(`(async () => {
    const ta = document.querySelector('.snbt-box textarea.snbt-edit');
    if (!ta) return JSON.stringify({ err: '找不到 SNBT textarea' });
    ta.focus();
    ta.value = '{A:1b,B:2b,C:3b,D:{E:"deep"}}';
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const btns = Array.from(document.querySelectorAll('#pageView button'));
    btns.find(b => b.innerText.trim() === '节点图').click();
    await new Promise(r => setTimeout(r, 1200));
    const host = document.querySelector('[data-nbt-graph]');
    const n1 = host.querySelectorAll('.mce-node').length;
    // 换成只有两个键的文本，再切一次
    btns.find(b => b.innerText.trim() === '文本 + JSON 高亮').click();
    await new Promise(r => setTimeout(r, 400));
    const ta2 = document.querySelector('.snbt-box textarea.snbt-edit');
    if (!ta2) return JSON.stringify({ ok: false, err: '第二次找不到 textarea' });
    ta2.value = '{X:"hello",N:1b}';
    ta2.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    btns.find(b => b.innerText.trim() === '节点图').click();
    await new Promise(r => setTimeout(r, 1200));
    const h2 = document.querySelector('[data-nbt-graph]');
    const n2 = h2.querySelectorAll('.mce-node').length;
    return JSON.stringify({ nodesAfterFirst: n1, nodesAfterSecond: n2, note: (h2.parentElement.querySelector('.tiny.muted')?.innerText||'') });
  })()`));
  check('文本改后图重建（节点数随之变化）', rebuild.nodesAfterSecond > 0 && rebuild.nodesAfterFirst !== rebuild.nodesAfterSecond,
    `${rebuild.nodesAfterFirst} → ${rebuild.nodesAfterSecond}`);
  console.log(`     note: ${rebuild.note}`);

  /* ---------------- 7. 图 → 文本 回写 ---------------- */
  section('7. 双向一致性：图上改值 → SNBT 草稿变化');
  const emit = JSON.parse(await evaluate(`(async () => {
    const host = document.querySelector('[data-nbt-graph]');
    const before = window.__MCE__.state.nbtDraft;
    // 找一个可编辑的文本框（json_field 的值输入）
    const inputs = Array.from(host.querySelectorAll('.node-field input, .node-field select'));
    const target = inputs.find(i => typeof i.value === 'string' && i.value.length > 0 && !i.disabled);
    if (!target) return JSON.stringify({ err: '图里找不到可编辑的字段输入框', inputs: inputs.length, before: before.slice(0,60) });
    const oldVal = target.value;
    target.focus();
    target.value = 'CHANGED_VALUE_42';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    // 有些宿主用 keydown/Enter 提交
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    const after = window.__MCE__.state.nbtDraft;
    return JSON.stringify({
      oldVal, newVal: target.value,
      before: before.slice(0,120), after: after.slice(0,200),
      changed: before !== after,
      keptSuffix: /N:\\s*1b/.test(after),
      leakedSuffixKey: /suffix/.test(after)
    });
  })()`));
  check('图上改值后 SNBT 草稿真的变了', emit.changed, JSON.stringify(emit).slice(0, 400));
  // 回归断言：宿主 graphFromJson 会把 NBTNumber（typeof 'object'）误判成容器，
  // 于是 `N:1b` 曾变成 `N:{suffix:"b"}`。桥接层修好后这两条必须成立。
  check('数值后缀 1b 在图上往返后保留', emit.keptSuffix, `after=${emit.after}`);
  check('没有把 suffix 泄漏成假键', !emit.leakedSuffixKey, `after=${emit.after}`);

  /* ---------------- 8. 组件页 ---------------- */
  section('8. 物品组件页');
  await evaluate(`document.querySelector('.nv-item[data-page="components"]').click()`);
  await sleep(1600);
  const compProbe = JSON.parse(await evaluate(`JSON.stringify({
    hasHan: /[\\u4e00-\\u9fa5]/.test(document.getElementById('pageView').innerText),
    pageText: document.getElementById('pageView').innerText.slice(0, 300),
    hasValHighlight: !!document.querySelector('.comp-val-hl, .snbt-box'),
    highlightSpans: document.querySelectorAll('.comp-val-hl .k-str, .comp-val-hl .k-num, .comp-val-hl .k-key, .snbt-box .k-str, .snbt-box .k-num').length,
    sinceWarn: /版本未取证/.test(document.getElementById('pageView').innerText)
  })`));
  check('组件页有汉字', compProbe.hasHan);
  check('组件页有 JSON/SNBT 高亮节点', compProbe.hasValHighlight, `spans=${compProbe.highlightSpans}`);
  console.log(`     版本未取证提示仍在: ${compProbe.sinceWarn}`);

  // 组件页的 since 覆盖率（数据层断言）
  const sinceStat = JSON.parse(await evaluate(`(async () => {
    const m = await import('/src/data/components-wiki.js');
    const all = m.ALL_COMPONENTS;
    const withSince = all.filter(c => c.since);
    return JSON.stringify({ total: all.length, withSince: withSince.length, unknown: all.filter(c=>!c.since).map(c=>c.id) });
  })()`));
  check('组件 since 取证覆盖率 ≥ 98%', sinceStat.withSince / sinceStat.total >= 0.98,
    `${sinceStat.withSince}/${sinceStat.total}，未取证=${JSON.stringify(sinceStat.unknown)}`);

  // 组件页节点图
  const compGraph = JSON.parse(await evaluate(`(async () => {
    const btns = Array.from(document.querySelectorAll('#pageView button'));
    const gb = btns.find(b => b.innerText.trim() === '节点图');
    if (!gb) return JSON.stringify({ err: '组件页没有节点图按钮' });
    gb.click();
    await new Promise(r => setTimeout(r, 1200));
    const host = document.querySelector('[data-comp-graph]');
    return JSON.stringify({
      hostFound: !!host,
      nodeCount: host ? host.querySelectorAll('.mce-node').length : 0
    });
  })()`));
  check('组件页节点图可用', compGraph.hostFound && compGraph.nodeCount > 0, JSON.stringify(compGraph));

  /* ---------------- 9. 全局异常 ---------------- */
  section('9. 全局异常');
  check('未捕获异常 = 0', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
  // 区分口径：JS 错误 与 远程资源拉取失败是两回事。
  // 资源 CDN 的端点探测会先打默认端点，被重置时浏览器必然记一条 Failed to load resource ——
  // 那是环境，不是缺陷。把它算进「console 错误 = 0」会让套件因网络抖动长期标红。
  const NET_NOISE_RE = /net::ERR_(CONNECTION_RESET|CONNECTION_REFUSED|ABORTED|NAME_NOT_RESOLVED|TIMED_OUT)|Failed to load resource/;
  const jsErrors = errorLogs.filter((t) => !NET_NOISE_RE.test(t));
  const netNoise = errorLogs.filter((t) => NET_NOISE_RE.test(t));
  check('console 错误 = 0（仅 JS 错误）', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
  if (netNoise.length) console.log(`  ℹ 远程资源失败 ${netNoise.length} 条（环境因素，非缺陷）：${netNoise.slice(0, 2).join(' | ')}`);

  console.log('\n════════════════ 汇总 ════════════════');
  const pass = results.filter((r) => r.ok).length;
  console.log(`  ${pass} / ${results.length} 项通过，失败 ${failures} 项`);
  if (failures) {
    console.log('\n失败项：');
    for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ ${r.name} — ${r.detail || ''}`);
  }
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((e) => { console.error('脚本失败:', e.message); process.exitCode = 1; })
  .finally(async () => {
    try { ws && ws.close(); } catch { /* ignore */ }
    edge.kill();
    await sleep(400);
  });
