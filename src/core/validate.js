// validate.js —— 语义校验
//
// 用户报障原话：「语法检查没用，只能检查json语法」。
// 所以这一层不检查括号配对（那是 parseSNBT 的活），而是检查**语义**：
//   · 组件是不是真的存在（wiki 组件表里有没有）
//   · 这个组件在当前版本能不能用（引入版本 / 已被改名）
//   · 值的形式对不对（枚举值越界、类型不匹配、空值）
//   · 命令在 wiki 命令表里有没有、当前版本有没有这种语法形式
//   · 参数个数是否超出该形式
//   · 版本号是不是清单里真实存在的版本
//
// 设计约定：只读依赖，不 import store（避免循环依赖）；版本从参数传进来。
// 所有 issue 都带 level：'error' 阻断生成、'warning' 可继续但需注意、'info' 提示。

import { isComponentEra, versionOrder, parseVersion, isAncient } from './versions.js';
import { stackSyntax, findCommand, formFor, commandAvailable, commandName, tokenizeCommand, splitTopLevel } from './commands.js';
import { componentById, ALL_COMPONENTS, COMPONENT_ALIASES } from '../data/components-wiki.js';
import { parseSNBT } from './nbt.js';

const LEVEL_RANK = { error: 0, warning: 1, info: 2 };

function issue(level, code, message, extra = null) {
  return { level, code, message, ...(extra || {}) };
}

/** 汇总结果：ok 只看有没有 error */
function result(issues) {
  const sorted = issues.slice().sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return {
    ok: !sorted.some((i) => i.level === 'error'),
    issues: sorted,
    errors: sorted.filter((i) => i.level === 'error'),
    warnings: sorted.filter((i) => i.level === 'warning'),
  };
}

/** 版本可用性：since 是否已经不晚于 version。since 为 null 视为「未取证」，不判定。 */
export function availableSince(since, version) {
  if (!since || !version) return null;
  try { return versionOrder(since) <= versionOrder(version); } catch { return null; }
}

/**
 * 某个语法形式是否真的适用于这个版本。
 * 为什么要单独判：commands.js 的 formFor() 在匹配不到时会兜底返回最后一个表单，
 * 直接信它会拿到属于别的版本的语法。
 * 判定口径：since 不晚于 version，且 until 不早于 version；字段缺失按「未标注」放行。
 */
export function formFitsVersion(form, version) {
  if (!form || !version) return true;
  try {
    if (form.since && versionOrder(form.since) > versionOrder(version)) return false;
    if (form.until && versionOrder(version) > versionOrder(form.until)) return false;
  } catch { return true; }
  return true;
}

/* ============================ 组件值的形状检查 ============================ */
// 只覆盖「值的形式有明确对错」的组件；布局类 / 复杂结构的组件不硬判，
// 免得把一个合法写法误报成错误。

const RARITY = ['common', 'uncommon', 'rare', 'epic'];

function asInt(s) {
  const t = String(s == null ? '' : s).trim();
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

function parseValueLoose(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return undefined;
  // 数字 / 布尔直接给原生值；其余交给 SNBT 解析
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  try {
    const r = parseSNBT(t);
    // 注意：本仓库的 parseSNBT 返回的是 {ok, error, value} 包装对象，
    // 不是解析结果本身。这里必须解包，否则 parsed.xxx 永远是 undefined。
    if (r && typeof r === 'object' && 'ok' in r) return r.ok ? r.value : undefined;
    return r;
  } catch { return undefined; }
}

function checkValueShape(id, value) {
  const out = [];
  const raw = String(value == null ? '' : value).trim();

  if (!raw) {
    out.push(issue('warning', 'component.empty-value', `组件 ${id} 的值是空的，生成的命令会是 ${id}=，游戏里多半不认`));
    return out;
  }

  const parsed = parseValueLoose(raw);

  switch (id) {
    case 'max_stack_size': {
      const n = asInt(raw);
      if (n === null) out.push(issue('error', 'value.not-int', 'max_stack_size 必须是整数'));
      else if (n < 1 || n > 99) out.push(issue('error', 'value.range', `max_stack_size 取值 1–99，当前是 ${n}（99 是上限；普通物品一堆 64）`));
      break;
    }
    case 'max_damage': {
      const n = asInt(raw);
      if (n === null) out.push(issue('error', 'value.not-int', 'max_damage 必须是整数'));
      else if (n < 1) out.push(issue('error', 'value.range', 'max_damage 至少为 1'));
      break;
    }
    case 'damage':
    case 'repair_cost': {
      const n = asInt(raw);
      if (n === null) out.push(issue('error', 'value.not-int', `${id} 必须是整数`));
      else if (n < 0) out.push(issue('error', 'value.range', `${id} 不能为负`));
      break;
    }
    case 'custom_model_data': {
      if (asInt(raw) === null && !(parsed && typeof parsed === 'object')) {
        out.push(issue('warning', 'value.expected-int', 'custom_model_data 通常是整数（或 {floats:[…],strings:[…]} 形式）'));
      }
      break;
    }
    case 'rarity': {
      const v = raw.replace(/^"|"$/g, '').replace(/^minecraft:/, '');
      if (!RARITY.includes(v)) {
        out.push(issue('error', 'value.enum', `rarity 只能是 ${RARITY.join(' / ')}，当前是 ${v}`));
      }
      break;
    }
    case 'unbreakable': {
      if (!/^\{\s*\}$/.test(raw) && !/^true$|^false$/.test(raw)) {
        out.push(issue('warning', 'value.shape', 'unbreakable 是一个空复合标签 {}（旧写法才是布尔值）'));
      }
      break;
    }
    case 'enchantments':
    case 'stored_enchantments': {
      if (!parsed || typeof parsed !== 'object') {
        out.push(issue('error', 'value.type', `${id} 需要复合标签，形如 {levels:{"minecraft:sharpness":5}}`));
      } else if (!('levels' in parsed)) {
        out.push(issue('warning', 'value.shape', `${id} 通常写成 {levels:{…}}，当前没有 levels 字段`));
      }
      break;
    }
    case 'custom_name':
    case 'item_name':
      if (!/^["']/.test(raw) && !/^\[/.test(raw) && !/^\{/.test(raw)) {
        out.push(issue('warning', 'value.text-component', `${id} 是文本组件：直接写要加引号（"名称"），或用 JSON 形式 {"text":"…"}`));
      }
      break;
    case 'lore':
      if (!Array.isArray(parsed)) {
        out.push(issue('warning', 'value.type', 'lore 是文本组件数组，形如 [{"text":"第一行"}]'));
      }
      break;
    case 'dyed_color': {
      if (parsed && typeof parsed === 'object' && parsed.rgb != null) {
        const n = Number(parsed.rgb);
        if (!Number.isFinite(n) || n < 0 || n > 0xffffff) {
          out.push(issue('error', 'value.range', `dyed_color 的 rgb 是 0–16777215 的整数，当前是 ${parsed.rgb}`));
        }
      } else if (asInt(raw) === null) {
        out.push(issue('warning', 'value.shape', 'dyed_color 形如 {rgb:16711680}'));
      }
      break;
    }
    case 'enchantment_glint_override':
      if (!/^(true|false)$/.test(raw)) {
        out.push(issue('warning', 'value.expected-bool', 'enchantment_glint_override 是 true/false'));
      }
      break;
    case 'custom_data':
    case 'block_state':
    case 'attribute_modifiers':
    case 'tool':
    case 'food':
    case 'consumable':
    case 'use_effects':
    case 'equippable':
    case 'profile':
      if (parsed === undefined) {
        out.push(issue('error', 'value.unparsable', `${id} 的值不是合法的 SNBT/JSON`));
      }
      break;
    default:
      if (parsed === undefined) {
        out.push(issue('error', 'value.unparsable', `${id} 的值不是合法的 SNBT/JSON`));
      }
  }
  return out;
}

/* ============================ 组件列表校验 ============================ */

/**
 * @param {string} version 当前编辑版本
 * @param {Array<{key:string,value:string}>} comps
 * @returns {{ok:boolean, issues:Array}}
 */
export function validateComponents(version, comps = []) {
  const issues = [];
  const list = Array.isArray(comps) ? comps.filter((c) => c && String(c.key || '').trim()) : [];

  let syntax = null;
  try { syntax = stackSyntax(version); } catch { syntax = null; }
  if (syntax === 'nbt') {
    issues.push(issue('error', 'version.no-components',
      `${version} 还不支持数据组件（自 1.20.5 / 24w09a 起引入），这个版本要用物品 NBT`));
  }

  const seen = new Map();
  for (const c of list) {
    const rawKey = String(c.key).trim();
    const bare = rawKey.replace(/^minecraft:/, '');
    const isNamespacedMod = rawKey.includes(':') && !rawKey.startsWith('minecraft:');

    // 改名提示
    if (COMPONENT_ALIASES[bare]) {
      issues.push(issue('warning', 'component.renamed',
        `组件 ${bare} 已被 ${COMPONENT_ALIASES[bare]} 取代，建议换用新名`, { key: rawKey }));
    }

    const meta = componentById(rawKey);
    if (!meta) {
      if (isNamespacedMod) {
        issues.push(issue('info', 'component.mod-namespace',
          `${rawKey} 不是原版组件，按模组自定义组件处理（本编辑器不做校验）`, { key: rawKey }));
      } else {
        issues.push(issue('error', 'component.unknown',
          `wiki 的数据组件表里没有「${bare}」这个组件`, {
            key: rawKey,
            hint: suggestion(bare),
          }));
        continue;
      }
    } else {
      const avail = availableSince(meta.since, version);
      if (avail === false) {
        issues.push(issue('error', 'component.too-early',
          `${meta.name}（${meta.id}）自 ${meta.since} 起才可用，当前编辑的是 ${version}`, { key: rawKey }));
      } else if (avail === null && meta.since === null) {
        issues.push(issue('info', 'component.since-unverified',
          `${meta.name}（${meta.id}）的引入版本未取证，无法判断 ${version} 是否支持`, { key: rawKey }));
      }
    }

    const prev = seen.get(bare);
    if (prev) {
      issues.push(issue('warning', 'component.duplicate',
        `组件 ${bare} 出现了多次，后面的会覆盖前面的`, { key: rawKey }));
    } else {
      seen.set(bare, true);
    }

    if (meta) issues.push(...checkValueShape(meta.id, c.value));
  }

  return result(issues);
}

/** 猜一个最接近的组件名，给「你是不是想写 X」用 */
function suggestion(bare) {
  const q = String(bare).toLowerCase();
  let best = null; let bestScore = 0;
  for (const c of ALL_COMPONENTS) {
    const id = c.id.toLowerCase();
    let s = 0;
    if (id.startsWith(q.slice(0, Math.max(2, q.length - 2)))) s = 2;
    if (q.length > 3 && id.includes(q.slice(1))) s = 3;
    if (q.length > 4 && id.includes(q.slice(0, q.length - 1))) s = 4;
    if (s > bestScore) { bestScore = s; best = c.id; }
  }
  return bestScore >= 2 ? best : null;
}

/* ============================ 命令校验 ============================ */

export function validateCommandText(version, text) {
  const issues = [];
  const raw = String(text == null ? '' : text).trim();

  if (!raw) {
    issues.push(issue('warning', 'command.empty', '命令是空的'));
    return result(issues);
  }

  const body = raw.startsWith('/') ? raw.slice(1) : raw;
  // 取证结果：tokenizeCommand 返回的是词元对象数组 [{type:'tok'|'ws', v:'…'}]，
  // 不是字符串数组（tools/probe-contracts.mjs 实测）。之前直接当字符串用，
  // 于是 t.startsWith 直接炸。这里只取 type==='tok' 的 v。
  let toks = [];
  try {
    const rawToks = tokenizeCommand(body);
    toks = Array.isArray(rawToks)
      ? rawToks.filter((t) => t && t.type === 'tok').map((t) => String(t.v))
      : String(body).split(/\s+/).filter(Boolean);
  } catch {
    toks = String(body).split(/\s+/).filter(Boolean);
  }

  let name = null;
  try { name = commandName(body); } catch { name = null; }
  if (!name) {
    issues.push(issue('error', 'command.no-name', '认不出命令名'));
    return result(issues);
  }

  const cmd = findCommand(name);
  if (!cmd) {
    issues.push(issue('error', 'command.unknown',
      `wiki 的命令表里没有 /${name}（不是原版命令，或拼错了）`, { name }));
    return result(issues);
  }

  let available = null;
  try { available = commandAvailable(cmd, version); } catch { available = null; }
  if (available === false) {
    issues.push(issue('error', 'command.unavailable',
      `/${name} 在 ${version} 不可用（${cmd.since ? `自 ${cmd.since} 起` : ''}${cmd.until ? `${cmd.since ? '，' : ''}止于 ${cmd.until}` : ''}）`, { name }));
  }

  let form = null;
  try { form = formFor(cmd, version); } catch { form = null; }

  // ⚠️ 不能直接信 formFor 的返回值。
  // 它的实现末行是 `return best || cmd.forms[cmd.forms.length - 1]` ——
  // 没有表单匹配该版本时会**兜底返回最后一个表单**。对 /fill（只记了 1.13+ 一条）
  // 就意味着 1.12.2 会拿到 1.13 语法，进而产出 `/fill ~ ~ ~ ~ ~2 ~ 1` 这种不存在的命令。
  // 所以这里自己对表单的 since/until 做一次版本判定，兜底返回的表单会被判掉。
  if (form && !formFitsVersion(form, version)) form = null;

  if (!form) {
    issues.push(issue('error', 'command.no-form',
      `/${name} 在 ${version} 没有对应的语法形式；这个版本请换写法`, { name }));
  } else {
    // 参数个数：不硬判可选参数，只在明显超出时报
    const given = toks.length - 1;
    const want = (form.args || []).length;
    if (want && given > want + 2) {
      issues.push(issue('warning', 'command.too-many-args',
        `/${name} 在这套语法里大约 ${want} 个参数，当前给了 ${given} 个。期望形式：${form.syntax}`,
        { name, syntax: form.syntax }));
    }
    if (want && given === 0 && /<[^>]+>/.test(form.syntax) && !/\[[^\]]+\]/.test(form.syntax.split(' ').slice(1).join(' '))) {
      issues.push(issue('info', 'command.args-hint',
        `/${name} 的期望形式：${form.syntax}`, { name, syntax: form.syntax }));
    }
  }

  // 目标选择器粗检（toks 现在是纯字符串）
  for (const t of toks) {
    if (!t.startsWith('@')) continue;
    if (/^@[aprsen](\[.*\])?$/.test(t)) continue;
    issues.push(issue('error', 'command.bad-selector',
      `「${t}」不是合法的目标选择器（应为 @a/@p/@r/@s/@e/@n，可带 [参数]）`));
  }

  // SNBT 片段能不能解析。
  // 实测形状：`minecraft:stone{custom_name="x"}` 整体是**一个** token，
  // 所以不能只看以 { 开头的 token，要从每个 token 里把 {…} 摘出来验。
  for (const t of toks) {
    const i = t.indexOf('{');
    if (i < 0) continue;
    const frag = t.slice(i);
    if (!frag.endsWith('}')) {
      issues.push(issue('error', 'command.bad-snbt',
        `NBT 片段缺少闭合的 }：${frag.slice(0, 40)}${frag.length > 40 ? '…' : ''}`));
      continue;
    }
    const r = parseSNBT(frag);
    if (!r || r.ok !== true) {
      issues.push(issue('error', 'command.bad-snbt',
        `NBT 片段无法解析：${frag.slice(0, 40)}${frag.length > 40 ? '…' : ''}（${(r && r.error) || '未知错误'}）`));
    }
  }

  return result(issues);
}

/* ============================ 版本校验 ============================ */

export function validateVersionId(id, index) {
  const issues = [];
  const v = String(id == null ? '' : id).trim();
  if (!v) {
    issues.push(issue('error', 'version.empty', '版本号是空的'));
    return result(issues);
  }
  if (!index || !Array.isArray(index.versions)) {
    issues.push(issue('info', 'version.no-index', '版本清单尚未加载，无法确认这个版本是否存在'));
    return result(issues);
  }
  const hit = index.versions.find((x) => x.id === v);
  if (!hit) {
    issues.push(issue('error', 'version.unknown', `版本清单里没有「${v}」这个版本（清单来自 Mojang launchermeta）`));
    return result(issues);
  }
  let p = null;
  try { p = parseVersion(v); } catch { p = null; }
  if (p && p.kind === 'snapshot' && !isAncient(v) && !isComponentEra(v)) {
    issues.push(issue('info', 'version.snapshot', `${v} 是开发版，行为可能与正式版有差异`));
  }
  return result(issues);
}

/* ============================ 统一入口 ============================ */

/** 给 UI 用：把一堆 issue 压成一行摘要 */
export function summarize(res) {
  if (!res || !res.issues.length) return { level: 'ok', text: '没有发现问题' };
  const n = { error: 0, warning: 0, info: 0 };
  for (const i of res.issues) n[i.level] = (n[i.level] || 0) + 1;
  const parts = [];
  if (n.error) parts.push(`${n.error} 个错误`);
  if (n.warning) parts.push(`${n.warning} 个警告`);
  if (n.info) parts.push(`${n.info} 条提示`);
  return { level: n.error ? 'error' : (n.warning ? 'warning' : 'info'), text: parts.join(' · ') };
}
