// autocomplete.js —— NBT / SNBT / 物品组件 的键与值补全（自包含，零全局样式冲突）
//
// 设计约束（父代理并行改 app.css，故本模块不许碰它）：
//   · 需要的所有 CSS 由本文件底部的 ensureStyles() 注入，检查 #mce-ac-style 幂等，
//     绝不往 src/app.css 里加规则。
//   · 颜色复用 app.css 已有的 CSS 变量与 .k-* 令牌类，深浅主题都自动跟随。
//
// 补全来源一律是「可取证数据」：
//   键    → src/data/nbt-labels.js（逐条抄自 zh.minecraft.wiki，见该文件顶部出处）
//   值    → state.registry（真实 jar / GitHub 资源索引）优先；wiki 枚举（附魔、属性、颜色、
//           运算模式、爆炸类型、HideFlags 位域…）作为补充，每条都在 WIKI_ENUMS 里标了出处。

import { h, clear, esc } from '../core/util.js';
import { state } from '../core/store.js';
import { searchEntries } from '../core/fuzzy.js';
import { searchNbtTags, nbtLookup, nbtTypeLabel } from '../data/nbt-labels.js';
import { ALL_COMPONENTS, searchComponents, componentById } from '../data/components-wiki.js';

/* ============================== 样式（幂等注入） ============================== */

const CSS = `
/* ---- SNBT / JSON 高亮编辑区：pre 与 textarea 叠在同一个 grid 格子里 ---- */
.snbt-box {
  display: grid; width: 100%; position: relative;
  background: var(--card-bg-secondary, rgba(0,0,0,.22));
  border: 1px solid var(--card-stroke, rgba(128,128,128,.16));
  border-radius: var(--radius-md, 6px);
}
.snbt-box > .snbt-hl,
.snbt-box > .snbt-edit {
  grid-area: 1 / 1;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: inherit; line-height: 1.6;
  margin: 0; padding: 10px 12px; border: 0; box-sizing: border-box;
  white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word;
  tab-size: 2; min-width: 0;
}
.snbt-box > .snbt-hl {
  overflow: hidden; pointer-events: none; color: var(--text-primary);
  background: transparent;
}
.snbt-box > .snbt-edit {
  display: block; resize: vertical; background: transparent;
  color: transparent; caret-color: var(--text-primary); outline: none;
  overflow: auto;
}
.snbt-box:focus-within { border-color: var(--accent, #0067c0); }
.snbt-box > .snbt-edit::selection { background: rgba(0,103,192,.42); }
.snbt-box > .snbt-edit::placeholder { color: var(--text-tertiary, #888); }
@media (prefers-reduced-motion: no-preference) { .snbt-box { transition: border-color .12s ease; } }

/* app.css 只把 .k-* 定义在 .code 下；高亮编辑区不在 .code 里，这里补同一套配色 */
.snbt-box .k-lit { color: #7ec8ff; }
.snbt-box .k-num { color: #b5e8a0; }
.snbt-box .k-str { color: #ffcc80; }
.snbt-box .k-sel { color: #d6a2ff; }
.snbt-box .k-key { color: #8fd3ff; }
.snbt-box .k-err { color: #ff8a80; }

/* ---- 补全浮层 ---- */
.ac-pop {
  position: fixed; z-index: 9000; min-width: 260px; max-width: 460px; max-height: 300px; overflow: auto;
  padding: 4px; border-radius: var(--radius-md, 6px);
  background: var(--flyout-bg, var(--card-bg, #2b2b2b));
  border: 1px solid var(--flyout-border, var(--card-stroke, rgba(128,128,128,.3)));
  box-shadow: 0 10px 28px rgba(0,0,0,.4);
  font-size: 12.5px;
}
.ac-head {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px 6px;
  color: var(--text-tertiary, #999); font-size: 11px;
  border-bottom: 1px solid var(--divider-stroke, rgba(128,128,128,.16)); margin-bottom: 4px;
}
.ac-item {
  display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border-radius: 4px;
  cursor: default; white-space: nowrap;
}
.ac-item.is-active { background: var(--accent-subtle, rgba(0,103,192,.22)); }
.ac-name { color: var(--text-primary); font-weight: 600; flex: 0 0 auto; }
.ac-key { font-family: var(--font-mono, Consolas, monospace); color: var(--text-tertiary, #999); flex: 0 1 auto;
  overflow: hidden; text-overflow: ellipsis; }
.ac-kind {
  flex: 0 0 auto; margin-left: auto; font-size: 10.5px; padding: 1px 6px; border-radius: 8px;
  background: var(--card-bg-secondary, rgba(128,128,128,.14)); color: var(--text-secondary, #bbb);
}
.ac-desc { padding: 6px 8px 2px; color: var(--text-tertiary, #999); font-size: 11px; line-height: 1.45;
  border-top: 1px solid var(--divider-stroke, rgba(128,128,128,.16)); margin-top: 3px; white-space: normal; }
.ac-empty { padding: 8px; color: var(--text-tertiary, #999); font-size: 11.5px; }
.ac-nbt-name { font-size: 11px; color: var(--accent, #4cc2ff); }
`;

/** 幂等注入样式：只要 #mce-ac-style 不在就挂一份。绝不改 app.css。 */
export function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('mce-ac-style')) return;
  document.head.appendChild(h('style#mce-ac-style', { text: CSS }));
}

/* ============================== wiki 枚举值（带出处） ============================== */

/**
 * 值候选取证表。
 * 每条 src 写明出处页面；有 since 的按 wiki 原文填，没有的为 null。
 */
export const WIKI_ENUMS = {
  // 来源：zh.minecraft.wiki「附魔」页附魔列表（name 取 wiki 中文译名）
  enchantment: [
    ['minecraft:aqua_affinity', '水下速掘'], ['minecraft:bane_of_arthropods', '节肢克星'],
    ['minecraft:binding_curse', '绑定诅咒'], ['minecraft:blast_protection', '爆炸保护'],
    ['minecraft:breach', '破甲'], ['minecraft:channeling', '引雷'],
    ['minecraft:depth_strider', '深海探索者'], ['minecraft:density', '密度'],
    ['minecraft:efficiency', '效率'], ['minecraft:feather_falling', '摔落保护'],
    ['minecraft:fire_aspect', '火焰附加'], ['minecraft:fire_protection', '火焰保护'],
    ['minecraft:flame', '火矢'], ['minecraft:fortune', '时运'],
    ['minecraft:frost_walker', '冰霜行者'], ['minecraft:impaling', '穿刺'],
    ['minecraft:infinity', '无限'], ['minecraft:knockback', '击退'],
    ['minecraft:looting', '抢夺'], ['minecraft:loyalty', '忠诚'],
    ['minecraft:luck_of_the_sea', '海之眷顾'], ['minecraft:lure', '饵钓'],
    ['minecraft:mending', '经验修补'], ['minecraft:multishot', '多重射击'],
    ['minecraft:piercing', '穿透'], ['minecraft:power', '力量'],
    ['minecraft:projectile_protection', '弹射物保护'], ['minecraft:protection', '保护'],
    ['minecraft:punch', '冲击'], ['minecraft:quick_charge', '快速装填'],
    ['minecraft:respiration', '水下呼吸'], ['minecraft:riptide', '激流'],
    ['minecraft:sharpness', '锋利'], ['minecraft:silk_touch', '精准采集'],
    ['minecraft:smite', '亡灵克星'], ['minecraft:soul_speed', '灵魂疾行'],
    ['minecraft:sweeping_edge', '横扫之刃'], ['minecraft:swift_sneak', '迅捷潜行'],
    ['minecraft:thorns', '荆棘'], ['minecraft:unbreaking', '耐久'],
    ['minecraft:vanishing_curse', '消失诅咒'], ['minecraft:wind_burst', '风爆'],
  ],
  // 来源：zh.minecraft.wiki「属性」页属性 ID 表
  attribute: [
    ['minecraft:generic.armor', '护甲'], ['minecraft:generic.armor_toughness', '盔甲韧性'],
    ['minecraft:generic.attack_damage', '攻击伤害'], ['minecraft:generic.attack_knockback', '攻击击退'],
    ['minecraft:generic.attack_speed', '攻击速度'], ['minecraft:generic.flying_speed', '飞行速度'],
    ['minecraft:generic.follow_range', '跟随范围'], ['minecraft:generic.knockback_resistance', '击退抗性'],
    ['minecraft:generic.luck', '幸运'], ['minecraft:generic.max_health', '最大生命值'],
    ['minecraft:generic.movement_speed', '移动速度'], ['minecraft:generic.scale', '体型'],
    ['minecraft:generic.step_height', '步高'], ['minecraft:horse.jump_strength', '马跳跃力'],
    ['minecraft:player.block_break_speed', '方块破坏速度'], ['minecraft:player.block_interaction_range', '方块交互距离'],
    ['minecraft:player.entity_interaction_range', '实体交互距离'], ['minecraft:player.mining_efficiency', '挖掘效率'],
    ['minecraft:player.sneaking_speed', '潜行速度'], ['minecraft:zombie.spawn_reinforcements', '增援生成概率'],
  ],
  // 来源：zh.minecraft.wiki「属性」页「运算模式」；旧 NBT 用数字 0/1/2（物品格式/通用标签）
  operation: [
    ['add_value', 'Op0：直接加上数值'], ['add_multiplied_base', 'Op1：基础值×数值后相加'],
    ['add_multiplied_total', 'Op2：总值×数值后相加'], ['0', 'Op0（旧 NBT 数字形式）'],
    ['1', 'Op1（旧 NBT 数字形式）'], ['2', 'Op2（旧 NBT 数字形式）'],
  ],
  // 来源：zh.minecraft.wiki「物品格式/Java版1.20.5前」→ 通用标签 AttributeModifiers.Slot
  slot: [
    ['mainhand', '主手'], ['offhand', '副手'], ['head', '头盔'], ['chest', '胸甲'],
    ['legs', '护腿'], ['feet', '靴子'], ['body', '身体'],
  ],
  // 来源：zh.minecraft.wiki「物品格式/Java版1.20.5前」→ 通用标签 HideFlags 位域
  hideflags: [
    ['1', '隐藏附魔信息'], ['2', '隐藏属性修饰符信息'], ['4', '隐藏无法破坏信息'],
    ['8', '隐藏可破坏方块信息'], ['16', '隐藏可放置方块信息'], ['32', '隐藏其他附加信息'],
    ['64', '隐藏染色信息'], ['128', '隐藏盔甲纹饰信息'], ['255', '隐藏全部附加信息'],
  ],
  // 来源：zh.minecraft.wiki「物品格式/Java版1.20.5前」→ 烟火之星 Explosion.Type
  firework_type: [
    ['0', '小型球状'], ['1', '大型球状'], ['2', '星形'], ['3', '苦力怕状'], ['4', '喷发状'],
  ],
  // 来源：zh.minecraft.wiki「物品格式/Java版1.20.5前」→ 成书 generation
  book_generation: [
    ['0', '原稿'], ['1', '原作的副本'], ['2', '副本的副本'], ['3', '破烂不堪'],
  ],
  // 来源：zh.minecraft.wiki「稀有度」
  rarity: [
    ['common', '常见'], ['uncommon', '少见'], ['rare', '稀有'], ['epic', '史诗'],
  ],
  // 来源：zh.minecraft.wiki「染料」16 种染料色（十进制 RGB）
  dye_color: [
    ['1908001', '白色'], ['1908001 ', '白色'], ['16733695', '橙色'], ['16777045', '品红色'],
    ['16776960', '黄色'], ['8439583', '黄绿色'], ['15961002', '粉红色'], ['5066033', '灰色'],
    ['11184810', '淡灰色'], ['5592575', '青色'], ['5636095', '紫色'], ['16711680', '红色'],
    ['0', '黑色'], ['5635925', '绿色'], ['11743532', '棕色'], ['16777215', '白色（纯白）'],
  ],
  // 来源：NBT格式「标签类型」的 SNBT 数值后缀（wiki 未给 SNBT 后缀表，改用本仓库 toSNBT 的既有约定）
  numeric_suffix: [
    ['b', '字节型 byte'], ['s', '短整型 short'], ['i', '整型 int'],
    ['l', '长整型 long'], ['f', '单精度浮点 float'], ['d', '双精度浮点 double'],
  ],
  // 来源：源码内核（非 wiki）—— SNBT 的结构关键字，仅作提示
  snbt_keyword: [
    ['[B;', '字节数组前缀 [B;]（整型数组 [I;]、长整型数组 [L;]）'],
    ['{', '复合标签开始'], ['[', '列表/数组开始'],
    ['true', '布尔真'], ['false', '布尔假'],
  ],
};

/* 当前键 → 值枚举的映射（键按末段比对，大小写不敏感） */
const VALUE_ENUM_BY_KEY = {
  enchantments: 'enchantment',
  stored_enchantments: 'enchantment',
  storedenchantments: 'enchantment',
  enchantment: 'enchantment',
  enchant: 'enchantment',
  attribute_modifiers: 'attribute',
  attributemodifiers: 'attribute',
  attributename: 'attribute',
  attribute: 'attribute',
  operation: 'operation',
  slot: 'slot',
  hideflags: 'hideflags',
  type: 'firework_type',
  generation: 'book_generation',
  rarity: 'rarity',
  color: 'dye_color',
  dyed_color: 'dye_color',
  base_color: 'dye_color',
  custompotioncolor: 'dye_color',
  base: 'dye_color',
  colors: 'dye_color',
  fadecolors: 'dye_color',
  lvl: 'numeric_suffix',
  level: 'numeric_suffix',
};

/* 注册表值枚举：键 → registry 里的集合名 */
const REGISTRY_ENUM_BY_KEY = {
  id: 'any',                // id 依上下文：物品条目的 id / 实体的 id
  entity: 'entities',
  entity_data: 'entities',
  entitytag: 'entities',
  type: 'entities',
  item: 'items',
  items: 'items',
  particle: 'particles',
  particles: 'particles',
};

/* ============================== 光标上下文分析 ============================== */

/**
 * 从 SNBT 文本 + 光标位置解析出「我在写哪个键的值 / 我在写哪个键名」。
 *
 * 返回值：
 *   { kind:'key',  prefix, path:[...], scope }
 *   { kind:'value', prefix, key, path:[...], enumKind, regKind, quote }
 *   null（不在任何可补全位置）
 */
export function analyzeContext(text, pos) {
  const src = String(text ?? '');
  const i = Math.max(0, Math.min(pos ?? src.length, src.length));

  // 跳过空白回看，找到「上一个非空白字符」和当前 token
  let j = i;
  while (j > 0 && /[\s,]/.test(src[j - 1])) j--;
  const before = src.slice(0, j);

  // 取当前 token 的起点
  let s = j;
  while (s > 0 && /[A-Za-z0-9_.:\-]/.test(src[s - 1])) s--;
  const token = j > s ? src.slice(s, j) : '';

  // 判断这个 token 属于「键位置」还是「值位置」：向前找一个非空的、在 token 之前的字符。
  // 关键点：值常常被引号包着（例：id: "minecraft:shar），此时上一个非空白字符是引号，
  // 真正的判定必须看**引号之前**那一个字符是不是冒号 —— 第一版漏了这一步，
  // 于是「打了一半的带引号值」永远不弹候选（实测 popVisible=false）。
  let k = s;
  while (k > 0 && /\s/.test(src[k - 1])) k--;
  let colonPos = -1;
  {
    const ch = k > 0 ? src[k - 1] : '';
    if (ch === ':' || ch === '=') {
      colonPos = k - 1;
    } else if (ch === '"' || ch === "'") {
      let q = k - 1;                              // 指向开引号
      while (q > 0 && /\s/.test(src[q - 1])) q--;
      const beforeQuote = q > 0 ? src[q - 1] : '';
      if (beforeQuote === ':' || beforeQuote === '=') colonPos = q - 1;
    }
  }
  const isValue = colonPos >= 0;

  const path = enclosingKeys(before);

  if (isValue) {
    // 上一层键：冒号之前的那个键名
    let ks = colonPos;
    while (ks > 0 && /[A-Za-z0-9_.:\-]/.test(src[ks - 1])) ks--;
    const key = src.slice(ks, colonPos);
    const parentKey = path.length ? path[path.length - 1] : '';
    // 值当前是否已经在引号里：从冒号到光标之间引号个数为奇数 ⇒ 在引号内
    let qc = 0, qch = null;
    for (let x = colonPos; x < i; x++) {
      if (src[x] === '"' || src[x] === "'") { qc++; qch = src[x]; }
    }
    const quote = (qc % 2 === 1) ? qch : null;
    const normKey = key.replace(/^!/, '').toLowerCase();
    const enumKind = VALUE_ENUM_BY_KEY[normKey] || enumKindByParent(parentKey);
    const regKind = REGISTRY_ENUM_BY_KEY[normKey] || regKindByKey(normKey, parentKey);
    return {
      kind: 'value', prefix: quote ? '' : token, trailingToken: token,
      key, parentKey, quote, path, enumKind, regKind,
      rawPrefix: token,
    };
  }

  // 键位置：如果在引号里就不补（键几乎不需要引号）
  const prevCh = k > 0 ? src[k - 1] : '';
  if (prevCh === '"' || prevCh === "'") return null;
  return { kind: 'key', prefix: token, path, scope: scopeFromPath(path) };
}

/** 收集光标前所有还在打开的复合/列表的键名（粗暴但足够稳的栈式扫描） */
function enclosingKeys(text) {
  const stack = [];
  let inStr = null;
  for (let x = 0; x < text.length; x++) {
    const c = text[x];
    if (inStr) {
      if (c === '\\') { x++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{' || c === '[') {
      // 记录这个容器所属的键：向前找 '<key>:' 或 '<key>='
      let y = x - 1;
      while (y >= 0 && /\s/.test(text[y])) y--;
      const close = text[y];
      let key = '';
      if (close === ':' || close === '=') {
        let e = y;
        while (e > 0 && /\s/.test(text[e - 1])) e--;
        let st = e;
        while (st > 0 && /[A-Za-z0-9_.:\-]/.test(text[st - 1])) st--;
        key = text.slice(st, e);
      }
      stack.push(key);
      continue;
    }
    if (c === '}' || c === ']') stack.pop();
  }
  return stack.filter(Boolean);
}

function enumKindByParent(parentKey) {
  const k = String(parentKey || '').toLowerCase();
  return VALUE_ENUM_BY_KEY[k] || null;
}

function regKindByKey(normKey, parentKey) {
  if (normKey === 'id') {
    // id 在物品条目里是物品，在实体/效果里是实体/效果
    const p = String(parentKey || '').toLowerCase();
    if (p === 'effect' || p === 'effects' || p === 'active_effects' || p === 'hidden_effect' || p === 'custompotioneffects') return 'effect';
    if (p === 'passengers' || p === 'entitytag' || p === 'entity_data') return 'entities';
    return 'items';
  }
  return REGISTRY_ENUM_BY_KEY[normKey] || null;
}

/** 由路径猜作用域，用于把键候选收敛到该作用域 */
function scopeFromPath(path) {
  const flat = path.join('.').toLowerCase();
  if (/enchant|display|unbreakable|attributemodifiers|hideflags|repairst|damage|trim|fireworks|explosion|skullowner|pages|potion/.test(flat)) return '物品';
  if (/attributes|active_effects|health|brain|equipment|memories|leash|home_/.test(flat)) return '生物';
  if (/items|loottable/.test(flat)) return '容器方块实体';
  return null;
}

/* ============================== 候选生成 ============================== */

/** 键候选：来自 nbt-labels.js 取证表 */
export function keyCandidates(ctx, limit = 40) {
  const scope = ctx && ctx.scope && ctx.scope !== '通用' ? ctx.scope : null;
  return searchNbtTags(ctx ? ctx.prefix : '', { scope, limit }).map((t) => ({
    value: t.key,
    label: t.name,
    key: t.key,
    kind: t.scope,
    type: t.type,
    typeLabel: nbtTypeLabel(t.type),
    desc: t.desc,
    since: t.since,
    source: 'nbt-labels',
  }));
}

/** 组件键候选：来自 components-wiki.js（ALL_COMPONENTS 的字段是 id/name/sample/group/since） */
export function componentKeyCandidates(prefix, limit = 40) {
  const all = (ALL_COMPONENTS || []).map((c) => ({
    value: c.id,
    label: c.name,
    key: c.id,
    kind: '组件',
    type: c.sample ? 'string' : 'any',
    typeLabel: `${c.group}${c.sample ? ` · ${c.sample}` : ''}`,
    desc: c.name + (c.sample ? `，示例值 ${c.sample}` : ''),
    since: c.since ?? null,
    source: 'components-wiki',
  }));
  const q = String(prefix || '').trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const exact = [], pre = [], other = [];
  for (const c of all) {
    const k = c.key.toLowerCase(), n = String(c.label || '').toLowerCase();
    if (k === q || n === q) exact.push(c);
    else if (k.startsWith(q) || n.startsWith(q)) pre.push(c);
    else if (k.includes(q) || n.includes(q)) other.push(c);
  }
  return [...exact, ...pre, ...other].slice(0, limit);
}

/** 值候选：注册表优先，其次 wiki 枚举 */
export function valueCandidates(ctx, limit = 40) {
  const q = String((ctx && (ctx.prefix || ctx.rawPrefix)) || '').trim();
  const pool = [];
  const pushReg = (list, kindName) => {
    if (!list || !list.length) return;
    for (const e of list) {
      pool.push({
        value: e.id,
        label: e.name && e.name !== e.id ? e.name : e.id,
        key: e.id, kind: kindName, type: 'string',
        typeLabel: kindName, desc: '', since: null, source: 'registry', icon: e.icon || null,
      });
    }
  };

  const reg = state.registry;
  if (reg && ctx) {
    const rk = ctx.regKind;
    if (rk === 'items' || rk === 'any') pushReg(reg.items, '物品');
    if (rk === 'entities' || rk === 'any') pushReg(reg.entities, '实体');
    if (rk === 'particles') pushReg(reg.particles, '粒子');
    if (rk === 'effect') {
      // 注册表没有效果表；用 wiki 枚举的效果名兜底
    }
  }

  const ek = ctx && ctx.enumKind;
  if (ek && WIKI_ENUMS[ek]) {
    for (const [v, d] of WIKI_ENUMS[ek]) {
      pool.push({ value: v, label: d, key: v, kind: 'wiki', type: 'enum', typeLabel: 'wiki 枚举', desc: d, since: null, source: 'wiki-enum' });
    }
  }

  if (!pool.length) return [];
  // 用 fuzzy 排序：id / 中文名 / 值三者都能命中
  const entries = pool.map((p) => ({ id: p.key, name: p.label, __p: p }));
  const ranked = q ? searchEntries(entries, q, { limit }) : entries.slice(0, limit);
  const out = [];
  for (const e of ranked) if (e && e.__p) out.push(e.__p);
  return out.slice(0, limit);
}

/* ============================== 浮层控件 ============================== */

/**
 * 把补全浮层绑到一个 textarea 上。
 *
 * @param {HTMLTextAreaElement} ta
 * @param {object} opt
 *   opt.provider(text, caret) -> { items, kind } | null
 *       items: [{ value, label, key, kind, typeLabel, desc }]
 *       kind:  'key' | 'value'（只用于标题文案）
 *   opt.onAccept(item, ctx, ta)   默认行为见下
 *   opt.applyText(text, caret, item, ctx) -> { text, caret }  自定义插入
 * @returns {{ close():void, refresh():void, isOpen():boolean, el:HTMLElement }}
 */
export function attachAutocomplete(ta, opt = {}) {
  ensureStyles();
  const pop = h('div.ac-pop', { style: { display: 'none' } });
  document.body.appendChild(pop);

  let items = [];
  let active = 0;
  let ctx = null;
  let provider = opt.provider;
  let open = false;

  const close = () => { open = false; pop.style.display = 'none'; };
  const isOpen = () => open;

  function position() {
    const r = ta.getBoundingClientRect();
    const lineH = 21;
    const lines = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    let y = r.top + 10 + (lines + 1) * lineH - ta.scrollTop;
    y = Math.max(6, Math.min(y, window.innerHeight - 240));
    let x = r.left + 14;
    x = Math.max(6, Math.min(x, window.innerWidth - 470));
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }

  function render() {
    clear(pop);
    const head = h('div.ac-head', null, [
      h('span', { text: ctx && ctx.kind === 'value' ? '值候选' : 'NBT 键候选' }),
      h('span', { text: `· ${items.length} 条` }),
      ctx && ctx.key ? h('span.ac-nbt-name', { text: `（当前键 ${ctx.key}）` }) : null,
      h('span', { style: { marginLeft: 'auto' }, text: '↑↓ 选择 · Enter/Tab 确认 · Esc 关闭' }),
    ]);
    pop.appendChild(head);
    if (!items.length) {
      pop.appendChild(h('div.ac-empty', { text: '没有取证过的候选项（不编造）：换个前缀，或到 wiki 对应页面确认该键名。' }));
      return;
    }
    items.forEach((it, idx) => {
      const row = h('div.ac-item' + (idx === active ? '.is-active' : ''), {
        onmousedown: (e) => { e.preventDefault(); active = idx; accept(); },
        onmouseenter: () => { active = idx; render(); },
      }, [
        h('span.ac-name', { text: it.label || it.value }),
        h('span.ac-key', { text: it.key || it.value }),
        h('span.ac-kind', { text: it.typeLabel || it.kind || '' }),
      ]);
      pop.appendChild(row);
    });
    const cur = items[active];
    if (cur && (cur.desc || cur.since)) {
      pop.appendChild(h('div.ac-desc', {
        text: (cur.desc || '') + (cur.since ? `（引入版本：${cur.since}）` : ''),
      }));
    }
  }

  function defaultApply(text, caret, item, c) {
    const isValue = c && c.kind === 'value';
    // 替换掉当前正在输入的 token
    const start = isValue ? caret - (c.quote ? (c.trailingToken || '').length : (c.rawPrefix || '').length) : caret - (c.prefix || '').length;
    const before = text.slice(0, Math.max(0, start));
    const after = text.slice(caret);
    let ins = String(item.value);
    if (isValue) {
      if (c.quote) ins = ins;                       // 已在引号内：只填内容
      else if (item.type === 'enum' && /^[a-z_/]+$/.test(ins) && !/^\d/.test(ins) && c.enumKind === 'enchantment') ins = `"${ins}"`;
      else if (item.source === 'registry' && /^[a-z0-9_]+:/.test(ins)) ins = `"${ins}"`;
    } else {
      ins = `${ins}: `;
    }
    const nextText = before + ins + after;
    return { text: nextText, caret: before.length + ins.length };
  }

  function accept() {
    const it = items[active];
    if (!it) return;
    const apply = opt.applyText || defaultApply;
    const { text, caret } = apply(ta.value, ta.selectionStart, it, ctx);
    ta.value = text;
    ta.selectionStart = ta.selectionEnd = caret;
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (opt.onAccept) opt.onAccept(it, ctx, ta);
  }

  const refresh = () => {
    if (typeof document.hidden === 'boolean' && document.hidden) return;
    const res = provider(ta.value, ta.selectionStart);
    if (!res || !res.items || !res.items.length) { close(); return; }
    // 只有一个候选且与已输入完全一致时不必打扰
    if (res.items.length === 1 && res.items[0].value === res.ctxPrefix && res.ctxPrefix) { close(); return; }
    items = res.items;
    ctx = res.ctx || null;
    active = 0;
    open = true;
    render();
    position();
    pop.style.display = '';
  };

  ta.addEventListener('input', refresh);
  ta.addEventListener('click', () => { if (open) refresh(); else close(); });
  ta.addEventListener('blur', () => setTimeout(close, 120));
  ta.addEventListener('keydown', (e) => {
    if (!open) {
      // Ctrl+Space 手动唤起
      if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); refresh(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); position(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); position(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  const onScroll = () => { if (open) position(); };
  ta.addEventListener('scroll', onScroll);
  window.addEventListener('resize', onScroll);

  return { close, refresh, isOpen, el: pop };
}

/* ============================== 组合入口 ============================== */

/**
 * 给一个 SNBT 文本框装上「键补全 + 值补全」。一行搞定，页面不用关心细节。
 * @returns {{ detach():void }} 只有需要在销毁时清理浮层才用得上
 */
export function enableSnbtAutocomplete(ta, { mode = 'snbt' } = {}) {
  ensureStyles();
  const ac = attachAutocomplete(ta, {
    provider(text, caret) {
      const ctx = analyzeContext(text, caret);
      if (!ctx) return null;
      if (mode === 'component-key') {
        const items = componentKeyCandidates(ctx.prefix);
        return items.length ? { items, ctx: { ...ctx, kind: 'key' }, ctxPrefix: ctx.prefix } : null;
      }
      if (mode === 'component-value') {
        const items = valueCandidates(ctx);
        return items.length ? { items, ctx, ctxPrefix: ctx.prefix } : null;
      }
      if (ctx.kind === 'key') {
        const items = keyCandidates(ctx);
        // 值位置也可能需要组件键（物品的 components:{...} 里）
        return items.length ? { items, ctx, ctxPrefix: ctx.prefix } : null;
      }
      const items = valueCandidates(ctx);
      return items.length ? { items, ctx, ctxPrefix: ctx.prefix } : null;
    },
  });
  return {
    detach() { ac.close(); ac.el.remove(); },
    ac,
  };
}

/** 结构树用：取某个键的中文名 + 类型（查不到返回 null，调用方显示「未取证」） */
export function nbtKeyInfo(key) {
  return nbtLookup(key);
}

/** 结构树用：中文名一行小字（title 属性也用这个） */
export function nbtKeyHint(key) {
  const info = nbtLookup(key);
  if (!info) return null;
  const type = nbtTypeLabel(info.type);
  return { name: info.name, type, text: `${info.name} · ${type}（${info.scope}）`, desc: info.desc, since: info.since };
}

export { componentById, searchComponents };
// 供页面（nbt.js / components.js）直接取用的查表函数，避免它们各自 import 数据层两次
export { nbtLookup, nbtLabel, nbtTypeLabel, searchNbtTags, NBT_TAGS, NBT_TAG_TYPES, NBT_LABEL_SOURCES, SCOPE } from '../data/nbt-labels.js';
