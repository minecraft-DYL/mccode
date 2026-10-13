// nbt-labels.js —— NBT 标签中文名 / 类型 / 作用域 取证表
//
// ═══════════════════════ 数据来源（逐条可回溯） ═══════════════════════
// 全部条目抄自 zh.minecraft.wiki 的原始 wikitext，抓取通道见 tools/wiki-get.mjs
// （真实 Edge headless + CDP 过 Cloudflare；纯 HTTP 客户端一律 403，见 tools/fetch-wiki.py 留档）。
//
//   [S1] NBT格式 / section=4「标签类型」
//        https://zh.minecraft.wiki/api.php?action=parse&page=NBT格式&prop=wikitext&section=4
//        → NBT_TAG_TYPES（13 种标签类型的官方中文名）
//
//   [S2] 编码格式/Entity / section=10「实体共通标签」
//        https://zh.minecraft.wiki/api.php?action=parse&page=编码格式/Entity&prop=wikitext&section=10
//        → 全部实体共有的根标签（Entity::load / saveWithoutId）
//
//   [S3] 编码格式/Entity / section=11「生物共通标签」（LivingEntity）
//   [S4] 编码格式/Entity / section=15「AI生物共通标签」（Mob）
//   [S5] 编码格式/Entity / section=16「状态效果实例数据」（MobEffectInstance）
//
//   [S6] 编码格式/BlockEntity / section=5「方块实体共通标签」
//   [S7] 编码格式/BlockEntity / section=3「容器方块实体共通标签」
//   [S8] 编码格式/BlockEntity / section=6「战利品容器方块实体共通标签」
//   [S9] 编码格式/BlockEntity / section=2「熔炉共通标签」
//
//   [S10] 编码格式/Item / section=3「物品共通标签」（ItemStack，1.20.5 起）
//   [S11] 编码格式/Item / section=2「数据组件修订」（DataComponentPatch）
//   注意：物品的旧 `tag` 复合标签在 1.20.5（24w09a）被移除 —— 见 物品格式 / section=5「历史」。
//
//   [S12] 物品格式/Java版1.20.5前 / section=1「物品存储格式」+ section=2「通用标签」
//        以及其 onlyinclude 子页：物品格式/通用标签、方块、附魔书、成书、书与笔、玩家头颅、
//        盾牌、收纳袋、烟火之星、烟花火箭（旧的 id / Count / tag 结构与各物品专属标签）
//        https://zh.minecraft.wiki/index.php?title=物品格式/Java版1.20.5前&action=raw
//        （该页是 zh 站唯一保留旧物品 NBT 定义的地方；主页面「物品格式」最早修订为 2025-04-19，
//          已无 1.20.5 前内容，故旧键只能从此子页取证。）
//
// 【口径说明 / 不编造原则】
//   · type 字段一律用 wiki 原文里的类型模板（{{nbt|...}}）名，未标注类型的写 'any' 或 'compound|string'
//     这类「多类型」原样形式，不猜一个单一类型。
//   · since 只填 wiki 明确写了版本的地方；wiki 没写的填 null，由 UI 显示「引入版本未取证」。
//   · 本轮取证时 zh.minecraft.wiki 的 entity/worldgen NBT 已改用 snake_case 命名
//     （fall_distance / invulnerable_time / active_effects 等），与 1.21.x 的
//     FallDistance / Invulnerable / ActiveEffects 命名不同；本表按 wiki 现状抄录，两种拼写
//     都进索引（NP_LEGACY_ALIASES），这样用户手上的新旧存档都能命中中文名。
//
// 【未取证的部分，明确列出】
//   · 方块实体各自的专属标签（箱子 Items 以外的 furnace/hopper 等）只取了 wiki 明写的
//     「熔炉」「容器」「战利品容器」三个共通段；单个方块实体的 BE/ED 子页未逐条抓。
//   · 实体的「生物/弹射物/交通工具/其他」分类专属标签（如 Villager 的 Offers）未逐条抓。

/* ============================ [S1] 标签类型 ============================ */

/**
 * NBT 13 种标签类型的中文名。
 * 来源 [S1] 的表格「ID / ID（HEX）/ 标签类型 / 负载内容 / 负载大小」。
 */
export const NBT_TAG_TYPES = [
  { id: 0, hex: '00', type: 'END', name: '结束标签', payload: '—', size: '—' },
  { id: 1, hex: '01', type: 'BYTE', name: '字节型', payload: '单个有符号字节', size: '1' },
  { id: 2, hex: '02', type: 'SHORT', name: '短整型', payload: '单个有符号短整型', size: '2' },
  { id: 3, hex: '03', type: 'INT', name: '整型', payload: '单个有符号整型', size: '4' },
  { id: 4, hex: '04', type: 'LONG', name: '长整型', payload: '单个有符号长整型', size: '8' },
  { id: 5, hex: '05', type: 'FLOAT', name: '单精度浮点型', payload: '单个单精度浮点数（IEEE754）', size: '4' },
  { id: 6, hex: '06', type: 'DOUBLE', name: '双精度浮点型', payload: '单个双精度浮点数（IEEE754）', size: '8' },
  { id: 7, hex: '07', type: 'BYTE_ARRAY', name: '字节数组', payload: '长度 + 相应个数的有符号字节', size: '4+<长度>' },
  { id: 8, hex: '08', type: 'STRING', name: '字符串标签', payload: '变种 UTF-8 编码的带长字符串', size: '2+<长度>' },
  { id: 9, hex: '09', type: 'LIST', name: '列表', payload: '子标签类型 ID + 长度 + 相应个数的子标签负载', size: '5+…' },
  { id: 10, hex: '0A', type: 'COMPOUND', name: '复合标签', payload: '若干个子标签整体，后跟空字节', size: '?+1' },
  { id: 11, hex: '0B', type: 'INT_ARRAY', name: '整型数组', payload: '长度 + 相应个数的有符号整型', size: '4+<长度>×4' },
  { id: 12, hex: '0C', type: 'LONG_ARRAY', name: '长整型数组', payload: '长度 + 相应个数的有符号长整型（仅 Java 版）', size: '4+<长度>×8' },
];

/** 类型 → 中文名（给结构树用）。TAG_NAME 里的英文缩写也一并认。 */
const TYPE_NAME = {
  END: '结束', BYTE: '字节型', SHORT: '短整型', INT: '整型', LONG: '长整型',
  FLOAT: '单精度浮点', DOUBLE: '双精度浮点', BYTE_ARRAY: '字节数组', STRING: '字符串',
  LIST: '列表', COMPOUND: '复合标签', INT_ARRAY: '整型数组', LONG_ARRAY: '长整型数组',
  bool: '布尔（字节型）', any: '任意类型', 'int-array': '整型数组', 'byte-array': '字节数组',
  'int array': '整型数组', 'byte array': '字节数组', 'long array': '长整型数组',
  'compound|string': '复合/字符串', 'string|compound': '字符串/复合',
  'compound|list|string': '复合/列表/字符串', 'string|compound|list': '字符串/复合/列表',
  'int|list': '整型/列表', 'int-array|compound': '整型数组/复合',
};

/** NBT 类型标识 → 中文名。传 'INT' / 'int' / 'bool' / 'compound|string' 都能出结果。 */
export function nbtTypeLabel(type) {
  if (type == null || type === '') return '';
  const k = String(type).trim();
  if (TYPE_NAME[k]) return TYPE_NAME[k];
  const up = k.toUpperCase().replace(/[\s-]/g, '_');
  if (TYPE_NAME[up]) return TYPE_NAME[up];
  const direct = NBT_TAG_TYPES.find((t) => t.type === up);
  return direct ? direct.name : k;
}

/* ============================ 标签表 ============================ */

/**
 * 作用域常量。scope 用于区分同名不同义的键（例：id 在物品/实体/方块实体/效果里是四种东西）。
 */
export const SCOPE = {
  COMMON: '通用',
  ITEM: '物品',
  ITEM_LEGACY: '物品（1.20.5 前）',
  ENTITY: '实体',
  MOB: '生物',
  AI_MOB: 'AI生物',
  EFFECT: '状态效果',
  BLOCK_ENTITY: '方块实体',
  CONTAINER: '容器方块实体',
  FURNACE: '熔炉',
};

/**
 * 全表。字段：{ key, name, type, scope, desc, since, path? }
 *   key   英文键名（SNBT/JSON 里实际书写的那个）
 *   name  中文名
 *   type  wiki 原文的标签类型（可能是 "compound|string" 这类多类型）
 *   scope 作用域（SCOPE.*）
 *   desc  wiki 原文中文释义（截取，不加工语义）
 *   since 引入/变更版本；wiki 未写明则 null
 *   path  可选。当同一个字面键在不同作用域含义不同、需要分开检索时，用 path 写清「在哪里的 key」。
 *         例：物品的 `id` 写作 path:'id@物品'，容器里的 `Slot` 写作 path:'Slot@物品'。
 *         查表时 path 与 key 都能命中；补全会把 path 还原成真正的字面键再插入。
 */
export const NBT_TAGS = [
  /* ---------------- [S1] 类型条目也进索引，便于搜「整型」 ---------------- */
  ...NBT_TAG_TYPES.map((t) => ({
    key: t.type,
    name: t.name,
    type: t.type,
    scope: SCOPE.COMMON,
    desc: `NBT 标签类型 #${t.id}（0x${t.hex}）：${t.payload}${t.size !== '—' ? `；负载大小 ${t.size}` : ''}`,
    since: null,
  })),

  /* ---------------- [S2] 实体共通标签（Entity） ---------------- */
  { key: 'id', name: '实体类型 ID', type: 'string', scope: SCOPE.ENTITY, desc: '（命名空间ID）实体类型。此数据仅在持久化保存（存储入区块文件、结构模板、蜂巢、蜂箱数据或作为乘客实体保存）时存在；/data 无法获取也无法修改。', since: null },
  { key: 'Air', name: '剩余空气值', type: 'short', scope: SCOPE.ENTITY, desc: '当前实体所剩的空气值。每刻增加 4 直至最大空气值；可窒息环境中逐渐减少直至 -20，达到 -20 后受到伤害并重置为 0。', since: null },
  { key: 'CustomName', name: '自定义名称', type: 'string|compound|list', scope: SCOPE.ENTITY, desc: '（文本组件）当前实体的自定义名称，会出现在死亡消息、村民交易界面，以及光标指向实体的上方。被视为数据组件 custom_name。', since: null },
  { key: 'CustomNameVisible', name: '名称始终显示', type: 'bool', scope: SCOPE.ENTITY, desc: '表示实体是否一直渲染名称。不存在时默认为 false。', since: null },
  { key: 'data', name: '任意 NBT 数据', type: 'string|compound', scope: SCOPE.ENTITY, desc: '任意 NBT 数据。字符串形式只用于加载，游戏保存时只使用复合标签形式。被视为数据组件 custom_data。', since: null },
  { key: 'fall_distance', name: '已摔落距离', type: 'double', scope: SCOPE.ENTITY, desc: '当前实体已经摔落的距离。值越大，落地时受到的摔落伤害越大。不存在时默认为 0。', since: null },
  { key: 'Fire', name: '着火剩余刻数', type: 'short', scope: SCOPE.ENTITY, desc: '正值代表距离火熄灭剩余的时间，负值表示能在火中站立而不着火的时间，单位为游戏刻。', since: null },
  { key: 'Glowing', name: '发光轮廓', type: 'bool', scope: SCOPE.ENTITY, desc: '实体是否有发光的轮廓线。不存在时默认为 false。', since: null },
  { key: 'HasVisualFire', name: '视觉上着火', type: 'bool', scope: SCOPE.ENTITY, desc: '表示实体是否视觉上正在着火（可能实际没着火）。不存在时默认为 false。', since: null },
  { key: 'Invulnerable', name: '免疫伤害', type: 'bool', scope: SCOPE.ENTITY, desc: '实体是否永久抵抗绝大多数伤害。为 true 时只会受到创造模式玩家的伤害与 bypasses_invulnerability 标签的伤害。', since: null },
  { key: 'invulnerable_time', name: '免疫剩余刻数', type: 'int', scope: SCOPE.ENTITY, desc: '实体能够抵抗绝大多数伤害的剩余刻数。小于等于 0 时不存储。', since: null },
  { key: 'Motion', name: '速度向量', type: 'list<double>', scope: SCOPE.ENTITY, desc: '当前实体的速度，代表下一游戏刻的移动距离和方向（X/Y/Z 三个分量，值域 -10~10，越界会重置为 0）。', since: null },
  { key: 'NoGravity', name: '不受重力', type: 'bool', scope: SCOPE.ENTITY, desc: '实体是否不会受到重力的影响。不存在时默认为 false。', since: null },
  { key: 'OnGround', name: '接触地面', type: 'bool', scope: SCOPE.ENTITY, desc: '实体是否正在接触地面。不存在时默认为 false。', since: null },
  { key: 'Passengers', name: '乘客列表', type: 'list<compound>', scope: SCOPE.ENTITY, desc: '正在骑乘当前实体的实体的数据，递归标签。仅 /summon 指定标签、刷怪笼与试炼刷怪笼指定生成数据时才可有效设置。', since: null },
  { key: 'PortalCooldown', name: '传送门冷却', type: 'int', scope: SCOPE.ENTITY, desc: '距离下一次可以穿过下界传送门传送的时间，以游戏刻计。不接触传送门方块时每刻减 1 直至 0。', since: null },
  { key: 'Pos', name: '坐标', type: 'list<double>', scope: SCOPE.ENTITY, desc: '当前实体的坐标（X/Y/Z，值域 -30000512~30000512 / -20000000~20000000）。', since: null },
  { key: 'Rotation', name: '旋转角度', type: 'list<float>', scope: SCOPE.ENTITY, desc: '实体的旋转角度，使用角度制：[0] 偏转角（以 Y 轴为中心，正南顺时针），[1] 俯仰角（-90~90，正值朝下）。', since: null },
  { key: 'Silent', name: '静音', type: 'bool', scope: SCOPE.ENTITY, desc: '实体是否不会发出任何声音。不存在时默认为 false。', since: null },
  { key: 'Tags', name: '记分板标签', type: 'list<string>', scope: SCOPE.ENTITY, desc: '实体的自定义记分板标签（目标选择器 tag= 匹配用），不超过 1024 个。', since: null },
  { key: 'TicksFrozen', name: '冰冻时间', type: 'int', scope: SCOPE.ENTITY, desc: '实体的冰冻时间。被冰冻时每刻增加 1，不被冰冻时每刻减少 2。不存在时默认为 0。', since: null },
  { key: 'UUID', name: 'UUID', type: 'int-array', scope: SCOPE.ENTITY, desc: '（UUID）实体的 UUID。此值无法使用 /data 修改。', since: null },

  /* ---------------- [S4] AI 生物共通标签（Mob） ---------------- */
  { key: 'CanPickUpLoot', name: '可捡起战利品', type: 'bool', scope: SCOPE.AI_MOB, desc: '表示生物是否可以捡起战利品（穿戴捡起的盔甲，使用捡起的武器）。', since: null },
  { key: 'DeathLootTable', name: '死亡战利品表', type: 'string', scope: SCOPE.AI_MOB, desc: '决定当前生物被杀死后掉落物品的战利品表。', since: null },
  { key: 'DeathLootTableSeed', name: '死亡战利品种子', type: 'long', scope: SCOPE.AI_MOB, desc: '生成战利品表的种子，0 或未定义则使用随机序列。必须和 DeathLootTable 一起设置否则不生效。', since: null },
  { key: 'drop_chances', name: '装备掉落概率', type: 'compound', scope: SCOPE.AI_MOB, desc: '生物死亡时各种装备槽位物品的掉落概率。未定义的槽位默认 8.5%。', since: null },
  { key: 'home_pos', name: '活动中心坐标', type: 'int-array', scope: SCOPE.AI_MOB, desc: '生物尝试活动范围的中心；被拴住或骑乘时也会改变。对嘎枝表示绑定的嘎枝之心位置，对海龟表示生成位置。', since: null },
  { key: 'home_radius', name: '活动半径', type: 'int', scope: SCOPE.AI_MOB, desc: '如果存在，生物会尝试只在以 home_pos 为球心、此值为半径的范围内活动。', since: null },
  { key: 'leash', name: '拴绳信息', type: 'int-array|compound', scope: SCOPE.AI_MOB, desc: '二选一：被拴在栅栏上时为整型数组（XYZ 坐标）；被另一实体拴住时为复合标签（内含 UUID）。未被拴住则不存在。', since: null },
  { key: 'LeftHanded', name: '主手为左手', type: 'bool', scope: SCOPE.AI_MOB, desc: '表示生物的主手是否为左手。', since: null },
  { key: 'NoAI', name: '禁用 AI', type: 'bool', scope: SCOPE.AI_MOB, desc: '代表生物的 AI 是否被禁用。被禁用 AI 的生物不会尝试移动，也不会被动移动，在合适情况下也不会摔落。', since: null },
  { key: 'PersistenceRequired', name: '不会被自然删除', type: 'bool', scope: SCOPE.AI_MOB, desc: '代表生物是否不会被自然删除。', since: null },

  /* ---------------- [S3] 生物共通标签（LivingEntity） ---------------- */
  { key: 'AbsorptionAmount', name: '伤害吸收值', type: 'float', scope: SCOPE.MOB, desc: '生物的伤害吸收值（金苹果等的黄色生命）。', since: null },
  { key: 'active_effects', name: '状态效果列表', type: 'list<compound>', scope: SCOPE.MOB, desc: '该生物的状态效果的列表。当前生物没有状态效果则不存在此标签。每项见「状态效果实例数据」。', since: null },
  { key: 'attributes', name: '属性列表', type: 'list<compound>', scope: SCOPE.MOB, desc: '当前生物的属性的列表。每项含 id（属性命名空间ID）、base（基础值）、modifiers（修饰符列表）。', since: null },
  { key: 'base', name: '属性基础值', type: 'double', scope: SCOPE.MOB, desc: '（attributes 子项）属性的基础值。', since: null },
  { key: 'modifiers', name: '属性修饰符列表', type: 'list<compound>', scope: SCOPE.MOB, desc: '（attributes 子项）限制本条属性的修饰符。修饰符在内部计算中调整基础值，但不更改原值。', since: null },
  { key: 'operation', name: '运算模式', type: 'string', scope: SCOPE.MOB, desc: '（属性修饰符子项）定义修饰符对基础值的运算模式：add_value（Op0）/ add_multiplied_base（Op1）/ add_multiplied_total（Op2）。', since: null },
  { key: 'amount', name: '修饰数值', type: 'double', scope: SCOPE.MOB, desc: '（属性修饰符子项）计算中修饰符调整基础值的数值。', since: null },
  { key: 'Brain', name: '生物记忆', type: 'compound', scope: SCOPE.MOB, desc: '当前生物需要记住的所有信息；其 memories 子标签用于生物 AI 的计算。', since: null },
  { key: 'memories', name: '记忆条目', type: 'compound', scope: SCOPE.MOB, desc: '（Brain 子项）生物的记忆，用于生物 AI 的计算。', since: null },
  { key: 'current_explosion_impact_pos', name: '爆炸击退坐标', type: 'list<double>', scope: SCOPE.MOB, desc: '生物被任何爆炸击退时存在，表示被击退时的坐标。落地、陷入方块、末影珍珠/紫颂果传送或切创造模式时清除。', since: null },
  { key: 'current_impulse_context_reset_grace_time', name: '爆炸击退减伤计时', type: 'int', scope: SCOPE.MOB, desc: '爆炸击退减少摔落伤害的最长时间，按游戏刻计。风爆击退或重锤时为 40，其他爆炸或清除坐标时设 0。', since: null },
  { key: 'DeathTime', name: '死亡动画计时', type: 'short', scope: SCOPE.MOB, desc: '距离生物死亡而被删除的时间，同时控制死亡动画。存活为 0，濒死每刻 +1，到 20 时被删除。', since: null },
  { key: 'equipment', name: '装备栏物品', type: 'compound', scope: SCOPE.MOB, desc: '生物装备的物品，按装备槽位分组。玩家主手槽位的物品不在此处保存。', since: null },
  { key: 'FallFlying', name: '滑翔中', type: 'bool', scope: SCOPE.MOB, desc: '表示生物是否处于滑翔状态（鞘翅飞行，旧名 FallFlying）。', since: null },
  { key: 'Health', name: '生命值', type: 'float', scope: SCOPE.MOB, desc: '（默认为当前生物的最大生命值）当前生物所拥有的生命值。超过最大值时受伤会被钳制。', since: null },
  { key: 'HurtTime', name: '受伤发红计时', type: 'short', scope: SCOPE.MOB, desc: '生物被伤害后发红时间的倒计时。刚被伤害时设为 10，每刻减 1 直到 0。', since: null },
  { key: 'last_hurt_by_mob', name: '最近攻击生物 UUID', type: 'int-array', scope: SCOPE.MOB, desc: '生物最近一次被生物攻击时的生物 UUID 信息；攻击生物死亡或卸载时清除。', since: null },
  { key: 'last_hurt_by_player', name: '最近攻击玩家 UUID', type: 'int-array', scope: SCOPE.MOB, desc: '生物最近一次被玩家攻击时的玩家 UUID 信息。', since: null },
  { key: 'last_hurt_by_player_memory_time', name: '记仇剩余刻数', type: 'int', scope: SCOPE.MOB, desc: '（当 last_hurt_by_player 存在时有效）被玩家攻击后设为 100，每刻减 1，降到 0 以下清除玩家 UUID。', since: null },
  { key: 'locator_bar_icon', name: '路径点图标', type: 'compound', scope: SCOPE.MOB, desc: '生物路径点图标数据，不存在时默认为 {"style":"minecraft:default"}。含 color（覆写颜色）与 style（路径点样式 ID）。', since: null },
  { key: 'style', name: '路径点样式 ID', type: 'string', scope: SCOPE.MOB, desc: '（locator_bar_icon 子项）路径点样式的命名空间 ID。', since: null },
  { key: 'color', name: '颜色', type: 'int|list', scope: SCOPE.MOB, desc: '（locator_bar_icon 子项）覆写此生物的路径点图标颜色，游戏只保存为整数形式。', since: null },
  { key: 'sleeping_pos', name: '睡觉床坐标', type: 'int-array', scope: SCOPE.MOB, desc: '当前生物正在睡觉的床的坐标；不在睡觉则不存在此标签。', since: null },
  { key: 'Team', name: '所属队伍', type: 'string', scope: SCOPE.MOB, desc: '（不能导出和保存，仅可以加载或用 /data 修改）设置当前生物所属的队伍。', since: null },
  { key: 'ticks_since_last_hurt_by_mob', name: '距上次被攻击刻数', type: 'int', scope: SCOPE.MOB, desc: '（当 last_hurt_by_mob 存在时有效）距上次被生物攻击的游戏刻数。', since: null },

  /* ---------------- [S5] 状态效果实例数据 ---------------- */
  { key: 'ambient', name: '信标效果', type: 'bool', scope: SCOPE.EFFECT, desc: '表示状态效果是否是被信标添加的，即粒子是否有透明度。不存在则为 false。', since: null },
  { key: 'amplifier', name: '效果倍率', type: 'byte', scope: SCOPE.EFFECT, desc: '（无符号 8 位，0~255）状态效果的倍率。0 表示等级 1，以此类推。超 127 时显示为负数但实际为正。', since: null },
  { key: 'duration', name: '效果持续刻数', type: 'int', scope: SCOPE.EFFECT, desc: '距离状态效果失效的时间刻数。为 -1 则永不失效。不存在则为 0。', since: null },
  { key: 'hidden_effect', name: '被覆盖的效果', type: 'compound', scope: SCOPE.EFFECT, desc: '与此状态效果类型相同、但因等级更低而被覆盖的效果信息。外层过期后此层尝试生效。递归定义。', since: null },
  { key: 'show_icon', name: '显示图标', type: 'bool', scope: SCOPE.EFFECT, desc: '表示是否显示状态效果的图标。不存在则与 show_particles 值相同。', since: null },
  { key: 'show_particles', name: '显示粒子', type: 'bool', scope: SCOPE.EFFECT, desc: '表示是否显示粒子效果，以及计算效果混合颜色时是否参与计算。不存在则为 true。', since: null },
  { key: 'effect_id', name: '效果 ID', type: 'string', scope: SCOPE.EFFECT, desc: '（状态效果实例的 id 子项）状态效果的命名空间 ID。', since: null },
  { key: 'id', path: 'id@状态效果', name: '效果 ID', type: 'string', scope: SCOPE.EFFECT, desc: '（状态效果实例子项）状态效果的命名空间 ID。', since: null },

  /* ---------------- [S6] 方块实体共通标签 ---------------- */
  { key: 'x', name: 'X 坐标', type: 'int', scope: SCOPE.BLOCK_ENTITY, desc: '当前方块实体的 X 坐标。', since: null },
  { key: 'y', name: 'Y 坐标', type: 'int', scope: SCOPE.BLOCK_ENTITY, desc: '当前方块实体的 Y 坐标。', since: null },
  { key: 'z', name: 'Z 坐标', type: 'int', scope: SCOPE.BLOCK_ENTITY, desc: '当前方块实体的 Z 坐标。', since: null },
  { key: 'id', path: 'id@方块实体', name: '方块实体类型 ID', type: 'string', scope: SCOPE.BLOCK_ENTITY, desc: '（命名空间ID）方块实体的类型。', since: null },
  { key: 'components', name: '数据组件信息', type: 'compound', scope: SCOPE.BLOCK_ENTITY, desc: '方块实体的数据组件信息。用对应物品放置此方块实体时，物品额外持有且不会被继承序列化的数据组件会被复制存入此标签。', since: '1.20.5' },

  /* ---------------- [S7] 容器方块实体共通标签 ---------------- */
  { key: 'lock', name: '容器锁', type: 'compound', scope: SCOPE.CONTAINER, desc: '如果存在，容器只能用符合该物品谓词的物品打开。被视为数据组件 lock。', since: null },

  /* ---------------- [S8] 战利品容器方块实体共通标签 ---------------- */
  { key: 'Items', name: '容器内物品列表', type: 'list<compound>', scope: SCOPE.CONTAINER, desc: '（当 LootTable 不存在时存在且有效）当前容器内物品的列表，超出槽位范围的物品无效。被视为数据组件 container。', since: null },
  { key: 'LootTable', name: '战利品表', type: 'string', scope: SCOPE.CONTAINER, desc: '决定容器第一次被打开时生成战利品所用的战利品表的命名空间 ID。战利品生成后被删除。被视为容器战利品数据。', since: null },
  { key: 'LootTableSeed', name: '战利品种子', type: 'long', scope: SCOPE.CONTAINER, desc: '（当 LootTable 存在时有效）生成战利品使用的种子，0 或不输入将使用随机序列。战利品生成后被删除。', since: null },
  { key: 'Slot', name: '槽位', type: 'byte', scope: SCOPE.CONTAINER, desc: '（带槽位存储）物品所在的槽位编号，例如在箱子中。', since: null },

  /* ---------------- [S9] 熔炉共通标签 ---------------- */
  { key: 'cooking_time_spent', name: '已烧炼时间', type: 'int', scope: SCOPE.FURNACE, desc: '（默认为 0）烧炼物已被烧炼的时间。等于 cooking_total_time 时本次烧炼完成并重置为 0。', since: null },
  { key: 'cooking_total_time', name: '烧炼所需时间', type: 'int', scope: SCOPE.FURNACE, desc: '（默认为 0）烧炼物完成烧炼所需时间。', since: null },
  { key: 'lit_time_remaining', name: '燃料剩余燃烧时间', type: 'int', scope: SCOPE.FURNACE, desc: '（默认为 0）当前使用的燃料剩余的燃烧时间。', since: null },
  { key: 'lit_total_time', name: '燃料总燃烧时长', type: 'int', scope: SCOPE.FURNACE, desc: '（默认为 0）熔炉应燃烧的总时长。', since: null },
  { key: 'speed_multiplier', name: '烧炼速度乘数', type: 'float', scope: SCOPE.FURNACE, desc: '（默认为 1.0）该熔炉正在燃烧的燃料的烧炼速度乘数。', since: null },
  { key: 'RecipesUsed', name: '已烧炼配方统计', type: 'compound', scope: SCOPE.FURNACE, desc: '熔炉从最后一次玩家取出成品到现在已烧炼的配方数，用于计算经验值；内部键为配方命名空间 ID、值为次数。', since: null },

  /* ---------------- [S10] 物品共通标签（1.20.5 起） ---------------- */
  { key: 'id', path: 'id@物品', name: '物品 ID', type: 'string', scope: SCOPE.ITEM, desc: '（命名空间ID）表示某种类的物品堆叠。若未指定，游戏会在加载区块或生成物品时将其变更为空气。', since: '1.20.5' },
  { key: 'count', name: '堆叠数量', type: 'int', scope: SCOPE.ITEM, desc: '（0 < 值 ≤ 物品最大堆叠数量）物品的堆叠数。不存在或无效时默认为 1。', since: '1.20.5' },

  /* ---------------- [S12] 物品旧格式（1.20.5 前） ---------------- */
  { key: 'Count', name: '堆叠数量（旧）', type: 'byte', scope: SCOPE.ITEM_LEGACY, desc: '（大于 0）堆叠的物品数量，不受最大堆叠数量限制。不大于 0 时游戏视为空气。1.20.5 起被 count 取代。', since: null },
  { key: 'tag', name: '物品附加数据（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '（可选）关于当前物品的额外信息。1.20.5（24w09a）被结构化的 components 取代。内部所有标签都是可选的。', since: null },
  { key: 'AttributeModifiers', name: '属性修饰符（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '包含了物品的属性修饰符。它会修改佩戴者或持有者的属性，若物品不在 Slot 指定的槽位则不起效果；会覆盖物品本身自带的修饰属性。', since: null },
  { key: 'AttributeName', name: '属性名称（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（属性修饰符子项）此修饰符的属性名称，是一个命名空间 ID。', since: null },
  { key: 'Name', name: '修饰符名称（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（属性修饰符子项）修饰符的名称。', since: null },
  { key: 'Operation', name: '运算方法（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '（属性修饰符子项）定义修饰符对基础值的运算方法：0（Op0）、1（Op1）、2（Op2）。', since: null },
  { key: 'CanDestroy', name: '可破坏方块（旧）', type: 'list<string>', scope: SCOPE.ITEM_LEGACY, desc: '冒险模式的玩家可以使用这个物品破坏的方块列表（方块命名空间 ID 或方块标签）。', since: null },
  { key: 'CanPlaceOn', name: '可放置于（旧）', type: 'list<string>', scope: SCOPE.ITEM_LEGACY, desc: '冒险模式的玩家可以将此方块物品放置在其表面的方块（方块命名空间 ID 或标签）。', since: null },
  { key: 'CustomCreativeLock', name: '创造栏锁定（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '无子标签。在创造模式保存的物品栏中拥有此标签的物品将无法交互，但仍可通过快捷键存储或加载到快捷栏。', since: null },
  { key: 'CustomModelData', name: '自定义模型数据（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '用于物品模型的覆盖。1.20.5 起作为同名数据组件保留。', since: null },
  { key: 'Damage', name: '损坏值（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '物品的损坏值。没有最大耐久值则不存在；此标签不存在代表物品处于最大耐久值。', since: null },
  { key: 'display', name: '显示属性（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '物品显示属性，含 color（染色）、Lore（提示框多行文本）、Name（物品名称）。', since: null },
  { key: 'Lore', name: '提示框文本（旧）', type: 'list<string>', scope: SCOPE.ITEM_LEGACY, desc: '（display 子项）物品提示框中显示的信息，每项是一个必须为 JSON 形式的文本组件。', since: null },
  { key: 'Enchantments', name: '附魔列表（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '包含影响物品特征的附魔信息。每项含 id（魔咒命名空间 ID）与 lvl（等级）。', since: null },
  { key: 'lvl', name: '魔咒等级（旧）', type: 'short', scope: SCOPE.ITEM_LEGACY, desc: '（附魔条目子项，0~255）魔咒的等级。小于 0 重置为 0，大于 255 重置为 255。', since: null },
  { key: 'HideFlags', name: '隐藏提示框位域（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '决定隐藏显示物品的哪些信息，按位域存储：1 附魔 / 2 属性修饰符 / 4 无法破坏 / 8 可破坏方块 / 16 可放置方块 / 32 其他附加信息 / 64 染色 / 128 盔甲纹饰。相加即为组合。', since: null },
  { key: 'RepairCost', name: '累积惩罚等级（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '在铁砧上修理、合并或重命名当前物品时，表示在基础等级消耗之上额外增加的附魔等级。', since: null },
  { key: 'Trim', name: '盔甲纹饰（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '盔甲纹饰，物品不是盔甲则此标签没有作用。含 material（材料 ID）与 pattern（纹饰 ID）。', since: null },
  { key: 'material', name: '纹饰材料（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（Trim 子项）材料的命名空间 ID。', since: null },
  { key: 'pattern', name: '纹饰图案（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（Trim 子项）盔甲纹饰的命名空间 ID。', since: null },
  { key: 'Unbreakable', name: '无法破坏（旧）', type: 'bool', scope: SCOPE.ITEM_LEGACY, desc: '表示物品是否无法破坏。1.20.5 起由 unbreakable 数据组件承载。', since: null },
  { key: 'Potion', name: '药水效果 ID（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '药水的效果命名空间 ID（1.20.5 起由 potion_contents 组件承载）。', since: null },
  { key: 'CustomPotionEffects', name: '自定义药水效果（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '自定义药水效果的列表。每项是一条状态效果实例，见「状态效果实例数据」。', since: null },
  { key: 'CustomPotionColor', name: '药水自定义颜色（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '药水的自定义颜色，十进制 RGB。', since: null },
  { key: 'StoredEnchantments', name: '附魔书魔咒（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '附魔书内部含有的魔咒。每项含 id 与 lvl。', since: null },
  // —— 以下来自 物品格式/Java版1.20.5前 的 onlyinclude 子页（成书 / 书与笔 / 玩家头颅 / 盾牌 / 收纳袋）
  { key: 'title', name: '成书标题（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '成书的标题，不能超过 32 个字符。超过或不存在时打开成书 GUI 会显示 book.invalid.tag。', since: null },
  { key: 'author', name: '成书作者（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '成书的作者。不存在时打开成书 GUI 会显示 book.invalid.tag。', since: null },
  { key: 'pages', name: '书页内容（旧）', type: 'list<string>', scope: SCOPE.ITEM_LEGACY, desc: '成书 / 书与笔的各个页面。每页是一个将被解析为文本组件的字符串（书与笔用 \\n 作为换行符）。', since: null },
  { key: 'generation', name: '成书副本代数（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '决定成书是否为副本：0 原稿 / 1 原作的副本 / 2 副本的副本 / 3 破烂不堪。不存在视为 0。', since: null },
  { key: 'resolved', name: '成书已解析（旧）', type: 'bool', scope: SCOPE.ITEM_LEGACY, desc: '表示这本成书是否是第一次被打开，决定是否要进行成书内文本的解析。', since: null },
  { key: 'filtered_pages', name: '已过滤页面（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '已过滤的页面信息，键为页数、值为过滤后字符串。玩家开启过滤时优先于 pages。', since: null },
  { key: 'filtered_title', name: '已过滤标题（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '已过滤的标题。无实际作用。', since: null },
  { key: 'SkullOwner', name: '玩家头颅所有者（旧）', type: 'string|compound', scope: SCOPE.ITEM_LEGACY, desc: '指定头颅渲染的玩家。可以为玩家名称或一个玩家游戏档案标签；存储时玩家名称会自动解析为游戏档案标签。', since: null },
  { key: 'Properties', name: '游戏档案属性（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '（SkullOwner 子项）玩家游戏档案配置属性，含 textures 纹理属性列表。', since: null },
  { key: 'textures', name: '档案纹理（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '（Properties 子项）游戏档案纹理属性。每项含 Value（Base64 纹理串）与可能存在的 Signature。', since: null },
  { key: 'Value', name: '纹理 Base64（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（textures 子项）Base64 字符串，包含游戏档案内所有的纹理（皮肤和披风）。', since: null },
  { key: 'Signature', name: '纹理签名（旧）', type: 'string', scope: SCOPE.ITEM_LEGACY, desc: '（textures 子项，可能不存在）Value 使用 Yggdrasil 私钥签名后得到的 Base64 字符串。', since: null },
  { key: 'Patterns', name: '盾牌图案（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '（BlockEntityTag 子项）盾牌上的图案，格式见旗帜的方块实体格式。', since: null },
  { key: 'Explosion', name: '烟火之星爆炸（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '烟火之星的爆炸信息，含 Colors（颜色，十进制 RGB 数组）、FadeColors（淡出颜色）、Type（爆炸类型）、Trail/Flicker（拖尾/闪烁）。', since: null },
  { key: 'Fireworks', name: '烟花火箭数据（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '烟花火箭数据，含 Flight（飞行时间）与 Explosions（烟火之星爆炸列表）。', since: null },
  { key: 'Flight', name: '烟花飞行时间（旧）', type: 'byte', scope: SCOPE.ITEM_LEGACY, desc: '（Fireworks 子项）烟花火箭的飞行时间。', since: null },
  { key: 'Explosions', name: '烟花爆炸列表（旧）', type: 'list<compound>', scope: SCOPE.ITEM_LEGACY, desc: '（Fireworks 子项，可选）包含烟花火箭每次爆裂的数据，每项为「物品格式/烟火之星」结构。', since: null },
  { key: 'Colors', name: '爆炸颜色（旧）', type: 'int-array', scope: SCOPE.ITEM_LEGACY, desc: '（Explosion 子项）爆炸的颜色，十进制 RGB 整型数组。', since: null },
  { key: 'FadeColors', name: '淡出颜色（旧）', type: 'int-array', scope: SCOPE.ITEM_LEGACY, desc: '（Explosion 子项）爆炸后淡出的颜色，十进制 RGB 整型数组。', since: null },
  { key: 'Type', name: '爆炸类型（旧）', type: 'byte', scope: SCOPE.ITEM_LEGACY, desc: '（Explosion 子项）烟火之星爆炸的类型：0 小型球 / 1 大型球 / 2 星形 / 3 苦力怕 / 4 爆裂。', since: null },
  { key: 'Trail', name: '拖尾（旧）', type: 'bool', scope: SCOPE.ITEM_LEGACY, desc: '（Explosion 子项）爆炸是否有拖尾效果。', since: null },
  { key: 'Flicker', name: '闪烁（旧）', type: 'bool', scope: SCOPE.ITEM_LEGACY, desc: '（Explosion 子项）爆炸是否有闪烁效果。', since: null },
  { key: 'Base', name: '盾牌底色（旧）', type: 'int', scope: SCOPE.ITEM_LEGACY, desc: '（BlockEntityTag 子项）盾牌的底色（旗帜的 Base 颜色编号）。', since: null },
  { key: 'BlockEntityTag', name: '方块实体数据（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '方块物品放置时写入方块实体的数据。1.20.5 起由 block_entity_data 组件承载。', since: null },
  { key: 'EntityTag', name: '生成实体数据（旧）', type: 'compound', scope: SCOPE.ITEM_LEGACY, desc: '刷怪蛋等物品生成实体时写入实体的数据。1.20.5 起由 entity_data 组件承载。', since: null },
];

/* ============================ 旧拼写别名 → 现行键 ============================ */
// wiki 现状是 snake_case（fall_distance），而 1.21.x 及更早存档里是 PascalCase（FallDistance）。
// 两种拼写都要能查到中文名，否则用户手上的旧存档照样看不懂。
export const NBT_LEGACY_ALIASES = {
  FallDistance: 'fall_distance',
  InvulnerableTime: 'invulnerable_time',
  ActiveEffects: 'active_effects',
  DeathLootTableSeed2: 'DeathLootTableSeed',
  CanPickupLoot: 'CanPickUpLoot',
  DropChances: 'drop_chances',
  HomePos: 'home_pos',
  HomeRadius: 'home_radius',
  Leash: 'leash',
  AbsorbingAmount: 'AbsorptionAmount',
  SleepingX: 'sleeping_pos',
  Brain2: 'Brain',
  CanDestroy2: 'CanDestroy',
  CookingTimeSpent: 'cooking_time_spent',
  CookingTotalTime: 'cooking_total_time',
  LitTimeRemaining: 'lit_time_remaining',
  LitTotalTime: 'lit_total_time',
  SpeedMultiplier: 'speed_multiplier',
  LootTableSeed2: 'LootTableSeed',
  Motion2: 'Motion',
  PersistenceRequired2: 'PersistenceRequired',
  TicksSinceLastHurtByMob: 'ticks_since_last_hurt_by_mob',
  LastHurtByMob: 'last_hurt_by_mob',
  LastHurtByPlayer: 'last_hurt_by_player',
  LastHurtByPlayerMemoryTime: 'last_hurt_by_player_memory_time',
  DeathTime2: 'DeathTime',
  HurtTime2: 'HurtTime',
  CurrentExplosionImpactPos: 'current_explosion_impact_pos',
  LocatorBarIcon: 'locator_bar_icon',
};

/* ============================ 索引 ============================ */

/** 同时容纳中文/英文/别名匹配的规范化（与 core/fuzzy.js 的 normalize 口径一致） */
function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s_\-·。、，,.!'"（）()\[\]<>]/g, '');
}

/** 主索引：字面键(小写) | path(小写) → 条目数组 */
const BY_KEY = new Map();
/** 别名索引：小写别名 → 条目数组 */
const BY_ALIAS = new Map();

function push(map, k, v) {
  if (!k) return;
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

for (const t of NBT_TAGS) {
  push(BY_KEY, String(t.key).toLowerCase(), t);
  if (t.path && String(t.path).toLowerCase() !== String(t.key).toLowerCase()) {
    push(BY_KEY, String(t.path).toLowerCase(), t);
  }
}
for (const [alias, target] of Object.entries(NBT_LEGACY_ALIASES)) {
  for (const [k, list] of BY_KEY) {
    if (k === target.toLowerCase() || k.startsWith(target.toLowerCase() + '@')) {
      for (const h of list) push(BY_ALIAS, alias.toLowerCase(), h);
    }
  }
}

/** 返回条目真正书写在文本里的字面键（path 形式只用于查表） */
function literalKey(t) {
  return t.path ? String(t.path).split('@')[0] : t.key;
}

/**
 * 作用域匹配：严格一些，避免「物品」把「实体」的首条当成命中。
 * 规则：scope 完全相等 > scope 是请求作用域的前缀/被包含（且长度接近）> 不匹配。
 */
function scopeRank(t, want) {
  if (!want) return 0;
  const w = String(want);
  const s = String(t.scope);
  if (s === w) return 0;
  // '物品' 应命中 '物品（1.20.5 前）'，但 '物品' 不该命中 '实体'
  if (s.startsWith(w) || w.startsWith(s)) return 1;
  const short = w.replace(/[（(].*$/, '').slice(0, 2);
  if (short && s.startsWith(short)) return 2;
  return -1;
}

/**
 * 取某个键的中文名 + 类型。
 * @param {string} path 键名或键路径（'display.Lore'、'items[0].id' 都能取到末段）
 * @param {object} [opt] { scope } 指定作用域可消歧同名键
 * @returns {{key,name,type,scope,desc,since,aliasOf?}|null}
 */
export function nbtLookup(path, opt = {}) {
  if (path == null) return null;
  // 取路径末段：去掉数组下标、点/斜杠分隔、以及引号
  let last = String(path).trim();
  last = last.replace(/\[\d*\]/g, '');
  const parts = last.split(/[./\\]/).filter(Boolean);
  if (parts.length) last = parts[parts.length - 1];
  last = last.replace(/^["']|["']$/g, '');
  if (!last) return null;

  const raw = last.replace(/^!+/, '');   // 组件失效标记 !key
  const lower = raw.toLowerCase();

  let cands = BY_KEY.get(lower) || null;
  if (!cands) {
    // 组件/键名允许带命名空间前缀
    const noNs = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : null;
    if (noNs) cands = BY_KEY.get(noNs) || null;
  }
  const isAlias = !cands;
  if (!cands) cands = BY_ALIAS.get(lower) || null;
  if (!cands || !cands.length) return null;

  let pool = cands;
  if (opt.scope) {
    const scored = cands
      .map((c) => ({ c, r: scopeRank(c, opt.scope) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r);
    if (scored.length) pool = scored.map((x) => x.c);
  }
  const hit = pool[0];
  return {
    key: literalKey(hit),
    name: hit.name,
    type: hit.type,
    scope: hit.scope,
    desc: hit.desc,
    since: hit.since ?? null,
    ...(isAlias ? { aliasOf: literalKey(hit) } : {}),
  };
}

/** nbtLabel(path) → 中文名；查不到返回 null（UI 层显示「未取证」，绝不编一个） */
export function nbtLabel(path, opt) {
  const hit = nbtLookup(path, opt);
  return hit ? hit.name : null;
}

/**
 * 按前缀/子串搜 NBT 键，用于补全候选。
 * 注意：返回条目的 `key` 一律是「真正写进文本的字面键」（path 只用于查表），
 * 所以 id@物品 这类条目补全出来就是 `id`。
 * @param {string} q 已输入的键前缀（空串返回靠前的若干条）
 * @param {object} [opt] { scope, limit }
 */
export function searchNbtTags(q, { scope = null, limit = 30 } = {}) {
  const nq = norm(q);
  const inScope = (t) => !scope || scopeRank(t, scope) >= 0;
  const pool = NBT_TAGS.filter(inScope);

  const out = [];
  for (const t of pool) {
    const s = tagScore(t, nq, scope);
    if (s > 0) out.push({ t, s });
  }
  // 旧拼写别名也参与（用户可能输 FallDistance）
  if (nq) {
    for (const [alias, target] of Object.entries(NBT_LEGACY_ALIASES)) {
      const na = norm(alias);
      if (!na.startsWith(nq)) continue;
      for (const h of pool) {
        if (h.key.toLowerCase() === String(target).toLowerCase()) out.push({ t: h, s: 700 });
      }
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const x of out.sort((a, b) => b.s - a.s || literalKey(a.t).localeCompare(literalKey(b.t)))) {
    const k = x.t.scope + '|' + literalKey(x.t) + '|' + x.t.name;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ ...x.t, key: literalKey(x.t), path: x.t.path || null });
  }
  return uniq.slice(0, limit);
}

function tagScore(t, nq, scope) {
  const nkey = norm(literalKey(t));
  const nname = norm(t.name);
  const scopeBonus = scope ? (scopeRank(t, scope) === 0 ? 0 : scopeRank(t, scope) === 1 ? -5 : 0) : 0;
  if (!nq) return 1 + scopeBonus;
  if (nkey === nq) return 1000 + scopeBonus;
  if (nname === nq) return 990 + scopeBonus;
  if (nkey.startsWith(nq)) return 900 - Math.min(50, nkey.length) + scopeBonus;
  if (nname.startsWith(nq)) return 880 + scopeBonus;
  if (nkey.includes(nq)) return 700 + scopeBonus;
  if (nname.includes(nq)) return 680 + scopeBonus;
  if (norm(t.desc).includes(nq)) return 400 + scopeBonus;
  return -1;
}

/** 全部键（去重，按作用域分组），给 UI 做「标签总览」 */
export function nbtTagsByScope() {
  const out = new Map();
  for (const t of NBT_TAGS) {
    if (t.scope === SCOPE.COMMON && NBT_TAG_TYPES.some((x) => x.type === t.key)) continue; // 类型条目单独展示
    if (!out.has(t.scope)) out.set(t.scope, []);
    out.get(t.scope).push({ ...t, key: literalKey(t) });
  }
  return out;
}

/** 供 UI 显示来源 */
export const NBT_LABEL_SOURCES = [
  { scope: SCOPE.COMMON, page: 'NBT格式', section: 4, url: 'https://zh.minecraft.wiki/w/NBT格式' },
  { scope: SCOPE.ENTITY, page: '编码格式/Entity', section: 10, url: 'https://zh.minecraft.wiki/w/实体数据格式' },
  { scope: SCOPE.MOB, page: '编码格式/Entity', section: 11, url: 'https://zh.minecraft.wiki/w/实体数据格式' },
  { scope: SCOPE.AI_MOB, page: '编码格式/Entity', section: 15, url: 'https://zh.minecraft.wiki/w/实体数据格式' },
  { scope: SCOPE.EFFECT, page: '编码格式/Entity', section: 16, url: 'https://zh.minecraft.wiki/w/实体数据格式' },
  { scope: SCOPE.BLOCK_ENTITY, page: '编码格式/BlockEntity', section: 5, url: 'https://zh.minecraft.wiki/w/方块实体数据格式' },
  { scope: SCOPE.CONTAINER, page: '编码格式/BlockEntity', section: 3, url: 'https://zh.minecraft.wiki/w/方块实体数据格式' },
  { scope: SCOPE.FURNACE, page: '编码格式/BlockEntity', section: 2, url: 'https://zh.minecraft.wiki/w/方块实体数据格式' },
  { scope: SCOPE.ITEM, page: '编码格式/Item', section: 3, url: 'https://zh.minecraft.wiki/w/物品格式' },
  { scope: SCOPE.ITEM_LEGACY, page: '物品格式/Java版1.20.5前', section: 2, url: 'https://zh.minecraft.wiki/w/物品格式/Java版1.20.5前' },
];
