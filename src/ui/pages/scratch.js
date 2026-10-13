// pages/scratch.js —— Scratch 模式：把命令序列呈现成一摞积木块
//
// 与节点图共用同一份数据（同一个 NodeGraph 实例）：这里改的每个参数都直接写进
// node.values，读的是同一批节点；块顺序读的是 graph.scriptNodes()，
// 也就是节点图里那条「触发」链的顺序。两边不存在第二份存储。

import { h, clear } from '../../core/util.js';
import { ensureStyles } from '../../graph/graph-theme.js';
import { OUT_PORT } from '../../graph/nodegraph.js';
import { badge, toast } from '../controls.js';

/** 下拉候选：真实注册表数据（没有注册表就不编造，退回手填输入框） */
function registryChoices(registry) {
  const out = { item: [], entity: [], particle: [] };
  if (!registry) return out;
  const pick = (arr) => (arr || []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  out.item = pick(registry.items);
  out.entity = pick(registry.entities);
  out.particle = pick(registry.particles);
  return out;
}

/**
 * 渲染 Scratch 模式
 * @param {object} ctx { graph, onDirty, registry }
 * @returns {HTMLElement}
 */
export function renderScratch(ctx) {
  ensureStyles();
  const { graph, registry } = ctx;
  const types = graph.types;
  const choices = registryChoices(registry);

  const stage = h('div.mce-scratch-stage');
  const pal = h('div.mce-scratch-pal');
  const host = h('div.mce-scratch', null, [
    h('div', null, [
      h('h3', { style: { margin: '0 0 8px', fontSize: '12.5px' }, text: '命令块（拖到脚本末尾，或点一下追加）' }),
      pal,
      h('div.tiny.muted', { text: '块的参数是可点的下拉框；改完立刻反映到节点图和下面的命令。全部命令（102 条）在左侧分类栏里。' }),
    ]),
    stage,
  ]);

  /* ---------------- 命令块面板 ---------------- */
  const palItems = [];
  for (const [type, def] of types) {
    if (def.kind !== 'action' || !def.rich) continue;   // 通用命令节点走左侧分类栏，面板只放富表单命令
    palItems.push({ type, def });
  }
  palItems.sort((a, b) => String(a.def.category || '').localeCompare(String(b.def.category || ''), 'zh'));
  for (const { type, def } of palItems) {
    const el = h('div.mce-sb', {
      dataset: { scratchPal: type },
      draggable: 'true',
      title: def.desc || def.title,
      style: { background: def.color || '#7ec8ff' },
      text: def.title.replace(/\s*\/\S+$/, ''),
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/mce-node', type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => appendBlock(type, null));
    pal.appendChild(el);
  }
  for (const [type, def] of types) {
    if (def.nodeCat !== 'event') continue;
    const el = h('div.mce-sb', {
      dataset: { scratchPal: type }, draggable: 'true', title: def.desc || def.title,
      style: { background: def.color || '#ff6666' }, text: def.title,
    });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/mce-node', type); e.dataTransfer.effectAllowed = 'copy'; });
    el.addEventListener('click', () => {
      const first = graph.scriptNodes()[0];
      const n = graph.addNode(type, 40, 20, {});
      if (first) graph.link(n.id, OUT_PORT, first.id, 'trigger');
      rerender(); dirty();
    });
    pal.appendChild(el);
  }

  /* ---------------- 脚本区 ---------------- */
  function appendBlock(type, at) {
    const def = types.get(type);
    if (!def) return;
    if (def.nodeCat === 'event') graph.addNode(type, 40, 20, {});
    else graph.appendScriptNode(type, {}, at);
    rerender();
    dirty();
  }

  function dirty() { if (ctx.onDirty) ctx.onDirty(); }

  /** 事件类型切换：保留原有的触发连线 */
  function swapEventType(oldId, newType) {
    const old = graph.nodes.get(oldId);
    if (!old) return;
    const outs = graph.links.filter((l) => l.from.node === oldId).map((l) => ({ to: { ...l.to }, port: l.from.port }));
    const n = graph.addNode(newType, old.x, old.y, {}, { silent: true });
    graph.removeNode(oldId);
    for (const l of outs) graph.link(n.id, l.port, l.to.node, l.to.port);
    rerender();
    dirty();
  }

  function foundHatNode() {
    for (const [id, n] of graph.nodes) {
      const def = types.get(n.type);
      if (!def || def.nodeCat !== 'event') continue;
      if (graph.links.some((l) => l.from.node === id)) return n;
    }
    return null;
  }

  function makeArg(node, f) {
    const linked = f.port && graph.links.some((l) => l.to.node === node.id && l.to.port === f.key);
    const wrap = h('span.mce-arg', { dataset: { arg: f.key } });
    wrap.appendChild(h('span.mce-arg-lbl', { text: (f.label || f.key) + '：' }));
    if (linked) {
      const up = graph.links.find((l) => l.to.node === node.id && l.to.port === f.key);
      const upNode = up ? graph.nodes.get(up.from.node) : null;
      const upDef = upNode ? types.get(upNode.type) : null;
      wrap.appendChild(h('span.mce-arg-lbl', {
        style: { color: '#0b3d1e', background: '#8fd6a0', borderRadius: '9px', padding: '1px 7px', opacity: '1' },
        text: `← 连线：${upDef ? upDef.title : '上游节点'}`,
      }));
      return wrap;
    }
    const val = node.values[f.key];
    if (f.type === 'select' || f.choices) {
      const opts = (f.options || []).map((o) => (o && typeof o === 'object' ? o : { value: o, label: String(o) }))
        .concat((f.choices || []).map((c) => ({ value: c, label: String(c) })));
      const sel = h('select', { dataset: { argInput: f.key } });
      const seen = new Set();
      for (const o of opts) {
        if (seen.has(String(o.value))) continue;
        seen.add(String(o.value));
        const op = h('option', { value: o.value }); op.textContent = o.label;
        sel.appendChild(op);
      }
      if (val != null && val !== '' && !seen.has(String(val))) {
        const op = h('option', { value: val }); op.textContent = String(val);
        sel.appendChild(op);
      }
      sel.value = val == null ? '' : String(val);
      sel.addEventListener('change', () => { node.values[f.key] = sel.value; localRefresh(node); dirty(); });
      wrap.appendChild(sel);
      return wrap;
    }
    if (f.type === 'number') {
      const inp = h('input', { type: 'number', dataset: { argInput: f.key }, value: val ?? '' });
      inp.addEventListener('input', () => { node.values[f.key] = inp.value; localRefresh(node); dirty(); });
      wrap.appendChild(inp);
      return wrap;
    }
    if (f.type === 'bool') {
      const inp = h('input', { type: 'checkbox', checked: !!val, dataset: { argInput: f.key } });
      inp.addEventListener('change', () => { node.values[f.key] = inp.checked; localRefresh(node); dirty(); });
      wrap.appendChild(inp);
      return wrap;
    }
    // picker：有注册表就挂 datalist（真实数据），否则纯文本
    const list = f.picker && choices[f.picker] && choices[f.picker].length ? `mce-dl-${f.picker}` : null;
    const inp = h('input', { type: 'text', dataset: { argInput: f.key }, list, value: val ?? '' });
    inp.addEventListener('input', () => { node.values[f.key] = inp.value; localRefresh(node); dirty(); });
    wrap.appendChild(inp);
    return wrap;
  }

  /** 只刷新这一块的命令预览，不重建整摞块（否则输入框会掉焦点） */
  function localRefresh(node) {
    const box = stage.querySelector(`[data-scratch-block="${node.id}"] .mce-blk-preview`);
    if (!box) return;
    const def = types.get(node.type);
    try { box.textContent = '/' + (def.compute(node, (p) => graph.resolve(node.id, p)) || ''); }
    catch (e) { box.textContent = '⚠ ' + e.message; }
  }

  function makeBlock(node, index) {
    const def = types.get(node.type);
    const el = h('div.mce-blk', {
      dataset: { scratchBlock: node.id, seq: String(index) },
      style: { background: def.color || '#7ec8ff' },
    });
    const head = h('div.mce-blk-head', null, [
      h('span.mce-blk-title', { text: def.title }),
      h('span.mce-blk-seq', { text: `#${index + 1}` }),
    ]);
    el.appendChild(head);
    const args = h('div.mce-blk-args');
    for (const f of def.fields || []) {
      if (f.type === 'port') continue;   // 触发端口在 Scratch 里就是「上一块接下一块」
      args.appendChild(makeArg(node, f));
    }
    if (args.children.length) el.appendChild(args);
    const preview = h('div.mce-blk-preview');
    try { preview.textContent = '/' + (def.compute(node, (p) => graph.resolve(node.id, p)) || ''); }
    catch (e) { preview.textContent = '⚠ ' + e.message; }
    el.appendChild(preview);

    const ops = h('div.mce-blk-ops');
    const up = h('button', { type: 'button', title: '上移', text: '↑' });
    up.addEventListener('click', () => { graph.moveInScript(node.id, -1); rerender(); dirty(); });
    const down = h('button', { type: 'button', title: '下移', text: '↓' });
    down.addEventListener('click', () => { graph.moveInScript(node.id, 1); rerender(); dirty(); });
    const del = h('button', { type: 'button', title: '删除这一块', text: '×' });
    del.addEventListener('click', () => { graph.removeNode(node.id); rerender(); dirty(); });
    ops.appendChild(up); ops.appendChild(down); ops.appendChild(del);
    el.appendChild(ops);

    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.style.outline = '2px solid var(--accent,#0067c0)'; });
    el.addEventListener('dragleave', () => { el.style.outline = ''; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.outline = '';
      const type = e.dataTransfer.getData('text/mce-node');
      if (type && types.get(type) && types.get(type).kind === 'action') appendBlock(type, index + 1);
    });
    return el;
  }

  function rerender() {
    clear(stage);
    const list = graph.scriptNodes();
    const hat = foundHatNode();
    if (hat) {
      const def = types.get(hat.type);
      const hatEl = h('div.mce-blk.mce-blk-hat', {
        dataset: { scratchHat: hat.id },
        style: { background: def.color || '#ff6666' },
      });
      const sel = h('select', { dataset: { hatType: '1' } });
      for (const [type, d] of types) {
        if (d.nodeCat !== 'event') continue;
        const op = h('option', { value: type }); op.textContent = d.title;
        sel.appendChild(op);
      }
      sel.value = hat.type;
      sel.addEventListener('change', () => swapEventType(hat.id, sel.value));
      hatEl.appendChild(h('div.mce-blk-head', null, [h('span.mce-blk-title', { text: '当' }), sel]));
      hatEl.appendChild(h('div.mce-blk-args', null, h('span.mce-arg-lbl', { text: def.desc || '' })));
      stage.appendChild(hatEl);
    } else {
      const add = h('div.mce-blk.mce-blk-hat', { style: { background: '#ff6666' } });
      const btn = h('button', { type: 'button', text: '＋ 加一个「当…」事件帽' });
      btn.addEventListener('click', () => {
        const n = graph.addNode('event_tick', 40, 20, {});
        const first = graph.scriptNodes()[0];
        if (first) graph.link(n.id, OUT_PORT, first.id, 'trigger');
        rerender(); dirty();
      });
      add.appendChild(h('div.mce-blk-head', null, [h('span.mce-blk-title', { text: '当' }), btn]));
      stage.appendChild(add);
    }

    if (!list.length) {
      stage.appendChild(h('div.tiny.muted', { style: { margin: '14px 0' }, text: '脚本是空的：点一下上方的命令块，或从左侧命令分类栏加一条命令。' }));
    }
    list.forEach((node, i) => stage.appendChild(makeBlock(node, i)));

    const zone = h('div.mce-dropzone', { dataset: { scratchDropzone: '1' }, text: '把命令块拖到这里 → 追加到脚本末尾' });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const type = e.dataTransfer.getData('text/mce-node');
      if (type && types.get(type) && types.get(type).kind === 'action') appendBlock(type, null);
      else if (type) toast('这个块不能追加到脚本（只有命令块可以）', 'error');
    });
    stage.appendChild(zone);

    stage.appendChild(h('div.mce-mcb-legend', null, [
      badge(`脚本 ${list.length} 块`, list.length ? 'ok' : 'no'),
      h('span.tiny.muted', { text: '顺序写入节点图的「触发」链，切回节点图能看到同一条链。' }),
    ]));
  }

  rerender();
  return host;
}

/** 供页面顶部模式切换时统计脚本块数 */
export function scratchSummary(graph) {
  return { blocks: graph.scriptNodes().length };
}
