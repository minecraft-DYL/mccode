// command-graph.js —— 命令节点类型：把「拼命令」变成「连线」
//
// 端口类型体系（配色参考 PVZ 融合版「超级自定义关卡 / 关卡事件」事件编辑器）：
//   trigger #ffcc31 触发   int #66ccff 整数   float #66ff98 浮点
//   bool    #ff4b80 布尔   string #ff99ca 文本  object #808080 对象（NBT / SNBT 块）
//
// 连接规则：
//   · 触发 → 触发 ✅（可多连一，用来表达"先执行谁"）       触发 ↔ 数据 ❌
//   · 数据 → 同类型 ✅（int → float 是唯一的数值放宽）       数据 → 不同类型 ❌
//   · 同一个数据输入端只能有一条线；触发输入端可以有多条线
//
// 动作节点有 2 个输出端口：
//   __out = 触发（串执行顺序）      __cmd = String（命令文本，喂给 /execute 的子命令端口等）

import { stackSyntax, buildGive, buildSetblock, buildSummon, buildParticle, buildSelector } from '../core/commands.js';

const clean = (v) => (v == null ? '' : String(v));

/** 依赖版本的物品参数（1.20.5 前后两套） */
function itemArg(version, item, data) {
  const style = stackSyntax(version);
  const it = clean(item) || 'minecraft:stone';
  const d = clean(data).trim();
  if (!d) return it;
  if (style === 'components') {
    const body = d.startsWith('[') ? d.slice(1, -1) : d;
    return `${it}[${body}]`;
  }
  const body = d.startsWith('{') ? d : `{${d}}`;
  return `${it}${body}`;
}

/** 动作节点公共骨架：触发输入 + 触发/命令双输出 */
function action({ title, color, category, desc, fields, compute, pickers = undefined, absorbs = undefined }) {
  return {
    title, color, kind: 'action', nodeCat: 'action', category, desc, rich: true,
    fields: [{ key: 'trigger', label: '触发', type: 'port', port: true, portType: 'trigger' }, ...fields],
    outPorts: [
      { port: '__out', type: 'trigger', label: '触发' },
      { port: '__cmd', type: 'string', label: '命令' },
    ],
    compute,
    ...(pickers ? { pickers } : {}),
    ...(absorbs ? { absorbs } : {}),
  };
}

/** 事件触发节点（红）：只输出触发信号，本身不生成命令 */
function eventNode({ title, color = '#ff6666', desc, outPorts }) {
  return {
    title, color, kind: 'event', nodeCat: 'event', desc,
    fields: [],
    outPorts: outPorts || [{ port: '__out', type: 'trigger', label: '触发' }],
    resolve: () => true,
  };
}

/** 比较 / 条件节点（玫红）：产出 /execute 的 if 条件片段 */
function compareNode({ title, desc, fields, resolve }) {
  return {
    title, color: '#ff99ca', kind: 'compare', nodeCat: 'compare', desc,
    outType: 'string',
    fields,
    resolve,
  };
}

/**
 * 建立命令节点类型表
 * @param {string} version 当前版本（影响物品语法）
 */
export function commandNodeTypes(version) {
  const V = version;
  const t = {};
  const components = stackSyntax(V) === 'components';

  /* ---------------------------- 事件触发（红） ---------------------------- */

  t.event_tick = eventNode({
    title: '事件：游戏刻', desc: '循环型命令方块每个游戏刻执行一次（红石保持激活时持续运行）。把「触发」输出接到动作节点的触发输入。',
  });
  t.event_redstone = eventNode({
    title: '事件：红石激活', desc: '命令方块被红石信号激活时执行一次（脉冲型）。把「触发」输出接到动作节点的触发输入。',
  });
  t.event_function = eventNode({
    title: '事件：函数调用', desc: '由 /function 调用数据包函数时执行（wiki：function —— 运行函数，权限 2）。',
  });
  t.event_schedule = eventNode({
    title: '事件：计划任务', desc: '由 /schedule 安排在执行者所在维度、指定游戏刻后运行（wiki：schedule —— 安排函数在特定的游戏刻后运行，权限 2）。',
  });
  t.event_trigger = eventNode({
    title: '事件：/trigger 触发器', desc: '玩家用 /trigger 激活记分板触发器时执行（wiki：trigger —— 设置一个触发器，权限 0）。',
  });

  /* ---------------------------- 动作（命令） ---------------------------- */

  t.give = action({
    title: '给予物品 /give', color: '#ffd479', category: '物品',
    desc: 'wiki：给予玩家物品（权限 2，作用域：玩家）。物品参数按版本切换数据组件 / NBT 两套写法。',
    fields: [
      { key: 'targets', label: '目标', port: true, portType: 'string', default: '@s', choices: ['@s', '@a', '@p', '@r', '@e'] },
      { key: 'item', label: '物品', port: true, portType: 'string', default: 'minecraft:diamond_sword', picker: 'item' },
      { key: 'data', label: components ? '组件' : 'NBT', port: true, portType: 'object', type: 'text', mono: true, placeholder: components ? 'custom_name="剑"' : '{CustomName:"剑"}' },
      { key: 'count', label: '数量', port: true, portType: 'int', type: 'number', default: 1 },
    ],
    compute: (n, r) => {
      const targets = clean(r('targets') ?? n.values.targets) || '@s';
      const item = clean(r('item') ?? n.values.item) || 'minecraft:stone';
      const data = clean(r('data') ?? n.values.data);
      const arg = itemArg(V, item, data);
      const c = Number(n.values.count) || 1;
      return `give ${targets} ${arg}${c !== 1 ? ' ' + c : ''}`;
    },
    pickers: ['item'],
  });

  t.setblock = action({
    title: '放置方块 /setblock', color: '#ff9db0', category: '方块',
    desc: 'wiki：将方块替换为其他方块（权限 2，作用域：方块）。',
    fields: [
      { key: 'pos', label: '坐标', port: true, portType: 'string', default: '~ ~ ~' },
      { key: 'block', label: '方块', port: true, portType: 'string', default: 'minecraft:stone', picker: 'block' },
      { key: 'nbt', label: 'NBT', port: true, portType: 'object', type: 'text', mono: true, placeholder: '{Items:[]}' },
      { key: 'mode', label: '模式', type: 'select', options: ['', 'replace', 'destroy', 'keep'] },
    ],
    compute: (n, r) => buildSetblock(V, {
      pos: clean(r('pos') ?? n.values.pos) || '~ ~ ~',
      block: clean(r('block') ?? n.values.block) || 'minecraft:stone',
      nbt: clean(r('nbt') ?? n.values.nbt),
      mode: n.values.mode || '',
    }),
  });

  t.summon = action({
    title: '召唤实体 /summon', color: '#8fd6a0', category: '实体',
    desc: 'wiki：生成一个实体（权限 2，作用域：实体）。',
    fields: [
      { key: 'entity', label: '实体', port: true, portType: 'string', default: 'minecraft:pig', picker: 'entity' },
      { key: 'pos', label: '坐标', port: true, portType: 'string', default: '~ ~ ~' },
      { key: 'nbt', label: 'NBT', port: true, portType: 'object', type: 'text', mono: true, placeholder: '{NoAI:1b}' },
    ],
    compute: (n, r) => buildSummon(V, {
      entity: clean(r('entity') ?? n.values.entity) || 'minecraft:pig',
      pos: clean(r('pos') ?? n.values.pos) || '~ ~ ~',
      nbt: clean(r('nbt') ?? n.values.nbt),
    }),
    pickers: ['entity'],
  });

  t.particle = action({
    title: '生成粒子 /particle', color: '#d6a2ff', category: '粒子',
    desc: 'wiki：创建粒子（权限 2，作用域：玩家）。',
    fields: [
      { key: 'particle', label: '粒子', port: true, portType: 'string', default: 'minecraft:flame', picker: 'particle' },
      { key: 'pos', label: '坐标', port: true, portType: 'string', default: '~ ~1 ~' },
      { key: 'delta', label: '扩散', port: true, portType: 'string', default: '0.2 0.2 0.2' },
      { key: 'speed', label: '速度', port: true, portType: 'float', type: 'number', default: 1 },
      { key: 'count', label: '数量', port: true, portType: 'int', type: 'number', default: 10 },
      { key: 'mode', label: '模式', type: 'select', options: ['normal', 'force'] },
    ],
    compute: (n, r) => buildParticle(V, {
      particle: clean(r('particle') ?? n.values.particle) || 'minecraft:flame',
      pos: clean(r('pos') ?? n.values.pos) || '~ ~1 ~',
      delta: clean(r('delta') ?? n.values.delta) || '0.2 0.2 0.2',
      speed: Number(n.values.speed) || 1,
      count: Number(n.values.count) || 10,
      mode: n.values.mode || 'normal',
    }),
    pickers: ['particle'],
  });

  t.tellraw = action({
    title: '发送文本 /tellraw', color: '#7ec8ff', category: '文本',
    desc: 'wiki：向玩家发送以文本组件表示的消息（权限 2，作用域：玩家）。',
    fields: [
      { key: 'targets', label: '目标', port: true, portType: 'string', default: '@a', choices: ['@a', '@p', '@s', '@r'] },
      { key: 'message', label: '文本', port: true, portType: 'string', default: '{"text":"你好"}' },
    ],
    compute: (n, r) => `tellraw ${clean(r('targets') ?? n.values.targets) || '@a'} ${clean(r('message') ?? n.values.message) || '{"text":""}'}`,
  });

  t.data = action({
    title: '数据操作 /data', color: '#c586c0', category: 'NBT',
    desc: 'wiki：获取、合并、修改或移除方块实体、实体或命令存储的 NBT 数据（权限 2）。',
    fields: [
      { key: 'op', label: '操作', type: 'select', options: ['get', 'merge', 'remove', 'modify'] },
      { key: 'target', label: '目标', port: true, portType: 'string', default: 'entity @s' },
      { key: 'path', label: '路径', port: true, portType: 'string', default: '' },
      { key: 'nbt', label: 'NBT', port: true, portType: 'object', type: 'text', mono: true, default: '{}' },
    ],
    compute: (n, r) => {
      const op = n.values.op || 'get';
      const target = clean(r('target') ?? n.values.target) || 'entity @s';
      const path = clean(n.values.path).trim();
      if (op === 'get') return `data get ${target}${path ? ' ' + path : ''}`;
      if (op === 'remove') return `data remove ${target}${path ? ' ' + path : ''}`;
      if (op === 'merge') return `data merge ${target} ${clean(r('nbt') ?? n.values.nbt) || '{}'}`;
      return `data modify ${target}${path ? ' ' + path : ''} set ${clean(r('nbt') ?? n.values.nbt) || '{}'}`;
    },
  });

  t.function = action({
    title: '执行函数 /function', color: '#b5e8a0', category: '函数',
    desc: 'wiki：运行函数（权限 2，作用域：世界）。',
    fields: [{ key: 'name', label: '函数', port: true, portType: 'string', default: 'mypack:main' }],
    compute: (n, r) => `function ${clean(r('name') ?? n.values.name) || 'mypack:main'}`,
  });

  t.gamerule = action({
    title: '游戏规则 /gamerule', color: '#ffcc80', category: '流程',
    desc: 'wiki：更改或查询游戏规则（权限 2，作用域：世界）。取值是 Bool 端口（true / false）。',
    fields: [
      { key: 'rule', label: '规则', port: true, portType: 'string', default: 'keepInventory' },
      { key: 'value', label: '取值', port: true, portType: 'bool', type: 'select', options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
    ],
    compute: (n, r) => {
      const rule = clean(r('rule') ?? n.values.rule) || 'keepInventory';
      const raw = r('value');
      const v = raw === undefined ? n.values.value : raw;
      return `gamerule ${rule} ${v === false || v === 'false' ? 'false' : 'true'}`;
    },
  });

  t.execute = action({
    title: '执行上下文 /execute', color: '#ffcc80', category: '流程',
    desc: 'wiki：检测、改变命令上下文并执行命令（权限 2）。条件输入接「比较」节点的 if 片段，子命令接其他命令节点的「命令」输出。',
    fields: [
      { key: 'chain', label: '链', port: true, portType: 'string', default: 'as @s at @s' },
      { key: 'condition', label: '条件', port: true, portType: 'string', default: '' },
      { key: 'command', label: '子命令', port: true, portType: 'string', placeholder: '把命令节点的「命令」输出接到这里' },
    ],
    compute: (n, r) => {
      const chain = clean(n.values.chain).trim() || 'as @s';
      const cond = clean(r('condition') ?? n.values.condition).trim();
      const sub = clean(r('command') ?? n.values.command).trim().replace(/^\//, '');
      const mid = cond ? `${chain} ${cond}` : chain;
      return sub ? `execute ${mid} run ${sub}` : `execute ${mid}`;
    },
    /** 被 execute 消费的子命令不单独输出 */
    absorbs: 'command',
  });

  /* ---------------------------- 比较 / 条件 ---------------------------- */

  t.cond_score = compareNode({
    title: '比较：记分板分数', desc: '/execute if score 条件片段。操作符取自实际语法：< <= = >= >。',
    fields: [
      { key: 'a_target', label: '目标 A', port: true, portType: 'string', default: '@s' },
      { key: 'a_obj', label: '记分项 A', type: 'text', default: 'obj' },
      { key: 'op', label: '操作符', type: 'select', options: ['<', '<=', '=', '>=', '>'] },
      { key: 'b_target', label: '目标 B', port: true, portType: 'string', default: '@s' },
      { key: 'b_obj', label: '记分项 B', type: 'text', default: 'obj2' },
    ],
    resolve: (n, g) => {
      const a = clean(g.resolve(n.id, 'a_target') ?? n.values.a_target) || '@s';
      const b = clean(g.resolve(n.id, 'b_target') ?? n.values.b_target) || '@s';
      return `if score ${a} ${clean(n.values.a_obj) || 'obj'} ${n.values.op || '>='} ${b} ${clean(n.values.b_obj) || 'obj2'}`;
    },
  });

  t.cond_block = compareNode({
    title: '比较：方块', desc: '/execute if block 条件片段：指定位置是否为指定方块。',
    fields: [
      { key: 'pos', label: '坐标', port: true, portType: 'string', default: '~ ~-1 ~' },
      { key: 'block', label: '方块', port: true, portType: 'string', default: 'minecraft:stone', picker: 'block' },
    ],
    resolve: (n, g) => {
      const pos = clean(g.resolve(n.id, 'pos') ?? n.values.pos) || '~ ~ ~';
      const block = clean(g.resolve(n.id, 'block') ?? n.values.block) || 'minecraft:stone';
      return `if block ${pos} ${block}`;
    },
  });

  t.cond_entity = compareNode({
    title: '比较：实体存在', desc: '/execute if entity 条件片段：选择器能否匹配到实体。',
    fields: [{ key: 'target', label: '选择器', port: true, portType: 'string', default: '@e[type=minecraft:pig,distance=..5]' }],
    resolve: (n, g) => {
      const target = clean(g.resolve(n.id, 'target') ?? n.values.target) || '@e';
      return `if entity ${target}`;
    },
  });

  /* ---------------------------- 输出 ---------------------------- */

  t.selector_sink = {
    title: '输出：聊天框指令', color: '#4cc2ff', kind: 'sink', nodeCat: 'action', outputPort: false,
    desc: '把命令整理成可以直接粘进聊天框的形式（自动补 /）。',
    fields: [
      { key: 'command', label: '命令', port: true, portType: 'string' },
      { key: 'autoSlash', label: '自动加 /', type: 'select', options: [{ value: 'yes', label: '是' }, { value: 'no', label: '否' }] },
    ],
    compute: (n, r) => {
      const c = clean(r('command') ?? n.values.command).trim();
      if (!c) return '';
      const need = n.values.autoSlash !== 'no' && !c.startsWith('/');
      return need ? '/' + c : c;
    },
  };

  return t;
}

/** 节点类别清单（供 UI 分组用，顺序即展示顺序） */
export const COMMAND_NODE_GROUPS = [
  { key: 'event', label: '事件触发', color: '#ff6666' },
  { key: 'action', label: '行为', color: '#7ec8ff' },
  { key: 'value', label: '值', color: '#66ff98' },
  { key: 'compare', label: '比较', color: '#ff99ca' },
];

/**
 * 从节点图取出要逐行输出的命令（跳过值 / 事件 / 比较节点与被 /execute 吸收的节点）
 * 顺序 = graph.scriptNodes()（显式脚本顺序优先，其余按触发链拓扑序）
 */
export function commandsFromGraph(graph, version) {
  const absorbed = new Set();
  for (const l of graph.links) {
    const n = graph.nodes.get(l.to.node);
    const def = n ? graph.types.get(n.type) : null;
    if (def && def.absorbs && def.absorbs === l.to.port) absorbed.add(l.from.node);
  }
  const order = typeof graph.scriptNodes === 'function' ? graph.scriptNodes() : graph.ordered();
  const out = [];
  for (const n of order) {
    const def = graph.types.get(n.type);
    if (!def || def.kind !== 'action' || absorbed.has(n.id)) continue;
    let cmd = '';
    try { cmd = def.compute(n, (p) => graph.resolve(n.id, p)) || ''; } catch (e) { cmd = `⚠ ${e.message}`; }
    if (cmd) out.push({ node: n, cmd });
  }
  const sinks = [];
  for (const n of graph.nodes.values()) {
    const def = graph.types.get(n.type);
    if (def && def.kind === 'sink') {
      let cmd = '';
      try { cmd = def.compute(n, (p) => graph.resolve(n.id, p)) || ''; } catch { cmd = ''; }
      if (cmd) sinks.push({ node: n, cmd });
    }
  }
  void version;
  return { lines: out, sinks };
}

/** 默认示例图：一条事件 → 两条命令的触发链 + 两个值节点 */
export function defaultCommandGraph(version) {
  const components = stackSyntax(version) === 'components';
  return {
    pan: { x: 40, y: 24 }, zoom: 1,
    sequence: ['demo_give', 'demo_summon', 'demo_rule'],
    nodes: [
      { id: 'demo_event', type: 'event_tick', x: 20, y: 20, values: {} },
      { id: 'demo_sel', type: 'selector', x: 250, y: 160, values: { base: '@a', args: '' } },
      { id: 'demo_item', type: 'const_text', x: 250, y: 300, values: { text: 'minecraft:diamond_sword' } },
      { id: 'demo_give', type: 'give', x: 600, y: 20, values: { targets: '@a', item: 'minecraft:diamond_sword', data: components ? 'custom_name="神剑"' : '{CustomName:\'{"text":"神剑"}\'}', count: 1 } },
      { id: 'demo_pos', type: 'position', x: 250, y: 440, values: { x: '~', y: '~1', z: '~' } },
      { id: 'demo_summon', type: 'summon', x: 990, y: 20, values: { entity: 'minecraft:pig', pos: '~ ~1 ~', nbt: '{NoAI:1b,CustomName:\'{"text":"猪"}\'}' } },
      { id: 'demo_rule', type: 'gamerule', x: 1330, y: 20, values: { rule: 'keepInventory', value: 'true' } },
    ],
    links: [
      { from: { node: 'demo_event', port: '__out' }, to: { node: 'demo_give', port: 'trigger' } },
      { from: { node: 'demo_give', port: '__out' }, to: { node: 'demo_summon', port: 'trigger' } },
      { from: { node: 'demo_summon', port: '__out' }, to: { node: 'demo_rule', port: 'trigger' } },
      { from: { node: 'demo_sel', port: '__out' }, to: { node: 'demo_give', port: 'targets' } },
      { from: { node: 'demo_item', port: '__out' }, to: { node: 'demo_give', port: 'item' } },
      { from: { node: 'demo_pos', port: '__out' }, to: { node: 'demo_summon', port: 'pos' } },
    ],
  };
}

export { buildSelector };
