// 命令全表（Java 版）——权威数据，逐字来自中文 Minecraft Wiki
//   来源页：https://zh.minecraft.wiki/w/命令
//     · section=11「命令列表及其概述 → Java版」（94 条）
//     · section=12「调试命令」（8 条）
//   取数方式：index.php?title=命令&action=raw&section=11（纯 wikitext，避开 Cloudflare 与转义）
//   抓取时间：本仓库最后一次取数为 2026-08
//
// 严禁臆造：命令名 / 中文描述 / 权限等级 / 作用域 / 是否仅专用服务端 全部逐字照抄 wiki 表格。
// 需要扩充或校正时，重新抓 section=11，不要凭记忆补写。

/** 作用域中文标签（wiki 表格右侧 4 个图标列的语义） */
export const CMD_SCOPE_LABEL = {
  blocks: '方块', mobs: '实体', player: '玩家', world: '世界', dedicated: '仅专用服务端',
};

/** 权限等级说明（wiki「权限等级」条目） */
export const PERM_LABEL = {
  0: '所有玩家', 1: '可绕过出生点保护', 2: '游戏管理员', 3: '服务器管理员', 4: '仅服务器控制台',
};

/* [名称, 中文描述, 权限等级, 作用域(数组), 是否仅专用服务端, 是否调试命令] */
export const WIKI_COMMAND_ROWS = [
  ['advancement', '添加、移除或查询玩家的进度。', 2, ['player'], 0, 0],
  ['attribute', '修改或查询生物的属性。', 2, ['mobs', 'player'], 0, 0],
  ['ban', '将玩家加入封禁列表。', 3, ['player'], 1, 0],
  ['ban-ip', '将IP地址加入封禁列表。', 3, ['player'], 1, 0],
  ['banlist', '显示封禁列表。', 3, ['player'], 1, 0],
  ['bossbar', '修改或查询Boss栏。', 2, ['player', 'world'], 0, 0],
  ['clear', '从玩家物品栏中删除物品。', 2, ['player'], 0, 0],
  ['clone', '将特定区域的方块复制到另一处。', 2, ['blocks'], 0, 0],
  ['compute', '在指定战利品上下文中对数值提供器求值。', 2, [], 0, 0],
  ['damage', '对实体造成伤害。', 2, ['mobs', 'player'], 0, 0],
  ['data', '获取、合并、修改或移除方块实体、实体或命令存储的NBT数据。', 2, ['blocks', 'mobs', 'player'], 0, 0],
  ['datapack', '控制或列出加载的数据包。', 2, ['world'], 0, 0],
  ['debug', '开始或结束刻分析器或对函数进行调试。', 3, [], 0, 0],
  ['defaultgamemode', '更改默认的游戏模式。', 2, ['world'], 0, 0],
  ['deop', '撤销玩家的管理员权限。', 3, ['player'], 1, 0],
  ['dialog', '向玩家展示或清除对话框。', 2, ['player'], 0, 0],
  ['difficulty', '设置难度等级。', 2, ['world'], 0, 0],
  ['effect', '添加或移除状态效果。', 2, ['mobs', 'player'], 0, 0],
  ['enchant', '为玩家当前所选物品添加魔咒。', 2, ['player'], 0, 0],
  ['execute', '检测、改变命令上下文并执行命令。', 2, ['blocks', 'mobs', 'player', 'world'], 0, 0],
  ['experience', 'xp的替代命令，给予玩家经验。', 2, ['player'], 0, 0],
  ['fetchprofile', '获取玩家档案。', 2, ['player'], 0, 0],
  ['fill', '填充某个区域为特定方块。', 2, ['blocks'], 0, 0],
  ['fillbiome', '将区域设置为指定生物群系。', 2, ['world'], 0, 0],
  ['forceload', '强制加载区块或取消区块强制加载。', 2, ['world'], 0, 0],
  ['function', '运行函数。', 2, ['world'], 0, 0],
  ['gamemode', '更改玩家的游戏模式。', 2, ['player'], 0, 0],
  ['gamerule', '更改或查询游戏规则。', 2, ['world'], 0, 0],
  ['give', '给予玩家物品。', 2, ['player'], 0, 0],
  ['help', '?的替代命令，用于查询命令语法。', 0, ['player'], 0, 0],
  ['item', '修改方块或实体物品栏内的物品。', 2, ['blocks', 'mobs', 'player'], 0, 0],
  ['jfr', '开始或结束JFR分析。', 4, [], 0, 0],
  ['kick', '将玩家踢出服务器。', 3, ['player'], 0, 0],
  ['kill', '清除实体。', 2, ['mobs', 'player'], 0, 0],
  ['list', '列出服务器中的玩家。', 0, ['player'], 0, 0],
  ['locate', '显示最近的给定结构、生物群系或兴趣点的坐标。', 2, ['blocks', 'mobs', 'world'], 0, 0],
  ['loot', '将指定的战利品放入物品栏或生成在世界中。', 2, ['blocks', 'mobs', 'player'], 0, 0],
  ['me', '显示一条关于命令执行者自己的信息。', 0, ['player'], 0, 0],
  ['msg', 'tell和w的替代命令，向另一玩家发送私信。', 0, ['player'], 0, 0],
  ['op', '授予玩家管理员权限。', 3, ['player'], 1, 0],
  ['pardon', '解封玩家。', 3, ['player'], 1, 0],
  ['pardon-ip', '从封禁列表中解封指定IP。', 3, ['player'], 1, 0],
  ['particle', '创建粒子。', 2, ['player'], 0, 0],
  ['perf', '记录并保存性能分析数据（10秒内）。', 4, ['world'], 1, 0],
  ['place', '在满足条件的指定位置放置一个已配置的地物、拼图或结构。', 2, ['blocks', 'world'], 0, 0],
  ['playsound', '播放音效。', 2, ['player'], 0, 0],
  ['posteffect', '管理玩家使用的后处理效果。', 2, ['player'], 0, 0],
  ['publish', '向局域网开放单人游戏世界。', 4, ['world'], 0, 0],
  ['random', '生成随机值或控制随机序列。', '0（不涉及序列）/ 2（涉及序列）', [], 0, 0],
  ['recipe', '给予或剥夺合成配方。', 2, ['player'], 0, 0],
  ['reload', '从硬盘中重新加载数据包中的函数、进度等文件（不包括魔咒等需要重新进入世界加载的内容）。', 2, ['world'], 0, 0],
  ['return', '在函数内跳过后续命令并更改函数返回值。', 2, [], 0, 0],
  ['ride', '控制一个实体的骑乘状态。', 2, ['mobs', 'player'], 0, 0],
  ['rotate', '更改实体的旋转角度。', 2, ['mobs', 'player'], 0, 0],
  ['save-all', '保存服务器世界状态到硬盘。', 4, ['world'], 1, 0],
  ['save-off', '关闭服务器自动保存。', 4, ['world'], 1, 0],
  ['save-on', '开启服务器自动保存。', 4, ['world'], 1, 0],
  ['say', '向多个玩家发送消息。', 2, ['player'], 0, 0],
  ['schedule', '安排函数在特定的游戏刻后运行。', 2, [], 0, 0],
  ['scoreboard', '管理记分板的记分项和分数持有者。', 2, ['mobs', 'player'], 0, 0],
  ['seed', '显示世界种子。', '0（仅集成服务端）/ 2（仅专用服务端）', ['world'], 0, 0],
  ['setblock', '将方块替换为其他方块。', 2, ['blocks'], 0, 0],
  ['setidletimeout', '设置无操作玩家被踢出的延时。', 3, ['player'], 1, 0],
  ['setworldspawn', '设置世界出生点。', 2, ['world'], 0, 0],
  ['spawnpoint', '设置一个玩家的出生地点。', 2, ['player'], 0, 0],
  ['spectate', '使一个处于旁观模式的玩家旁观一个实体。', 2, ['player'], 0, 0],
  ['spreadplayers', '将实体传送到随机位置。', 2, ['mobs', 'player'], 0, 0],
  ['stop', '关闭服务器。', 4, ['world'], 1, 0],
  ['stopsound', '停止声音播放。', 2, ['player'], 0, 0],
  ['stopwatch', '管理秒表。', 2, [], 0, 0],
  ['swing', '控制实体的手臂挥动。', 2, ['mobs'], 0, 0],
  ['summon', '生成一个实体。', 2, ['mobs'], 0, 0],
  ['tag', '修改实体的标签。', 2, ['mobs', 'player'], 0, 0],
  ['team', '修改队伍。', 2, ['mobs', 'player'], 0, 0],
  ['teammsg', 'tm的替代命令，指定要发送给队伍的消息。', 0, ['player'], 0, 0],
  ['teleport', 'tp的替代命令，传送实体。', 2, ['mobs', 'player'], 0, 0],
  ['tell', 'msg和w的替代命令，向另一个玩家发送私信。', 0, ['player'], 0, 0],
  ['tellraw', '向玩家发送以文本组件表示的消息。', 2, ['player'], 0, 0],
  ['test', '管理和运行游戏测试。', 2, [], 0, 0],
  ['tick', '停止或开始游戏刻的流逝，或更改游戏刻速率。', 3, ['world'], 0, 0],
  ['time', '更改或查询游戏中的世界时间。', 2, ['world'], 0, 0],
  ['title', '管理屏幕上的标题。', 2, ['player'], 0, 0],
  ['tm', 'teammsg命令的别名，指定要发送给队伍的消息。', 0, ['player'], 0, 0],
  ['tp', 'teleport命令的别名，传送实体。', 2, ['mobs', 'player'], 0, 0],
  ['transfer', '将玩家转移到另一个服务器上。', 3, ['player'], 1, 0],
  ['trigger', '设置一个触发器。', 0, [], 0, 0],
  ['unpublish', '停止将单人游戏世界开放到多人游戏。', 4, ['world'], 0, 0],
  ['version', '输出游戏版本信息。', '0（仅集成服务端）/ 2（仅专用服务端）', ['player'], 0, 0],
  ['w', 'msg和tell命令的别名，向另一玩家发送私信。', 0, ['player'], 0, 0],
  ['waypoint', '列出或更改路径点。', 2, ['player'], 0, 0],
  ['weather', '设置天气。', 2, ['world'], 0, 0],
  ['whitelist', '管理服务器白名单。', 3, [], 1, 0],
  ['worldborder', '管理世界边界。', 2, ['world'], 0, 0],
  ['xp', 'experience命令的别名，增加或减少一个玩家的经验。', 2, ['player'], 0, 0],
  // ---- 调试命令（需开启调试工具；wiki section=12）----
  ['warden_spawn_tracker', '设置幽匿尖啸体生成监守者之前应接收到多少次振动。', 2, ['player'], 0, 1],
  ['debugpath', '计算并测试指定生物是否能够寻路到指定位置。', 2, ['mobs'], 0, 1],
  ['debugmobspawning', '指定位置上进行一次生物的周期生成。', 2, [], 0, 1],
  ['raid', '管理执行者处的袭击。', 3, [], 0, 1],
  ['serverpack', '配置服务端指定资源包。', 2, [], 0, 1],
  ['spawn_armor_trims', '生成所有不同图案、材料和盔甲类型可能组合出的盔甲纹饰。', 2, [], 0, 1],
  ['debugconfig', '调试网络阶段的配置阶段。', 3, [], 1, 1],
  ['chase', '同步不同游戏实例的玩家的移动。', 0, [], 0, 1],
];

/**
 * 引入版本。来源：同一 wiki 页「历史 → Java版」章节（section=19）。
 * 值为 null 表示该次取数未核实到引入版本 —— UI 会显示「引入版本未核实」，且版本校验不对它做判定。
 * 绝不为了"看起来完整"而填一个猜测值。
 */
export const CMD_SINCE = {
  // 主 Java 版历史（可直接对照 release）
  gamemode: '1.3.1', give: '1.3.1', time: '1.3.1', xp: '1.3.1',
  help: '1.3.1', seed: '1.3.1', defaultgamemode: '1.3.1', publish: '1.3.1', debug: '1.3.1',
  difficulty: '1.4.2', gamerule: '1.4.2', spawnpoint: '1.4.2', weather: '1.4.2', clear: '1.4.2',
  enchant: '1.4.4',
  scoreboard: '1.5', effect: '1.5',
  spreadplayers: '1.6.1', playsound: '1.6.1',
  summon: '1.7.2', setblock: '1.7.2', tellraw: '1.7.2', setidletimeout: '1.7.2', setworldspawn: '1.7.2',
  clone: '1.8', fill: '1.8', particle: '1.8', trigger: '1.8', execute: '1.8', worldborder: '1.8', title: '1.8',
  stopsound: '1.9.3',
  teleport: '1.10',
  locate: '1.11',
  recipe: '1.12', advancement: '1.12', reload: '1.12', function: '1.12',
  tag: '1.13', team: '1.13',
  // Alpha/Beta 服务端时代就已有（wiki 历史：Alpha 服务端 0.1.1 / 0.1.2 / 0.1.3、Beta 1.3）。
  // 统一取最早可选版本 b1.0 作为下界：对 b1.0 及之后判定为可用，对远古版本判定为不可用。
  ban: 'b1.0', 'ban-ip': 'b1.0', banlist: 'b1.0', deop: 'b1.0', kick: 'b1.0', op: 'b1.0',
  pardon: 'b1.0', 'pardon-ip': 'b1.0', say: 'b1.0', stop: 'b1.0',
  'save-all': 'b1.0', 'save-off': 'b1.0', 'save-on': 'b1.0', tp: 'b1.0',
  list: 'b1.0', msg: 'b1.0', kill: 'b1.0', whitelist: 'b1.0',
};

/** 已知被移除 / 改名的命令（wiki 历史 1.13 条目） */
export const CMD_REMOVED = {
  achievement: '1.12', testfor: '1.13', testforblock: '1.13', testforblocks: '1.13',
  toggledownfall: '1.13', blockdata: '1.13', entitydata: '1.13', replaceitem: '1.13',
  stats: '1.13',
};

/** 展开成对象数组（供 UI 直接消费） */
export const WIKI_COMMANDS = WIKI_COMMAND_ROWS.map(([name, desc, perm, scopes, dedicated, debug]) => ({
  name, desc, perm, scopes, dedicated: !!dedicated, debug: !!debug,
  since: CMD_SINCE[name] ?? null,
}));

/** 分类维度：wiki 表格的作用域列 + 专用服务端 + 调试命令 */
export const CMD_CATEGORIES = [
  { key: 'player', label: '玩家', desc: '修改或查询玩家的命令' },
  { key: 'mobs', label: '实体', desc: '修改或查询实体的命令（生物、掉落物等）' },
  { key: 'blocks', label: '方块', desc: '修改或查询方块的命令' },
  { key: 'world', label: '世界', desc: '修改或查询世界的命令' },
  { key: 'dedicated', label: '仅专用服务端', desc: '仅在专用服务端中可用的命令' },
  { key: 'debug', label: '调试命令', desc: '需开启调试工具才可用的命令' },
  { key: 'all', label: '全部命令', desc: `${WIKI_COMMANDS.length} 条（Java 版，含调试命令）` },
];

/** 取某分类下的命令 */
export function commandsInCategory(key) {
  if (key === 'all') return WIKI_COMMANDS.slice();
  if (key === 'debug') return WIKI_COMMANDS.filter((c) => c.debug);
  if (key === 'dedicated') return WIKI_COMMANDS.filter((c) => c.dedicated);
  return WIKI_COMMANDS.filter((c) => c.scopes.includes(key));
}

/** 模糊搜索：命令名 / 中文描述 / 别名互通 */
export function searchCommands(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  return WIKI_COMMANDS
    .map((c) => {
      let score = 0;
      const n = c.name.toLowerCase();
      if (n === s) score = 100;
      else if (n.startsWith(s)) score = 80;
      else if (n.includes(s)) score = 60;
      if (c.desc.toLowerCase().includes(s)) score = Math.max(score, 40);
      if (c.scopes.some((x) => x.includes(s))) score = Math.max(score, 20);
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .map((x) => x.c);
}
