// cdp-command-graph.mjs —— 命令编辑器 / 命令方块 / 节点图 的真浏览器验收（零依赖 CDP）
//
// 用法: node tools/cdp-command-graph.mjs [baseUrl]
// 覆盖：
//   1) 命令页能打开、0 未捕获异常
//   2) 左侧分类栏能点、能按分类过滤、能搜索命令
//   3) 命令能多选并一次性加入画布
//   4) 拖线到空白处弹出只含兼容节点的菜单
//   5) 类型不兼容的两个端口连不上（直接对 graph 对象断言）
//   6) 数据端口不能 many-to-one，触发端口可以
//   7) Scratch 模式能切，且切换前后生成的是同一批命令（同一份数据）
//   8) 命令方块 2D 链渲染出节点
//   9) 框选 / Ctrl 多选 / Delete / 中键清线 / 滚轮缩放 / 右键菜单
//  10) 输出页「命令方块」编辑器（用户报障点）能打开、0 异常，并能从节点图取命令
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const base = process.argv[2] || 'http://127.0.0.1:8777/';
const SHOT_DIR = process.env.SHOT_DIR || 'D:\\ku\\traecode\\mccode\\.shots';
mkdirSync(SHOT_DIR, { recursive: true });
const PORT = 9500 + Math.floor(Math.random() * 300);
const profile = `${process.env.TEMP}\\edge-cmdgraph-${PORT}`;

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1680,1300',
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

let msgId = 0;
const pending = new Map();
const exceptions = [];
const errLogs = [];
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
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    errLogs.push(`console.${m.params.type}: ${String(args).slice(0, 400)}`);
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errLogs.push(`${m.params.entry.text} ${String(m.params.entry.url || '').split('/').pop()}`);
  }
  if (m.method === 'Network.loadingFailed') netFails.push(`${m.params.type} ${m.params.errorText}`);
};

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 45000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const msg = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'eval failed';
    throw new Error(`页面内表达式抛错：${String(msg).split('\n')[0]}  <<< ${expression.slice(0, 120)}`);
  }
  return r.result.value;
}

async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = `${SHOT_DIR}\\${name}.png`;
  writeFileSync(p, Buffer.from(s.data, 'base64'));
  return p;
}

/* ---------------- 真实鼠标事件（拖线、框选、中键都要真的走 Input 通道） ---------------- */

async function mouse(ev, x, y, button = 'left', buttons = 1) {
  await send('Input.dispatchMouseEvent', {
    type: ev, x: Math.round(x), y: Math.round(y), button, buttons,
    clickCount: ev === 'mouseMoved' ? 0 : 1,
  });
}

async function drag(x1, y1, x2, y2, { button = 'left', buttons = 1, steps = 10 } = {}) {
  await mouse('mousePressed', x1, y1, button, buttons);
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, button, buttons);
    await sleep(18);
  }
  await mouse('mouseReleased', x2, y2, button, buttons);
  await sleep(120);
}

/* ---------------- 断言 ---------------- */

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? '   → ' + String(detail).slice(0, 400) : ''}`);
}

/** 只打印、不计入通过率：用于别人正在改的页面（诊断信息，不是本次交付的验收项） */
function note(name, pass, detail = '') {
  console.log(`${pass ? '✓' : '✗'} [诊断] ${name}${detail ? '   → ' + String(detail).slice(0, 400) : ''}`);
}

/* ---------------- 页面内小工具 ---------------- */

const HELPERS = `
window.__T = {
  q: function (s) { return document.querySelector(s); },
  qa: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); },
  txt: function (s) { var e = this.q(s); return e ? e.innerText.replace(/\\s+/g, ' ') : null; },
  rows: function () { return this.qa('.mce-cmd-row').map(function (r) { return r.dataset.cmd; }); },
  clickTab: function (key) { var t = this.q('[data-mode-tab="' + key + '"]'); if (t) { t.click(); return true; } return false; },
  resetDemo: function () {
    var b = this.q('.graph-toolbar button[title="重置为示例图"]');
    if (!b) return false;
    b.click(); return true;
  },
  ctrlClick: function (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); },
  scrollGraph: function () {
    var g = this.q('.graph-wrap');
    if (g) g.scrollIntoView({ block: 'center' });
    return !!g;
  },
  portRect: function (nodeId, port, dir) {
    var sel = '.node-port.' + dir + '[data-node="' + nodeId + '"][data-port="' + port + '"]';
    var el = this.q(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, type: el.dataset.portType };
  },
  nodeRect: function (nodeId) {
    var el = this.q('.node[data-id="' + nodeId + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 10, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  },
  blankPoint: function () {
    var c = this.q('.graph-canvas');
    if (!c) return null;
    var r = c.getBoundingClientRect();
    var cands = [[0.5, 0.88], [0.78, 0.88], [0.2, 0.88], [0.5, 0.1], [0.88, 0.5]];
    for (var i = 0; i < cands.length; i++) {
      var x = r.left + r.width * cands[i][0], y = r.top + r.height * cands[i][1];
      var el = document.elementFromPoint(x, y);
      if (el && c.contains(el) && !el.closest('.node')) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  },
  g: function () { return window.__MCE__ && window.__MCE__.commandGraph ? window.__MCE__.commandGraph.graph : null; },
  cmds: function () { return window.__MCE__.commandGraph.commandsFromGraph().lines.map(function (l) { return l.cmd; }); },
  approxEq: function (a, b) { return JSON.stringify(a) === JSON.stringify(b); },
};
'ok'
`;

/* ---------------- 主流程 ---------------- */

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: base });
await sleep(12000);   // 等版本清单 + 能力矩阵就绪

const nav = await evaluate(`(function(){ var el = document.querySelector('.nv-item[data-page="commands"]'); if(!el) return 'NOT_FOUND'; el.click(); return 'ok'; })()`);
await sleep(2200);
await evaluate(HELPERS);

console.log('\n════════ 1. 命令页能打开、0 未捕获异常 ════════');
{
  const before = exceptions.length;
  const probe = await evaluate(`JSON.stringify({
    page: window.__MCE__.state.page,
    hasChainCard: !!document.querySelector('[data-mcb-card]'),
    mcbNodes: document.querySelectorAll('[data-mcb-node]').length,
    hasGraph: !!document.querySelector('.graph-wrap .graph-canvas'),
    nodes: document.querySelectorAll('.node').length,
    sidebarRows: document.querySelectorAll('.mce-cmd-row').length,
    cats: document.querySelectorAll('.mce-cat-item').length,
    modeTabs: document.querySelectorAll('[data-mode-tab]').length,
    errorCard: /渲染出错/.test(document.getElementById('pageView').innerText),
  })`);
  const p = JSON.parse(probe);
  check('命令页已激活', nav === 'ok' && p.page === 'commands', `nav=${nav} page=${p.page}`);
  check('命令方块 2D 链卡片存在（页面上方）', p.hasChainCard, `hasChainCard=${p.hasChainCard}`);
  check('节点图渲染出节点', p.hasGraph && p.nodes > 0, `canvas=${p.hasGraph} nodes=${p.nodes}`);
  check('左侧分类栏有分类项', p.cats >= 7, `cats=${p.cats}`);
  check('四种模式切换控件齐全', p.modeTabs === 4, `modeTabs=${p.modeTabs}`);
  check('没有「页面渲染出错」卡片', !p.errorCard);
  check('打开命令页期间 0 未捕获异常', exceptions.length === before, exceptions.slice(before).join(' | '));
  check('命令方块链渲染出方块（≥2）', p.mcbNodes >= 2, `mcbNodes=${p.mcbNodes}`);
  console.log('   截图：' + await shot('cmdgraph-1-commands'));
}

console.log('\n════════ 2. 分类栏能点、能过滤、能搜索 ════════');
{
  const allRows = await evaluate(`JSON.stringify(window.__T.rows())`);
  await evaluate(`window.__T.q('[data-cat-key="world"]').click()`);
  await sleep(700);
  const worldRows = JSON.parse(await evaluate(`JSON.stringify(window.__T.rows())`));
  const active = await evaluate(`window.__T.q('.mce-cat-item.is-active') ? window.__T.q('.mce-cat-item.is-active').dataset.catKey : null`);
  check('点「世界」分类后高亮切到 world', active === 'world', `active=${active}`);
  check('分类过滤生效：行数变化', worldRows.length > 0 && worldRows.length !== JSON.parse(allRows).length, `all=${JSON.parse(allRows).length} world=${worldRows.length}`);
  check('世界分类含 /time 与 /weather', worldRows.includes('time') && worldRows.includes('weather'), worldRows.slice(0, 12).join(','));
  check('世界分类不含 /give（give 作用域只有玩家）', !worldRows.includes('give'));

  // 搜索
  await evaluate(`(function(){ var i = document.querySelector('.mce-cmd-side input.tb'); i.value='天气'; i.dispatchEvent(new Event('input', {bubbles:true})); return 'ok'; })()`);
  await sleep(600);
  const hit = JSON.parse(await evaluate(`JSON.stringify(window.__T.rows())`));
  check('搜索「天气」命中 /weather', hit.includes('weather'), hit.join(','));
}

console.log('\n════════ 3. 命令能多选并一次性加入 ════════');
{
  await evaluate(`(function(){ var i = document.querySelector('.mce-cmd-side input.tb'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true})); return 'ok'; })()`);
  await sleep(300);
  await evaluate(`window.__T.q('[data-cat-key="all"]').click()`);
  await sleep(600);
  const before = await evaluate(`window.__T.g().nodes.size`);
  const multi = await evaluate(`(function(){
    var rows = window.__T.qa('.mce-cmd-row');
    var pick = rows.filter(function(r){ return ['kill','clear','fill'].indexOf(r.dataset.cmd) >= 0; });
    pick.forEach(function(r){ window.__T.ctrlClick(r); });
    return { picked: pick.length, sel: window.__T.qa('.mce-cmd-row.is-sel').length };
  })()`);
  check('Ctrl+单击可多选命令行', multi.sel === 3, `picked=${multi.picked} sel=${multi.sel}`);
  await evaluate(`window.__T.q('[data-add-selected]').click()`);
  await sleep(800);
  const after = await evaluate(`window.__T.g().nodes.size`);
  check('「加入选中的」一次加入 3 个节点', after - before === 3, `before=${before} after=${after}`);
}

console.log('\n════════ 4. 拖线到空白处弹出只含兼容节点的菜单 ════════');
{
  await evaluate(`window.__T.resetDemo()`);
  await sleep(500);
  await evaluate(`(function(){ var g = window.__T.g(); g.addNode('const_int', 40, 430); g.render(); return g.nodes.size; })()`);
  await sleep(300);
  await evaluate(`window.__T.scrollGraph()`);
  await sleep(400);
  const intNodeId = await evaluate(`(function(){ var it=null; window.__T.g().nodes.forEach(function(n){ if(n.type==='const_int') it=n.id; }); return it; })()`);
  const port = await evaluate(`JSON.stringify(window.__T.portRect(${JSON.stringify(intNodeId)}, '__out', 'out'))`);
  const blank = await evaluate(`JSON.stringify(window.__T.blankPoint())`);
  const pp = port ? JSON.parse(port) : null, bp = blank ? JSON.parse(blank) : null;
  check('找到 int 输出端口与画布空白点', !!pp && !!bp, `port=${port} blank=${blank}`);
  if (pp && bp) {
    await drag(pp.x, pp.y, bp.x, bp.y, { button: 'left', buttons: 1 });
    await sleep(400);
    const menu = JSON.parse(await evaluate(`(function(){
      var m = document.querySelector('[data-mce-portmenu]');
      if (!m) return JSON.stringify({ open:false });
      var items = Array.prototype.slice.call(m.querySelectorAll('.mce-pm-item[data-node-type]')).map(function(it){ return { type: it.dataset.nodeType, portType: it.dataset.portType }; });
      return JSON.stringify({ open:true, portType: m.dataset.portType, dir: m.dataset.dir, items: items });
    })()`));
    check('拖到空白处弹出了端口菜单', menu.open === true, `menu=${JSON.stringify(menu).slice(0, 200)}`);
    if (menu.open) {
      const expect = JSON.parse(await evaluate(`(function(){
        var c = window.__T.g().portCandidates('out','int').map(function(x){ return x.type + '|' + x.portType; }).sort();
        return JSON.stringify(c);
      })()`));
      const got = menu.items.map((i) => i.type + '|' + i.portType).sort();
      check('菜单项与 graph.portCandidates(int) 完全一致（只含兼容节点）', JSON.stringify(expect) === JSON.stringify(got), `expect=${expect.length} got=${got.length}`);
      const allOk = menu.items.every((i) => i.portType === 'int' || i.portType === 'float');
      check('菜单里每个节点的端口类型都与 int 兼容（int/float）', allOk, menu.items.filter((i) => !['int', 'float'].includes(i.portType)).map((i) => i.portType).join(',') || 'all ok');
      check('菜单里没有 string / trigger / object 端口节点', !menu.items.some((i) => ['string', 'trigger', 'object', 'bool'].includes(i.portType)));
      console.log('   截图：' + await shot('cmdgraph-2-portmenu'));
      // 选中一项：应自动创建节点并连线
      const beforeNodes = await evaluate(`window.__T.g().nodes.size`);
      await evaluate(`(function(){ var it = document.querySelector('.mce-pm-item[data-node-type]'); it.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true})); return true; })()`);
      await sleep(500);
      const afterNodes = await evaluate(`window.__T.g().nodes.size`);
      const menuGone = await evaluate(`!document.querySelector('[data-mce-portmenu]')`);
      check('选菜单项后自动创建节点并连线', afterNodes - beforeNodes === 1 && menuGone, `nodes ${beforeNodes}→${afterNodes} menuClosed=${menuGone}`);
    }
  }
}

console.log('\n════════ 5. 类型不兼容连不上 / 兼容的能连上 ════════');
{
  await evaluate(`window.__T.resetDemo()`);
  await sleep(400);
  const r = JSON.parse(await evaluate(`(function(){
    var g = window.__T.g();
    var id = function (t) { var out = null; g.nodes.forEach(function (n) { if (n.type === t && !out) out = n.id; }); return out; };
    var give = id('give'), summon = id('summon');
    var intNode = g.addNode('const_int', 40, 430).id;
    var floatNode = g.addNode('const_number', 40, 520).id;
    return JSON.stringify({ give: give, summon: summon, intNode: intNode, floatNode: floatNode, particle: id('particle') });
  })()`));
  const res = JSON.parse(await evaluate(`(function(){
    var g = window.__T.g();
    var o = {};
    o.intToInt = g.link(${JSON.stringify(r.intNode)}, '__out', ${JSON.stringify(r.give)}, 'count');          // int → int ✅
    o.floatToInt = g.link(${JSON.stringify(r.floatNode)}, '__out', ${JSON.stringify(r.give)}, 'count');      // float → int ❌
    o.floatErr = g.lastLinkError;
    o.intToStr = g.link(${JSON.stringify(r.intNode)}, '__out', ${JSON.stringify(r.give)}, 'targets');         // int → string ❌
    o.intToStrErr = g.lastLinkError;
    o.triggerToStr = g.link(${JSON.stringify(r.give)}, '__out', ${JSON.stringify(r.summon)}, 'pos');          // trigger → string ❌
    o.triggerToStrErr = g.lastLinkError;
    o.intToFloat = g.link(${JSON.stringify(r.intNode)}, '__out', ${JSON.stringify(r.floatNode)}, 'value');    // int → float ✅（数值放宽）
    o.linksFromIntToTargets = g.links.filter(function (l) { return l.from.node === ${JSON.stringify(r.intNode)} && l.to.node === ${JSON.stringify(r.give)} && l.to.port === 'targets'; }).length;
    return JSON.stringify(o);
  })()`));
  check('int → int 可以连', res.intToInt === true);
  check('float → int 连不上并给出原因', res.floatToInt === false && /数据类型不同/.test(res.floatErr || ''), res.floatErr);
  check('int → string 连不上', res.intToStr === false && /数据类型不同/.test(res.intToStrErr || ''), res.intToStrErr);
  check('触发 → 数据 连不上', res.triggerToStr === false && /触发端口不能接到数据端口/.test(res.triggerToStrErr || ''), res.triggerToStrErr);
  check('int → float 可以连（唯一数值放宽）', res.intToFloat === true);
  check('被拒绝的连线没有落进 links', res.linksFromIntToTargets === 0, `links int→targets=${res.linksFromIntToTargets}`);
}

console.log('\n════════ 6. 数据端口不能 many-to-one，触发端口可以 ════════');
{
  const res = JSON.parse(await evaluate(`(function(){
    var g = window.__T.g();
    var id = function (t) { var out = null; g.nodes.forEach(function (n) { if (n.type === t && !out) out = n.id; }); return out; };
    var give = id('give');
    var a = g.addNode('const_text', 40, 620), b = g.addNode('const_text', 40, 700);
    a.values.text = 'AAA'; b.values.text = 'BBB';
    g.link(a.id, '__out', give, 'item');
    g.link(b.id, '__out', give, 'item');
    var toItem = g.links.filter(function (l) { return l.to.node === give && l.to.port === 'item'; });
    // 用一个全新的 particle 节点当靶子，避免示例图里已有的触发线干扰计数
    var fresh = g.addNode('particle', 900, 700).id;
    var e1 = g.addNode('event_tick', 40, 20).id, e2 = g.addNode('event_redstone', 40, 90).id;
    g.link(e1, '__out', fresh, 'trigger');
    g.link(e2, '__out', fresh, 'trigger');
    var toTrig = g.links.filter(function (l) { return l.to.node === fresh && l.to.port === 'trigger'; });
    var cmds = window.__T.cmds();
    return JSON.stringify({
      itemLines: toItem.length, itemFrom: toItem.map(function (l) { return g.nodes.get(l.from.node).values.text; }),
      trigLines: toTrig.length, cmds: cmds,
    });
  })()`));
  check('数据输入端只有 1 条线（新线顶替旧线）', res.itemLines === 1, `lines=${res.itemLines} from=${res.itemFrom.join(',')}`);
  check('数据输入端保留的是最后连上的那条', res.itemFrom[0] === 'BBB', res.itemFrom.join(','));
  check('触发输入端可以有 2 条线（many-to-one ✅）', res.trigLines === 2, `lines=${res.trigLines}`);
  check('触发多连后命令仍能正常生成', res.cmds.length >= 3, `cmds=${res.cmds.length}`);
}

console.log('\n════════ 7. Scratch 模式能切，且前后是同一份数据 ════════');
{
  await evaluate(`window.__T.resetDemo()`);
  await sleep(500);
  const before = JSON.parse(await evaluate(`JSON.stringify(window.__T.cmds())`));
  const beforeJson = await evaluate(`JSON.stringify(window.__T.g().toJSON().nodes.map(function(n){return [n.id,n.type,n.values];}))`);
  const sw = await evaluate(`window.__T.clickTab('scratch')`);
  await sleep(1200);
  const scratch = JSON.parse(await evaluate(`(function(){
    var blocks = window.__T.qa('[data-scratch-block]');
    return JSON.stringify({
      switched: !!document.querySelector('.mce-scratch-stage'),
      blocks: blocks.length,
      previews: blocks.map(function(b){ var p = b.querySelector('.mce-blk-preview'); return p ? p.textContent : null; }),
      selects: window.__T.qa('.mce-blk select[data-arg-input]').length,
      args: window.__T.qa('.mce-blk [data-arg-input]').length,
      dropzone: !!document.querySelector('[data-scratch-dropzone]'),
      scriptNodes: window.__MCE__.commandGraph.scriptNodes().length,
      errorCard: /渲染出错/.test(document.getElementById('pageView').innerText),
    });
  })()`));
  const after = JSON.parse(await evaluate(`JSON.stringify(window.__T.cmds())`));
  check('切到 Scratch 模式渲染出积木块', sw === true && scratch.switched && scratch.blocks >= 3, `blocks=${scratch.blocks}`);
  check('Scratch 块数 == graph.scriptNodes() 数', scratch.blocks === scratch.scriptNodes, `blocks=${scratch.blocks} scriptNodes=${scratch.scriptNodes}`);
  check('切换前后生成的命令完全一致（同一份数据）', JSON.stringify(before) === JSON.stringify(after), `before=${before.length} after=${after.length}`);
  check('Scratch 每块预览 == 节点图生成的命令', scratch.blocks === before.length && scratch.previews.every((p, i) => p === '/' + before[i]), JSON.stringify(scratch.previews).slice(0, 200));
  check('块上有可点的参数控件（下拉/输入）', scratch.args >= 5, `args=${scratch.args}`);
  check('有「追加到脚本末尾」的投放区', scratch.dropzone === true);
  check('Scratch 渲染 0 报错', !scratch.errorCard);
  console.log('   截图：' + await shot('cmdgraph-3-scratch'));

  // 下拉参数必须真的能改（功能验证，不是数数）
  const dd = JSON.parse(await evaluate(`(function(){
    var blocks = window.__T.qa('[data-scratch-block]');
    var g = window.__T.g();
    var sb = window.__T.q('[data-scratch-pal="setblock"]');
    if (!sb) return JSON.stringify({ ok:false, why:'no setblock palette' });
    sb.click();
    var list = window.__T.qa('[data-scratch-block]');
    var last = list[list.length - 1];
    var node = g.nodes.get(last.dataset.scratchBlock);
    var sel = last.querySelector('select[data-arg-input="mode"]');
    if (!sel) return JSON.stringify({ ok:false, why:'no mode select', args: Array.prototype.slice.call(last.querySelectorAll('[data-arg-input]')).map(function(e){return e.dataset.argInput;}) });
    sel.value = 'destroy';
    sel.dispatchEvent(new Event('change', { bubbles:true }));
    return JSON.stringify({ ok:true, nodeType: node.type, value: node.values.mode, preview: last.querySelector('.mce-blk-preview').textContent });
  })()`));
  check('Scratch 块上的下拉参数可点且写进节点', dd.ok && dd.value === 'destroy', JSON.stringify(dd).slice(0, 220));
  check('改下拉后命令预览同步变化', dd.ok && /destroy/.test(dd.preview || ''), dd.preview);
  const edit = JSON.parse(await evaluate(`(function(){
    var blocks = window.__T.qa('[data-scratch-block]');
    var giveBlock = null;
    blocks.forEach(function(b){ if (window.__T.g().nodes.get(b.dataset.scratchBlock).type === 'give') giveBlock = b; });
    if (!giveBlock) return JSON.stringify({ ok:false });
    var inp = giveBlock.querySelector('input[data-arg-input="count"]');
    if (!inp) return JSON.stringify({ ok:false, why:'no count input' });
    inp.value = '5';
    inp.dispatchEvent(new Event('input', { bubbles:true }));
    var node = window.__T.g().nodes.get(giveBlock.dataset.scratchBlock);
    return JSON.stringify({ ok:true, nodeValue: node.values.count, preview: giveBlock.querySelector('.mce-blk-preview').textContent, id: node.id });
  })()`));
  check('Scratch 里改参数写进了同一个节点对象', edit.ok && String(edit.nodeValue) === '5', JSON.stringify(edit).slice(0, 200));

  // 追加一个命令块（拖放的真实路径：点击命令块面板 = 同一段 appendBlock 逻辑）
  const appended = JSON.parse(await evaluate(`(function(){
    var beforeNodes = window.__T.g().nodes.size;
    var beforeSeq = window.__MCE__.commandGraph.scriptNodes().length;
    var sb = window.__T.q('[data-scratch-pal="particle"]');
    if (!sb) return JSON.stringify({ ok:false });
    sb.click();
    var afterNodes = window.__T.g().nodes.size;
    var list = window.__MCE__.commandGraph.scriptNodes();
    var last = list[list.length - 1];
    var linked = window.__T.g().links.some(function(l){ return l.to.node === last.id && l.to.port === 'trigger'; });
    return JSON.stringify({ ok:true, added: afterNodes - beforeNodes, seq: list.length, beforeSeq: beforeSeq, lastType: last.type, triggerLinked: linked });
  })()`));
  check('追加命令块进脚本末尾', appended.ok && appended.added === 1 && appended.seq === appended.beforeSeq + 1, JSON.stringify(appended));
  check('追加的块自动接上「触发」链（节点图里能看到同一条链）', appended.triggerLinked === true, `lastType=${appended.lastType} linked=${appended.triggerLinked}`);

  // 切回节点图：数据必须一致，且节点输入框显示 Scratch 里改的值
  await evaluate(`window.__T.clickTab('graph')`);
  await sleep(1000);
  const back = JSON.parse(await evaluate(`(function(){
    var g = window.__T.g();
    var giveNode = null;
    g.nodes.forEach(function(n){ if (n.type === 'give') giveNode = n; });
    var input = document.querySelector('.node[data-id="' + giveNode.id + '"] input[type=number]');
    return JSON.stringify({
      countValue: giveNode.values.count,
      inputShown: input ? input.value : null,
      cmds: window.__T.cmds(),
      errorCard: /渲染出错/.test(document.getElementById('pageView').innerText),
    });
  })()`));
  check('切回节点图后数据未丢（count 仍是 Scratch 里改的 5）', String(back.countValue) === '5', `count=${back.countValue} inputShown=${back.inputShown}`);
  check('节点图的输入框显示的是 Scratch 里改的值', back.inputShown === '5', `inputShown=${back.inputShown}`);
  check('切回节点图后命令包含新参数与新追加的 particle', back.cmds.some((c) => /count| 5/.test(c)) && back.cmds.some((c) => c.startsWith('particle')), back.cmds.join(' || ').slice(0, 260));
  check('来回切换 0 报错', !back.errorCard);
  void beforeJson;
}

console.log('\n════════ 8. 框选 / 中键清线 / Delete / 右键菜单 / 滚轮 ════════');
{
  await evaluate(`window.__T.resetDemo()`);
  await sleep(500);
  await evaluate(`window.__T.scrollGraph()`);
  await sleep(300);
  const g1 = JSON.parse(await evaluate(`JSON.stringify(window.__T.g().nodes.size)`));
  const canvasRect = JSON.parse(await evaluate(`(function(){ var r = window.__T.q('.graph-canvas').getBoundingClientRect(); return JSON.stringify({left:r.left,top:r.top,width:r.width,height:r.height}); })()`));
  // 框选整个画布（从左上到右下）
  await drag(canvasRect.left + 6, canvasRect.top + 6, canvasRect.left + canvasRect.width - 6, canvasRect.top + canvasRect.height - 6, { steps: 12 });
  await sleep(300);
  const selCount = await evaluate(`document.querySelectorAll('.node.is-sel').length`);
  check('空白处左键拖拽 = 框选多个节点', selCount >= 4, `selected=${selCount} of ${g1}`);

  // 中键点击某个节点 → 清空该节点所有连线
  const mid = JSON.parse(await evaluate(`(function(){
    var g = window.__T.g();
    var give = null;
    g.nodes.forEach(function(n){ if (n.type === 'give') give = n; });
    var before = g.links.filter(function(l){ return l.from.node === give.id || l.to.node === give.id; }).length;
    var r = window.__T.nodeRect(give.id);
    return JSON.stringify({ id: give.id, before: before, rect: r });
  })()`));
  await mouse('mousePressed', mid.rect.x, mid.rect.y, 'middle', 4);
  await mouse('mouseReleased', mid.rect.x, mid.rect.y, 'middle', 4);
  await sleep(400);
  const afterMid = await evaluate(`(function(){ var g = window.__T.g(); return g.links.filter(function(l){ return l.from.node === ${JSON.stringify(mid.id)} || l.to.node === ${JSON.stringify(mid.id)}; }).length; })()`);
  check('中键点击节点 = 清空该节点所有连线', mid.before > 0 && afterMid === 0, `${mid.before} → ${afterMid}`);

  // Delete 删除选中
  await evaluate(`window.__T.resetDemo()`);
  await sleep(400);
  await evaluate(`(function(){ var g = window.__T.g(); g.selected = new Set([g.nodes.keys().next().value]); g._select(); return 1; })()`);
  const beforeDel = await evaluate(`window.__T.g().nodes.size`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 46, key: 'Delete', code: 'Delete' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 46, key: 'Delete', code: 'Delete' });
  await sleep(400);
  const afterDel = await evaluate(`window.__T.g().nodes.size`);
  check('Delete 删除选中节点（含其连线）', afterDel === beforeDel - 1, `${beforeDel} → ${afterDel}`);

  // 右键空白 = 创建菜单
  const bp = JSON.parse(await evaluate(`JSON.stringify(window.__T.blankPoint())`));
  await mouse('mousePressed', bp.x, bp.y, 'right', 2);
  await mouse('mouseReleased', bp.x, bp.y, 'right', 2);
  await sleep(400);
  const blankMenu = await evaluate(`document.querySelectorAll('[data-mce-blankmenu] .mce-pm-item').length`);
  check('右键空白 = 创建/粘贴菜单', blankMenu > 3, `items=${blankMenu}`);
  await evaluate(`window.__T.g().closeMenus()`);

  // 滚轮缩放
  const z1 = await evaluate(`window.__T.g().zoom`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bp.x, y: bp.y, deltaX: 0, deltaY: -240 });
  await sleep(300);
  const z2 = await evaluate(`window.__T.g().zoom`);
  check('滚轮 = 缩放（不需要 Ctrl）', z2 > z1, `zoom ${z1} → ${z2}`);
}

console.log('\n════════ 9. 命令方块 2D 链的内容断言 ════════');
{
  await evaluate(`window.__T.resetDemo()`);
  await sleep(600);
  const chain = JSON.parse(await evaluate(`(function(){
    var nodes = window.__T.qa('[data-mcb-node]');
    return JSON.stringify({
      n: nodes.length,
      kinds: nodes.map(function(b){ return b.dataset.blockKind; }),
      cmds: nodes.map(function(b){ return b.dataset.cmd; }),
      advice: window.__T.txt('.mce-mcb-rec'),
      axis: !!document.querySelector('.mce-mcb-axis'),
    });
  })()`));
  check('2D 链渲染出 ≥3 个命令方块', chain.n >= 3, `n=${chain.n}`);
  check('首块是脉冲/循环，后续都是连锁', chain.kinds[0] !== 'chain' && chain.kinds.slice(1).every((k) => k === 'chain'), chain.kinds.join(','));
  check('链上写着真实命令', chain.cmds.every((c) => c.length > 3), JSON.stringify(chain.cmds).slice(0, 160));
  check('「适合放在哪种命令方块上」给出了结论与依据', /命令方块可用|命令方块不可用/.test(chain.advice || '') && /wiki/.test(chain.advice || ''), (chain.advice || '').slice(0, 220));
  check('2D 平面有执行顺序轴', chain.axis === true);
  console.log('   截图：' + await shot('cmdgraph-4-chain'));
}

console.log('\n════════ 10. 输出页「命令方块」编辑器（用户报障点） ════════');
{
  const before = exceptions.length;
  const beforeLogs = errLogs.length;
  await evaluate(`document.querySelector('.nv-item[data-page="output"]').click()`);
  await sleep(1500);
  const tabs = await evaluate(`(function(){ var t = window.__T.qa('#pageView .tab'); for (var i=0;i<t.length;i++){ if (t[i].textContent.indexOf('命令方块')>=0){ t[i].click(); return 'clicked'; } } return 'NOT_FOUND'; })()`);
  await sleep(1800);
  const probe = JSON.parse(await evaluate(`(function(){
    var v = document.getElementById('pageView');
    return JSON.stringify({
      errorCard: /渲染出错/.test(v.innerText),
      text: v.innerText.replace(/\\s+/g,' ').slice(0, 400),
      cards: v.querySelectorAll('.card').length,
    });
  })()`));
  const clickRes = await evaluate(`(function(){ var b = window.__T.qa('#pageView button'); for (var i=0;i<b.length;i++){ if (b[i].textContent.indexOf('从节点图取命令')>=0){ b[i].click(); return 'clicked'; } } return 'NOT_FOUND'; })()`);
  await sleep(1500);
  const draft = await evaluate(`(function(){ var ta = document.querySelector('#pageView textarea'); return ta ? ta.value.split('\\n').length : -1; })()`);
  check('输出页「命令方块」标签能点开', tabs === 'clicked', `tabs=${tabs}`);
  check('命令方块编辑器没有渲染出错卡片', !probe.errorCard, probe.text.slice(0, 160));
  check('命令方块编辑器渲染出内容卡片', probe.cards >= 2, `cards=${probe.cards}`);
  check('命令方块编辑器期间 0 未捕获异常', exceptions.length === before, exceptions.slice(before).join(' | '));
  // 区分口径：远程资源拉取失败是环境，不是 JS 缺陷（CDN 端点探测会先打默认端点）。
  const NET_NOISE_RE = /net::ERR_(CONNECTION_RESET|CONNECTION_REFUSED|ABORTED|NAME_NOT_RESOLVED|TIMED_OUT)|Failed to load resource/;
  const newErrs = errLogs.slice(beforeLogs);
  const newJsErrs = newErrs.filter((t) => !NET_NOISE_RE.test(t));
  check('命令方块编辑器期间 0 console 错误（仅 JS 错误）', newJsErrs.length === 0, newJsErrs.join(' | '));
  const newNet = newErrs.filter((t) => NET_NOISE_RE.test(t));
  if (newNet.length) console.log(`  ℹ 该阶段远程资源失败 ${newNet.length} 条（环境因素，非缺陷）`);
  check('「从节点图取命令」可用并取回多行', clickRes === 'clicked' && draft >= 2, `click=${clickRes} lines=${draft}`);

  // 用户报障「命令方块编辑器出错」的取证：把预览里的原始字符与下方纯文本链逐字对比
  const raw = JSON.parse(await evaluate(`(function(){
    var codes = window.__T.qa('#pageView .code');
    return JSON.stringify(codes.map(function(c){ return c.textContent; }));
  })()`));
  const setblockLine = raw.find((s) => s.startsWith('setblock')) || '';
  const giveLine = raw.find((s) => s.startsWith('give @s')) || '';
  const chainLines = raw.filter((s) => s.startsWith('setblock') && /Command:/.test(s));
  check('setblock 预览保留了 SNBT 转义 \\" （与 /give 行一致）', setblockLine.includes('\\"') , `setblock=${setblockLine.slice(0, 130)}`);
  check('setblock 与链式渲染对同一条命令给出相同转义', chainLines.length > 0 && chainLines.every((l) => l.includes('\\"')), `chain=${(chainLines[0] || '').slice(0, 130)}`);
  check('give 物品形式用的是 block_entity_data 组件（1.20.5+）', /block_entity_data=/.test(giveLine), giveLine.slice(0, 140));
  console.log('   setblock 原文：' + setblockLine.slice(0, 200));
  console.log('   give 原文    ：' + giveLine.slice(0, 200));
  console.log('   截图：' + await shot('cmdgraph-5-output-commandblock'));
}

console.log('\n════════ 11. 可复用节点图宿主 + JSON 适配器（别的编辑器直接消费） ════════');
{
  const before = exceptions.length;
  const r = JSON.parse(await evaluate(`(async function(){
    var ng = await import('/src/graph/nodegraph.js');
    var jg = await import('/src/graph/json-graph.js');
    var gt = await import('/src/graph/graph-theme.js');
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:560px;z-index:0;';
    document.body.appendChild(host);
    var nbt = { NoAI: true, CustomName: '{"text":"pig"}', Health: 20.5, Tags: ['a','b'], Nested: { x: 1 }, Nothing: null };
    var data = jg.jsonToGraphData(nbt);
    var emitted = 0;
    var graph = ng.createGraph(host, {
      types: jg.jsonGraphTypes(), ports: jg.jsonGraphPorts(),
      nodes: data.nodes, links: data.links, sequence: [],
      onEmit: function () { emitted++; },
    });
    graph.render();
    var round = jg.graphToJson(graph);
    var domNodes = host.querySelectorAll('.node').length;
    var ports = host.querySelectorAll('.node-port.in').length;
    var colored = {};
    host.querySelectorAll('.node-port.in').forEach(function (p) { colored[p.dataset.portType] = (colored[p.dataset.portType] || 0) + 1; });
    // 动态端口：给一个 json_field 换掉它的端口声明，图上应该跟着变
    var field = null;
    graph.nodes.forEach(function (n) { if (n.type === 'json_field' && !field) field = n; });
    field.fields = [{ key: 'value', label: '值', port: true, portType: 'int', type: 'text' }];
    graph.render();
    var dyn = host.querySelector('.node[data-id="' + field.id + '"] .node-port.in');
    var dynType = dyn ? dyn.dataset.portType : null;
    var api = ['createGraph','NodeGraph','outPortsOf','fieldsOf','VALUE_NODE_TYPES','OUT_PORT'].filter(function (k) { return !!ng[k]; });
    // 数据往返：round === nbt
    var same = JSON.stringify(round) === JSON.stringify(nbt);
    host.remove();
    return JSON.stringify({ same: same, round: round, domNodes: domNodes, inPorts: ports, colored: colored, dynType: dynType, api: api, emitted: emitted, jsgApi: Object.keys(jg) });
  })()`));
  check('createGraph(host,{nodes,ports,onEmit}) 能直接建图并渲染', r.domNodes >= 10, `nodes=${r.domNodes} inPorts=${r.inPorts}`);
  check('JSON → 图 → JSON 往返完全一致', r.same === true, JSON.stringify(r.round).slice(0, 200));
  check('端口按真实类型着色（bool/int/float/string/nullable）', Object.keys(r.colored).length >= 4, JSON.stringify(r.colored));
  check('动态端口（node.fields）生效', r.dynType === 'int', `dynType=${r.dynType}`);
  check('宿主导出齐全', r.api.length === 6 && r.jsgApi.includes('jsonToGraphData') && r.jsgApi.includes('graphToJson') && r.jsgApi.includes('createJsonGraph'), `${r.api.join(',')} | ${r.jsgApi.join(',')}`);
  check('宿主建图期间 0 未捕获异常', exceptions.length === before, exceptions.slice(before).join(' | '));
}

console.log('\n════════ 12. 其他编辑器页面的渲染自检（报障定位用） ════════');
{
  for (const page of ['blocks', 'nbt', 'components', 'pickers', 'output']) {
    await evaluate(`(function(){ var el = document.querySelector('.nv-item[data-page="${page}"]'); if (el) el.click(); return 1; })()`);
    await sleep(1400);
    const p = JSON.parse(await evaluate(`(function(){
      var v = document.getElementById('pageView');
      var t = v.innerText;
      var m = t.match(/这个页面渲染出错了[\\s\\S]{0,260}/);
      return JSON.stringify({ title: (document.querySelector('.page-title')||{}).textContent || '', err: m ? m[0].replace(/\\s+/g,' ') : null, cards: v.querySelectorAll('.card').length });
    })()`));
    note(`${page} 页渲染正常（无错误卡片）`, !p.err, p.err ? p.err.slice(0, 240) : `cards=${p.cards}`);
  }
}

/* ---------------- 汇总 ---------------- */
console.log('\n════════════════════ 汇总 ════════════════════');
const pass = results.filter((r) => r.pass).length;
console.log(`  通过 ${pass} / ${results.length}`);
for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ ${r.name}  → ${r.detail}`);
console.log(`\n未捕获异常 (${exceptions.length})`);
exceptions.slice(0, 10).forEach((e) => console.log('  ' + e));
console.log(`console 错误/警告 (${errLogs.length})`);
[...new Set(errLogs)].slice(0, 10).forEach((e) => console.log('  ' + e));
console.log(`网络失败 (${netFails.length})`);
[...new Set(netFails)].slice(0, 10).forEach((e) => console.log('  ' + e));

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(pass === results.length ? 0 : 1);
