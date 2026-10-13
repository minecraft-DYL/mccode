// capabilities.js —— 版本能力矩阵（编辑器「一切的前置」）
//
// 三段式结构： 段(Segment) → 大版本(MajorVersion) → 小版本(SubVersion)
//   · 每个「技术性更改」= 一段；只要某个更改让任一能力 生效/失效/降级，就另起一段。
//   · 段内可再分大版本，大版本内可再分小版本（快照 / 预发布 / 正式版）。
//
// 数据来源双通道：
//   1) 内置基线（本文件 SEGMENTS）—— 离线可用，未取证的条目标 verified:false 并注明待核实；
//   2) 外部取证 data/version-segments.json —— 由 wiki 逐条取证（zh.minecraft.wiki），verified:true，优先覆盖内置。
//
// 能力取值：ok 完整可用 / partial 部分可用 / degraded 能力被替代或受限 / unsupported 不可用

import { fetchJSON } from './util.js';

export const CAPABILITIES = [
  { key: 'nbt', name: '编辑 NBT', short: 'NBT', desc: '编辑物品 / 实体 / 方块的 NBT 数据标签', color: '#4cc2ff' },
  { key: 'components', name: '编辑物品组件', short: '组件', desc: '编辑数据组件（Data Component，1.20.5 起取代物品 NBT）', color: '#c586c0' },
  { key: 'command', name: '编辑命令', short: '命令', desc: '命令语法本身（参数类型、选择器、SNBT 等）', color: '#7ec8ff' },
  { key: 'mcfunction', name: '编辑 .mcfunction', short: '函数', desc: '函数文件与数据包中的函数目录结构', color: '#b5e8a0' },
  { key: 'commandblock', name: '编辑命令方块', short: '命令方块', desc: '命令方块 / 命令方块矿车，含脉冲·循环·连锁与条件', color: '#ffcc80' },
  { key: 'chatcommand', name: '编辑聊天框指令', short: '聊天框', desc: '聊天栏里执行的一条指令', color: '#d6a2ff' },
  { key: 'itemPicker', name: '物品选择器', short: '物品', desc: '枚举全部物品 ID 与图标', color: '#ffd479' },
  { key: 'entityPicker', name: '实体选择器', short: '实体', desc: '枚举全部实体 ID', color: '#8fd6a0' },
  { key: 'particlePicker', name: '粒子选择器', short: '粒子', desc: '枚举全部粒子 ID', color: '#ff9db0' },
];

export const CAP_KEYS = CAPABILITIES.map((c) => c.key);

export const STATUS_LABEL = {
  ok: '可用',
  partial: '部分可用',
  degraded: '已变更',
  unsupported: '不可用',
};

// 外部取证数据里「聊天框指令」这个能力被写成 chatchat，而本文件的能力键是 chatcommand。
// 不归一，这条能力会永远是 unsupported —— 且不会报任何错，只会安静地少一格。
const CAP_KEY_ALIASES = {
  chatchat: 'chatcommand',
  chat: 'chatcommand',
  chatCommand: 'chatcommand',
  chatbox: 'chatcommand',
};

/** 把外部数据里的能力名归一成本文件的 CAP_KEY；认不出就返回 null（忽略，不猜） */
export function capKeyOf(k) {
  if (!k) return null;
  const s = String(k).replace(/^minecraft:/, '').trim();
  if (CAP_KEYS.includes(s)) return s;
  return CAP_KEY_ALIASES[s] || null;
}

/** 内置基线分段（时间正序）。verified:false = 版本号/日期待 wiki 核实 */
export const SEGMENTS = [
  {
    id: 'seg-origin',
    title: '命令只能从聊天框输入',
    anchor: '1.0',
    anchorType: 'release',
    date: '',
    change: '命令体系诞生：一切命令都由聊天框输入，没有命令方块，物品以数字 ID 表示，无法枚举。',
    caps: { nbt: 'unsupported', components: 'unsupported', command: 'partial', mcfunction: 'unsupported', commandblock: 'unsupported', chatcommand: 'ok', itemPicker: 'unsupported', entityPicker: 'unsupported', particlePicker: 'unsupported' },
    subs: [{ label: '1.0 – 1.3.2', note: '命令 = 聊天框' }],
    sources: ['https://zh.minecraft.wiki/w/命令'],
    verified: false,
  },
  {
    id: 'seg-1402',
    title: '命令方块诞生',
    anchor: '1.4.2',
    anchorType: 'release',
    date: '',
    change: '命令方块（Command Block）加入游戏，命令第一次可以脱离玩家手动输入被执行。',
    caps: { nbt: 'unsupported', components: 'unsupported', command: 'partial', mcfunction: 'unsupported', commandblock: 'partial', chatcommand: 'ok', itemPicker: 'unsupported', entityPicker: 'unsupported', particlePicker: 'unsupported' },
    subs: [{ label: '1.4.2', note: '命令方块加入（仅脉冲型）' }],
    sources: ['https://zh.minecraft.wiki/w/命令方块'],
    verified: false,
  },
  {
    id: 'seg-18',
    title: '命令中可以编辑 NBT',
    anchor: '1.8',
    anchorType: 'release',
    date: '',
    change: '14w02a 加入 /entitydata 与 /blockdata，命令首次能直接读写实体与方块实体的 NBT；物品 NBT 通过 /give 的 NBT 参数写入。',
    caps: { nbt: 'partial', components: 'unsupported', command: 'partial', mcfunction: 'unsupported', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'unsupported', entityPicker: 'unsupported', particlePicker: 'unsupported' },
    subs: [
      { label: '1.8', note: '/entitydata、/blockdata、/give 带 NBT' },
      { label: '1.9', note: '命令方块新增循环型与连锁型，NBT 结构变化' },
      { label: '1.11', note: '1.11 起移除部分旧语法' },
    ],
    sources: ['https://zh.minecraft.wiki/w/Java版1.8', 'https://zh.minecraft.wiki/w/命令/entitydata'],
    verified: false,
  },
  {
    id: 'seg-112',
    title: '函数（.mcfunction）诞生',
    anchor: '1.12',
    anchorType: 'release',
    date: '',
    change: '17w13a 加入函数：一个 .mcfunction 文本文件可以容纳多行命令，用 /function 执行。文件放在存档的 functions/ 目录，尚无命名空间。',
    caps: { nbt: 'partial', components: 'unsupported', command: 'partial', mcfunction: 'partial', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'unsupported', entityPicker: 'unsupported', particlePicker: 'unsupported' },
    subs: [
      { label: '1.12', note: '函数加入；/function 命令' },
      { label: '1.12.1 / 1.12.2', note: '挖法式函数数量上限调整' },
    ],
    sources: ['https://zh.minecraft.wiki/w/Java版函数'],
    verified: false,
  },
  {
    id: 'seg-113',
    title: '数据包 + 命令全面重写 + 注册表扁平化',
    anchor: '1.13',
    anchorType: 'release',
    date: '',
    change: '17w43a 引入数据包（datapack）：函数移入 data/<命名空间>/function/；命令体系被完全重写（/execute 重写、统一参数类型、SNBT）；/data 取代 /entitydata 与 /blockdata；物品/方块/粒子 ID 扁平化为 minecraft:diamond_sword 并在资源包中数据驱动，从此可以枚举全部 ID。',
    caps: { nbt: 'ok', components: 'unsupported', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [
      { label: '1.13', note: '数据包、/data、ID 扁平化、粒子数据驱动' },
      { label: '1.14', note: '/data modify 等操作扩展' },
      { label: '1.16', note: '函数与数据包格式微调；/attribute 等' },
    ],
    sources: ['https://zh.minecraft.wiki/w/Java版1.13', 'https://zh.minecraft.wiki/w/数据包'],
    verified: false,
  },
  {
    id: 'seg-1194',
    title: '开发期命令补充',
    anchor: '1.19.4',
    anchorType: 'release',
    date: '',
    change: '/ride、/damage、/execute 的 on 关系等加入，命令覆盖面继续扩大，但物品数据存储方式尚未变化。',
    caps: { nbt: 'ok', components: 'unsupported', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [{ label: '1.19.4', note: '/ride、/damage' }],
    sources: ['https://zh.minecraft.wiki/w/命令'],
    verified: false,
  },
  {
    id: 'seg-1205',
    title: '物品组件取代物品 NBT',
    anchor: '1.20.5',
    anchorType: 'release',
    date: '',
    change: '24w09a 起，物品堆叠的属性由 NBT 标签改为「数据组件（Data Component）」。命令中 {NBT} 位置改由 [组件] 表达；旧数据可放入 minecraft:custom_data 组件保留。这是物品维度上最重要的一次失效点。',
    caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [
      { label: '1.20.5', note: '数据组件正式版；/give 语法改为 [组件]' },
      { label: '1.20.6', note: '组件补充与修正' },
    ],
    sources: ['https://zh.minecraft.wiki/w/Java版1.20.5', 'https://zh.minecraft.wiki/w/数据组件'],
    verified: false,
  },
  {
    id: 'seg-1212',
    title: '组件持续扩充',
    anchor: '1.21.2',
    anchorType: 'release',
    date: '',
    change: 'tool、enchantments 等组件结构调整，物品渲染与装备逻辑迁移到组件上。',
    caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [{ label: '1.21.2 / 1.21.3', note: 'tool 组件、无分发式装备' }],
    sources: ['https://zh.minecraft.wiki/w/数据组件'],
    verified: false,
  },
  {
    id: 'seg-1214',
    title: '物品模型定义（item model definition）',
    anchor: '1.21.4',
    anchorType: 'release',
    date: '',
    change: "物品的模型入口从 assets/minecraft/models/item/*.json 迁到 assets/minecraft/items/*.json（item model definition）。这直接改变了「物品选择器」检索图标与 ID 的方式：1.21.4 起以 items/ 目录为准。",
    caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [{ label: '1.21.4', note: 'assets/minecraft/items/ 成为物品模型入口' }],
    sources: ['https://zh.minecraft.wiki/w/Java版1.21.4', 'https://zh.minecraft.wiki/w/物品模型'],
    verified: false,
  },
  {
    id: 'seg-1215',
    title: 'SNBT / 组件语法调整',
    anchor: '1.21.5',
    anchorType: 'release',
    date: '',
    change: 'SNBT 语法放宽（字符串引号可省略等），组件写法与 custom_model_data 等结构变化，编辑器需要按版本切换 SNBT 生成策略。',
    caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [
      { label: '1.21.5', note: 'SNBT 简化、custom_model_data 结构化' },
      { label: '1.21.6', note: '对话框（dialog）等新命令域' },
    ],
    sources: ['https://zh.minecraft.wiki/w/Java版1.21.5', 'https://zh.minecraft.wiki/w/SNBT'],
    verified: false,
  },
  {
    id: 'seg-26',
    title: '新版本号体系（26.x）',
    anchor: '26.1',
    anchorType: 'release',
    date: '',
    change: 'Minecraft Java 版改用「年份.序号」版本号体系（26.1 / 26.2 / 26.3 / 26.4-snapshot-*）。资源与注册表结构延续 1.21.x 末期的形态，items/ 与 particles/ 均为数据驱动，可完整枚举。',
    caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok', commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [
      { label: '26.1', note: '新版本号体系首个正式版' },
      { label: '26.2', note: '续作' },
      { label: '26.3', note: '当前最新正式版（本机已安装）' },
      { label: '26.4-snapshot-*', note: '开发中快照' },
    ],
    sources: ['https://zh.minecraft.wiki/w/26.x', 'https://zh.minecraft.wiki/w/Java版26.3'],
    verified: false,
  },
];

/** 段内每个「大版本 → 小版本」由 manifest 实时展开（保证对小版本 / 快照的完整覆盖） */

export class CapabilityMatrix {
  constructor(segments = SEGMENTS, versionIndex = null) {
    this.segments = segments.slice().sort((a, b) => {
      if (!versionIndex) return 0;
      const ia = versionIndex.order.get(a.anchor), ib = versionIndex.order.get(b.anchor);
      if (ia != null && ib != null) return ib - ia; // order 越小越新 → 倒序变正序
      return 0;
    });
    this.index = versionIndex;
    this.loadedFrom = 'builtin';
  }

  static async load(versionIndex, { url = 'data/version-segments.json' } = {}) {
    const builtin = new CapabilityMatrix(SEGMENTS, versionIndex);
    try {
      const ext = await fetchJSON(url, { cache: 'no-store' }, 8000);
      if (ext && Array.isArray(ext.segments) && ext.segments.length) {
        const merged = builtin.merge(ext);
        merged.loadedFrom = 'wiki';
        return merged;
      }
    } catch { /* 外部取证文件不存在时静默使用内置基线 */ }
    return builtin;
  }

  /** 用外部取证数据覆盖内置段，并补充新段 */
  merge(ext) {
    // 外部取证文件存在两种写法，必须都吃下：
    //   ① 旧 schema：每段自带 caps { 能力键: 状态 }
    //   ② 新 schema：每段给 effects [{capability, from, to, note}]，描述「这一段造成了什么变迁」
    // ①直接可读；②必须按时间正序**回放**才能得出「该段结束时每个能力的实际状态」。
    // 只认 ① 会静默把全部能力判成 unsupported —— 整个能力矩阵全灭，而且不报错。
    const extSegs = Array.isArray(ext.segments) ? ext.segments.slice() : [];
    try {
      extSegs.sort((a, b) => this._cmp(a.anchor || a.anchorVersion, b.anchor || b.anchorVersion));
    } catch { /* 排序失败就按文件里的原顺序 */ }

    const replay = new Map();           // 段下标 -> 该段结束时的能力快照
    const state = {};
    for (const k of CAP_KEYS) state[k] = 'unsupported';
    extSegs.forEach((s, i) => {
      if (Array.isArray(s.effects)) {
        for (const e of s.effects) {
          const k = capKeyOf(e && e.capability);
          const to = e && e.to;
          if (k && STATUS_LABEL[to]) state[k] = to;
        }
      }
      replay.set(i, Object.assign({}, state));
    });

    const byId = new Map(this.segments.map((s) => [s.id, s]));

    // 外部段的 id 与内置段的 id 命名体系不同（内置 seg-1402，外部 seg-1.4.2），
    // 只按 id 去重会留下两个锚在同一版本的段。这里按「锚点版本相同」再删一遍内置段，外部取证优先。
    const extAnchors = new Set(extSegs.map((s) => String(s.anchor || s.anchorVersion || '')).filter(Boolean));
    for (const [id, s] of Array.from(byId)) {
      if (extAnchors.has(String(s.anchor || ''))) byId.delete(id);
    }

    extSegs.forEach((s, i) => {
      const caps = {};
      for (const k of CAP_KEYS) {
        const fromEffects = Array.isArray(s.effects) ? replay.get(i)[k] : null;
        caps[k] = fromEffects || (s.caps && s.caps[k]) || 'unsupported';
      }
      const seg = {
        id: s.id, title: s.title, anchor: s.anchor || s.anchorVersion, anchorType: s.anchorType || 'release',
        date: s.date || '', change: s.change || '',
        caps, subs: normalizeSubs(s), sources: s.sources || [], verified: true,
      };
      byId.set(seg.id, seg);
    });

    const list = Array.from(byId.values());
    const m = new CapabilityMatrix(list, this.index);
    m.loadedFrom = 'wiki';
    m.extCapabilities = ext.capabilities || null;
    return m;
  }

  /** 取某版本所处「段」 */
  segmentAt(versionId) {
    const sorted = this._sorted();
    let found = sorted[0];
    for (const s of sorted) {
      if (this._cmp(s.anchor, versionId) <= 0) found = s;
      else break;
    }
    return found;
  }

  /** 某版本的能力状态表 */
  capsAt(versionId) {
    const seg = this.segmentAt(versionId);
    return seg ? seg.caps : null;
  }

  /** 某能力在某版本是否可用（组字面量判断，供 UI 门控） */
  isAvailable(versionId, capKey) {
    const c = this.capsAt(versionId);
    if (!c) return false;
    return c[capKey] === 'ok' || c[capKey] === 'partial' || c[capKey] === 'degraded';
  }

  isFull(versionId, capKey) { const c = this.capsAt(versionId); return !!c && c[capKey] === 'ok'; }

  _sorted() {
    if (this._cacheSorted && this._sortedLen === this.segments.length) return this._cacheSorted;
    const s = this.segments.slice();
    if (this.index) s.sort((a, b) => this._cmp(a.anchor, b.anchor));
    this._cacheSorted = s; this._sortedLen = s.length;
    return s;
  }

  /** anchor 比较：负数 = a 比 b 旧 */
  _cmp(a, b) {
    if (this.index) {
      const ia = this.index.order.get(a), ib = this.index.order.get(b);
      if (ia != null && ib != null) return ib - ia;
    }
    return 0;
  }

  /** 把某段的「大版本 → 小版本」用 manifest 实时展开 */
  expandSegment(seg, { includePrerelease = true } = {}) {
    if (!this.index) return [{ label: seg.anchor, items: [{ id: seg.anchor, note: seg.title }] }];
    const sorted = this._sorted();
    const i = sorted.indexOf(seg);
    const next = sorted[i + 1] || null;
    const groups = new Map();
    for (const v of this.index.versions) {
      if (!includePrerelease && v.type !== 'release') continue;
      if (!this._inSegment(seg, v.id)) continue;
      const major = majorOf(v.id);
      if (!groups.has(major)) groups.set(major, []);
      groups.get(major).push({ id: v.id, type: v.type, date: v.releaseTime, note: '' });
    }
    void next;
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }

  _inSegment(seg, versionId) {
    const sorted = this._sorted();
    const i = sorted.indexOf(seg);
    if (i < 0) return false;
    const from = seg.anchor;
    const to = sorted[i + 1] ? sorted[i + 1].anchor : null;
    const geFrom = this._cmp(from, versionId) <= 0;
    if (!geFrom) return false;
    if (to == null) return true;
    return this._cmp(to, versionId) > 0;
  }
}

function majorOf(id) {
  const p = /^(\d+(?:\.\d+)?)/.exec(String(id).replace(/[-_]+v\d*[-_]*$/i, ''));
  if (!p) return String(id);
  const parts = p[1].split('.');
  return parts.length >= 2 ? parts.slice(0, 2).join('.') : parts[0];
}

function normalizeSubs(s) {
  if (Array.isArray(s.subs)) return s.subs;
  if (Array.isArray(s.majorVersions)) {
    return s.majorVersions.map((mv) => ({
      label: mv.label || mv.version,
      note: mv.note || '',
      items: mv.subVersions || mv.items || [],
    }));
  }
  if (Array.isArray(s.subVersions)) return s.subVersions;
  return [];
}

/** 生成「版本 × 能力」二维表（供矩阵页渲染） */
export function buildMatrixRows(matrix, { releasesOnly = false, limit = 120 } = {}) {
  const index = matrix.index;
  if (!index) return [];
  const versions = releasesOnly ? index.releases(limit) : index.versions.slice(0, limit);
  return versions.map((v) => ({
    version: v.id,
    type: v.type,
    date: v.releaseTime,
    caps: matrix.capsAt(v.id),
    segment: matrix.segmentAt(v.id),
  }));
}
