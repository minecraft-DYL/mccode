// nodegraph.js —— 通用节点图引擎（零依赖）
// 能力：节点拖拽 / 类型受约束的端口连线 / 拖到空白处弹兼容节点菜单 / 框选与多选 /
//       中键平移 + 滚轮缩放 / 中键清线 / 右键创建菜单 / 复制粘贴 / 序列化
// 用途：① 命令节点图（可视化拼命令）② 版本能力时间轴
//
// 端口类型与配色参考 PVZ 融合版「超级自定义关卡 / 关卡事件」事件编辑器：
//   https://wiki.biligame.com/pvzrh/超级自定义关卡/关卡事件
//   节点标题在上，输入端口在左、输出端口在右；触发 #ffcc31 / Int #66ccff / Float #66ff98 /
//   Bool #ff4b80 / String #ff99ca / object #808080。

import { h, clear } from '../core/util.js';
import {
  checkPortCompat, canManyToOne, portColor, portLabel, nodeCatClass, nodeCatOf,
  NODE_CATS, NODE_CAT_ORDER, ensureStyles,
} from './graph-theme.js';

let uid = 0;
export const nextId = (p = 'n') => `${p}${++uid}_${Date.now().toString(36).slice(-4)}`;

/** 输出端口的固定键名 */
export const OUT_PORT = '__out';

/**
 * 节点字段描述
 *  { key, label, type: 'text'|'number'|'select'|'textarea'|'bool'|'readonly',
 *    options?, placeholder?, port?: true, portType?: 'trigger'|'int'|'float'|'bool'|'string'|'object'|'any',
 *    choices?: [] }
 * · port:true 表示该字段可作为输入端口被连线（连线后使用上游值）
 * · portType 决定端口配色与连接约束（缺省 any = 兼容一切，仅用于透传端口）
 * · choices 给 Scratch 模式下拉参数用（缺省取 options）
 */
export class NodeGraph {
  /**
   * @param {HTMLElement} host 容器（.graph-wrap）
   * @param {object} o
   * @param {Map<string,{title,color,fields,compute,outType?,nodeCat?,desc?}>} o.types 节点类型定义
   * @param {function} o.onChange 变更回调
   * @param {function} o.onSelect 选中回调 (ids, graph)
   * @param {function} o.onNotice 提示回调 (text, level) —— 连线被拒绝时给用户一句话
   */
  constructor(host, { types = new Map(), data = null, onChange = null, onSelect = null, onNotice = null } = {}) {
    ensureStyles();
    this.host = host;
    this.types = types;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.onNotice = onNotice;
    this.nodes = new Map();
    this.links = [];
    /** 脚本顺序（Scratch 模式与节点图共用同一份数据）：动作节点 id 的有序列表 */
    this.sequence = [];
    this.selected = new Set();
    this.pan = { x: 40, y: 20 };
    this.zoom = 1;
    this._drag = null;
    this._marquee = null;
    this._clipboard = null;
    this.lastLinkError = null;
    this.lastMenuCandidates = [];
    this._menus = [];

    clear(host);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'graph-svg');
    this.svg.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none';
    this.layer = h('div.graph-layer');
    this.canvas = h('div.graph-canvas', null, [this.svg, this.layer]);
    host.appendChild(this.canvas);

    this._bindCanvas();
    this._bindKeys();
    if (data) this.fromJSON(data);
    this.render();
  }

  /* ------------------------------ 数据 ------------------------------ */

  addNode(type, x, y, values = {}, { append = false, silent = false, fields = null, outPorts = null, id = null } = {}) {
    const def = this.types.get(type);
    if (!def) throw new Error(`未知节点类型 ${type}`);
    const node = {
      id: id || nextId(type.slice(0, 2)),
      type, x, y,
      values: { ...defaultValues(def), ...values },
    };
    // 每个节点可以覆盖出/入端口声明（动态端口：JSON/NBT 这类键名不固定的数据用得上）
    if (fields) node.fields = fields;
    if (outPorts) node.outPorts = outPorts;
    this.nodes.set(node.id, node);
    if (append || def.nodeCat === 'event') this._pushSequence(node.id);
    if (!silent) { this.render(); this._emit(); }
    return node;
  }

  /** 追加到脚本顺序末尾（Scratch「拖出命令块追加到脚本末尾」） */
  appendScriptNode(type, values = {}, at = null) {
    const def = this.types.get(type);
    if (!def) throw new Error(`未知节点类型 ${type}`);
    const node = this.addNode(type, this._nextScriptX(), this._nextScriptY(), values, { silent: true });
    this._pushSequence(node.id, at);
    this._chainFromPrev(node);
    this.render(); this._emit();
    return node;
  }

  /**
   * 追加进脚本时，自动把上一个脚本节点的「触发」输出接到新节点的「触发」输入。
   * 这样 Scratch 里堆出来的顺序，在节点图里就是一条真实的触发链 —— 两边同一份数据。
   */
  _chainFromPrev(node) {
    const def = this.types.get(node.type);
    if (!def) return false;
    const triggerIn = fieldsOf(node, def).find((f) => f.port && f.portType === 'trigger');
    if (!triggerIn) return false;
    if (this.links.some((l) => l.to.node === node.id && l.to.port === triggerIn.key)) return false;
    const i = this.sequence.indexOf(node.id);
    const prevId = i > 0 ? this.sequence[i - 1] : null;
    if (!prevId) return false;
    const prev = this.nodes.get(prevId);
    if (!prev) return false;
    const out = outPortsOf(this.types.get(prev.type)).find((o) => o.type === 'trigger');
    if (!out) return false;
    return this.link(prevId, out.port, node.id, triggerIn.key);
  }

  _nextScriptX() {
    const list = Array.from(this.nodes.values());
    if (!list.length) return 60;
    return Math.round(Math.max(...list.map((n) => n.x)) + 40);
  }

  _nextScriptY() {
    const list = Array.from(this.nodes.values());
    if (!list.length) return 60;
    return Math.round(Math.min(...list.map((n) => n.y)) + 170);
  }

  _pushSequence(id, at = null) {
    this.sequence = this.sequence.filter((x) => x !== id);
    if (at == null || at < 0 || at >= this.sequence.length) this.sequence.push(id);
    else this.sequence.splice(at, 0, id);
  }

  /** 调整脚本顺序（Scratch 上/下移） */
  moveInScript(id, delta) {
    const i = this.sequence.indexOf(id);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(this.sequence.length - 1, i + delta));
    if (i === j) return false;
    this.sequence.splice(i, 1);
    this.sequence.splice(j, 0, id);
    this.render(); this._emit();
    return true;
  }

  removeNode(id) {
    this.nodes.delete(id);
    this.links = this.links.filter((l) => l.from.node !== id && l.to.node !== id);
    this.selected.delete(id);
    this.sequence = this.sequence.filter((x) => x !== id);
    this.render(); this._emit();
  }

  /** 移除挂在某节点上的所有连线（中键点击节点） */
  clearLinks(id) {
    const before = this.links.length;
    this.links = this.links.filter((l) => l.from.node !== id && l.to.node !== id);
    const n = before - this.links.length;
    if (n) { this.render(); this._emit(); }
    return n;
  }

  /** 某端口的类型 */
  portType(nodeId, port, dir) {
    const node = this.nodes.get(nodeId);
    if (!node) return 'any';
    const def = this.types.get(node.type);
    if (!def) return 'any';
    if (dir === 'out' || port === OUT_PORT) {
      const outs = outPortsOf(def, node);
      const hit = outs.find((o) => o.port === port);
      if (hit) return hit.type;
      if (dir === 'out') return 'any';
    }
    const f = fieldsOf(node, def).find((x) => x.key === port);
    return (f && f.portType) || 'any';
  }

  /** 连线前的完整判定：类型兼容 + 多对一规则 */
  canLink(fromId, fromPort, toId, toPort) {
    if (fromId === toId) return { ok: false, reason: '不能把节点连到自己' };
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return { ok: false, reason: '节点不存在' };
    const fromType = this.portType(fromId, fromPort, 'out');
    const toType = this.portType(toId, toPort, 'in');
    const c = checkPortCompat(fromType, toType);
    if (!c.ok) return { ok: false, reason: c.reason, fromType, toType };
    const existing = this.links.filter((l) => l.to.node === toId && l.to.port === toPort);
    if (existing.length && !canManyToOne(toType)) {
      // 数据端口不能 many-to-one：这里按"新线顶替旧线"处理（输入端永远只有一条线）
      return { ok: true, reason: '数据输入端只能有一条线，新连线会顶替旧连线', fromType, toType, replaces: true };
    }
    return { ok: true, reason: c.reason, fromType, toType };
  }

  /**
   * 连线。返回 boolean（类型不兼容 / 自连 → false，并把原因写进 lastLinkError）
   * · 触发可以 many-to-one（多条触发线进同一个输入端口）
   * · 数据不能 many-to-one（同一输入端口只保留一条线，新线顶替旧线）
   */
  link(fromId, fromPort, toId, toPort) {
    const v = this.canLink(fromId, fromPort, toId, toPort);
    if (!v.ok) {
      this.lastLinkError = v.reason;
      if (this.onNotice) this.onNotice(v.reason, 'error');
      return false;
    }
    const toType = v.toType;
    if (canManyToOne(toType)) {
      const dup = this.links.some((l) => l.from.node === fromId && l.from.port === fromPort && l.to.node === toId && l.to.port === toPort);
      if (dup) { this.lastLinkError = '这条线已经存在'; return false; }
    } else {
      this.links = this.links.filter((l) => !(l.to.node === toId && l.to.port === toPort));
    }
    this.links.push({ from: { node: fromId, port: fromPort }, to: { node: toId, port: toPort } });
    this.lastLinkError = null;
    this.render(); this._emit();
    return true;
  }

  unlink(link) {
    this.links = this.links.filter((l) => l !== link);
    this.render(); this._emit();
  }

  /** 上游求值：节点某端口的实际值（有连线则取上游输出） */
  resolve(nodeId, port) {
    const link = this.links.find((l) => l.to.node === nodeId && l.to.port === port);
    if (!link) return undefined;
    return this.outputOf(link.from.node);
  }

  outputOf(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    const def = this.types.get(node.type);
    if (!def) return undefined;
    if (def.resolve) return def.resolve(node, this);
    if (def.compute) return def.compute(node, (port) => this.resolve(nodeId, port));
    return node.values;
  }

  /** 只输出"会产出命令"的动作节点（拓扑序） */
  ordered() {
    const done = new Set();
    const out = [];
    const visit = (id, stack = new Set()) => {
      if (done.has(id) || stack.has(id)) return;
      stack.add(id);
      const n = this.nodes.get(id);
      if (!n) return;
      const def = this.types.get(n.type);
      for (const l of this.links) if (l.to.node === id) visit(l.from.node, stack);
      done.add(id);
      if (def && def.kind === 'action') out.push(n);
      stack.delete(id);
    };
    for (const id of this.nodes.keys()) visit(id);
    return out;
  }

  /**
   * 脚本顺序的动作节点：显式 sequence 优先，其余节点按拓扑序补在末尾。
   * Scratch 模式与节点图模式都走这里 → 两边表达的是同一份数据、同一个顺序。
   */
  scriptNodes() {
    const actions = this.ordered();
    if (!this.sequence || !this.sequence.length) return actions;
    const byId = new Map(actions.map((n) => [n.id, n]));
    const out = [];
    for (const id of this.sequence) {
      const n = byId.get(id);
      if (n) { out.push(n); byId.delete(id); }
    }
    for (const n of actions) if (byId.has(n.id)) out.push(n);
    return out;
  }

  infoFor(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    const def = this.types.get(node.type);
    const cat = nodeCatOf(def);
    return {
      id: node.id, type: node.type,
      title: (def && def.title) || node.type,
      desc: (def && def.desc) || '',
      cat: cat.label, catColor: cat.color,
      inputs: fieldsOf(node, def).filter((f) => f.port).map((f) => ({ key: f.key, label: f.label || f.key, type: f.portType || 'any' })),
      output: (def && def.outputPort === false) ? null : ((def && def.outType) || 'string'),
      links: this.links.filter((l) => l.from.node === id || l.to.node === id).length,
    };
  }

  toJSON() {
    return {
      pan: { ...this.pan }, zoom: this.zoom,
      sequence: this.sequence.slice(),
      nodes: Array.from(this.nodes.values()).map((n) => {
        const o = { id: n.id, type: n.type, x: n.x, y: n.y, values: n.values };
        if (n.fields) o.fields = n.fields;       // 动态端口要一起持久化
        if (n.outPorts) o.outPorts = n.outPorts;
        return o;
      }),
      links: this.links.map((l) => ({ from: { ...l.from }, to: { ...l.to } })),
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.nodes.clear(); this.links = []; this.sequence = [];
    for (const n of data.nodes || []) if (this.types.has(n.type)) this.nodes.set(n.id, { ...n });
    this.links = (data.links || []).filter((l) => this.nodes.has(l.from.node) && this.nodes.has(l.to.node)).map((l) => ({ from: { ...l.from }, to: { ...l.to } }));
    this.sequence = (data.sequence || []).filter((id) => this.nodes.has(id));
    if (data.pan) this.pan = { ...data.pan };
    if (data.zoom) this.zoom = data.zoom;
  }

  /* ------------------------------ 渲染 ------------------------------ */

  render() {
    this.layer.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    clear(this.layer);
    this.layer.appendChild(this.svg);
    this.portIndex = new Map();
    for (const node of this.nodes.values()) this._renderNode(node);
    this._positionPorts();
    this._measurePorts();
    this._renderLinks();
    // sequence 里指向已删除节点的残留清理
    if (this.sequence.some((id) => !this.nodes.has(id))) {
      this.sequence = this.sequence.filter((id) => this.nodes.has(id));
    }
  }

  _renderNode(node) {
    const def = this.types.get(node.type);
    const cat = nodeCatOf(def);
    const el = h('div.node.mce-node.' + nodeCatClass(def) + (this.selected.has(node.id) ? '.is-sel' : ''), {
      dataset: { id: node.id, cat: (def.nodeCat || (def.kind === 'value' ? 'value' : 'action')), type: node.type },
      style: { left: node.x + 'px', top: node.y + 'px' },
    });
    const head = h('div.node-head', null, [
      h('span.node-dot', { style: { background: cat.color } }),
      h('span.node-title', { text: def.title, title: def.title }),
      h('span.mce-cat-tag', { text: cat.label, title: `类别：${cat.label}` }),
    ]);
    head.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 1) this._startNodeDrag(e, node); });
    el.appendChild(head);

    const body = h('div.node-body');
    for (const f of fieldsOf(node, def)) {
      const row = h('div.node-field', { dataset: { portKey: f.port ? f.key : '' } });
      if (f.label) row.appendChild(h('label', { text: f.label }));
      const val = node.values[f.key];
      let input;
      const linked = f.port && this.links.some((l) => l.to.node === node.id && l.to.port === f.key);
      if (f.type === 'select') {
        input = h('select');
        for (const o of f.options || []) {
          const opt = h('option', { value: o.value ?? o }); opt.textContent = o.label ?? o;
          input.appendChild(opt);
        }
        input.value = val ?? '';
        input.addEventListener('change', () => { node.values[f.key] = input.value; this._emit(); });
      } else if (f.type === 'port') {
        // 纯端口（如「触发」输入）：没有可编辑控件，只显示连接状态
        input = h('div.node-cmd', { text: linked ? '● 已连接' : '○ 未连接' });
      } else if (f.type === 'readonly') {
        input = h('div.node-cmd', { text: String(val ?? '') });
      } else if (f.type === 'bool') {
        input = h('input', { type: 'checkbox', checked: !!val, style: { flex: '0 0 auto', height: 'auto' } });
        input.addEventListener('change', () => { node.values[f.key] = input.checked; this._emit(); });
      } else {
        input = h('input', {
          class: f.mono ? 'mono' : null,
          type: f.type === 'number' ? 'number' : 'text',
          placeholder: f.placeholder || '',
        });
        input.value = val ?? '';
        input.addEventListener('input', () => { node.values[f.key] = input.value; this._emit(); });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
      }
      if (linked && f.port) { input.disabled = true; input.style.opacity = '.55'; input.title = '该参数由上游连线提供'; }
      row.appendChild(input);
      body.appendChild(row);
    }

    if (def.compute && def.kind !== 'value') {
      let preview = '';
      try { preview = def.compute(node, (port) => this.resolve(node.id, port)) || ''; } catch (e) { preview = `⚠ ${e.message}`; }
      body.appendChild(h('div.node-cmd', { text: preview }));
    }
    el.appendChild(body);

    // 输入端口（左侧）
    for (const f of fieldsOf(node, def)) {
      if (!f.port) continue;
      const type = f.portType || 'any';
      const p = h('div.node-port.in' + (type === 'trigger' ? '.is-trigger' : '.is-data'), {
        dataset: { node: node.id, port: f.key, portType: type },
        title: `输入：${f.label || f.key}（${portLabel(type)}）`,
        style: { background: portColor(type) },
      });
      p.addEventListener('mousedown', (e) => { if (e.button === 0) this._startLink(e, node.id, f.key, 'in'); });
      el.appendChild(p);
    }
    // 输出端口（右侧，可多个：触发链 + 数据）
    if (def.outputPort !== false) {
      for (const o of outPortsOf(def, node)) {
        const type = o.type;
        const p = h('div.node-port.out' + (type === 'trigger' ? '.is-trigger' : '.is-data'), {
          dataset: { node: node.id, port: o.port, portType: type },
          title: `输出：${o.label || ''}（${portLabel(type)}）`,
          style: { background: portColor(type) },
        });
        p.addEventListener('mousedown', (e) => { if (e.button === 0) this._startLink(e, node.id, o.port, 'out'); });
        el.appendChild(p);
      }
    }

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node-head') || e.target.closest('.node-port') || e.target.closest('input,select,textarea,label')) return;
      if (e.button === 0 || e.button === 1) this._startNodeDrag(e, node);
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.removeNode(node.id); });

    this.layer.appendChild(el);
    node.__el = el;
  }

  /** 端口垂直位置：按真实字段行高对齐（比固定公式可靠） */
  _positionPorts() {
    for (const node of this.nodes.values()) {
      const el = node.__el; if (!el) continue;
      const def = this.types.get(node.type) || {};
      const fields = fieldsOf(node, def);
      const rows = Array.from(el.querySelectorAll('.node-field'));
      const outs = outPortsOf(def, node);
      for (const p of el.querySelectorAll('.node-port')) {
        const key = p.dataset.port;
        if (p.classList.contains('out')) {
          const idx = Math.max(0, outs.findIndex((o) => o.port === key));
          const head = el.querySelector('.node-head');
          const body = el.querySelector('.node-body');
          const base = (head ? head.offsetHeight : 30) + (body ? body.offsetHeight : 0);
          const top = outs.length === 1
            ? Math.max(34, (head ? head.offsetHeight : 30) + 16)
            : Math.max(30, (head ? head.offsetHeight : 30) + 10 + idx * 22);
          p.style.top = `${Math.round(top - 5.5)}px`;
          void base;
          continue;
        }
        const f = fields.find((x) => x.key === key);
        if (!f) continue;
        const idx = fields.indexOf(f);
        const row = rows[idx];
        const top = row ? row.offsetTop + row.offsetHeight / 2 : 34 + idx * 30;
        p.style.top = `${Math.round(top - 5.5)}px`;
      }
    }
  }

  _measurePorts() {
    for (const node of this.nodes.values()) {
      const el = node.__el; if (!el) continue;
      node.__ports = {};
      for (const p of el.querySelectorAll('.node-port')) {
        node.__ports[p.dataset.port] = {
          x: el.offsetLeft + p.offsetLeft + p.offsetWidth / 2,
          y: el.offsetTop + p.offsetTop + p.offsetHeight / 2,
          el: p,
        };
      }
    }
  }

  _renderLinks() {
    clear(this.svg);
    for (const l of this.links) {
      const a = this.nodes.get(l.from.node), b = this.nodes.get(l.to.node);
      if (!a || !b) continue;
      const pa = a.__ports && a.__ports[l.from.port];
      const pb = b.__ports && b.__ports[l.to.port];
      if (!pa || !pb) continue;
      const type = this.portType(l.from.node, l.from.port, 'out');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', bezier(pa.x, pa.y, pb.x, pb.y));
      path.setAttribute('class', 'link');
      path.setAttribute('stroke', portColor(type));
      path.style.pointerEvents = 'stroke';
      path.addEventListener('dblclick', () => this.unlink(l));
      this.svg.appendChild(path);
      for (const pt of [pa, pb]) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', 3.5);
        c.setAttribute('class', 'dot');
        c.setAttribute('fill', portColor(type));
        c.style.pointerEvents = 'none';
        this.svg.appendChild(c);
      }
    }
  }

  _select() {
    for (const n of this.nodes.values()) if (n.__el) n.__el.classList.toggle('is-sel', this.selected.has(n.id));
    if (this.onSelect) this.onSelect(Array.from(this.selected), this);
  }

  _emit() { if (this.onChange) this.onChange(this); }

  /* ------------------------------ 坐标 ------------------------------ */

  toCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.pan.x) / this.zoom, y: (clientY - r.top - this.pan.y) / this.zoom };
  }

  /* ------------------------------ 交互 ------------------------------ */

  _bindCanvas() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node, .mce-portmenu')) return;
      this.closeMenus();
      if (e.button === 1) { this._startPan(e); return; }
      if (e.button !== 0) return;
      this._startMarquee(e);
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const wx = (cx - this.pan.x) / this.zoom, wy = (cy - this.pan.y) / this.zoom;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const z = Math.max(0.25, Math.min(2.6, this.zoom * factor));
      if (z === this.zoom) return;
      this.zoom = z;
      this.pan.x = cx - wx * z;
      this.pan.y = cy - wy * z;
      this.render();
      this._emit();
    }, { passive: false });

    this.canvas.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.node')) return;   // 节点右键 = 删除节点（节点自己处理）
      e.preventDefault();
      this._openBlankMenu(e.clientX, e.clientY);
    });
  }

  _startPan(e) {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, moved: false };
    const move = (ev) => {
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) start.moved = true;
      this.pan.x = start.px + (ev.clientX - start.x);
      this.pan.y = start.py + (ev.clientY - start.y);
      this.layer.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!start.moved) {
        const nodeEl = ev.target && ev.target.closest && ev.target.closest('.node');
        if (nodeEl) {
          const n = this.clearLinks(nodeEl.dataset.id);
          if (this.onNotice) this.onNotice(n ? `已清空该节点的 ${n} 条连线` : '该节点没有连线', 'info');
        }
      } else { this.render(); }
      this._emit();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /** 空白处左键拖拽 = 框选 */
  _startMarquee(e) {
    const additive = !!(e.shiftKey || e.ctrlKey || e.metaKey);
    if (!additive) { this.selected.clear(); this._select(); }
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const box = h('div.mce-marquee');
    let shown = false;
    const rectOf = (ev) => {
      const x2 = ev.clientX - r.left, y2 = ev.clientY - r.top;
      return { left: Math.min(sx, x2), top: Math.min(sy, y2), width: Math.abs(x2 - sx), height: Math.abs(y2 - sy) };
    };
    const move = (ev) => {
      const m = rectOf(ev);
      if (m.width < 4 && m.height < 4) return;
      if (!shown) { shown = true; this.canvas.appendChild(box); }
      Object.assign(box.style, { left: m.left + 'px', top: m.top + 'px', width: m.width + 'px', height: m.height + 'px' });
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      box.remove();
      if (!shown) return;
      const m = rectOf(ev);
      // 屏幕坐标 → 画布坐标
      const a = { x: (m.left - this.pan.x) / this.zoom, y: (m.top - this.pan.y) / this.zoom };
      const b = { x: (m.left + m.width - this.pan.x) / this.zoom, y: (m.top + m.height - this.pan.y) / this.zoom };
      let n = 0;
      for (const node of this.nodes.values()) {
        const el = node.__el; if (!el) continue;
        const w = el.offsetWidth, hh = el.offsetHeight;
        const hit = node.x < b.x && node.x + w > a.x && node.y < b.y && node.y + hh > a.y;
        if (hit) { this.selected.add(node.id); n++; }
      }
      this._select();
      if (this.onNotice) this.onNotice(`框选了 ${n} 个节点`, 'info');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  _startNodeDrag(e, node) {
    const middle = e.button === 1;
    e.preventDefault(); e.stopPropagation();
    if (middle) { this._startPan(e); return; }
    if (e.ctrlKey || e.metaKey) {
      if (this.selected.has(node.id)) this.selected.delete(node.id);
      else this.selected.add(node.id);
    } else if (!this.selected.has(node.id)) {
      this.selected.clear();
      this.selected.add(node.id);
    }
    this._select();
    const group = this.selected.has(node.id)
      ? Array.from(this.selected).map((id) => this.nodes.get(id)).filter(Boolean)
      : [node];
    const starts = group.map((n) => ({ n, x: n.x, y: n.y }));
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / this.zoom, dy = (ev.clientY - sy) / this.zoom;
      for (const s of starts) {
        s.n.x = s.x + dx; s.n.y = s.y + dy;
        if (s.n.__el) { s.n.__el.style.left = s.n.x + 'px'; s.n.__el.style.top = s.n.y + 'px'; }
      }
      this._measurePorts(); this._renderLinks();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this._emit();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /* ------------------------------ 连线 ------------------------------ */

  /** 拖线：空端口 → 找目标端口；松手在空白处 → 弹兼容节点菜单 */
  _startLink(e, nodeId, port, dir) {
    e.preventDefault(); e.stopPropagation();
    this.closeMenus();
    let src = { dir, nodeId, port, type: this.portType(nodeId, port, dir) };
    if (dir === 'in') {
      const existing = this.links.find((l) => l.to.node === nodeId && l.to.port === port);
      if (existing) {
        // 从已连线的输入端口拖出 = 摘下这条线，改从它的源输出端口继续拖
        const fn = existing.from.node, fp = existing.from.port;
        this.unlink(existing);
        src = { dir: 'out', nodeId: fn, port: fp, type: this.portType(fn, fp, 'out') };
      }
    }
    const p = this._portPos(src.nodeId, src.port);
    if (!p) return;

    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('class', 'link tmp');
    tmp.setAttribute('stroke', portColor(src.type));
    tmp.setAttribute('stroke-dasharray', '5 4');
    this.svg.appendChild(tmp);
    this._markLinkable(src);

    const move = (ev) => {
      const q = this.toCanvas(ev.clientX, ev.clientY);
      tmp.setAttribute('d', src.dir === 'out' ? bezier(p.x, p.y, q.x, q.y) : bezier(q.x, q.y, p.x, p.y));
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      tmp.remove();
      this._clearLinkable();
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const portEl = target && target.closest && target.closest('.node-port');
      if (portEl && portEl.dataset.node) {
        const otherNode = portEl.dataset.node, otherPort = portEl.dataset.port;
        let ok = false;
        if (src.dir === 'out' && portEl.classList.contains('in')) ok = this.link(src.nodeId, src.port, otherNode, otherPort);
        else if (src.dir === 'in' && portEl.classList.contains('out')) ok = this.link(otherNode, otherPort, src.nodeId, src.port);
        else if (this.onNotice) this.onNotice('两个方向相同的端口不能相连', 'error');
        void ok;
        return;
      }
      // 松手在画布空白处 → 弹只含兼容节点的菜单
      if (this.canvas.contains(target) || !target) {
        this._openPortMenu(ev.clientX, ev.clientY, src);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  _portPos(nodeId, port) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.__ports) return null;
    return node.__ports[port] || null;
  }

  /** 拖线时高亮所有"可以接上"的端口 */
  _markLinkable(src) {
    for (const node of this.nodes.values()) {
      const el = node.__el; if (!el) continue;
      for (const p of el.querySelectorAll('.node-port')) {
        const t = p.dataset.portType || 'any';
        if (p.dataset.node === src.nodeId && p.dataset.port === src.port) { p.classList.add('mce-dragging'); continue; }
        const otherDir = p.classList.contains('out') ? 'out' : 'in';
        if (otherDir === src.dir) continue;
        const compat = src.dir === 'out'
          ? checkPortCompat(src.type, t)
          : checkPortCompat(t, src.type);
        if (compat.ok) p.classList.add('mce-linkable');
      }
    }
  }

  _clearLinkable() {
    this.host.querySelectorAll('.mce-linkable, .mce-dragging').forEach((el) => el.classList.remove('mce-linkable', 'mce-dragging'));
  }

  /** 与某端口方向相反、类型兼容的节点候选 */
  portCandidates(dir, dragType) {
    const out = [];
    for (const [type, def] of this.types) {
      if (dir === 'out') {
        for (const f of def.fields || []) {
          if (!f.port) continue;
          if (checkPortCompat(dragType, f.portType || 'any').ok) {
            out.push({ type, def, port: f.key, portType: f.portType || 'any', dir: 'in', label: def.title });
            break;
          }
        }
      } else {
        if (def.outputPort === false) continue;
        const hit = outPortsOf(def).find((o) => checkPortCompat(o.type, dragType).ok);
        if (hit) out.push({ type, def, port: hit.port, portType: hit.type, dir: 'out', label: def.title });
      }
    }
    return out;
  }

  /** 拖到空白处松手 → 在鼠标位置弹出兼容节点菜单 */
  _openPortMenu(clientX, clientY, src) {
    this.closeMenus();
    const cands = this.portCandidates(src.dir, src.type);
    this.lastMenuCandidates = cands.map((c) => ({ type: c.type, port: c.port, portType: c.portType, dir: c.dir, label: c.label }));
    const menu = h('div.mce-portmenu', {
      dataset: { mcePortmenu: '1', portType: src.type, dir: src.dir, candidateCount: String(cands.length) },
    });
    menu.appendChild(h('div.mce-pm-head', null, [
      h('span.mce-pm-swatch', { style: { background: portColor(src.type) } }),
      h('span', { text: `可接 ${portLabel(src.type)} 的节点（${cands.length}）` }),
    ]));
    if (!cands.length) {
      menu.appendChild(h('div.mce-pm-empty', { text: `没有能接 ${portLabel(src.type)} 的节点类型` }));
    }
    const groups = new Map();
    for (const c of cands) {
      const key = c.def.nodeCat || (c.def.kind === 'value' ? 'value' : 'action');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    for (const key of NODE_CAT_ORDER) {
      const list = groups.get(key);
      if (!list || !list.length) continue;
      menu.appendChild(h('div.mce-pm-sec', { text: `${NODE_CATS[key].label}（${list.length}）` }));
      for (const c of list) {
        const item = h('div.mce-pm-item', {
          dataset: { nodeType: c.type, port: c.port, portType: c.portType },
          title: c.def.desc || c.def.title,
        }, [
          h('span.mce-pm-swatch', { style: { background: portColor(c.portType) } }),
          h('span', { text: c.def.title }),
          h('span.mce-pm-port', { text: c.dir === 'in' ? `→ ${c.port}` : `← ${c.port === OUT_PORT ? '输出' : c.port}` }),
        ]);
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          this._spawnFromMenu(c, src, clientX, clientY);
        });
        menu.appendChild(item);
      }
    }
    this._showMenu(menu, clientX, clientY);
  }

  _spawnFromMenu(c, src, clientX, clientY) {
    const pos = this.toCanvas(clientX, clientY);
    const node = this.addNode(c.type, Math.round(pos.x), Math.round(pos.y), {}, { silent: true });
    let ok;
    if (src.dir === 'out' && c.dir === 'in') ok = this.link(src.nodeId, src.port, node.id, c.port);
    else ok = this.link(node.id, c.port, src.nodeId, src.port);
    this.closeMenus();
    this.selected.clear();
    this.selected.add(node.id);
    this.render();
    this._select();
    this._emit();
    if (this.onNotice) this.onNotice(ok ? `已创建「${c.def.title}」并连线` : `已创建「${c.def.title}」，但连线被拒绝：${this.lastLinkError || ''}`, ok ? 'success' : 'error');
    return node;
  }

  /** 右键空白 = 创建 / 粘贴菜单 */
  _openBlankMenu(clientX, clientY) {
    this.closeMenus();
    const menu = h('div.mce-portmenu', { dataset: { mceBlankmenu: '1' } });
    menu.appendChild(h('div.mce-pm-head', { text: '在此处创建节点' }));
    if (this._clipboard && this._clipboard.nodes.length) {
      const paste = h('div.mce-pm-item', { dataset: { paste: '1' }, title: `粘贴 ${this._clipboard.nodes.length} 个节点` }, [
        h('span.mce-pm-swatch', { style: { background: 'var(--accent,#0067c0)' } }),
        h('span', { text: `粘贴（${this._clipboard.nodes.length} 个节点）` }),
      ]);
      paste.addEventListener('mousedown', (ev) => { ev.preventDefault(); this._paste(clientX, clientY); });
      menu.appendChild(paste);
      menu.appendChild(h('div.mce-pm-sec', { text: '新建' }));
    }
    const groups = new Map();
    for (const [type, def] of this.types) {
      if (def.hiddenInMenu) continue;   // 例：102 条通用命令节点走左侧分类栏，不塞进右键菜单
      const key = def.nodeCat || (def.kind === 'value' ? 'value' : 'action');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([type, def]);
    }
    for (const key of NODE_CAT_ORDER) {
      const list = groups.get(key);
      if (!list || !list.length) continue;
      menu.appendChild(h('div.mce-pm-sec', { text: NODE_CATS[key].label }));
      for (const [type, def] of list) {
        const item = h('div.mce-pm-item', { dataset: { nodeType: type }, title: def.desc || def.title }, [
          h('span.mce-pm-swatch', { style: { background: nodeCatOf(def).color } }),
          h('span', { text: def.title }),
        ]);
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const pos = this.toCanvas(clientX, clientY);
          const n = this.addNode(type, Math.round(pos.x), Math.round(pos.y), {}, { silent: true });
          this.closeMenus(); this.render();
          this.selected.clear(); this.selected.add(n.id); this._select(); this._emit();
        });
        menu.appendChild(item);
      }
    }
    this._showMenu(menu, clientX, clientY);
  }

  _showMenu(menu, clientX, clientY) {
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - r.width - 8);
    const top = Math.min(clientY, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    this._menus.push(menu);
    setTimeout(() => {
      const onDown = (ev) => {
        if (menu.contains(ev.target)) return;
        this.closeMenus();
      };
      menu.__onDown = onDown;
      document.addEventListener('mousedown', onDown, true);
    }, 0);
  }

  closeMenus() {
    for (const m of this._menus) {
      if (m.__onDown) document.removeEventListener('mousedown', m.__onDown, true);
      m.remove();
    }
    this._menus = [];
  }

  /* ------------------------------ 剪贴板 / 快捷键 ------------------------------ */

  copySelection() {
    const ids = Array.from(this.selected);
    if (!ids.length) return 0;
    const set = new Set(ids);
    this._clipboard = {
      nodes: ids.map((id) => {
        const n = this.nodes.get(id);
        return { id: n.id, type: n.type, x: n.x, y: n.y, values: { ...n.values } };
      }),
      links: this.links.filter((l) => set.has(l.from.node) && set.has(l.to.node)).map((l) => ({ from: { ...l.from }, to: { ...l.to } })),
    };
    if (this.onNotice) this.onNotice(`已复制 ${ids.length} 个节点`, 'info');
    return ids.length;
  }

  _paste(clientX, clientY) {
    if (!this._clipboard || !this._clipboard.nodes.length) return 0;
    const base = this.toCanvas(clientX, clientY);
    const minX = Math.min(...this._clipboard.nodes.map((n) => n.x));
    const minY = Math.min(...this._clipboard.nodes.map((n) => n.y));
    const idMap = new Map();
    this.selected.clear();
    for (const n of this._clipboard.nodes) {
      const node = {
        id: nextId(n.type.slice(0, 2)), type: n.type,
        x: Math.round(base.x + (n.x - minX)), y: Math.round(base.y + (n.y - minY)),
        values: { ...n.values },
      };
      this.nodes.set(node.id, node);
      idMap.set(n.id, node.id);
      this.selected.add(node.id);
      const def = this.types.get(n.type);
      if (def && def.kind === 'action') this._pushSequence(node.id);
    }
    for (const l of this._clipboard.links) {
      const f = idMap.get(l.from.node), t = idMap.get(l.to.node);
      if (f && t) this.links.push({ from: { node: f, port: l.from.port }, to: { node: t, port: l.to.port } });
    }
    this.closeMenus();
    this.render();
    this._select();
    this._emit();
    if (this.onNotice) this.onNotice(`已粘贴 ${this._clipboard.nodes.length} 个节点`, 'success');
    return this._clipboard.nodes.length;
  }

  pasteAtPointer() {
    const p = this._pointer || { x: 0, y: 0 };
    return this._paste(p.x, p.y);
  }

  _bindKeys() {
    this._onKeyDown = (e) => {
      if (!this.host.isConnected) return;
      if (this.host.offsetParent === null) return;   // 隐藏的临时图（如 output 页取命令用）不抢键盘
      const t = e.target;
      if (t && t.matches && t.matches('input,textarea,select,[contenteditable]')) return;
      if (e.key === 'Escape') { this.closeMenus(); this.selected.clear(); this._select(); return; }
      if (e.key === 'Delete') {
        if (!this.selected.size) return;
        e.preventDefault();
        const n = this.selected.size;
        this.deleteSelected();
        if (this.onNotice) this.onNotice(`已删除 ${n} 个节点及其连线`, 'info');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { this.copySelection(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { this.pasteAtPointer(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.selected = new Set(this.nodes.keys());
        this._select();
      }
    };
    this._onPointerMove = (e) => { this._pointer = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('mousemove', this._onPointerMove, { passive: true });
  }

  fit() {
    const list = Array.from(this.nodes.values());
    if (!list.length) { this.pan = { x: 40, y: 20 }; this.zoom = 1; this.render(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of list) {
      const w = n.__el ? n.__el.offsetWidth : 200, hh = n.__el ? n.__el.offsetHeight : 100;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + hh);
    }
    const rect = this.canvas.getBoundingClientRect();
    const zx = (rect.width - 60) / Math.max(1, maxX - minX);
    const zy = (rect.height - 60) / Math.max(1, maxY - minY);
    this.zoom = Math.max(0.35, Math.min(1.2, Math.min(zx, zy)));
    this.pan = { x: 30 - minX * this.zoom, y: 30 - minY * this.zoom };
    this.render();
  }

  deleteSelected() {
    for (const id of Array.from(this.selected)) {
      this.nodes.delete(id);
      this.links = this.links.filter((l) => l.from.node !== id && l.to.node !== id);
      this.sequence = this.sequence.filter((x) => x !== id);
    }
    this.selected.clear();
    this.render(); this._emit();
  }

  destroy() {
    this.closeMenus();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('mousemove', this._onPointerMove);
    clear(this.host);
  }
}

function defaultValues(def) {
  const v = {};
  for (const f of def.fields || []) {
    if (f.type === 'select' && f.options && f.options.length) v[f.key] = (f.options[0].value ?? f.options[0]);
    else if (f.type === 'bool') v[f.key] = !!f.default;
    else v[f.key] = f.default ?? '';
  }
  return v;
}

/**
 * 节点的输出端口列表。
 * · def.outPorts 显式声明（动作节点：触发链 __out + 命令文本 __cmd）
 * · 否则按 outType 派生出唯一的 __out
 */
export function outPortsOf(def, node = null) {
  if (node && Array.isArray(node.outPorts) && node.outPorts.length) return node.outPorts;
  if (!def) return [];
  if (def.outputPort === false) return [];
  if (Array.isArray(def.outPorts) && def.outPorts.length) return def.outPorts;
  return [{ port: OUT_PORT, type: def.outType || 'string', label: def.kind === 'value' ? '值' : '输出' }];
}

/** 节点的字段声明（node.fields 覆盖 def.fields —— 动态端口用） */
export function fieldsOf(node, def) {
  if (node && Array.isArray(node.fields)) return node.fields;
  return (def && def.fields) || [];
}

function bezier(x1, y1, x2, y2) {
  const dx = Math.max(30, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/* ------------------------------ 内置节点类型 ------------------------------ */

export const VALUE_NODE_TYPES = {
  const_text: {
    title: '文本', color: '#8fd6a0', kind: 'value', nodeCat: 'value',
    desc: '一个文本常量，接到需要 String 的输入端口。',
    outType: 'string',
    fields: [{ key: 'text', label: '内容', port: true, portType: 'string', type: 'text' }],
    resolve: (n, g) => (g.resolve(n.id, 'text') ?? n.values.text),
  },
  const_number: {
    title: '数字', color: '#ffd479', kind: 'value', nodeCat: 'value',
    desc: '一个数值常量（Float），接到 Float 输入端口。',
    outType: 'float',
    fields: [{ key: 'value', label: '数值', port: true, portType: 'float', type: 'number' }],
    resolve: (n, g) => {
      const v = g.resolve(n.id, 'value') ?? n.values.value;
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    },
  },
  const_int: {
    title: '整数', color: '#66ccff', kind: 'value', nodeCat: 'value',
    desc: '一个整数常量（Int），接到 Int 输入端口（也可接到 Float，整数是浮点的子集）。',
    outType: 'int',
    fields: [{ key: 'value', label: '整数', port: true, portType: 'int', type: 'number' }],
    resolve: (n, g) => {
      const v = g.resolve(n.id, 'value') ?? n.values.value;
      const num = Number(v);
      return Number.isFinite(num) ? Math.trunc(num) : 0;
    },
  },
  const_bool: {
    title: '布尔', color: '#ff4b80', kind: 'value', nodeCat: 'value',
    desc: 'true / false 常量，接到 Bool 输入端口。',
    outType: 'bool',
    fields: [{ key: 'value', label: '取值', type: 'select', options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] }],
    resolve: (n) => n.values.value === 'true' || n.values.value === true,
  },
  selector: {
    title: '目标选择器', color: '#d6a2ff', kind: 'value', nodeCat: 'value',
    desc: '实体/玩家选择器，输出 String。',
    outType: 'string',
    fields: [
      { key: 'base', label: '主体', type: 'select', options: ['@a', '@p', '@r', '@s', '@e', '@n'] },
      { key: 'args', label: '参数', port: true, portType: 'string', placeholder: 'type=pig,distance=..10' },
    ],
    resolve: (n) => (n.values.args ? `${n.values.base}[${n.values.args}]` : n.values.base),
  },
  position: {
    title: '坐标', color: '#7ec8ff', kind: 'value', nodeCat: 'value',
    desc: '三维坐标（支持 ~ / ^ 相对坐标），输出 String。',
    outType: 'string',
    fields: [
      { key: 'x', label: 'X', type: 'text', default: '~' },
      { key: 'y', label: 'Y', type: 'text', default: '~' },
      { key: 'z', label: 'Z', type: 'text', default: '~' },
    ],
    resolve: (n) => `${n.values.x || '~'} ${n.values.y || '~'} ${n.values.z || '~'}`,
  },
  nullable_snbt: {
    title: 'SNBT 数据', color: '#c586c0', kind: 'value', nodeCat: 'value',
    desc: 'SNBT / NBT 数据块（对象），接到 object 输入端口（如 /data 的 nbt、/summon 的 nbt）。',
    outType: 'object',
    fields: [{ key: 'snbt', label: 'SNBT', port: true, portType: 'object', type: 'text', mono: true, default: '{}' }],
    resolve: (n, g) => (g.resolve(n.id, 'snbt') ?? n.values.snbt),
  },
};

/**
 * 便捷：创建带类型映射的图（本仓库既有调用方用旧签名，新页面用新签名）
 *
 * 旧签名（保留兼容）：
 *   createGraph(host, extraTypes, data, onChange, onSelect, onNotice)
 * 新签名（推荐给别的页面/编辑器复用）：
 *   createGraph(host, {
 *     types,        // { 或 Map } 追加/覆盖的节点类型定义
 *     nodes,        // 节点数组（与 data 二选一）→ {id,type,x,y,values,fields?,outPorts?}
 *     ports,        // { 端口类型补充表 }，会把每个类型里未声明 portType 的端口按名字补上类型
 *     data,         // 完整图数据 {pan,zoom,sequence,nodes,links}
 *     onChange,     // (graph) => void          每次数据变化
 *     onEmit,       // 同 onChange（别名，宿主更常用的叫法）
 *     onSelect,     // (ids) => void            选中变化
 *     onNotice,     // (msg, level) => void     提示/报错
 *     readOnly,     // true = 只读（不能改结构与参数）
 *     theme,        // 'graph'（默认）
 *   })
 * @returns {NodeGraph}
 */
export function createGraph(host, typesOrOpts, data, onChange, onSelect, onNotice) {
  // 只认「选项专属」的键，避免和节点类型名撞车（本仓库有名为 data 的命令节点！）
  const OPT_KEYS = ['types', 'nodes', 'links', 'sequence', 'ports', 'onEmit', 'onChange', 'onSelect', 'onNotice', 'readOnly'];
  const isOpts = arguments.length < 3 && typesOrOpts && typeof typesOrOpts === 'object' && !(typesOrOpts instanceof Map)
    && OPT_KEYS.some((k) => k in typesOrOpts);
  const opts = isOpts ? typesOrOpts : { types: typesOrOpts, data, onChange, onSelect, onNotice };
  const extra = opts.types instanceof Map ? Object.fromEntries(opts.types) : (opts.types || {});
  const types = new Map(Object.entries({ ...VALUE_NODE_TYPES, ...extra }));
  applyPortTable(types, opts.ports);
  const graph = new NodeGraph(host, {
    types,
    data: opts.data || (opts.nodes ? { nodes: opts.nodes, links: opts.links || [], sequence: opts.sequence } : null),
    onChange: opts.onChange || opts.onEmit || null,
    onSelect: opts.onSelect || null,
    onNotice: opts.onNotice || null,
  });
  if (opts.readOnly) {
    graph.readOnly = true;
    graph._bindCanvas = () => {};
    graph._bindKeys = () => {};
    graph.appendScriptNode = () => { throw new Error('只读图不能改结构'); };
  }
  return graph;
}

/**
 * 端口类型补充表：{ portName: 'int' } 会把所有类型里同名、且没写 portType 的端口补成该类型。
 * 用于「宿主只想声明一次端口类型」的复用场景。
 */
function applyPortTable(types, ports) {
  if (!ports || typeof ports !== 'object') return;
  for (const def of types.values()) {
    for (const f of def.fields || []) {
      if (f.port && !f.portType && ports[f.key]) f.portType = ports[f.key];
    }
    for (const o of def.outPorts || []) {
      if (!o.type && ports[o.port]) o.type = ports[o.port];
    }
  }
}
