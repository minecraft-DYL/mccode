// components-wiki.js —— 物品数据组件全表（含中文名 + 引入版本）
//
// 【组件清单来源】zh.minecraft.wiki「数据组件」section=6「数据组件类型」
//   https://zh.minecraft.wiki/index.php?title=数据组件&action=raw&section=6
//   该节由 wiki 用 columns-list 逐条列出组件 ID 与中文释义，本文件逐条抄录，未增补未取证条目。
//   共 89 个常规组件 + 29 个实体变种组件 + 3 个临时组件 = 121 条。
//
// 【since（引入版本）取证来源】三条互相独立的证据链，逐条可追溯：
//   ① 数据组件 section=130「历史」——逐快照记录「加入了 X 组件」
//      https://zh.minecraft.wiki/index.php?title=数据组件&action=raw&section=130
//      这条覆盖 1.20.5(24w10a 之后) / 1.21 / 1.21.2 / 1.21.5 / 1.21.11 / 26.1 / 26.2 / 26.3 的绝大部分新增。
//   ② Java版24w09a section=2「新内容/常规」——组件化首批的权威名单
//      https://zh.minecraft.wiki/index.php?title=Java版24w09a&action=raw&section=2
//      wiki 原文：「加入了以下物品堆叠组件（均省略命名空间 minecraft:）：」随后 treeview 逐条列出。
//      1.20.5 的 49 条基本来自这里（历史节对首批只写了「加入了数据组件。」一句，不逐个列名）。
//   ③ 人工补查，仅 1 条：lodestone_tracker
//      24w09a 以 lodestone_target 之名加入，24w10a 改名 lodestone_tracker（两个快照同属 1.20.5）。
//
// 【仍有 2 条未取证，一律留 null —— 不许编版本号】
//   creative_slot_lock / map_post_processing：wiki 把它们列为「临时组件」，只描述功能不给版本；
//   历史节没有出现；全站 insource 正则搜索 /加入了[^。]{0,60}<名字>/ 命中 0 条。
//   查证过程见 tools/__since-manual.json 的 _unverified 字段。
//   → 需要校正时请重新跑 tools/__parse-comp-history.mjs + __parse-24w09a.mjs + __merge-since.mjs，
//     不要凭记忆往里填版本号。
//
// 【已确认的改名】hide_tooltip 在 1.21.5 被 tooltip_display 取代，
//   wiki 现列表中已无 hide_tooltip，故只保留 tooltip_display，并把旧名登记为别名。
//   fire_resistant 同理已被 damage_resistant 取代（1.21.2 24w37a 移除 fire_resistant）。

/** 引入版本 → 该版本引入/定名的组件 ID 列表（组件 ID 逐字来自「数据组件」列表） */
export const COMPONENT_SINCE = {
  '1.20.5': [
    'attribute_modifiers', 'banner_patterns', 'base_color',
    'bees', 'block_entity_data', 'block_state',
    'bucket_entity_data', 'bundle_contents', 'can_break',
    'can_place_on', 'charged_projectiles', 'container',
    'container_loot', 'custom_data', 'custom_model_data',
    'custom_name', 'damage', 'debug_stick_state',
    'dyed_color', 'enchantment_glint_override', 'enchantments',
    'entity_data', 'firework_explosion', 'fireworks',
    'food', 'instrument', 'intangible_projectile',
    'item_name', 'lock', 'lodestone_tracker',
    'lore', 'map_decorations', 'map_id',
    'max_damage', 'max_stack_size', 'note_block_sound',
    'ominous_bottle_amplifier', 'pot_decorations', 'potion_contents',
    'profile', 'rarity', 'recipes',
    'repair_cost', 'stored_enchantments', 'suspicious_stew_effects',
    'tool', 'trim', 'unbreakable',
    'writable_book_content', 'written_book_content',
  ],
  '1.21': [
    'jukebox_playable',
  ],
  '1.21.2': [
    'consumable', 'damage_resistant', 'death_protection',
    'enchantable', 'equippable', 'glider',
    'item_model', 'repairable', 'tooltip_style',
    'use_cooldown', 'use_remainder',
  ],
  '1.21.5': [
    'axolotl/variant', 'blocks_attacks', 'break_sound',
    'cat/collar', 'cat/variant', 'chicken/variant',
    'cow/variant', 'fox/variant', 'frog/variant',
    'horse/variant', 'llama/variant', 'mooshroom/variant',
    'painting/variant', 'parrot/variant', 'pig/variant',
    'potion_duration_scale', 'provides_banner_patterns', 'provides_trim_material',
    'rabbit/variant', 'salmon/size', 'sheep/color',
    'shulker/color', 'tooltip_display', 'tropical_fish/base_color',
    'tropical_fish/pattern', 'tropical_fish/pattern_color', 'villager/variant',
    'weapon', 'wolf/collar', 'wolf/sound_variant',
    'wolf/variant',
  ],
  '1.21.11': [
    'attack_range', 'damage_type', 'kinetic_weapon',
    'minimum_attack_charge', 'piercing_weapon', 'use_effects',
  ],
  '26.1': [
    'additional_trade_cost', 'cat/sound_variant', 'chicken/sound_variant',
    'cow/sound_variant', 'dye', 'pig/sound_variant',
  ],
  '26.2': [
    'sulfur_cube_content',
  ],
  '26.3': [
    'attack_animation', 'block_transformer', 'brewing_fuel',
    'compostable', 'cooking_fuel', 'cushion/color',
    'interact_animation', 'mob_visibility', 'provides_pottery_pattern',
    'sign_text_back', 'sign_text_front', 'villager_food',
    'waxed',
  ],
};

/** 未取证的组件 ID（UI 必须显示「引入版本未取证」，不得显示任何版本号） */
export const COMPONENT_SINCE_UNKNOWN = ['creative_slot_lock', 'map_post_processing'];

/** 组件旧名/别名 → 现行组件 ID */
export const COMPONENT_ALIASES = {
  hide_tooltip: 'tooltip_display',
  fire_resistant: 'damage_resistant',
  lodestone_target: 'lodestone_tracker',
};

/** id → since 的扁平索引，避免每次线性扫 8 个数组 */
const SINCE_BY_ID = new Map();
for (const [ver, ids] of Object.entries(COMPONENT_SINCE)) {
  for (const id of ids) if (!SINCE_BY_ID.has(id)) SINCE_BY_ID.set(id, ver);
}

function sinceOf(id) {
  const key = String(id == null ? '' : id).trim().replace(/^minecraft:/, '');
  return SINCE_BY_ID.get(key) || SINCE_BY_ID.get(COMPONENT_ALIASES[key]) || null;
}

/** 主表：[ID, 中文名, 示例值]（示例值由本编辑器补，便于直接生成可用命令） */
const MAIN = [
  ['attack_animation', '攻击动画', null],
  ['attack_range', '攻击距离', null],
  ['attribute_modifiers', '属性修饰符', '{modifiers:[]}'],
  ['banner_patterns', '旗帜图案', null],
  ['base_color', '盾牌基色', null],
  ['bees', '蜜蜂数据', null],
  ['block_entity_data', '方块实体数据', null],
  ['block_state', '方块状态', '{facing:"north"}'],
  ['block_transformer', '物品交互方块变换效果', null],
  ['blocks_attacks', '格挡攻击', null],
  ['break_sound', '物品耐久耗尽音效', null],
  ['brewing_fuel', '用于酿造的燃料', null],
  ['bucket_entity_data', '生物桶所装实体数据', null],
  ['bundle_contents', '收纳袋内物品', null],
  ['can_break', '冒险模式下该物品可破坏的方块', null],
  ['can_place_on', '冒险模式下该物品可放置于的方块', null],
  ['charged_projectiles', '所装载的弹射物', null],
  ['compostable', '堆肥行为', null],
  ['consumable', '可消耗性', '{consume_seconds:1.6}'],
  ['container', '容器内物品', null],
  ['container_loot', '容器战利品表', null],
  ['cooking_fuel', '用于烧炼的燃料', null],
  ['custom_data', '自定义数据', '{my_key:1}'],
  ['custom_model_data', '自定义模型数据', '123'],
  ['custom_name', '自定义名称', '"我的物品"'],
  ['damage', '物品损坏值', '10'],
  ['damage_resistant', '不被指定伤害类型摧毁', null],
  ['damage_type', '攻击造成的伤害类型', null],
  ['debug_stick_state', '调试棒状态', null],
  ['death_protection', '死亡保护', null],
  ['dye', '染料颜色', null],
  ['dyed_color', '所染颜色', '{rgb:16711680}'],
  ['enchantable', '在附魔台上的附魔能力', null],
  ['enchantment_glint_override', '附魔光效', 'true'],
  ['enchantments', '魔咒', '{levels:{"minecraft:sharpness":5}}'],
  ['entity_data', '实体数据', null],
  ['equippable', '可穿戴性', null],
  ['firework_explosion', '烟火之星爆裂数据', null],
  ['fireworks', '烟花火箭爆裂和飞行数据', null],
  ['food', '食物', '{nutrition:4,saturation:2.4}'],
  ['glider', '穿戴后可滑翔', null],
  ['instrument', '山羊角乐器', null],
  ['intangible_projectile', '只能被创造模式玩家捡起的弹射物', null],
  ['interact_animation', '交互动画', null],
  ['item_model', '物品模型', null],
  ['item_name', '物品名称', '"内部名"'],
  ['jukebox_playable', '插入唱片机并播放音乐', null],
  ['kinetic_weapon', '设置冲锋攻击', null],
  ['lock', '锁', null],
  ['lodestone_tracker', '所追踪的磁石位置', null],
  ['lore', '物品提示框中的描述信息', '[{"text":"第一行"}]'],
  ['map_decorations', '地图图标', null],
  ['map_id', '地图编号', null],
  ['max_damage', '最大耐久度', '1000'],
  ['max_stack_size', '最大堆叠数', '64'],
  ['minimum_attack_charge', '进行攻击所需的攻击冷却进度最小值', null],
  ['mob_visibility', '装备对生物探测半径的影响', null],
  ['note_block_sound', '放有玩家的头的音符盒音效', '"minecraft:block.note_block.harp"'],
  ['ominous_bottle_amplifier', '不祥之兆状态效果倍率', null],
  ['piercing_weapon', '设置戳刺攻击', null],
  ['pot_decorations', '饰纹陶罐陶片装饰', null],
  ['potion_contents', '药水效果与状态效果信息', null],
  ['potion_duration_scale', '状态效果时长缩放倍率', null],
  ['profile', '玩家游戏档案信息', '"Notch"'],
  ['provides_banner_patterns', '置于织布机时提供的旗帜图案', null],
  ['provides_pottery_pattern', '为饰纹陶罐提供的陶片样式', null],
  ['provides_trim_material', '作为锻造原材料时提供的盔甲纹饰材料', null],
  ['rarity', '稀有度', '"epic"'],
  ['recipes', '知识之书配方信息', null],
  ['repair_cost', '铁砧上的累积惩罚值', '5'],
  ['repairable', '可在铁砧上被修复', null],
  ['sign_text_back', '告示牌类方块的背面文本', null],
  ['sign_text_front', '告示牌类方块的正面文本', null],
  ['stored_enchantments', '所存储的“无活性”魔咒', null],
  ['sulfur_cube_content', '硫方怪吸收的方块', null],
  ['suspicious_stew_effects', '谜之炖菜效果', null],
  ['tool', '成为挖掘某方块的工具', '{default_mining_speed:1.0}'],
  ['tooltip_display', '物品提示框及附加信息的显示', null],
  ['tooltip_style', '物品提示框背景和边框样式', null],
  ['trim', '盔甲纹饰', null],
  ['unbreakable', '无法破坏', '{}'],
  ['use_cooldown', '使用后冷却', null],
  ['use_effects', '玩家使用物品时的行为', null],
  ['use_remainder', '使用后返还物品', null],
  ['villager_food', '村民食物', null],
  ['waxed', '涂蜡', null],
  ['weapon', '作为武器时的行为', null],
  ['writable_book_content', '书与笔内容', null],
  ['written_book_content', '成书内容', null],
];

const ENTITY_VARIANTS = [
  ['axolotl/variant', '美西螈变种'], ['cat/collar', '猫项圈颜色'], ['cat/sound_variant', '猫音效变种'],
  ['cat/variant', '猫变种'], ['chicken/sound_variant', '鸡音效变种'], ['chicken/variant', '鸡变种'],
  ['cow/sound_variant', '牛音效变种'], ['cow/variant', '牛变种'], ['cushion/color', '坐垫颜色'],
  ['fox/variant', '狐狸变种'], ['frog/variant', '青蛙变种'], ['horse/variant', '马变种'],
  ['llama/variant', '羊驼变种'], ['mooshroom/variant', '哞菇变种'], ['painting/variant', '画变种'],
  ['parrot/variant', '鹦鹉变种'], ['pig/sound_variant', '猪音效变种'], ['pig/variant', '猪变种'],
  ['rabbit/variant', '兔子变种'], ['salmon/size', '鲑鱼体型尺寸'], ['sheep/color', '绵羊变种'],
  ['shulker/color', '潜影贝颜色'], ['tropical_fish/base_color', '热带鱼体色'],
  ['tropical_fish/pattern', '热带鱼花纹'], ['tropical_fish/pattern_color', '热带鱼花纹颜色'],
  ['villager/variant', '村民变种'], ['wolf/collar', '狼项圈颜色'], ['wolf/sound_variant', '狼音效变种'],
  ['wolf/variant', '狼变种'],
];

const TEMPORARY = [
  ['additional_trade_cost', '额外交易花费（临时组件）'],
  ['creative_slot_lock', '创造模式槽位锁定（临时组件）'],
  ['map_post_processing', '地图后处理（临时组件）'],
];

function make([id, name, sample], group) {
  const since = sinceOf(id);
  return { id, name, sample: sample || null, group, since, sinceKnown: since !== null };
}

/** 全部组件（121 条） */
export const ALL_COMPONENTS = [
  ...MAIN.map((r) => make(r, '常规')),
  ...ENTITY_VARIANTS.map(([id, name]) => make([id, name, null], '实体变种')),
  ...TEMPORARY.map(([id, name]) => make([id, name, null], '临时')),
];

const BY_ID = new Map(ALL_COMPONENTS.map((c) => [c.id, c]));

export function componentById(id) {
  const key = String(id == null ? '' : id).trim().replace(/^minecraft:/, '');
  return BY_ID.get(key) || BY_ID.get(COMPONENT_ALIASES[key]) || null;
}

/** 组件是否在给定版本可用（since 未知时返回 'unknown'，由 UI 决定怎么提示） */
export function componentAvailability(c, versionOrderIdx, orderOf) {
  if (!c) return 'unknown';
  if (!c.sinceKnown) return 'unknown';
  if (typeof orderOf !== 'function') return 'unknown';
  return orderOf(c.since) <= versionOrderIdx ? 'yes' : 'no';
}

/** 按关键词搜组件（ID 或中文名） */
export function searchComponents(q, limit = 40) {
  const s = String(q == null ? '' : q).trim().toLowerCase();
  if (!s) return ALL_COMPONENTS.slice(0, limit);
  const scored = [];
  for (const c of ALL_COMPONENTS) {
    const id = c.id.toLowerCase();
    const name = c.name;
    let score = -1;
    if (id === s || name === s) score = 1000;
    else if (id.startsWith(s)) score = 900;
    else if (name.startsWith(s)) score = 880;
    else if (id.includes(s)) score = 700;
    else if (name.includes(s)) score = 680;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  return scored.slice(0, limit).map((x) => x.c);
}

/** 兼容旧调用：与 components.js 原先的 COMPONENT_CATALOG 字段同名 */
export function toCatalogEntry(c) {
  return {
    key: c.id,
    since: c.since,          // null 表示未取证
    sample: c.sample || '',
    desc: `${c.name}（${c.group}）`,
    name: c.name,
    group: c.group,
  };
}
