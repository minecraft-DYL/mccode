// commands.js —— 命令定义、参数类型与版本感知生成
// 核心差异：物品堆叠的参数语法在 1.20.5（24w09a）前后是两套
//   旧：  minecraft:diamond_sword{display:{Name:'...'}}      ← NBT
//   新：  minecraft:diamond_sword[custom_name='"..."']        ← 数据组件

import { parseVersion, versionOrder, isDatapackEra } from './versions.js';
import { toSNBT, NBTNumber, parseSNBT } from './nbt.js';
import { WIKI_COMMANDS, CMD_CATEGORIES, commandsInCategory, searchCommands, CMD_SCOPE_LABEL, PERM_LABEL } from '../data/commands-wiki.js';

/** 物品堆叠语法族 */
export function stackSyntax(version) {
  const p = parseVersion(version);
  if (!p.nums.length) return 'components';
  if (p.nums[0] >= 26) return 'components';
  const [a, b, c = 0] = p.nums;
  if (a > 1) return 'components';
  if (b > 20) return 'components';
  if (b === 20 && c >= 5) return 'components';
  return 'nbt';
}

export const ARG_TYPES = {
  selector: { name: '目标选择器', hint: '@a / @p / @r / @s / @e[type=…]', sample: '@a' },
  item: { name: '物品 ID', hint: 'minecraft:diamond_sword', sample: 'minecraft:diamond_sword' },
  block: { name: '方块 ID', hint: 'minecraft:stone[阵营]', sample: 'minecraft:stone' },
  entity: { name: '实体 ID', hint: 'minecraft:pig', sample: 'minecraft:pig' },
  particle: { name: '粒子 ID', hint: 'minecraft:flame', sample: 'minecraft:flame' },
  position: { name: '坐标', hint: '~ ~1 ~ 或 10 64 -20', sample: '~ ~ ~' },
  number: { name: '数字', hint: '整数或小数', sample: '1' },
  string: { name: '文本', hint: '原样文本或 JSON 文本组件', sample: '' },
  snbt: { name: 'SNBT', hint: '{Key:Value}', sample: '{}' },
  component: { name: '数据组件', hint: 'key=value', sample: '' },
  function: { name: '函数', hint: '命名空间:路径', sample: 'mypack:main' },
};

/* ==================== 命令参数类型的中文名 / 提示（用于参数输入框标签） ====================
 * 来源：zh.minecraft.wiki「命令」页各命令的语法行（<targets> <item> <pos> <nbt> …），
 * 以及本仓库 COMMANDS[].forms[].syntax 里逐条抄录的同一批占位符。
 * 这里只做「中文名 + 中文提示 + 可复制示例」的补全，不改动任何命令定义本身。
 *
 * 与 ARG_TYPES 的分工：
 *   ARG_TYPES      —— 历史遗留，字段名 name/hint/sample，保留兼容；
 *   ARG_TYPE_LABEL —— 参数类型 → 中文名（UI 上的短标签）；
 *   ARG_TYPE_HINT  —— 参数类型 → 一句中文说明 + 语法占位符；
 *   ARG_TYPE_SAMPLE—— 参数类型 → 可直接用的示例值；
 *   ARG_TYPE_DESC  —— 合并入口，UI 一行拿到全部字段。
 */
export const ARG_TYPE_LABEL = {
  selector: '目标选择器',
  item: '物品 ID',
  block: '方块 ID',
  entity: '实体 ID',
  particle: '粒子 ID',
  position: '坐标',
  number: '数字',
  string: '文本',
  snbt: 'SNBT 数据',
  component: '数据组件',
  function: '函数',
};

/** [中文说明, 语法占位符, 示例值] —— 占位符写法与 wiki 语法行一致 */
const ARG_TYPE_DETAIL = {
  selector: ['选择一个或多个实体，@ 开头，可带 [参数] 过滤', '<targets>', '@a'],
  item: ['物品的命名空间 ID，1.20.5 起可跟 [组件]', '<item>', 'minecraft:diamond_sword'],
  block: ['方块的命名空间 ID，可跟 [方块状态]', '<block>', 'minecraft:oak_stairs[facing=north]'],
  entity: ['实体的命名空间 ID', '<entity>', 'minecraft:pig'],
  particle: ['粒子的命名空间 ID', '<particle>', 'minecraft:flame'],
  position: ['世界坐标，~ 表示相对执行者、^ 表示相对朝向', '<pos>', '~ ~1 ~'],
  number: ['整数或小数，可为负数', '<count>', '1'],
  string: ['原样文本；文本组件时用 JSON 或 SNBT', '<text>', '"你好"'],
  snbt: ['复合标签形式的 SNBT，必须用一对花括号包裹', '<nbt>', '{NoAI:1b}'],
  component: ['数据组件，key=value，多个用逗号分隔', '<components>', 'custom_name="神剑"'],
  function: ['数据包内的函数，命名空间:路径', '<function>', 'mypack:main'],
};

/** 未知类型的兜底（不编中文名，如实显示原始键名） */
function fallbackArgType(t) {
  return { type: t, label: String(t), hint: '', placeholder: `<${t}>`, sample: '', zh: '', known: false };
}

/** 参数类型 → 中文名；未知类型返回原始键名（不编） */
export function argTypeLabel(t) {
  return ARG_TYPE_LABEL[t] || String(t);
}

/** 参数类型 → { type, label, hint, placeholder, sample, zh, known }，UI 一行取全 */
export function describeArgType(t) {
  const d = ARG_TYPE_DETAIL[t];
  if (!d) return fallbackArgType(t);
  return {
    type: t,
    label: ARG_TYPE_LABEL[t] || String(t),
    zh: d[0],
    placeholder: d[1],
    sample: d[2],
    hint: `${d[0]}（${d[1]}）——例：${d[2] || '—'}`,
    known: true,
  };
}

/** 参数列表 → 中文标签串，例 ['selector','item'] → '目标选择器 · 物品 ID' */
export function describeArgTypes(list) {
  return (list || []).map((t) => argTypeLabel(t)).join(' · ');
}

/** 某个命令形式里每个参数的类型标签 + 提示（命令编辑器参数提示行直接渲染这个） */
export function argTypeChips(list) {
  return (list || []).map((t) => describeArgType(t));
}

/* ============================ 目标选择器 ============================ */

export const SELECTOR_VARS = [
  { v: '@a', d: '所有玩家' }, { v: '@p', d: '最近的玩家' }, { v: '@r', d: '随机玩家' },
  { v: '@s', d: '自己（执行者）' }, { v: '@e', d: '所有实体' }, { v: '@n', d: '最近的实体（1.21+）' },
];

export const SELECTOR_ARGS = [
  { k: 'type', d: '实体类型', since: '1.8' },
  { k: 'name', d: '实体名称', since: '1.8' },
  { k: 'distance', d: '距离范围（..10）', since: '1.8' },
  { k: 'x / y / z', d: '坐标原点', since: '1.8' },
  { k: 'dx / dy / dz', d: '体积范围', since: '1.8' },
  { k: 'tag', d: '记分板标签', since: '1.8' },
  { k: 'team', d: '队伍', since: '1.8' },
  { k: 'scores', d: '记分项', since: '1.8' },
  { k: 'nbt', d: 'NBT 匹配', since: '1.8' },
  { k: 'level', d: '玩家等级', since: '1.8' },
  { k: 'gamemode', d: '游戏模式', since: '1.8' },
  { k: 'limit', d: '数量上限', since: '1.8' },
  { k: 'sort', d: '排序方式', since: '1.8' },
  { k: 'predicate', d: '谓词（数据包）', since: '1.13' },
  { k: 'advancements', d: '进度匹配', since: '1.13' },
  { k: 'x_rotation / y_rotation', d: '视角朝向', since: '1.8' },
  { k: 'wave', d: '波次（袭击）', since: '1.16' },
];

export function buildSelector(base = '@a', args = []) {
  const parts = args.filter((a) => a && a.k && a.v !== '' && a.v != null).map((a) => `${a.k}=${a.v}`);
  return parts.length ? `${base}[${parts.join(',')}]` : base;
}

/* ============================ 命令定义 ============================ */

/**
 * forms[].syntax 里 <x> 为必填参数，[x] 为可选。
 * since 表示该形式自哪个版本可用（用于能力门控）。
 */
export const COMMANDS = [
  {
    name: 'give', category: '物品', since: '1.0', icon: 'gift',
    desc: '给予玩家物品',
    forms: [
      { since: '1.20.5', syntax: 'give <targets> <item>[components] [count]', args: ['selector', 'item', 'component', 'number'], template: (v) => `give ${v.targets} ${v.item}${v.component || ''}${v.count ? ' ' + v.count : ''}` },
      { since: '1.13', until: '1.20.4', syntax: 'give <targets> <item>{nbt} [count]', args: ['selector', 'item', 'snbt', 'number'], template: (v) => `give ${v.targets} ${v.item}${v.nbt || ''}${v.count ? ' ' + v.count : ''}` },
      { since: '1.0', until: '1.12.2', syntax: 'give <player> <item> [amount] [data] [dataTag]', args: ['selector', 'item', 'number', 'number', 'snbt'], template: (v) => `give ${v.targets} ${v.item} ${v.count || 1} ${v.data || 0} ${v.nbt || '{}'}` },
    ],
  },
  {
    name: 'setblock', category: '方块', since: '1.0',
    desc: '在指定位置放置方块',
    forms: [
      { since: '1.13', syntax: 'setblock <pos> <block>[states]{nbt} [replace|destroy|keep]', args: ['position', 'block', 'snbt', 'string'], template: (v) => `setblock ${v.pos} ${v.block}${v.nbt || ''}${v.mode ? ' ' + v.mode : ''}` },
      { since: '1.0', until: '1.12.2', syntax: 'setblock <pos> <block> [dataValue] [oldBlockHandling] [dataTag]', args: ['position', 'block', 'number', 'string', 'snbt'], template: (v) => `setblock ${v.pos} ${v.block} ${v.data || 0} ${v.mode || 'replace'} ${v.nbt || '{}'}` },
    ],
  },
  {
    name: 'summon', category: '实体', since: '1.7',
    desc: '召唤实体',
    forms: [
      { since: '1.13', syntax: 'summon <entity> [pos] [nbt]', args: ['entity', 'position', 'snbt'], template: (v) => `summon ${v.entity}${v.pos ? ' ' + v.pos : ''}${v.nbt ? ' ' + v.nbt : ''}` },
      { since: '1.7', until: '1.12.2', syntax: 'summon <EntityName> [x] [y] [z] [dataTag]', args: ['entity', 'number', 'number', 'number', 'snbt'], template: (v) => `summon ${v.entity} ${v.x || '~'} ${v.y || '~'} ${v.z || '~'} ${v.nbt || '{}'}` },
    ],
  },
  {
    name: 'particle', category: '粒子', since: '1.8',
    desc: '生成粒子',
    forms: [
      { since: '1.13', syntax: 'particle <name> [pos] [delta] [speed] [count] [mode] [viewers]', args: ['particle', 'position', 'position', 'number', 'number', 'string', 'selector'], template: (v) => `particle ${v.particle}${v.pos ? ' ' + v.pos : ''}${v.delta ? ' ' + v.delta : ''}${v.speed ? ' ' + v.speed : ''}${v.count ? ' ' + v.count : ''}${v.mode ? ' ' + v.mode : ''}` },
      { since: '1.8', until: '1.12.2', syntax: 'particle <name> <x> <y> <z> <xd> <yd> <zd> <speed> [count]', args: ['particle', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'], template: (v) => `particle ${v.particle} ${v.x || '~'} ${v.y || '~'} ${v.z || '~'} 0 0 0 ${v.speed || 1} ${v.count || 1}` },
    ],
  },
  {
    name: 'data', category: 'NBT', since: '1.13',
    desc: '读取 / 合并 / 修改 / 删除方块、实体、物品上的 NBT',
    forms: [
      { since: '1.13', syntax: 'data get <target> [path] [scale]', args: ['string', 'string', 'number'], template: (v) => `data get ${v.target}${v.path ? ' ' + v.path : ''}` },
      { since: '1.13', syntax: 'data merge <target> <nbt>', args: ['string', 'snbt'], template: (v) => `data merge ${v.target} ${v.nbt}` },
      { since: '1.13', syntax: 'data modify <target> <path> set|merge|append|prepend|insert <source>', args: ['string', 'string', 'string'], template: (v) => `data modify ${v.target} ${v.path} set ${v.source}` },
      { since: '1.13', syntax: 'data remove <target> <path>', args: ['string', 'string'], template: (v) => `data remove ${v.target} ${v.path}` },
    ],
  },
  {
    name: 'execute', category: '流程', since: '1.8',
    desc: '改变执行上下文后运行命令（1.13 起为子命令链式写法）',
    forms: [
      { since: '1.13', syntax: 'execute <as|at|positioned|if|unless|store|…> … run <command>', args: ['string'], template: (v) => `execute ${v.chain || 'as @s'} run ${v.command || ''}` },
      { since: '1.8', until: '1.12.2', syntax: 'execute <entity> <x> <y> <z> <command>', args: ['selector', 'number', 'number', 'number', 'string'], template: (v) => `execute ${v.targets || '@s'} ${v.x || '~'} ${v.y || '~'} ${v.z || '~'} ${v.command || ''}` },
    ],
  },
  { name: 'teleport', category: '移动', since: '1.10', desc: '传送实体（旧名 /tp）', forms: [{ since: '1.13', syntax: 'teleport <targets> <destination>', args: ['selector', 'position'], template: (v) => `teleport ${v.targets} ${v.dest}` }] },
  { name: 'tp', category: '移动', since: '1.0', desc: '传送', forms: [{ since: '1.0', syntax: 'tp <targets> <x> <y> <z>', args: ['selector', 'number', 'number', 'number'], template: (v) => `tp ${v.targets} ${v.x} ${v.y} ${v.z}` }] },
  { name: 'effect', category: '状态', since: '1.0', desc: '给予 / 移除状态效果', forms: [{ since: '1.13', syntax: 'effect give|clear <targets> <effect> [seconds] [amplifier]', args: ['string', 'selector', 'string', 'number', 'number'], template: (v) => `effect give ${v.targets} ${v.effect} ${v.seconds || 30} ${v.amplifier || 0}` }] },
  { name: 'fill', category: '方块', since: '1.8', desc: '填充区域', forms: [{ since: '1.13', syntax: 'fill <from> <to> <block>[states]{nbt} [replace|…]', args: ['position', 'position', 'block', 'snbt'], template: (v) => `fill ${v.from} ${v.to} ${v.block}${v.nbt || ''}` }] },
  { name: 'clone', category: '方块', since: '1.8', desc: '复制区域', forms: [{ since: '1.13', syntax: 'clone <begin> <end> <destination> [maskMode] [cloneMode]', args: ['position', 'position', 'position'], template: (v) => `clone ${v.from} ${v.to} ${v.dest}` }] },
  { name: 'scoreboard', category: '计分', since: '1.5', desc: '记分板操作', forms: [{ since: '1.13', syntax: 'scoreboard objectives|players …', args: ['string'], template: (v) => `scoreboard ${v.sub || 'objectives add obj dummy'}` }] },
  { name: 'tellraw', category: '文本', since: '1.7', desc: '发送 JSON 文本', forms: [{ since: '1.7', syntax: 'tellraw <targets> <message>', args: ['selector', 'string'], template: (v) => `tellraw ${v.targets} ${v.message}` }] },
  { name: 'title', category: '文本', since: '1.8', desc: '标题 / 副标题 / 动作栏', forms: [{ since: '1.8', syntax: 'title <targets> title|subtitle|actionbar|times|reset <…>', args: ['selector', 'string'], template: (v) => `title ${v.targets} ${v.sub || 'title'} ${v.text || '"标题"'}` }] },
  { name: 'function', category: '函数', since: '1.12', desc: '执行数据包中的函数', forms: [{ since: '1.13', syntax: 'function <name>', args: ['function'], template: (v) => `function ${v.name}` }] },
  { name: 'item', category: '物品', since: '1.17', desc: '替换容器 / 实体物品栏中的物品', forms: [{ since: '1.20.5', syntax: 'item replace <target> <slot> with <item>[components]', args: ['string', 'string', 'item', 'component'], template: (v) => `item replace ${v.target || 'entity @s'} ${v.slot || 'container.0'} with ${v.item}${v.component || ''}` }] },
  { name: 'loot', category: '物品', since: '1.14', desc: '从战利品表获得物品', forms: [{ since: '1.14', syntax: 'loot give|spawn|replace|insert <…>', args: ['string'], template: (v) => `loot give ${v.targets || '@s'} ${v.source || 'loot minecraft:chests/simple_dungeon'}` }] },
  { name: 'enchant', category: '物品', since: '1.0', desc: '附魔（1.20.5 起写法调整）', forms: [{ since: '1.20.5', syntax: 'enchant <targets> <enchantment> [level]', args: ['selector', 'string', 'number'], template: (v) => `enchant ${v.targets} ${v.enchantment}${v.level ? ' ' + v.level : ''}` }] },
  { name: 'difficulty', category: '世界', since: '1.4', desc: '设置难度', forms: [{ since: '1.4', syntax: 'difficulty <peaceful|easy|normal|hard>', args: ['string'], template: (v) => `difficulty ${v.value || 'normal'}` }] },
  { name: 'time', category: '世界', since: '1.4', desc: '设置时间', forms: [{ since: '1.13', syntax: 'time set|add <value|day|night|noon|midnight>', args: ['string', 'string'], template: (v) => `time set ${v.value || 'day'}` }] },
  { name: 'weather', category: '世界', since: '1.4', desc: '设置天气', forms: [{ since: '1.4', syntax: 'weather <clear|rain|thunder> [duration]', args: ['string', 'number'], template: (v) => `weather ${v.value || 'clear'}` }] },
  { name: 'gamerule', category: '世界', since: '1.4', desc: '游戏规则', forms: [{ since: '1.4', syntax: 'gamerule <rule> [value]', args: ['string', 'string'], template: (v) => `gamerule ${v.rule || 'keepInventory'} ${v.value ?? 'true'}` }] },
  { name: 'gamemode', category: '玩家', since: '1.0', desc: '切换游戏模式', forms: [{ since: '1.13', syntax: 'gamemode <survival|creative|adventure|spectator> [target]', args: ['string', 'selector'], template: (v) => `gamemode ${v.mode || 'creative'}${v.targets ? ' ' + v.targets : ''}` }] },
  { name: 'kill', category: '实体', since: '1.0', desc: '杀死实体', forms: [{ since: '1.13', syntax: 'kill [targets]', args: ['selector'], template: (v) => `kill${v.targets ? ' ' + v.targets : ''}` }] },
  { name: 'clear', category: '物品', since: '1.0', desc: '清空物品', forms: [{ since: '1.13', syntax: 'clear [targets] [item] [maxCount]', args: ['selector', 'item', 'number'], template: (v) => `clear${v.targets ? ' ' + v.targets : ''}${v.item ? ' ' + v.item : ''}${v.count ? ' ' + v.count : ''}` }] },
  { name: 'weather', category: '世界', since: '1.4', desc: '天气', forms: [{ since: '1.4', syntax: 'weather <type> [duration]', args: ['string', 'number'], template: (v) => `weather ${v.value || 'clear'}` }] },
  { name: 'advancement', category: '玩家', since: '1.12', desc: '进度管理', forms: [{ since: '1.13', syntax: 'advancement grant|revoke <targets> <…>', args: ['selector', 'string'], template: (v) => `advancement grant ${v.targets} everything` }] },
  { name: 'attribute', category: '实体', since: '1.16', desc: '实体属性', forms: [{ since: '1.16', syntax: 'attribute <target> <attribute> get|base|modifier <…>', args: ['selector', 'string', 'string'], template: (v) => `attribute ${v.targets} ${v.attribute || 'minecraft:generic.max_health'} get` }] },
  { name: 'return', category: '函数', since: '1.20.2', desc: '函数返回值', forms: [{ since: '1.20.2', syntax: 'return <value> | return run <command>', args: ['string'], template: (v) => `return ${v.value || 0}` }] },
  { name: 'ride', category: '实体', since: '1.19.4', desc: '骑乘控制', forms: [{ since: '1.19.4', syntax: 'ride <target> mount|dismount <vehicle>', args: ['selector', 'selector'], template: (v) => `ride ${v.targets} mount ${v.vehicle || '@e[limit=1]'}` }] },
  { name: 'damage', category: '实体', since: '1.19.4', desc: '造成伤害', forms: [{ since: '1.19.4', syntax: 'damage <target> <amount> [<damageType>] [at <location>|by <entity>]', args: ['selector', 'number', 'string'], template: (v) => `damage ${v.targets} ${v.amount || 1} ${v.type || 'minecraft:generic'}` }] },
  { name: 'dialog', category: '文本', since: '1.21.6', desc: '显示对话框', forms: [{ since: '1.21.6', syntax: 'dialog show <targets> <dialog>', args: ['selector', 'string'], template: (v) => `dialog show ${v.targets} ${v.dialog}` }] },
];

/* ------------------------------------------------------------------
 * 全量命令目录：wiki 全表（102 条）为主干，现有手写 forms 作为「富表单」叠加。
 * 之前只有 30 条手写命令 → 用户报障「命令没那么少，多看看 wiki 的命令分类」。
 * 现在目录、分类、描述、权限等级全部以 wiki 为准；富交互表单仍是手写的，二者按名字合并。
 * ------------------------------------------------------------------ */
const RICH_FORMS = new Map(COMMANDS.map((c) => [c.name, c]));
const SCOPE_TO_CAT = { player: '玩家', mobs: '实体', blocks: '方块', world: '世界' };

/** 引入版本未核实的命令，其版本下界取 1.13（扁平化）。
 *  依据：wiki 命令表中「历史」未核实引入版本的条目，全部属于 1.13 及之后；
 *  给它一个 1.13 下界可以保证远古 / 1.12 及以前不会误判为可用，同时不影响现代版本。
 *  该假设在数据上被显式标记为 sinceAssumed，UI 会提示「引入版本未核实」。 */
export const UNKNOWN_SINCE_FLOOR = '1.13';

export const ALL_COMMANDS = WIKI_COMMANDS.map((w) => {
  const rich = RICH_FORMS.get(w.name);
  const cats = w.scopes.map((s) => SCOPE_TO_CAT[s]).filter(Boolean);
  if (w.dedicated) cats.push('仅专用服务端');
  if (w.debug) cats.push('调试命令');
  if (!cats.length) cats.push('通用');
  const since = w.since ?? rich?.since ?? null;
  return {
    name: w.name,
    desc: w.desc,                       // 中文描述，逐字来自 wiki
    category: cats[0],
    categories: cats,
    scopes: w.scopes,
    perm: w.perm,
    dedicated: w.dedicated,
    debug: w.debug,
    since,
    sinceKnown: since != null,
    sinceAssumed: since == null,        // true → 版本下界按 1.13，UI 需提示未核实
    icon: rich?.icon || null,
    forms: rich?.forms || [],
    hasForm: !!(rich?.forms && rich.forms.length),
  };
});

const ALL_BY_NAME = new Map(ALL_COMMANDS.map((c) => [c.name, c]));

export { CMD_CATEGORIES, commandsInCategory, searchCommands, CMD_SCOPE_LABEL, PERM_LABEL };

/** 分类列表（兼容旧 UI：富表单里的业务分类） */
export const CATEGORIES = Array.from(new Set(COMMANDS.map((c) => c.category)));

/** 取某命令在某版本下的语法形式 */
export function formFor(cmd, version) {
  if (!cmd || !cmd.forms || !cmd.forms.length) return null;
  const idx = versionOrder(version);
  let best = null;
  let untagged = null;
  for (const f of cmd.forms) {
    // 没标 since 的表单视为「通用表单」，只在没有更精确匹配时兜底用
    if (!f.since) { if (!untagged) untagged = f; continue; }
    if (versionOrder(f.since) > idx) continue;
    if (f.until && versionOrder(f.until) < idx) continue;
    if (!best || versionOrder(f.since) > versionOrder(best.since)) best = f;
  }
  // ⚠️ 这里**绝对不能**写成 `best || cmd.forms[cmd.forms.length - 1]`。
  // 那样在没有表单匹配该版本时会兜底返回最后一个表单，等于让旧版本拿到新版本的语法：
  // /fill 只记了 1.13+ 一条，1.12.2 就会产出 `/fill ~ ~ ~ ~ ~2 ~ 1` 这种根本不存在的命令。
  // 匹配不到就返回 null，由调用方展示「未取证」，绝不编语法。
  return best || untagged || null;
}

/* versionOrder 已下沉到 versions.js（版本逻辑集中一处，便于单测） */

/** 某命令在某版本是否可用（含 since 未核实时的 1.13 下界） */
export function commandAvailable(cmd, version) {
  const idx = versionOrder(version);
  return versionOrder(cmd.since ?? UNKNOWN_SINCE_FLOOR) <= idx;
}

/** 该版本可用的命令（全量目录） */
export function commandsFor(version) {
  const idx = versionOrder(version);
  return ALL_COMMANDS.filter((c) => versionOrder(c.since ?? UNKNOWN_SINCE_FLOOR) <= idx);
}

/* ============================ 物品堆叠参数 ============================ */

/**
 * 生成命令里的物品参数
 * @param {string} version
 * @param {object} o { item, count, nbt, components }
 */
export function buildItemArg(version, { item = 'minecraft:stone', count = 1, nbt = '', components = {}, componentList = [] } = {}) {
  const style = stackSyntax(version);
  if (style === 'components') {
    const parts = [];
    if (components && typeof components === 'object' && Object.keys(components).length) {
      for (const [k, v] of Object.entries(components)) parts.push(`${k}=${v}`);
    }
    for (const c of componentList) if (c) parts.push(c);
    const comp = parts.length ? `[${parts.join(',')}]` : '';
    return { arg: `${item}${comp}`, count, style, note: '1.20.5+ 数据组件语法' };
  }
  const nbtPart = nbt && nbt.trim() && nbt.trim() !== '{}' ? (nbt.trim().startsWith('{') ? nbt.trim() : `{${nbt.trim()}}`) : '';
  return { arg: `${item}${nbtPart}`, count, style, note: '1.20.4- NBT 语法' };
}

/** 生成 /give */
export function buildGive(version, { targets = '@s', item = 'minecraft:stone', count = 1, nbt = '', components = {}, componentList = [] } = {}) {
  const style = stackSyntax(version);
  if (style === 'components') {
    const { arg } = buildItemArg(version, { item, components, componentList });
    return `give ${targets} ${arg}${count && count !== 1 ? ' ' + count : ''}`;
  }

  // 组件时代之前：调用方可能仍在传组件，必须自动降级成 NBT，
  // 否则切到旧版本时组件会被静默丢弃（曾产出 `give @s minecraft:diamond_sword`，属性全没了）。
  let effNbt = nbt;
  if (!effNbt) {
    const asObj = {};
    for (const c of componentList) {
      const i = indexOfTopLevel(c, '=');
      if (i > 0) asObj[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    }
    for (const [k, v] of Object.entries(components || {})) asObj[k] = v;
    if (Object.keys(asObj).length) {
      const back = componentsToNbt(asObj);
      if (back && Object.keys(back).length) effNbt = toSNBT(back);
    }
  }

  // 1.12 及以前：/give 是 give <player> <item> <amount> <data> <dataTag>（带 [data] 数字项）
  const modern = isDatapackEra(version);
  if (modern) {
    const { arg } = buildItemArg(version, { item, nbt: effNbt });
    return `give ${targets} ${arg}${count && count !== 1 ? ' ' + count : ''}`;
  }
  return `give ${targets} ${item.replace('minecraft:', '')} ${count} 0 ${effNbt && effNbt.trim() ? (effNbt.trim().startsWith('{') ? effNbt.trim() : `{${effNbt.trim()}}`) : '{}'}`;
}

/** 生成 /setblock */
export function buildSetblock(version, { pos = '~ ~ ~', block = 'minecraft:stone', states = '', nbt = '', mode = '' } = {}) {
  const modern = isDatapackEra(version);
  const blockArg = `${block}${states ? `[${states}]` : ''}`;
  if (modern) return `setblock ${pos} ${blockArg}${nbt && nbt.trim() && nbt.trim() !== '{}' ? nbt : ''}${mode ? ' ' + mode : ''}`;
  return `setblock ${pos} ${block.replace('minecraft:', '')} 0 ${mode || 'replace'} ${nbt || '{}'}`;
}

/** 生成 /summon */
export function buildSummon(version, { entity = 'minecraft:pig', pos = '', nbt = '' } = {}) {
  const modern = isDatapackEra(version);
  if (modern) return `summon ${entity}${pos ? ' ' + pos : ''}${nbt && nbt.trim() && nbt.trim() !== '{}' ? ' ' + nbt : ''}`;
  return `summon ${entity.replace('minecraft:', '')} ${pos || '~ ~ ~'} ${nbt || '{}'}`;
}

/** 生成 /particle */
export function buildParticle(version, { particle = 'minecraft:flame', pos = '~ ~1 ~', delta = '0.2 0.2 0.2', speed = 1, count = 10, mode = 'normal', viewers = '' } = {}) {
  const modern = isDatapackEra(version);
  if (modern) return `particle ${particle} ${pos} ${delta} ${speed} ${count} ${mode}${viewers ? ' ' + viewers : ''}`;
  const q = (s) => s.replace(/[~^]/g, '0').split(/\s+/).map((n) => Number(n) || 0);
  const [x, y, z] = q(pos), [dx, dy, dz] = q(delta);
  return `particle ${particle.replace('minecraft:', '')} ${x} ${y} ${z} ${dx} ${dy} ${dz} ${speed} ${count}`;
}

/* ============================ 命令解析 / 高亮 ============================ */

export function tokenizeCommand(text) {
  const out = [];
  const re = /(\s+)|("[^"]*"|'[^']*')|([^\s]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) out.push({ type: 'ws', v: m[1] });
    else if (m[2]) out.push({ type: 'str', v: m[2] });
    else out.push({ type: 'tok', v: m[3] });
  }
  return out;
}

export function commandName(text) {
  const t = String(text || '').trim().replace(/^\//, '');
  if (!t) return '';
  return t.split(/\s+/)[0];
}

export function findCommand(name) { return ALL_BY_NAME.get(String(name || '').toLowerCase()) || null; }

export function highlightCommand(text, version = null) {
  const esch = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const parts = tokenizeCommand(String(text || ''));
  const cmd = commandName(text);
  let i = 0;
  return parts.map((p) => {
    if (p.type === 'ws') return p.v;
    const first = i++ === 0;
    if (first) return `<span class="k-lit">${esch(p.v)}</span>`;
    if (p.type === 'str') return `<span class="k-str">${esch(p.v)}</span>`;
    const v = p.v;
    if (/^[@][aprsen]/.test(v)) return `<span class="k-sel">${esch(v)}</span>`;
    if (/^-?[\d.~^]/.test(v) || /^[~^]/.test(v)) return `<span class="k-num">${esch(v)}</span>`;
    if (/^(minecraft:)?[a-z0-9_]+(:[a-z0-9_/]+)?/.test(v)) return `<span class="k-str">${esch(v)}</span>`;
    void cmd; void version;
    return esch(v);
  }).join('');
}

/** 简单的命令校验：命令是否存在、必填参数是否够 */
export function validateCommand(text, version) {
  const t = String(text || '').trim().replace(/^\//, '');
  if (!t) return { ok: false, level: 'error', message: '命令为空' };
  const name = commandName(t);
  const cmd = findCommand(name);
  if (!cmd) return { ok: false, level: 'warning', message: `未知命令 /${name}（可能是模组或新版本命令）`, name };
  const idx = versionOrder(version);
  if (versionOrder(cmd.since) > idx) {
    return { ok: false, level: 'error', message: `/${name} 在 ${version} 中还不存在（自 ${cmd.since} 起可用）`, name, cmd };
  }
  const form = formFor(cmd, version);
  const need = (form.syntax.match(/<[^>]+>/g) || []).length;
  const got = t.split(/\s+/).length - 1;
  if (got < need) return { ok: false, level: 'warning', message: `参数不足：${form.syntax}（已给 ${got}，至少需要 ${need}）`, name, cmd, form };
  return { ok: true, level: 'ok', message: `/${name} 语法形式：${form.syntax}`, name, cmd, form };
}

/** 解析物品参数（反向：从命令里抽出物品与 NBT/组件） */
export function parseItemArg(arg, version) {
  const style = stackSyntax(version);
  if (style === 'components') {
    const m = /^([^\[\{]+)(?:\[(.*)\])?$/.exec(arg || '');
    if (!m) return { item: arg, components: {} };
    return { item: m[1], components: m[2] ? parseComponentList(m[2]) : {} };
  }
  const m = /^([^\{]+)(?:\{(.*)\})?$/.exec(arg || '');
  return { item: m ? m[1] : arg, nbt: m && m[2] ? `{${m[2]}}` : '' };
}

/** 解析 [key=value,key2=value2] —— 只在顶层逗号分割 */
export function parseComponentList(text) {
  const out = {};
  const parts = splitTopLevel(text, ',');
  for (const p of parts) {
    const eq = indexOfTopLevel(p, '=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

export function splitTopLevel(text, sep = ',') {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === q && text[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('[{('.includes(c)) depth++;
    if (']})'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

export function indexOfTopLevel(text, ch) {
  let depth = 0, q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q && text[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if ('[{('.includes(c)) depth++;
    if (']})'.includes(c)) depth--;
    if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** 从 SNBT 对象生成组件列表（1.20.5+ 物品迁移用） */
export function nbtToComponents(nbtObj) {
  const map = {
    CustomName: (v) => ['custom_name', typeof v === 'string' ? v : JSON.stringify(v)],
    Lore: (v) => ['lore', JSON.stringify(v)],
    Enchantments: (v) => ['enchantments', `{levels:${nbtEnchToComponents(v)}}`],
    Unbreakable: (v) => (Number(v) ? ['unbreakable', '{}'] : null),
    HideFlags: () => null,
    CustomModelData: (v) => ['custom_model_data', String(Number(v))],
    AttributeModifiers: () => null,
    CustomData: (v) => ['custom_data', toSNBT(v ?? {})],
    display: () => null,
  };
  const out = {};
  if (!nbtObj || typeof nbtObj !== 'object') return out;
  for (const [k, v] of Object.entries(nbtObj)) {
    const f = map[k];
    if (!f) continue;
    const r = f(v);
    if (r) out[r[0]] = r[1];
  }
  return out;
}

function nbtEnchToComponents(v) {
  const inner = {};
  const list = Array.isArray(v) ? v : [];
  for (const e of list) {
    if (!e) continue;
    const id = typeof e.id === 'string' ? e.id : String(e.id ?? '');
    const lvl = e.lvl instanceof NBTNumber ? e.lvl.valueOf() : (e.lvl ?? 1);
    if (id) inner[id] = Number(lvl);
  }
  return toSNBT(inner).replace(/i\b/g, '').replace(/"([^"]+)":/g, '"$1":');
}

/** 反向：组件 → 旧 NBT（给低版本用） */
export function componentsToNbt(comps) {
  const out = Object.create(null);
  if (!comps) return out;
  const val = (x) => { const r = parseSNBT(x); return r.ok ? r.value : x; };
  if (comps.custom_name) out.CustomName = typeof val(comps.custom_name) === 'string' ? val(comps.custom_name) : JSON.stringify(val(comps.custom_name));
  if (comps.lore) out.Lore = val(comps.lore);
  if (comps.custom_data) out.CustomData = val(comps.custom_data);
  if (comps.custom_model_data) out.CustomModelData = new NBTNumber(Number(comps.custom_model_data) || 0, 'i');
  if (comps.unbreakable) out.Unbreakable = new NBTNumber(1, 'b');
  if (comps.enchantments) {
    const e = val(comps.enchantments);
    const levels = e && e.levels ? e.levels : e;
    const list = [];
    if (levels && typeof levels === 'object') for (const [k, v] of Object.entries(levels)) list.push({ id: k, lvl: new NBTNumber(Number(v) || 1, 's') });
    out.Enchantments = list;
  }
  return out;
}
