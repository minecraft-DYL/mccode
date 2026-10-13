// item-aliases.js —— 物品别名：基岩版旧版命名 / 教育版专属名 → Java 现代命名空间 ID
//
// 【重要事实】基岩版自 1.16.100 起，方块与物品的命名空间 ID 已与 Java 版一致
//   （见 zh.minecraft.wiki「基岩版数据值」的章节标题「物品ID（基岩版1.16.100后）」）。
//   所以绝大多数情况下「基岩版名」就是 Java 名，无需别名。
//
// 本文件只收录【两者确实不同】的旧版名称，来源逐条抄自：
//   · zh.minecraft.wiki/index.php?title=基岩版数据值/物品ID/旧版&action=raw
//   · zh.minecraft.wiki/index.php?title=基岩版数据值/方块ID&action=raw
//   用的是这两张表里 Data table 模板的 nameid= 参数（即基岩版命名），
//   与 Java 现代 ID 逐条比对，只保留不同的。同名的条目没有收录价值，一律不收。
//
// 未收录 = 没有差异或未取证，不代表不存在；不使用猜测填充。

/** 基岩版旧版名 → Java 现代 ID */
export const BEDROCK_LEGACY = {
  // ---------------- 物品（来源：物品ID/旧版） ----------------
  reeds: 'sugar_cane',                       // 甘蔗
  fish: 'cod',                               // 生鳕鱼（Bedrock 旧名 fish）
  speckled_melon: 'glistering_melon_slice',  // 闪烁的西瓜片
  emptymap: 'map',                           // 空地图
  map_filled: 'filled_map',                  // 已填充的地图
  frame: 'item_frame',                       // 物品展示框
  glow_frame: 'glow_item_frame',             // 荧光物品展示框
  carrotonastick: 'carrot_on_a_stick',       // 胡萝卜钓竿
  netherstar: 'nether_star',                 // 下界之星
  fireworks: 'firework_rocket',              // 烟花火箭
  fireworkscharge: 'firework_star',          // 烟花之星
  quartz: 'nether_quartz',                   // 下界石英
  muttonraw: 'mutton',                       // 生羊肉
  muttoncooked: 'cooked_mutton',             // 熟羊肉
  chorus_fruit_popped: 'popped_chorus_fruit',// 爆裂紫颂果
  totem: 'totem_of_undying',                 // 不死图腾
  darkoak_sign: 'dark_oak_sign',             // 深色橡木告示牌
  horsearmorleather: 'leather_horse_armor',  // 皮革马铠
  horsearmoriron: 'iron_horse_armor',        // 铁马铠
  horsearmorgold: 'golden_horse_armor',      // 金马铠
  horsearmordiamond: 'diamond_horse_armor',  // 钻石马铠
  clay: 'clay_ball',                         // 黏土球（Bedrock 旧名 clay）
  leather_cap: 'leather_helmet',             // 皮革帽子
  leather_tunic: 'leather_chestplate',       // 皮革外套
  leather_pants: 'leather_leggings',         // 皮革裤子
  seeds: 'wheat_seeds',                      // 小麦种子（Bedrock 旧名 seeds）
  porkchop: 'porkchop',                      // 生猪排（同名，保留以便反查）

  // ---------------- 方块（来源：方块ID） ----------------
  noteblock: 'note_block',                   // 音符盒
  golden_rail: 'powered_rail',               // 充能铁轨
  web: 'cobweb',                             // 蜘蛛网
  deadbush: 'dead_bush',                     // 枯萎的灌木
  brick_block: 'bricks',                     // 砖块
  mob_spawner: 'spawner',                    // 刷怪笼
  standing_sign: 'oak_sign',                 // 站立告示牌
  wall_sign: 'oak_wall_sign',                // 墙上告示牌
  wooden_door: 'oak_door',                   // 橡木门
  stone_stairs: 'cobblestone_stairs',        // 圆石楼梯
  snow_layer: 'snow',                        // 雪（薄层）
  snow: 'snow_block',                        // 雪块
  lit_pumpkin: 'jack_o_lantern',             // 南瓜灯
  unpowered_repeater: 'repeater',            // 红石中继器
  powered_repeater: 'repeater',              // 红石中继器（激活态）
  trapdoor: 'oak_trapdoor',                  // 橡木活板门
  melon_block: 'melon',                      // 西瓜
  fence_gate: 'oak_fence_gate',              // 橡木栅栏门
  waterlily: 'lily_pad',                     // 睡莲
  nether_brick: 'nether_bricks',             // 下界砖块（方块）
  trip_wire: 'tripwire',                     // 绊线
  wooden_button: 'oak_button',               // 橡木按钮
  unpowered_comparator: 'comparator',        // 红石比较器
  powered_comparator: 'comparator',          // 红石比较器（激活态）
  quartz_ore: 'nether_quartz_ore',           // 下界石英矿石
  slime: 'slime_block',                      // 黏液块
  hardened_clay: 'terracotta',               // 陶瓦
  standing_banner: 'white_banner',           // 站立旗帜
  wall_banner: 'white_wall_banner',          // 墙上旗帜
  daylight_detector_inverted: 'daylight_detector', // 阳光探测器（反向）
  grass_path: 'dirt_path',                   // 土径
  undyed_shulker_box: 'shulker_box',         // 潜影盒
  end_bricks: 'end_stone_bricks',            // 末地石砖
  magma: 'magma_block',                      // 岩浆块
  red_nether_brick: 'red_nether_bricks',     // 红色下界砖块
  silver_glazed_terracotta: 'light_gray_glazed_terracotta', // 淡灰色带釉陶瓦
  beetroot: 'beetroots',                     // 甜菜根（作物方块）
  moving_block: 'moving_piston',             // 移动的方块
  prismarine_bricks_stairs: 'prismarine_brick_stairs', // 海晶石砖楼梯
  lit_redstone_ore: 'redstone_ore',          // 红石矿石（发光态）
  lit_redstone_lamp: 'redstone_lamp',        // 红石灯（点亮态）
  lapis_ore: 'lapis_ore',                    // 青金石矿石（同名）
  piston_arm_collision: 'piston_head',       // 活塞头
};

/**
 * 基岩版 / 教育版专属，Java 版没有对应物品。
 * 用户搜到这些名字时应当给提示，而不是静默无结果。
 * 来源同上两张表的 obtain=creative / link=元素 等标记。
 */
export const BEDROCK_ONLY = [
  'hard_glass', 'hard_glass_pane', 'hard_white_stained_glass', 'hard_white_stained_glass_pane',
  'chemical_heat', 'element_0',
  'board', 'chalkboard', 'medicine', 'balloon', 'rapid_fertilizer', 'sparkler',
  'camera', 'compound', 'portfolio', 'bleach', 'ice_bomb', 'glow_stick',
  'invisible_bedrock', 'netherreactor', 'glowingobsidian',
  'update_game_block', 'info_update', 'info_update2', 'reserved6',
  'allow', 'deny', 'border_block',
  'colored_torch_red', 'colored_torch_blue',
  'underwater_torch',
];

const REVERSE = new Map();
for (const [bed, java] of Object.entries(BEDROCK_LEGACY)) {
  if (!java || bed === java) continue;           // 同名的不进入反查索引
  if (!REVERSE.has(java)) REVERSE.set(java, []);
  REVERSE.get(java).push(bed);
}

const BEDROCK_ONLY_SET = new Set(BEDROCK_ONLY);

/** 给条目取别名列表（供模糊搜索使用）。返回 null 表示没有别名。 */
export function aliasesFor(e) {
  if (!e || !e.id) return null;
  const id = String(e.id).replace(/^minecraft:/, '');
  const list = REVERSE.get(id);
  return list && list.length ? list : null;
}

/** 判断一个查询串是否是「基岩版/教育版专属」名，用于给用户提示 */
export function isBedrockOnly(raw) {
  const s = String(raw || '').toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]/g, '_');
  return BEDROCK_ONLY_SET.has(s);
}

/** 直接解析基岩版旧名 → Java ID；无对应返回 null */
export function resolveBedrock(raw) {
  const s = String(raw || '').toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]/g, '_');
  return BEDROCK_LEGACY[s] || null;
}
