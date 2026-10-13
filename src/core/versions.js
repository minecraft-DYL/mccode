// versions.js —— 版本清单（Mojang 官方 manifest）+ 版本号解析 / 排序 / 分组
// 说明：全部数据来自 https://launchermeta.mojang.com/mc/game/version_manifest_v2.json（实测 CORS 开放）
// 新版本号体系（26.1 / 26.2 / 26.3 / 26.4-snapshot-*）与旧体系（1.x.y）同时支持。

import { fetchJSON, store, pool } from './util.js';

export const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
/** 版本清单源（按顺序尝试）。
 * 注意：官方源带 CORS `*`，浏览器里可直接读；
 * bmclapi2 镜像实测【不返回 Access-Control-Allow-Origin】，浏览器中必然被拦，
 * 因此只作为最后兜底（供 Electron / 本地代理等不受 CORS 约束的环境使用）。 */
export const MANIFEST_MIRRORS = [
  MANIFEST_URL,
  'https://launchermeta.mojang.com/mc/game/version_manifest.json',
  'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
];
const CACHE_KEY = 'manifest.v2';
const CACHE_TTL = 1000 * 60 * 60 * 6; // 6 小时

/**
 * 远古版本时序表（2009–2011），时间正序（旧 → 新）。
 * 来源：Mojang 官方 manifest 中 type = old_alpha / old_beta 的全部 61 个版本。
 * 这是冻结数据（Mojang 不会再新增 2009 年的版本），因此可以作为权威序数表硬编码。
 *
 * 为什么必须单独处理：`rd-132211` 这类 id 会被通用数字正则解析成 nums=[132211]，
 * 若直接按数值比较，它比 26.3 还"新"，会导致 2009 年的版本被判为支持全部命令。
 */
export const ANCIENT_ORDER = [
  'rd-132211', 'rd-132328', 'rd-20090515', 'rd-160052', 'rd-161348',
  'c0.0.11a', 'c0.0.13a_03', 'c0.0.13a', 'c0.30_01c',
  'inf-20100618',
  'a1.0.4', 'a1.0.5_01', 'a1.0.11', 'a1.0.14', 'a1.0.15', 'a1.0.16', 'a1.0.17_02', 'a1.0.17_04',
  'a1.1.0', 'a1.1.2', 'a1.1.2_01',
  'a1.2.0', 'a1.2.0_01', 'a1.2.0_02', 'a1.2.1', 'a1.2.1_01', 'a1.2.2a', 'a1.2.2b',
  'a1.2.3', 'a1.2.3_01', 'a1.2.3_02', 'a1.2.3_04', 'a1.2.4_01', 'a1.2.5', 'a1.2.6',
  'b1.0', 'b1.0_01', 'b1.0.2', 'b1.1_01', 'b1.1_02', 'b1.2', 'b1.2_01', 'b1.2_02',
  'b1.3b', 'b1.3_01', 'b1.4', 'b1.4_01', 'b1.5', 'b1.5_01',
  'b1.6', 'b1.6.1', 'b1.6.2', 'b1.6.3', 'b1.6.4', 'b1.6.5', 'b1.6.6',
  'b1.7', 'b1.7.2', 'b1.7.3', 'b1.8', 'b1.8.1',
];

/** 远古时代识别（顺序敏感：infdev 必须在 indev 之前判断） */
const ERA_RULES = [
  { re: /^(rd|pre[-_]?classic)/i, era: 'preclassic', rank: 1, label: 'Pre-classic' },
  { re: /^c\d/i, era: 'classic', rank: 2, label: 'Classic' },
  { re: /^inf/i, era: 'infdev', rank: 3, label: 'Infdev' },
  { re: /^in[-_]?\d/i, era: 'indev', rank: 4, label: 'Indev' },
  { re: /^a\d/i, era: 'alpha', rank: 5, label: 'Alpha' },
  { re: /^b\d/i, era: 'beta', rank: 6, label: 'Beta' },
];

/**
 * 愚人节版本。来源：Mojang manifest 中每年 4 月 1 日发布的快照，已逐个按 id 复核存在性。
 * 注意 manifest 里的实际 id 与玩家俗称不同：
 *   20w14∞ → `20w14infinite`；22w13oneBlockAtATime → 全小写 `22w13oneblockatatime`。
 * 这些 id 不符合常规命名，若不先识别会被通用数字正则判成 release。
 */
export const APRIL_FOOLS = [
  '15w14a', '1.RV-Pre1', '3D Shareware v1.34', '20w14infinite',
  '22w13oneblockatatime', '23w13a_or_b', '24w14potato', '25w14craftmine', '26w14a',
];

export function isAprilFools(id) { return APRIL_FOOLS.includes(String(id || '').trim()); }

/**
 * 版本号解析。返回统一的描述对象。
 * 支持：1.20.5 / 26.3 / 26.3-snapshot-1 / 24w09a / 1.21.4-pre1 / 26.3-rc-2 / 1.21.11-v-
 * 以及远古版本 rd-132211 / c0.30_01c / inf-20100618 / a1.2.6 / b1.7.3
 * 以及愚人节版本与老式 "1.14 Pre-Release 4" 命名
 */
export function parseVersion(id) {
  const raw = String(id || '').trim();
  const s = raw.replace(/[-_]+v\d*[-_]*$/i, '').replace(/[-_]+data$/i, '');
  const out = { raw, id: s, kind: 'unknown', nums: [], week: null, letter: null, build: null, channel: null, era: null, eraRank: 0, april: false };

  // 远古版本（2009–2011）：版本号不是 1.x 语义，必须单独标记，否则会被当成"最新版"
  for (const rule of ERA_RULES) {
    if (!rule.re.test(s)) continue;
    out.era = rule.era;
    out.eraRank = rule.rank;
    out.kind = 'old';
    out.channel = 'old';
    const nm = /(\d+(?:\.\d+)*)/.exec(s);
    out.nums = nm ? nm[1].split('.').map((n) => parseInt(n, 10)) : [];
    return out;
  }

  // 愚人节版本：命名不规则（24w14potato / 3D Shareware v1.34），必须先于通用正则识别
  if (isAprilFools(s)) {
    out.kind = 'snapshot';
    out.channel = 'aprilfools';
    out.april = true;
    const wk = /^(\d{2})w(\d{2})/i.exec(s);
    if (wk) out.week = parseInt(wk[1], 10) * 100 + parseInt(wk[2], 10);
    else {
      const nm = /(\d+(?:\.\d+)*)/.exec(s);
      out.nums = nm ? nm[1].split('.').map((n) => parseInt(n, 10)) : [];
    }
    return out;
  }

  // 老式预发布命名（带空格）：1.14 Pre-Release 4 / 1.9.3 Pre-Release 2
  let m = /^(\d+(?:\.\d+)*)\s+pre[-_ ]?release\s*(\d*)$/i.exec(s);
  if (m) {
    out.nums = m[1].split('.').map((n) => parseInt(n, 10));
    out.kind = 'pre';
    out.channel = 'pre';
    out.build = m[2] ? parseInt(m[2], 10) : null;
    return out;
  }

  // 旧快照：24w09a / 24w09b
  m = /^(\d{2})w(\d{2})([a-z])$/i.exec(s);
  if (m) {
    out.kind = 'snapshot';
    out.week = parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
    out.letter = m[3].toLowerCase();
    out.channel = 'snapshot';
    return out;
  }

  // 版本段 + 可选通道后缀：1.20.5 / 26.3 / 26.3-snapshot-1 / 1.21.4-pre1 / 1.21.4-rc2
  m = /^(\d+(?:\.\d+)*)(?:[-_](snapshot|pre|rc|preview)[-_]?(\d*))?$/i.exec(s);
  if (m) {
    out.nums = m[1].split('.').map((n) => parseInt(n, 10));
    const ch = (m[2] || '').toLowerCase();
    if (!ch) { out.kind = 'release'; out.channel = 'release'; }
    else {
      out.kind = ch === 'preview' ? 'pre' : ch;
      out.channel = out.kind;
      out.build = m[3] ? parseInt(m[3], 10) : null;
    }
    return out;
  }

  // 其它（如 "latest"、第三方版本名）：尝试抽取数字
  m = /(\d+(?:\.\d+)*)/.exec(s);
  if (m) { out.nums = m[1].split('.').map((n) => parseInt(n, 10)); out.kind = 'release'; out.channel = 'release'; }
  return out;
}

/** 是否远古版本（2009–2011） */
export function isAncient(id) {
  return parseVersion(id).era != null;
}

/** 是否 26.x 之后的新版本号体系 */
export function isNewScheme(id) {
  const p = parseVersion(id);
  if (p.era) return false;
  return p.nums.length > 0 && p.nums[0] >= 26;
}

/* ------------------------------------------------------------------
 * 语义化「时代」判断。
 * 之前这些条件在 commands.js / output.js 里手写了 9 遍，且写法不一致
 * （其中一处 (nums[2] || 0) >= 0 恒真，把 1.12 误判成数据包时代）。
 * 统一收敛到这里，只此一份，便于单测锁定。
 * 所有判断都必须先排除远古版本：它们被抽出的数字（如 132211）会误命中 >= 26。
 * ------------------------------------------------------------------ */

/** 数据包时代：1.13 起（或 26.x）。特征：字符串 ID、/data、命令物品参数不再有 [data] 数字项 */
export function isDatapackEra(id) {
  const p = parseVersion(id);
  if (p.era || !p.nums.length) return false;
  if (p.nums[0] >= 26) return true;
  return p.nums[0] === 1 && p.nums[1] >= 13;
}

/** 方块状态时代：1.19 起（或 26.x）。特征：命令方块的类型/朝向改为方块状态而非 NBT */
export function isBlockStateEra(id) {
  const p = parseVersion(id);
  if (p.era || !p.nums.length) return false;
  if (p.nums[0] >= 26) return true;
  return p.nums[0] === 1 && p.nums[1] >= 19;
}

/** 物品组件时代：1.20.5（24w09a）起（或 26.x）。特征：物品参数由 {NBT} 变为 [组件] */
export function isComponentEra(id) {
  const p = parseVersion(id);
  if (p.era || !p.nums.length) return false;
  if (p.nums[0] >= 26) return true;
  return p.nums[0] === 1 && (p.nums[1] > 20 || (p.nums[1] === 20 && (p.nums[2] || 0) >= 5));
}

/** 函数/数据包命名空间：1.13 起 */
export function isNamespacedFunction(id) { return isDatapackEra(id); }

/** 版本序号：把 远古 / 1.x / 26.x / 旧式快照 归一化成可比较的数字（越大越新）。
 *  关键约束：
 *   1. 远古版本必须排在所有 1.x 之前（否则 rd-132211 会被当成比 26.3 还新）；
 *   2. 新的「年份.序号」体系（26.x）整体晚于所有 1.x。 */
export function versionOrder(v) {
  const p = parseVersion(v);

  // 远古版本：查权威时序表；表内没有的给一个不可能与 1.x 混淆的小值
  if (p.era) {
    const i = ANCIENT_ORDER.indexOf(p.id);
    return i >= 0 ? i : p.eraRank * 10;
  }

  const chan = { release: 9, rc: 7, pre: 5, snapshot: 1, old: 0 }[p.kind] ?? 0;

  // 旧式快照 24w09a → week = 24*100+9 = 2409；排在所有 1.x 之后、26.x 之前
  if (p.week != null) return 50e9 + p.week * 1e3 + (p.letter ? p.letter.charCodeAt(0) - 96 : 0);

  if (!p.nums.length) return 0;
  const [a, b = 0, c = 0] = p.nums;
  const base = a >= 26
    ? 100e9 + a * 1e6 + b * 1e3 + c   // 26.3 → 100026003000+
    : a * 1e9 + b * 1e6 + c * 1e3;    // 1.21.11 → 1021011000+
  return base + chan;
}

/** 大版本标签（用于 UI 分组）：1.21.4 → "1.21"；26.3-snapshot-1 → "26.3"；
 *  24w09a → "2024 年周快照"（否则 437 个周快照会各自成为一组）；远古 → "Alpha" 等。 */
export function majorLabel(id) {
  const p = parseVersion(id);
  if (p.era) {
    const r = ERA_RULES.find((x) => x.era === p.era);
    return (r ? r.label : '远古') + '（远古版本）';
  }
  if (p.april) return '愚人节快照';
  if (p.week != null) return `${2000 + Math.floor(p.week / 100)} 年快照`;
  if (!p.nums.length) return '其它';
  return p.nums.slice(0, 2).join('.');
}

export function isPreRelease(id) {
  const p = parseVersion(id);
  return p.kind === 'pre' || p.kind === 'rc' || p.kind === 'snapshot';
}

export function channelName(kind) {
  return {
    release: '正式版', snapshot: '快照', pre: '预发布', rc: '候选版',
    old: '远古版本', aprilfools: '愚人节版本', unknown: '未知',
  }[kind] || kind;
}

export class VersionIndex {
  constructor(manifest) {
    this.manifest = manifest;
    this.versions = manifest.versions;
    this.byId = new Map(this.versions.map((v) => [v.id, v]));
    this.order = new Map(this.versions.map((v, i) => [v.id, i])); // 索引越小越新
    this.latest = manifest.latest;
  }

  get(id) { return this.byId.get(id) || this.byId.get(parseVersion(id).id) || null; }

  /** 在时间轴上，a 是否比 b 新（含等于） */
  isAtLeast(a, b) {
    const ia = this.order.get(a), ib = this.order.get(b);
    if (ia != null && ib != null) return ia <= ib; // manifest 按时间倒序
    // 兜底：数值化比较
    return compareParsed(parseVersion(a), parseVersion(b)) >= 0;
  }

  /** 按大版本分组（用于 UI 下拉） */
  groupByMajor({ includeSnapshots = true, limitMajors = Infinity } = {}) {
    const groups = new Map();
    for (const v of this.versions) {
      if (!includeSnapshots && v.type !== 'release') continue;
      const key = majorLabel(v.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    return Array.from(groups.entries()).slice(0, limitMajors === Infinity ? undefined : limitMajors)
      .map(([label, items]) => ({ label, items }));
  }

  releases(limit = Infinity) { return this.versions.filter((v) => v.type === 'release').slice(0, limit); }
}

function compareParsed(a, b) {
  // 远古版本必须先按权威时序表比较，否则 nums=[132211] 会把它顶到最新
  const ea = a.era ? (ANCIENT_ORDER.indexOf(a.id) >= 0 ? ANCIENT_ORDER.indexOf(a.id) : a.eraRank * 10) : null;
  const eb = b.era ? (ANCIENT_ORDER.indexOf(b.id) >= 0 ? ANCIENT_ORDER.indexOf(b.id) : b.eraRank * 10) : null;
  if (ea != null || eb != null) {
    if (ea == null) return 1;   // 远古 < 正式
    if (eb == null) return -1;
    return ea === eb ? 0 : (ea > eb ? 1 : -1);
  }
  const la = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < la; i++) {
    const x = a.nums[i] || 0, y = b.nums[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  const rank = { release: 3, rc: 2, pre: 1, snapshot: 0, old: -2, unknown: -1 };
  const ra = rank[a.kind] ?? -1, rb = rank[b.kind] ?? -1;
  if (ra !== rb) return ra > rb ? 1 : -1;
  if (a.week != null && b.week != null && a.week !== b.week) return a.week > b.week ? 1 : -1;
  if (a.letter && b.letter) return a.letter > b.letter ? 1 : -1;
  return (a.build || 0) - (b.build || 0);
}

/** 拉取 manifest（带本地缓存） */
export async function loadManifest({ force = false, onStatus = () => {} } = {}) {
  if (!force) {
    const c = store.get(CACHE_KEY);
    if (c && c.manifest && Date.now() - c.at < CACHE_TTL) {
      onStatus(`使用缓存版本清单（${new Date(c.at).toLocaleString('zh-CN')}）`);
      return { index: new VersionIndex(c.manifest), fromCache: true, at: c.at };
    }
  }
  let lastErr = null;
  for (const url of MANIFEST_MIRRORS) {
    try {
      onStatus(`正在拉取版本清单：${new URL(url).host}…`);
      const m = await fetchJSON(url, { cache: 'no-store' }, 30000);
      if (!m || !Array.isArray(m.versions)) throw new Error('清单格式异常');
      store.set(CACHE_KEY, { at: Date.now(), manifest: m });
      onStatus(`版本清单已更新：${m.versions.length} 个版本，最新正式版 ${m.latest.release}`);
      return { index: new VersionIndex(m), fromCache: false, at: Date.now(), url };
    } catch (e) { lastErr = e; onStatus(`源不可达（${e.message}），尝试下一个…`); }
  }
  // 全部失败 → 退回任何可用缓存
  const c = store.get(CACHE_KEY);
  if (c && c.manifest) return { index: new VersionIndex(c.manifest), fromCache: true, at: c.at, stale: true };
  throw new Error(`无法获取版本清单：${lastErr ? lastErr.message : '未知错误'}`);
}

/** 取某个版本的详细 JSON（含 downloads.client.url） */
export async function fetchVersionDetail(index, id) {
  const v = index.get(id);
  if (!v) throw new Error(`版本 ${id} 不在清单中`);
  const key = `vdetail.${v.id}`;
  const c = store.get(key);
  if (c && c.at && Date.now() - c.at < CACHE_TTL * 4) return c.detail;
  const detail = await fetchJSON(v.url, {}, 30000);
  store.set(key, { at: Date.now(), detail });
  return detail;
}

/** 解析本机已安装的版本目录名（供手动选 jar 时使用） */
export function normalizeLocalId(dirName) {
  return parseVersion(dirName).id;
}

/** 版本能力快照：用于 UI 上显示"这个版本能干什么" */
export function versionFacts(id) {
  const p = parseVersion(id);
  const n = p.nums;
  const ge = (a, b, c) => {
    if (n.length === 0) return false;
    if (n[0] >= 26) return false; // 26.x 走独立分支，由 capabilities 表处理
    const want = [a, b, c].filter((x) => x !== undefined);
    for (let i = 0; i < want.length; i++) {
      const x = n[i] || 0, y = want[i] || 0;
      if (x !== y) return x > y;
    }
    return true;
  };
  return {
    parsed: p,
    isNewScheme: n[0] >= 26,
    hasDataComponents: n[0] >= 26 || (n[0] === 1 && ge(1, 20, 5)),
    hasFlatRegistry: n[0] >= 26 || (n[0] === 1 && ge(1, 13, 0)),
    hasDatapack: n[0] >= 26 || (n[0] === 1 && ge(1, 13, 0)),
    hasFunction: n[0] >= 26 || (n[0] === 1 && ge(1, 12, 0)),
    hasItemModelDefs: n[0] >= 26 || (n[0] === 1 && ge(1, 21, 4)),
    hasMacro: n[0] >= 26 || (n[0] === 1 && ge(1, 20, 2)),
  };
}

/** 预热：并发检查若干版本的资源可用性（供"实时检索"用） */
export async function probeAssets(ids, checker, limit = 4) {
  return pool(ids, limit, checker);
}
