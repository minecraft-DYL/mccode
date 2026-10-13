// cdp-interact.mjs —— 真实交互端到端测试：点导航、填输入框、点按钮，然后断言界面真的变了。
// 巡测(cdp-tour)只证明「能渲染」；本脚本证明「功能可用」。
// 用法: node tools/cdp-interact.mjs [baseUrl]
import { spawn } from 'node:child_process';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const base = process.argv[2] || 'http://127.0.0.1:8777/';
const PORT = 9800 + Math.floor(Math.random() * 190);
const profile = `${process.env.TEMP}\\edge-ix-${PORT}`;

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
    exceptions.push(`${(d.exception && (d.exception.description || d.exception.value)) || d.text}`);
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

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
};

// 页面内通用工具：按文本找元素 / 给受控输入框赋值（触发框架的 input 监听）
const HELPERS = `
window.__T = {
  byText: (txt, sel) => Array.from(document.querySelectorAll(sel || 'button,a,div,span,label'))
    .filter(e => (e.innerText || '').trim() === txt)
    .pop() || null,
  byTextIncl: (txt, sel) => Array.from(document.querySelectorAll(sel || 'button'))
    .find(e => (e.innerText || '').includes(txt)) || null,
  setVal: (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  view: () => document.querySelector('#pageView'),
  txt: () => document.querySelector('#pageView').innerText,
  areas: () => Array.from(document.querySelectorAll('#pageView textarea, #pageView input[type=text]')),
};
'ok'
`;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail: String(detail ?? '').slice(0, 240) });
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: base });
await sleep(12000);
await ev(HELPERS);

const goto = async (p, ms = 1600) => { await ev(`window.__MCE__.goto('${p}')`); await sleep(ms); await ev(HELPERS); };

// 真实鼠标事件（CDP 视口坐标，与 getBoundingClientRect 同坐标系）
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left',
  buttons: type === 'mouseReleased' ? 0 : 1,
  clickCount: 1,
});

/** 取元素中心点（视口坐标） */
const centerOf = (sel, filterExpr = 'true') => ev(`(() => {
  const el = Array.from(document.querySelectorAll('${sel}')).find(e => (${filterExpr}));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), node: el.dataset.node || null, port: el.dataset.port || null };
})()`);

/* ─────────── 场景 1：NBT 编辑器实时校验（合法 + 非法） ─────────── */
await goto('nbt');
{
  const r = await ev(`(() => {
    const ta = document.querySelector('#pageView textarea');
    if (!ta) return { err: '找不到 SNBT 输入框' };
    __T.setVal(ta, '{CustomName:\\'{"text":"神剑"}\\',Unbreakable:1b,Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}');
    return { ok: true };
  })()`);
  await sleep(700);
  const good = await ev(`(() => { const t = __T.txt(); return t.includes('语法正确') ? t.match(/语法正确[^\\n]{0,40}/)[0] : ('未检出：' + t.slice(0, 120)); })()`);
  check('S1a NBT 合法 SNBT 通过校验', /语法正确/.test(String(good)), good);

  await ev(`(() => { const ta = document.querySelector('#pageView textarea'); __T.setVal(ta, '{a:}'); return 1; })()`);
  await sleep(700);
  const bad = await ev(`(() => { const t = __T.txt(); return /错误|失败|期待|非法|不合法/.test(t) ? t.match(/[^\\n]{0,60}(错误|失败|期待|非法|不合法)[^\\n]{0,40}/)[0] : ''; })()`);
  check('S1b NBT 非法 SNBT 被拦下', String(bad).length > 0, bad || '未检出错误提示');

  // 复原，避免污染后续
  await ev(`(() => { const ta = document.querySelector('#pageView textarea'); __T.setVal(ta, '{CustomName:\\'{"text":"hi"}\\'}'); return 1; })()`);
  await sleep(300);
}

/* ─────────── 场景 2：命令文本校验 ─────────── */
await goto('commands');
{
  // 切到「文本编辑」标签
  const tabbed = await ev(`(() => { const t = __T.byTextIncl('文本编辑'); if (!t) return 'no-tab'; t.click(); return 'ok'; })()`);
  await sleep(900);
  const inTa = await ev(`(() => { const ta = document.querySelector('#pageView textarea'); if (!ta) return 'no-textarea'; __T.setVal(ta, '/give @s minecraft:diamond_sword[custom_name="测试"]'); return 'ok'; })()`);
  await sleep(700);
  const okTxt = await ev(`(() => { const t = __T.txt(); return t.replace(/\\s+/g,' ').slice(0, 200); })()`);
  const passCmd = /通过|可用|正确|没有发现/.test(String(okTxt)) && !/尚不存在|不存在/.test(String(okTxt));
  check('S2a /give 组件语法在 26.3 通过校验', passCmd, `tab=${tabbed} input=${inTa} :: ${okTxt}`);

  await ev(`(() => { const ta = document.querySelector('#pageView textarea'); __T.setVal(ta, '/definitelynotacommand 1'); return 1; })()`);
  await sleep(700);
  const warn = await ev(`(() => __T.txt().replace(/\\s+/g,' ').slice(0,200))()`);
  check('S2b 未知命令给出提示', /未知|不存在|无法识别|警告|不是/.test(String(warn)), warn);
}

/* ─────────── 场景 3：节点图 → 生成命令 ─────────── */
await goto('commands');
{
  // S2 把标签切到了「文本编辑」，这里切回「节点图」（hash 相同不会触发重渲染）
  await ev(`(() => { const t = __T.byTextIncl('节点图'); if (t) t.click(); return 1; })()`);
  await sleep(1000);
  const r = await ev(`(() => {
    const v = __T.view();
    const nodes = v.querySelectorAll('.node').length;
    const codeBlocks = Array.from(v.querySelectorAll('.code')).map(e => e.innerText.trim()).filter(Boolean);
    const cmds = codeBlocks.join('\\n');
    return { nodes, hasGive: /give|setblock|summon|particle|execute/.test(cmds), sample: cmds.slice(0, 180) };
  })()`);
  check('S3a 节点图自动生成默认命令', r.nodes >= 1 && r.hasGive, `节点=${r.nodes} 命令片段=${r.sample}`);
}

/* ─────────── 场景 4：物品组件 → /give 预览 ─────────── */
await goto('components');
{
  const r = await ev(`(() => {
    const t = __T.txt().replace(/\\s+/g,' ');
    const m = t.match(/\\/give[^\\n]{0,160}/) || t.match(/give [^\\n]{0,160}/);
    return { found: !!m, cmd: m ? m[0] : '', head: t.slice(0, 160) };
  })()`);
  check('S4a 组件页生成 /give 预览', r.found, r.cmd || r.head);
  check('S4b 26.3 用组件语法（方括号）', /\[/.test(r.cmd), r.cmd);

  // 从组件目录挑一个组件加进去，看命令是否变化
  const add = await ev(`(() => {
    const before = (__T.txt().match(/\\/give[^\\n]{0,200}/)||[''])[0];
    const cat = __T.byTextIncl('从组件目录选择') || __T.byTextIncl('组件目录');
    if (cat) { cat.click(); return { clicked: true, before }; }
    return { clicked: false, before };
  })()`);
  await sleep(800);
  const after = await ev(`(() => {
    const t = __T.txt().replace(/\\s+/g,' ');
    const m = t.match(/\\/give[^\\n]{0,200}/);
    return { cmd: m ? m[0] : '' };
  })()`);
  check('S4c 打开组件目录不报错', !after.cmd.includes('Error') && after.cmd.length > 0, `clicked=${add.clicked} cmd=${after.cmd}`);
}

/* ─────────── 场景 5：输出通道 —— 从节点图取命令 ─────────── */
await goto('output');
{
  const r = await ev(`(() => {
    const btn = __T.byTextIncl('从节点图取命令');
    if (!btn) return { err: '找不到按钮' };
    btn.click();
    return { clicked: true };
  })()`);
  await sleep(900);
  const src = await ev(`(() => {
    const ta = document.querySelector('#pageView textarea');
    return ta ? ta.value : '';
  })()`);
  check('S5a 「从节点图取命令」填充命令源', String(src).trim().length > 0, `clicked=${r.clicked} 源=${String(src).slice(0, 120)}`);
  check('S5b 取到的是真命令', /give|setblock|summon|particle|execute|tellraw/.test(String(src)), String(src).slice(0, 140));
}

/* ─────────── 场景 6：版本前置 —— 换版本必须换语法 ─────────── */
{
  const cmp = await ev(`(async () => {
    const out = {};
    for (const v of ['26.3','1.20.4','1.12']) {
      window.__MCE__.setVersion(v);
      await new Promise(r => setTimeout(r, 120));
      out[v] = {
        datapackEra: !!window.__MCE__.capAvailable('mcfunction'),
        reportVer: window.__MCE__.state.version,
      };
    }
    return out;
  })()`);
  await sleep(600);
  // 直接比对命令生成：同一份物品数据在不同版本下必须产出不同写法
  const syntax = await ev(`(async () => {
    const out = {};
    for (const v of ['26.3','1.20.4']) {
      window.__MCE__.setVersion(v);
      window.__MCE__.goto('components');
      await new Promise(r => setTimeout(r, 900));
      const t = document.querySelector('#pageView').innerText.replace(/\\s+/g,' ');
      const m = t.match(/\\/give[^\\n]{0,220}/);
      out[v] = m ? m[0] : '(无)';
    }
    return out;
  })()`);
  const c26 = String(syntax['26.3'] || '');
  const c120 = String(syntax['1.20.4'] || '');
  check('S6a 26.3 产出组件语法（含 [）', c26.includes('['), c26);
  check('S6b 1.20.4 产出 NBT 语法（含 { 或旧式）', c120.includes('{') || /\\d\\s+0\\s+\\{/.test(c120), c120);
  check('S6c 两个版本的命令写法确实不同', c26 !== c120 && c26.length > 0 && c120.length > 0, `26.3=${c26.slice(0,60)} | 1.20.4=${c120.slice(0,60)}`);
  // 还原
  await ev(`window.__MCE__.setVersion('26.3')`);
  void cmp;
}

/* ─────────── 场景 7/8：节点图 —— 拖节点 + 连线（用户需求的核心动作） ─────────── */
await goto('commands');
await ev(`(() => { const t = __T.byTextIncl('节点图'); if (t) t.click(); return 1; })()`);
await sleep(1000);
{
  // 7. 拖动节点
  const before = await ev(`(() => { const n = document.querySelector('#pageView .node'); return n ? { left: n.style.left, top: n.style.top, id: n.dataset.id } : null; })()`);
  const head = await centerOf('#pageView .node .node-head');
  if (head && before) {
    await mouse('mousePressed', head.x, head.y);
    await sleep(70);
    await mouse('mouseMoved', head.x + 90, head.y + 55);
    await sleep(70);
    await mouse('mouseMoved', head.x + 130, head.y + 75);
    await sleep(70);
    await mouse('mouseReleased', head.x + 130, head.y + 75);
    await sleep(450);
    const after = await ev(`(() => { const n = document.querySelector('#pageView .node'); return n ? { left: n.style.left, top: n.style.top } : null; })()`);
    check('S7a 拖拽节点改变了位置', !!after && (after.left !== before.left || after.top !== before.top),
      `${before.left},${before.top} → ${after && after.left},${after && after.top}`);
  } else {
    check('S7a 拖拽节点改变了位置', false, `head=${JSON.stringify(head)} before=${JSON.stringify(before)}`);
  }

  // 8. 从 out 端口拖到另一个节点的 in 端口
  const portInfo = await ev(`(() => {
    const outs = Array.from(document.querySelectorAll('#pageView .node-port.out'));
    const ins = Array.from(document.querySelectorAll('#pageView .node-port.in'));
    const linksBefore = document.querySelectorAll('#pageView .graph-svg path.link:not(.tmp)').length;
    if (!outs.length || !ins.length) return { err: 'no ports', outs: outs.length, ins: ins.length };
    const o = outs[0];
    const on = o.dataset.node;
    const i = ins.find((el) => el.dataset.node !== on);
    if (!i) return { err: 'no cross-node in port' };
    const ro = o.getBoundingClientRect(), ri = i.getBoundingClientRect();
    return {
      linksBefore,
      from: { x: Math.round(ro.left + ro.width / 2), y: Math.round(ro.top + ro.height / 2) },
      to: { x: Math.round(ri.left + ri.width / 2), y: Math.round(ri.top + ri.height / 2) },
      fromNode: on, toNode: i.dataset.node, toPort: i.dataset.port,
    };
  })()`);
  if (portInfo && portInfo.from) {
    await mouse('mousePressed', portInfo.from.x, portInfo.from.y);
    await sleep(90);
    await mouse('mouseMoved', Math.round((portInfo.from.x + portInfo.to.x) / 2), Math.round((portInfo.from.y + portInfo.to.y) / 2));
    await sleep(70);
    await mouse('mouseMoved', portInfo.to.x, portInfo.to.y);
    await sleep(90);
    await mouse('mouseReleased', portInfo.to.x, portInfo.to.y);
    await sleep(550);
    const after = await ev(`(() => ({ links: document.querySelectorAll('#pageView .graph-svg path.link:not(.tmp)').length }))()`);
    check('S8a 拖拽连线建立连接', after.links > portInfo.linksBefore,
      `连接数 ${portInfo.linksBefore} → ${after.links}（${portInfo.fromNode} → ${portInfo.toNode}.${portInfo.toPort}）`);
    // 连线后下游端口应被锁定（用上游值覆盖手写值）
    const locked = await ev(`(() => {
      const ins = Array.from(document.querySelectorAll('#pageView .node .node-port.in'));
      const key = ${JSON.stringify(portInfo.toPort || '')};
      const t = document.querySelector('#pageView .node[data-id="${portInfo.toNode || ''}"]');
      if (!t) return { ok: false };
      const dis = Array.from(t.querySelectorAll('input,select,textarea')).filter(e => e.disabled).length;
      void ins; void key;
      return { ok: true, disabled: dis };
    })()`);
    check('S8b 连线后下游字段被上游接管（禁用或只读）', locked && locked.disabled >= 1, `禁用字段数=${locked && locked.disabled}`);
  } else {
    check('S8a 拖拽连线建立连接', false, JSON.stringify(portInfo));
  }
}

/* ─────────── 汇总 ─────────── */
console.log('\n=========== 交互端到端测试 ===========\n');
let pass = 0, fail = 0;
for (const r of results) {
  console.log(`${r.pass ? '  ✓' : '  ✗'} ${r.name}`);
  if (!r.pass || process.env.VERBOSE) console.log(`      ${r.detail}`);
  r.pass ? pass++ : fail++;
}
console.log(`\n通过 ${pass} / 失败 ${fail}`);
console.log(`未捕获异常 ${exceptions.length}`);
exceptions.slice(0, 8).forEach((e) => console.log('  ⚠ ' + e));

ws.close();
try { child.kill(); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
