#!/usr/bin/env node
// tools/fetch-legacy-ids.mjs —— 从 zh.minecraft.wiki 实抓「扁平化之前」的数字 ID 对照表，
// 生成 src/data/legacy-ids.js。
//
// 为什么需要这个工具：Java 版 1.13「扁平化」之前，方块/物品用「数字 ID + 数据值(metadata)」
// 标识（如 石头 = 1、红色羊毛 = 35:14、钻石剑 = 276），1.13 起才改成命名空间字符串 ID。
// 数字 ID 是历史事实，不能凭记忆写死 —— 本工具把每一条都从 wiki 抓下来，并在生成时校验：
//   · 数字 ID + 旧命名空间 ID + 中文名        ← Java版数据值/扁平化前/方块ID、…/物品ID
//   · 旧 ID → 1.13 新 ID（含「拆分」家族成员）← Java版1.13/扁平化
//   · 数据值顺序（第 i 个子项 ⇔ 数据值 i）    ← Java版数据值/扁平化前 的 DV 表
// 校验不通过的家族显式标注，绝不编造。
//
// 用法：
//   node tools/fetch-legacy-ids.mjs                  # 生成 src/data/legacy-ids.js
//   node tools/fetch-legacy-ids.mjs --print          # 只打印统计，不写文件
//   node tools/fetch-legacy-ids.mjs --out=path.js    # 指定输出

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = 'https://zh.minecraft.wiki';
const WIKI_EN = 'https://minecraft.wiki';
const UA = 'mccode-legacy-id-generator/1.0 (static site data build; contact: local)';

// 中文名 + 现代译名表（zh）
const PAGE_ZH_BLOCKS = 'Java版数据值/扁平化前/方块ID';
const PAGE_ZH_ITEMS = 'Java版数据值/扁平化前/物品ID';
const PAGE_PREFLAT = 'Java版数据值/扁平化前';
const PAGE_FLATTEN = 'Java版1.13/扁平化';
// 真正的 1.12.2 旧标识符 + 数字 ID（en）—— zh 表混用了 1.13 之后的现代 ID
// （例如把数字 ID 80 写成 snow_block，而当年叫 snow），因此「身份」必须以 en 表为准。
const PAGE_EN_BLOCKS = 'Java Edition pre-flattening data values/Block IDs';
const PAGE_EN_ITEMS = 'Java Edition pre-flattening data values/Item IDs';
// 第二条取证通道：en 的 DV 表（41+ 张，比 zh 多）配 en 的扁平化对照表，
// 两张表都是英文，子项名能精确对上，于是 new_id → 数据值 可以直接算出来。
const PAGE_EN_PREFLAT = 'Java Edition pre-flattening data values';
const PAGE_EN_FLATTEN = 'The Flattening (Java Edition)';

/* ----------------------------- HTML 小工具 ----------------------------- */

function stripTags(s) {
  return String(s)
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 切出所有顶层 <table>（支持嵌套时只取最外层，避免重复计入内层行）。 */
function extractTables(html) {
  const out = [];
  const re = /<table\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    let depth = 1;
    const tagRe = /<(\/?)table\b[^>]*>/g;
    tagRe.lastIndex = m.index + m[0].length;
    let t;
    let end = -1;
    while ((t = tagRe.exec(html))) {
      if (t[1] === '/') { depth--; if (depth === 0) { end = t.index; break; } }
      else depth++;
    }
    if (end < 0) break;
    out.push({ html: html.slice(m.index, end + 8), attrs: m[0] });
    re.lastIndex = end + 8;
  }
  return out;
}

/**
 * 单表 → 二维单元格文本数组，rowspan/colspan 就地展开。
 * 用「稀疏网格 + 找当前行下一个空列」实现：对任意 rowspan/colspan 组合都正确。
 */
function parseTable(tableHtml) {
  const body = tableHtml.replace(/^<table\b[^>]*>/, '').replace(/<\/table>\s*$/, '');
  const rawRows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let rm;
  while ((rm = rowRe.exec(body))) {
    const cells = [];
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const rs = /rowspan\s*=\s*"?(\d+)/i.exec(cm[2]);
      const cs = /colspan\s*=\s*"?(\d+)/i.exec(cm[2]);
      cells.push({ text: stripTags(cm[3]), rowspan: rs ? +rs[1] : 1, colspan: cs ? +cs[1] : 1 });
    }
    if (cells.length) rawRows.push(cells);
  }
  const grid = [];
  const ensure = (r) => { while (grid.length <= r) grid.push([]); };
  rawRows.forEach((cells, r) => {
    ensure(r);
    let c = 0;
    for (const cell of cells) {
      while (grid[r][c] !== undefined) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        ensure(r + dr);
        for (let dc = 0; dc < cell.colspan; dc++) grid[r + dr][c + dc] = cell.text;
      }
      c += cell.colspan;
    }
  });
  return grid.map((row) => row.map((x) => (x === undefined ? '' : x)));
}

/* ----------------------------- wiki 抓取 ----------------------------- */

async function fetchRendered(wiki, page) {
  const url = `${wiki}/api.php?action=parse&page=${encodeURIComponent(page)}`
    + '&prop=text&format=json&formatversion=2&disablelimitreport=1';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.parse || !json.parse.text) throw new Error(`${page}: 返回结构异常`);
  return json.parse.text;
}

/* ----------------------------- 解析 ----------------------------- */

/** 去掉 wiki 在名称后挂的能力角标（S = 需要方块数据、B = 需要损害值、D = 耐久）。 */
function cleanName(s) {
  return String(s).split(/\s+/).filter((t) => !/^[SBD]$/.test(t)).join(' ').trim();
}

/**
 * 数字 ID 表解析。两个 wiki 的表头用词不同：
 *   zh：`图标 | Dec | Hex | 命名空间ID | 方块`（大表被切成若干个 17 行的块，每块自带表头）
 *   en：`Icon | Dec | Hex | Identifier  | Block`
 * 所以表头匹配必须同时接受「命名空间ID」和「Identifier」。
 */
function parseIdTable(html, kind) {
  const out = [];
  const headers = [];
  for (const t of extractTables(html)) {
    const m = parseTable(t.html);
    if (!m.length) continue;
    const head = m[0];
    const idCol = head.findIndex((c) => c === '命名空间ID' || c === 'Identifier');
    if (!head.includes('Dec') || idCol < 0) continue;
    headers.push(head.join('|'));
    for (const row of m.slice(1)) {
      const num = parseInt(row[1], 10);
      const id = (row[idCol] || '').replace(/^minecraft:/, '').trim();
      const name = (row[idCol + 1] || '').trim();
      if (!Number.isFinite(num) || !id || !/^[a-z0-9_]+$/.test(id)) continue;
      out.push({ num, id, name: cleanName(name), kind });
    }
  }
  return { rows: out, headers };
}

/** 「扁平化」对照表 → 按旧 ID 分组的映射组。zh / en 两个版本列结构相同（5 列）。 */
function parseFlattenGroups(html) {
  let m = null;
  for (const t of extractTables(html)) {
    const cand = parseTable(t.html);
    // zh 表头「方块和物品ID」段：Java版1.12.2 / Java版1.13；en 表头：Before/Since … 1.13
    if (cand.length > 100 && cand[0].some((c) => /1\.13/.test(c))) { m = cand; break; }
  }
  if (!m) throw new Error('未找到扁平化对照表');
  const groups = [];
  let rows = 0;
  for (const row of m) {
    const [chg, oldName, oldCode, newName, newCode] = row;
    if (!/^(拆分|重命名|重新分类|合并|Separate|Renamed|Recategorized|Merged|Merge)$/.test(chg)) continue;
    if (!oldCode || !newCode) continue;
    rows++;
    const last = groups[groups.length - 1];
    const isSplit = chg === '拆分' || chg === 'Separate';
    // 「合并」是多个旧 ID → 一个旧 ID，不能按旧码归组；「拆分」按连续同旧码的行归组
    if (isSplit && last && last.oldCode === oldCode) {
      last.children.push({ name: newName, id: newCode });
      continue;
    }
    groups.push({ chg, oldName: cleanName(oldName), oldCode, children: [{ name: newName, id: newCode }] });
  }
  return { groups, rows };
}

/**
 * 数据值表 → 每张表一个 { dv, desc } 列表，用于给「拆分」家族定数据值。
 * 列位置不固定：zh 普通表表头是「空 | DV | 描述」，en 是「空 | DV | Description」，
 * 而「羊毛、陶瓦、染色玻璃和地毯」那张表表头是「空 | Dec/Data value | Hex | 描述 | 颜色代码…」，
 * 所以必须按表头名定位列，不能写死下标。中英表头都要认。
 */
function parseDataValueTables(html) {
  const tables = [];
  const pairs = [];
  for (const t of extractTables(html)) {
    const m = parseTable(t.html);
    if (!m.length) continue;
    let headRow = -1;
    let dvCol = -1;
    let descCol = -1;
    for (let r = 0; r < Math.min(4, m.length); r++) {
      const dv = m[r].findIndex((c) => c === 'Dec' || c === 'DV' || c === '数据值' || c === 'Data value');
      const de = m[r].findIndex((c) => c === '描述' || c === 'Description');
      if (dv >= 0 && de >= 0) { headRow = r; dvCol = dv; descCol = de; break; }
    }
    if (headRow < 0) continue;
    const rows = [];
    for (const row of m.slice(headRow + 1)) {
      const dv = parseInt(row[dvCol], 10);
      const desc = cleanName(row[descCol] || '');
      if (!Number.isFinite(dv) || !desc) continue;
      rows.push({ dv, desc });
      pairs.push({ dv, desc });
    }
    if (rows.length) tables.push({ rows, dvs: new Set(rows.map((r) => r.dv)) });
  }
  return { pairs, tables };
}

/**
 * 用 DV 表给「拆分」家族的每个子项定数据值 —— 按【名字】查，绝不按【下标】查。
 *
 * 为什么不按下标：扁平化表和 DV 表的排列顺序并不一致，实测 351（染料）在扁平化表里
 * 是从 15=骨粉 倒着排到 0=墨囊 的，按下标会整体错位 15。按名字查则 16 项全中。
 *
 * 一张 DV 表要能被采用，必须同时满足：
 *   1. 行数 === 家族子项数（挡掉 log(8 子项/16 数据值)、树叶(4/16)、大型植物(6/7)、
 *      铁砧、火把、石英块这类「数据值不是纯变体枚举」的家族）；
 *   2. 该表数据值集合恰为 {0..n-1}；
 *   3. 子项名在表里命中的位置互不重复（双射），避免一张表被两个子项共用。
 * 采用后，只有「名字精确命中」的子项才拿到 data；名字没命中的就是没取证，不猜。
 */
function assignDataValues(children, dvTables) {
  const n = children.length;
  const names = children.map((c) => cleanName(c.name));
  let best = null;
  let bestAnyMatched = 0;
  let sawRowMatch = false;
  let sawDvSet = false;
  for (const t of dvTables) {
    if (t.rows.length !== n) continue;
    sawRowMatch = true;
    if (t.dvs.size !== n || [...t.dvs].some((d) => d < 0 || d >= n)) continue;
    sawDvSet = true;
    const byDesc = new Map(t.rows.map((r) => [r.desc, r.dv]));
    const assigned = names.map((nm) => (byDesc.has(nm) ? byDesc.get(nm) : null));
    const vals = assigned.filter((a) => a !== null);
    if (!vals.length) continue;
    if (new Set(vals).size !== vals.length) continue; // 双射校验
    if (vals.length > bestAnyMatched) bestAnyMatched = vals.length;
    if (!best || vals.length > best.matched) best = { matched: vals.length, assigned, tableRows: n };
  }
  const assigned = names.map((_, i) => (best && best.assigned[i] !== null ? best.assigned[i] : undefined));
  const matched = best ? best.matched : 0;
  let reason = '';
  if (matched < n) {
    if (!sawRowMatch) reason = `无行数为 ${n} 的 DV 表`;
    else if (!sawDvSet) reason = `行数为 ${n} 的 DV 表数据值集合不是 0..${n - 1}`;
    else if (matched === 0) reason = 'DV 表里没有任何子项名精确命中（译名不同，不猜）';
    else reason = `仅 ${matched}/${n} 个子项名在 DV 表中精确命中`;
  }
  return { assigned, matched, n, full: matched === n, reason };
}

/* ----------------------------- 组装 ----------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const outArg = (args.find((a) => a.startsWith('--out=')) || '').slice(6);
  const print = args.includes('--print');

  const [zhBlocksH, zhItemsH, enBlocksH, enItemsH, hPre, hFlat, enPreH, enFlatH] = await Promise.all([
    fetchRendered(WIKI, PAGE_ZH_BLOCKS), fetchRendered(WIKI, PAGE_ZH_ITEMS),
    fetchRendered(WIKI_EN, PAGE_EN_BLOCKS), fetchRendered(WIKI_EN, PAGE_EN_ITEMS),
    fetchRendered(WIKI, PAGE_PREFLAT), fetchRendered(WIKI, PAGE_FLATTEN),
    fetchRendered(WIKI_EN, PAGE_EN_PREFLAT), fetchRendered(WIKI_EN, PAGE_EN_FLATTEN),
  ]);
  return build({
    zhBlocksH, zhItemsH, enBlocksH, enItemsH, hPre, hFlat, enPreH, enFlatH,
    OUT: print ? null : path.resolve(ROOT, outArg || 'src/data/legacy-ids.js'),
    dumpGroups: args.filter((a) => a.startsWith('--dump-group=')).map((a) => a.slice(13)),
  });
}

function build(src) {
  const { zhBlocksH, zhItemsH, enBlocksH, enItemsH, hPre, hFlat, enPreH, enFlatH, OUT, dumpGroups = [] } = src;

  const zhBlocks = parseIdTable(zhBlocksH, 'block');
  const zhItems = parseIdTable(zhItemsH, 'item');
  const enBlocks = parseIdTable(enBlocksH, 'block');
  const enItems = parseIdTable(enItemsH, 'item');
  const flat = parseFlattenGroups(hFlat);
  const dvParsed = parseDataValueTables(hPre);
  // 第二条取证通道：en 的 DV 表 + en 的扁平化表，两边都是英文，子项名能精确对上
  const enFlat = parseFlattenGroups(enFlatH);
  const enDv = parseDataValueTables(enPreH);

  log(`zh 方块表 ${zhBlocks.rows.length} 条 / zh 物品表 ${zhItems.rows.length} 条`);
  log(`en 方块表 ${enBlocks.rows.length} 条 / en 物品表 ${enItems.rows.length} 条（旧标识符身份来源）`);
  log(`扁平化对照 zh ${flat.groups.length} 组 / ${flat.rows} 行 · en ${enFlat.groups.length} 组 / ${enFlat.rows} 行`);
  log(`数据值表 zh ${dvParsed.tables.length} 张 / ${dvParsed.pairs.length} 对 · en ${enDv.tables.length} 张 / ${enDv.pairs.length} 对`);

  /**
   * 通道 B：用 en 的 DV 表给 en 的扁平化子项定数据值，得到 new_id → 数据值。
   * 之所以可行：两张表都是英文、同一 wiki，子项名能精确对上；得到的结果与语言无关，
   * 可以直接贴到中文条目上（中文条目记的正是同一个 new_id）。
   */
  const dataByNewId = new Map();
  let enChannelFamilies = 0;
  for (const g of enFlat.groups) {
    if (g.children.length < 2) continue;
    const v = assignDataValues(g.children, enDv.tables);
    if (!v.matched) continue;
    enChannelFamilies++;
    g.children.forEach((c, i) => {
      const dv = v.assigned[i];
      if (dv !== undefined && !dataByNewId.has(c.id)) dataByNewId.set(c.id, dv);
    });
  }
  log(`通道 B（en DV 表 ↔ en 扁平化表）：${enChannelFamilies} 个家族给出 ${dataByNewId.size} 个 new_id → 数据值`);

  if (dumpGroups.length) {
    for (const code of dumpGroups) {
      const g = flat.groups.find((x) => x.oldCode === code);
      log(`--dump-group ${code}: ${g ? `${g.chg} / ${g.children.length} 子项 ` + JSON.stringify(g.children.map((c) => c.name)) : '未找到'}`);
    }
    for (const t of dvParsed.tables) {
      log(`  DV表(${t.rows.length}): ${t.rows.map((r) => r.dv + '=' + r.desc).join(' | ')}`);
    }
  }

  // 中文名索引（按数字 ID）—— zh 表虽然旧标识符被现代化了，但「数字 ID → 中文名」是可靠的
  const zhNameByNum = new Map();
  for (const r of zhBlocks.rows) if (r.name && !zhNameByNum.has(r.num)) zhNameByNum.set(r.num, r.name);
  for (const r of zhItems.rows) if (r.name && !zhNameByNum.has(r.num)) zhNameByNum.set(r.num, r.name);

  /**
   * 身份表：以 en 表的「数字 ID ↔ 真正的 1.12.2 旧标识符」为准，
   * 中文名从 zh 表按数字 ID 取（缺则退回 en 的英文名并标记 nameEn）。
   * zh 表里多出来、en 表没有的数字 ID 也收下（用 zh 的标识符兜底）。
   */
  const merged = [];
  const enNums = new Set();
  const addMerged = (r, kind) => {
    const zh = zhNameByNum.get(r.num) || '';
    merged.push({ num: r.num, legacyId: r.id, kind, name: zh || r.name, nameEn: !zh });
    enNums.add(r.num);
  };
  for (const r of enBlocks.rows) addMerged(r, 'block');
  for (const r of enItems.rows) addMerged(r, 'item');
  const zhOnly = [];
  for (const [rows, kind] of [[zhBlocks.rows, 'block'], [zhItems.rows, 'item']]) {
    for (const r of rows) {
      if (enNums.has(r.num)) continue;
      zhOnly.push({ num: r.num, legacyId: r.id, kind, name: r.name, nameEn: false });
      merged.push(zhOnly[zhOnly.length - 1]);
    }
  }

  // 旧标识符 → { num, name, kind }
  const byOld = new Map();
  for (const m of merged) if (!byOld.has(m.legacyId)) byOld.set(m.legacyId, m);

  const entries = [];
  const splitFamilies = [];
  const unverifiedFamilies = [];
  const unresolvedGroups = [];
  const usedOld = new Set();

  /**
   * 别名分两轮，因为「旧名」和「新名」会撞车：
   *   数字 ID 78 在 1.13 后的名字是 `snow`，而 80 在 1.13 之前的旧名也是 `snow`。
   * 旧名优先（本表的主用途就是「1.13 之前怎么打这条命令」）：
   *   旧名 → 裸 num（旧名指的是整个数字 ID 家族，命令就是 `1`、`35`、`80`）
   *   新名 → 精确到 `num:data`（新名指的是具体变体，命令必须带数据值）
   */
  const oldAlias = {};
  const newAlias = {};
  const putOld = (k, v) => { if (k && oldAlias[k] === undefined) oldAlias[k] = v; };
  const putNew = (k, v) => { if (k && newAlias[k] === undefined) newAlias[k] = v; };
  for (const m of merged) putOld(m.legacyId, String(m.num));

  for (const g of flat.groups) {
    const base = byOld.get(g.oldCode);
    if (!base) { unresolvedGroups.push(g.oldCode); continue; }
    usedOld.add(g.oldCode);
    const num = base.num;

    if (g.children.length > 1) {
      const v = assignDataValues(g.children, dvParsed.tables);
      splitFamilies.push({ old: g.oldCode, num, n: g.children.length, matched: v.matched, full: v.full });
      if (!v.full) unverifiedFamilies.push({ old: g.oldCode, num, n: g.children.length, matched: v.matched, reason: v.reason });
      g.children.forEach((c, i) => {
        let dv = v.assigned[i];
        let dvSource = dv === undefined ? null : 'zh';
        // 通道 A（zh DV 表）没查到就试通道 B（en DV 表 ↔ en 扁平化表，按 new_id 关联）
        if (dv === undefined) {
          const en = dataByNewId.get(c.id);
          if (en !== undefined) { dv = en; dvSource = 'en'; }
        }
        entries.push({
          num,
          data: dv,
          id: c.id,
          name: cleanName(c.name),
          legacy: g.oldCode,
          kind: base.kind,
          ...(dvSource
            ? { dvSource }
            // 「拆分」家族里没取到数据值的子项：只给裸 num 会打错命令（6 是橡树树苗，
            // 云杉树苗得写 6:1）。所以显式标记，让 UI 提示用户补数据值，而不是替他编一个。
            : { dataUnknown: true }),
        });
        putNew(c.id, dv === undefined ? String(num) : `${num}:${dv}`);
      });
      putOld(g.oldCode, String(num));
    } else {
      const c = g.children[0];
      const nm = cleanName(c.name);
      entries.push({
        num, id: c.id, name: nm || base.name, legacy: g.oldCode, kind: base.kind,
        // nameEn 只在「最终用的就是英文名」时才打：扁平化表给的是中文名，不能因为
        // merged 里那条缺中文名就连带标成英文
        ...(nm ? {} : base.nameEn ? { nameEn: true } : {}),
      });
      putNew(c.id, String(num));
      putOld(g.oldCode, String(num));
    }
  }

  // 未出现在扁平化对照表里的数字 ID：1.13 未改动，旧标识符即新标识符
  for (const m of merged) {
    if (usedOld.has(m.legacyId)) continue;
    usedOld.add(m.legacyId);
    entries.push({
      num: m.num, id: m.legacyId, name: m.name, kind: m.kind,
      ...(m.nameEn ? { nameEn: true } : {}),
    });
    putNew(m.legacyId, String(m.num));
    putOld(m.legacyId, String(m.num));
  }

  // 合并别名：旧名优先（撞车时按「1.13 之前」语义解释）
  const aliases = { ...newAlias, ...oldAlias };

  entries.sort((a, b) => a.num - b.num || ((a.data ?? -1) - (b.data ?? -1)) || String(a.id).localeCompare(String(b.id)));

  const nums = new Set(entries.map((e) => e.num));
  const dataEntries = entries.filter((e) => e.data !== undefined);
  log(`LEGACY_IDS ${entries.length} 条 · 覆盖数字 ID ${nums.size} 个 · 带数据值 ${dataEntries.length} 条`);
  log(`拆分家族 ${splitFamilies.length} 个，其中数据值全部取证的 ${splitFamilies.filter((f) => f.full).length} 个`);
  log(`带数据值条目合计 ${dataEntries.length} 条`);
  const partial = splitFamilies.filter((f) => !f.full && f.matched > 0);
  const none = splitFamilies.filter((f) => f.matched === 0);
  log(`  全部子项取证 ${splitFamilies.filter((f) => f.full).length} · 部分取证 ${partial.length} · 完全未取证 ${none.length}`);
  if (unverifiedFamilies.length) {
    log(`⚠ 数据值未完全取证的「拆分」家族 ${unverifiedFamilies.length} 个（没取到的子项不带 data，不编造）：`);
    for (const u of unverifiedFamilies) log(`    ${u.old} (num ${u.num}, ${u.n} 子项, 命中 ${u.matched}) — ${u.reason}`);
  }
  if (unresolvedGroups.length) log(`⚠ 扁平化表中无对应数字 ID 的旧 ID（跳过，不猜）：${unresolvedGroups.join(', ')}`);
  const nameEnEntries = entries.filter((e) => e.nameEn);
  log(`ℹ 只有英文名的条目 ${nameEnEntries.length} 个（zh 表未收录这些数字 ID）：`
    + nameEnEntries.map((e) => `${e.num}=${e.name}`).join(', '));
  const dataUnknown = entries.filter((e) => e.dataUnknown);
  log(`ℹ 数据值未取证、已标 dataUnknown 的条目 ${dataUnknown.length} 个（UI 会要求用户补数据值）`);

  for (const probe of [[1, 0], [35, 14], [5, 0], [3, 0], [276], [159, 15], [351, 1], [383]]) {
    const found = entries.filter((e) => e.num === probe[0] && (probe[1] === undefined || e.data === probe[1]));
    log(`  抽查 ${probe.join(':')} → ${JSON.stringify(found).slice(0, 260)}`);
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    generator: 'tools/fetch-legacy-ids.mjs',
    sources: [
      `${WIKI_EN}/w/${encodeURIComponent(PAGE_EN_BLOCKS)}`,
      `${WIKI_EN}/w/${encodeURIComponent(PAGE_EN_ITEMS)}`,
      `${WIKI}/w/${encodeURIComponent(PAGE_ZH_BLOCKS)}`,
      `${WIKI}/w/${encodeURIComponent(PAGE_ZH_ITEMS)}`,
      `${WIKI}/w/${encodeURIComponent(PAGE_FLATTEN)}`,
      `${WIKI}/w/${encodeURIComponent(PAGE_PREFLAT)}`,
      `${WIKI_EN}/w/${encodeURIComponent(PAGE_EN_FLATTEN)}`,
      `${WIKI_EN}/w/${encodeURIComponent(PAGE_EN_PREFLAT)}`,
    ],
    counts: {
      entries: entries.length,
      numericIds: nums.size,
      withData: dataEntries.length,
      withDataZh: dataEntries.filter((e) => e.dvSource === 'zh').length,
      withDataEn: dataEntries.filter((e) => e.dvSource === 'en').length,
      dataUnknown: entries.filter((e) => e.dataUnknown).length,
      splitFamilies: splitFamilies.length,
      splitFamiliesFullyVerified: splitFamilies.filter((f) => f.full).length,
      splitFamiliesPartial: partial.length,
      aliases: Object.keys(aliases).length,
      nameEnOnly: entries.filter((e) => e.nameEn).length,
      zhOnlyNumericIds: zhOnly.length,
      enChannelFamilies,
    },
    unverifiedDataFamilies: unverifiedFamilies,
    unresolvedFlattenOldIds: unresolvedGroups,
    numericIdGaps: {
      blocks: gapList(merged.filter((m) => m.kind === 'block').map((m) => m.num), 0, 255),
      items: gapList(merged.filter((m) => m.kind === 'item').map((m) => m.num), 256, 2267),
      note: '公开 wiki 表里没有出现的数字 ID 区间（历史上就未定义或已被移除），未做补齐。',
    },
  };

  const outSrc = render({ entries, aliases, meta });
  if (!OUT) { log('（--print 模式：不写文件）'); return meta; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, outSrc);
  log(`已写出 ${path.relative(ROOT, OUT)}（${outSrc.length} 字节）`);
  return meta;
}

function log(s) { console.log(s); }

/** 把缺失的数字 ID 压成区间字符串（避免把上千个空号写进数据文件） */
function gapList(nums, lo, hi) {
  const have = new Set(nums);
  const ranges = [];
  let start = null;
  for (let i = lo; i <= hi; i++) {
    if (have.has(i)) { if (start !== null) { ranges.push([start, i - 1]); start = null; } continue; }
    if (start === null) start = i;
  }
  if (start !== null) ranges.push([start, hi]);
  return ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`));
}

function render({ entries, aliases, meta }) {
  const L = [];
  L.push('// src/data/legacy-ids.js —— Java 版 1.13「扁平化」之前的「数字 ID + 数据值」对照表');
  L.push('//');
  L.push('// 【本文件由 tools/fetch-legacy-ids.mjs 自动生成，请勿手改】');
  L.push('// 重新生成： node tools/fetch-legacy-ids.mjs');
  L.push('//');
  L.push('// 为什么需要它：1.13 之前方块/物品用「数字 ID + 数据值(metadata)」标识');
  L.push('// （石头 = 1、红色羊毛 = 35:14、钻石剑 = 276），1.13 起才改为命名空间字符串 ID。');
  L.push('// 数字 ID 是历史事实，不能凭记忆写；每一条都由生成脚本从 wiki 实抓。');
  L.push('//');
  L.push('// 数据来源页面（通过 api.php?action=parse 抓「渲染后的表格」，');
  L.push('// 因此 rowspan/colspan 已展开，不依赖 {{Data table}} 模板里的隐式计数器）：');
  for (const s of meta.sources) L.push(`//   · ${s}`);
  L.push('// 前两条是身份来源（数字 ID ↔ 真正的 1.12.2 旧标识符），第三条给中文名；');
  L.push('// 为什么身份以 en 表为准：zh 表把旧标识符写成了 1.13 之后的现代名');
  L.push('// （数字 ID 80 写成 snow_block，而 1.12.2 当年叫 snow），en 表保留旧名。');
  L.push('//');
  L.push('// 取证方式与校验：');
  L.push('//   1. 数字 ID + 旧命名空间 ID + 中文名 ← 「Java版数据值/扁平化前/方块ID」「…/物品ID」的 Dec / 命名空间ID / 名称列；');
  L.push('//   2. 1.13 新 ID（含「拆分」家族的成员与顺序）← 「Java版1.13/扁平化」对照表；');
  L.push('//   3. 数据值：在「拆分」家族里按【名字】到 DV 表精确查 —— 不按下标。实测 351（染料）');
  L.push('//      在扁平化表里是从 15=骨粉 倒排到 0=墨囊 的，按下标会整体错位 15。采用一张 DV 表需');
  L.push('//      同时满足：行数 === 子项数、数据值集合恰为 0..n-1、子项名命中位置互不重复（双射）。');
  L.push('//      名字没精确命中的子项就是没取证，不带 data（标记 dataUnknown）。两条通道：');
  L.push('//        zh：中文 DV 表 ↔ 中文扁平化子项名        → dvSource: "zh"');
  L.push('//        en：英文 DV 表 ↔ 英文扁平化子项名，按 new_id 关联回中文条目 → dvSource: "en"');
  L.push('//');
  L.push(`// 生成时间：${meta.generatedAt}`);
  L.push(`// 规模：${meta.counts.entries} 条 / 数字 ID ${meta.counts.numericIds} 个 / 带数据值 ${meta.counts.withData} 条（zh 通道 ${meta.counts.withDataZh} · en 通道 ${meta.counts.withDataEn}）/ 别名 ${meta.counts.aliases} 条`);
  L.push(`//      数据值未取证、标记 dataUnknown 的 ${meta.counts.dataUnknown} 条；只有英文名的 ${meta.counts.nameEnOnly} 条`);
  L.push(`//      数字 ID 缺口见 LEGACY_META.numericIdGaps（未做补齐）`);
  L.push(`// 拆分家族 ${meta.counts.splitFamilies} 个：${meta.counts.splitFamiliesFullyVerified} 个全部子项的数据值已取证、${meta.counts.splitFamiliesPartial} 个部分取证；`);
  L.push(`// 未取到的子项一律不带 data（见 LEGACY_META.unverifiedDataFamilies，原因逐条记录）。`);
  L.push('//');
  L.push('// 字段：');
  L.push('//   num    数字 ID（必填）');
  L.push('//   data   数据值；仅「拆分」家族且该子项名在 wiki DV 表中精确命中时存在');
  L.push('//   id     对应 1.13+ 的命名空间 ID（不含 minecraft: 前缀）');
  L.push('//   name   中文名；极少数条目 zh 表缺失，退回 en 表英文名并带 nameEn: true');
  L.push('//   legacy 1.12.2 时期的旧命名空间 ID（旧英文名，如 grass / snow / log2）；与 id 相同则省略');
  L.push('//   kind   block / item');
  L.push('//   dvSource  "zh" / "en"：这条的 data 是从哪条通道按名字精确查到的（不是按下标猜的）');
  L.push('//             zh = 中文 DV 表 ↔ 中文扁平化子项名；en = 英文 DV 表 ↔ 英文扁平化子项名');
  L.push('//   dataUnknown true 表示这条属于「拆分」家族但数据值没取证 —— UI 必须让用户补数据值，');
  L.push('//               不能拿裸 num 去打命令（6 是橡树树苗，云杉树苗得写 6:1）');
  L.push('//   nameEn  true 表示 name 只有英文（zh 表没收录这个数字 ID）');
  L.push('');
  L.push("import { searchEntries } from '../core/fuzzy.js';");
  L.push('');
  L.push('/** 数字 ID 对照表：{num, data?, dvSource?, dataUnknown?, id, name, legacy?, kind, nameEn?} */');
  L.push('export const LEGACY_IDS = [');
  for (const e of entries) L.push(`  ${entryLine(e)},`);
  L.push('];');
  L.push('');
  renderAliases(L, aliases);
  L.push(`/** 生成元信息：来源页面、规模、未取证家族与跳过项（供 UI 如实提示，不粉饰） */`);
  L.push(`export const LEGACY_META = ${JSON.stringify(meta, null, 2)};`);
  L.push('');
  renderHelpers(L);
  return L.join('\n');
}

function entryLine(e) {
  const parts = [`num: ${e.num}`];
  if (e.data !== undefined) parts.push(`data: ${e.data}`);
  parts.push(`id: ${JSON.stringify(e.id)}`);
  parts.push(`name: ${JSON.stringify(e.name)}`);
  if (e.legacy && e.legacy !== e.id) parts.push(`legacy: ${JSON.stringify(e.legacy)}`);
  parts.push(`kind: ${JSON.stringify(e.kind)}`);
  if (e.dvSource) parts.push(`dvSource: ${JSON.stringify(e.dvSource)}`);
  if (e.dataUnknown) parts.push('dataUnknown: true');
  if (e.nameEn) parts.push('nameEn: true');
  return `{ ${parts.join(', ')} }`;
}

function renderAliases(L, aliases) {
  L.push('/** 英文名 → 数字 ID。键含「1.12.2 旧名」与「1.13 新名」两种：');
  L.push(' *  grass → "2"（草方块当年叫 grass）、grass_block → "2"、red_wool → "35:14"。');
  L.push(' * 值形如 "35" 或 "35:14"，可直接喂给 byLegacyId。重名冲突保留先写入的（旧名优先）。 */');
  L.push('export const LEGACY_NAME_ALIASES = {');
  const keys = Object.keys(aliases).sort();
  let buf = [];
  for (const k of keys) {
    buf.push(`${JSON.stringify(k)}: ${JSON.stringify(aliases[k])}`);
    if (buf.length === 8) { L.push('  ' + buf.join(', ') + ','); buf = []; }
  }
  if (buf.length) L.push('  ' + buf.join(', ') + ',');
  L.push('};');
  L.push('');
}

function renderHelpers(L) {
  L.push('/* ------------------------------ 索引与查询 ------------------------------ */');
  L.push('');
  L.push('let _byNum = null;');
  L.push('function indexByNum() {');
  L.push('  if (_byNum) return _byNum;');
  L.push('  _byNum = new Map();');
  L.push('  for (const e of LEGACY_IDS) {');
  L.push('    if (!_byNum.has(e.num)) _byNum.set(e.num, []);');
  L.push('    _byNum.get(e.num).push(e);');
  L.push('  }');
  L.push('  return _byNum;');
  L.push('}');
  L.push('');
  L.push('/**');
  L.push(' * 按数字 ID（可选数据值）取条目。');
  L.push(' *   byLegacyId(35)     → 羊毛的全部 16 个数据值条目');
  L.push(' *   byLegacyId(35, 14) → 只要 35:14（红色羊毛）');
  L.push(' * 找不到返回 []（不猜）。');
  L.push(' */');
  L.push('export function byLegacyId(num, data = null) {');
  L.push('  const n = typeof num === \'string\' ? parseInt(num, 10) : num;');
  L.push('  if (!Number.isFinite(n)) return [];');
  L.push('  const list = indexByNum().get(n) || [];');
  L.push('  if (data == null || data === \'\') return list;');
  L.push('  const d = typeof data === \'string\' ? parseInt(data, 10) : data;');
  L.push('  if (!Number.isFinite(d)) return list;');
  L.push('  return list.filter((e) => e.data === d);');
  L.push('}');
  L.push('');
  L.push('/** 把查询里的「数字 [:数据值]」拆出来；不是数字则返回 null。 */');
  L.push('export function parseLegacyIdText(s) {');
  L.push('  const m = /^\\s*(\\d{1,4})(?:\\s*[:：]\\s*(\\d{1,3}))?\\s*$/.exec(String(s == null ? \'\' : s));');
  L.push('  if (!m) return null;');
  L.push('  return { num: parseInt(m[1], 10), data: m[2] === undefined ? null : parseInt(m[2], 10) };');
  L.push('}');
  L.push('');
  L.push('/** 渲染成命令里用的旧语法 ID 文本：有数据值写 `35:14`，否则写 `35`。 */');
  L.push('export function legacyIdText(e) {');
  L.push('  if (!e) return \'\';');
  L.push('  return e.data === undefined || e.data === null ? String(e.num) : `${e.num}:${e.data}`;');
  L.push('}');
  L.push('');
  L.push('/** 该数字 ID 是否存在数据值家族（决定命令里写 num 还是 num:data） */');
  L.push('export function numHasData(num) {');
  L.push('  return byLegacyId(num).some((e) => e.data !== undefined);');
  L.push('}');
  L.push('');
  L.push('/**');
  L.push(' * 搜索数字 ID 表。支持：');
  L.push(' *   · 纯数字       35      → 该数字 ID 的全部条目');
  L.push(' *   · 数字:数据值  35:14   → 精确到数据值');
  L.push(' *   · 中文名       羊毛 / 红色羊毛');
  L.push(' *   · 旧/新英文名  grass / grass_block / red_wool（走 LEGACY_NAME_ALIASES）');
  L.push(' * 名称搜索复用 core/fuzzy.js 的打分器（与全站搜索一致）；数字查询走精确匹配 + 前缀扩展。');
  L.push(' */');
  L.push('export function searchLegacy(q, { limit = 60 } = {}) {');
  L.push('  const raw = String(q == null ? \'\' : q).trim();');
  L.push('  if (!raw) return [];');
  L.push('  const keyOf = (e) => `${e.num}:${e.data ?? \'\'}`;');
  L.push('  const hit = parseLegacyIdText(raw);');
  L.push('  if (hit) {');
  L.push('    if (hit.data != null) return byLegacyId(hit.num, hit.data).slice(0, limit);');
  L.push('    const out = byLegacyId(hit.num).slice();');
  L.push('    const seen = new Set(out.map(keyOf));');
  L.push('    const prefix = String(hit.num);');
  L.push('    for (const e of LEGACY_IDS) {');
  L.push('      if (out.length >= limit) break;');
  L.push('      if (!String(e.num).startsWith(prefix)) continue;');
  L.push('      if (seen.has(keyOf(e))) continue;');
  L.push('      seen.add(keyOf(e)); out.push(e);');
  L.push('    }');
  L.push('    return out.slice(0, limit);');
  L.push('  }');
  L.push('  // 名称 / 别名：先按别名（旧英文名、新英文名）补，再交给 fuzzy 打分器');
  L.push('  const ordered = [];');
  L.push('  const pushed = new Set();');
  L.push('  const nq = raw.toLowerCase().replace(/^minecraft:/, \'\').trim();');
  L.push('  for (const [k, v] of Object.entries(LEGACY_NAME_ALIASES)) {');
  L.push('    if (k !== nq && !k.startsWith(nq)) continue;');
  L.push('    if (ordered.length >= limit) break;');
  L.push('    const [ns, ds] = String(v).split(\':\');');
  L.push('    for (const e of byLegacyId(parseInt(ns, 10), ds === undefined ? null : parseInt(ds, 10))) {');
  L.push('      const kk = keyOf(e);');
  L.push('      if (pushed.has(kk)) continue;');
  L.push('      pushed.add(kk); ordered.push(e);');
  L.push('    }');
  L.push('  }');
  L.push('  for (const e of searchEntries(LEGACY_IDS, raw, { limit })) {');
  L.push('    const kk = keyOf(e);');
  L.push('    if (pushed.has(kk)) continue;');
  L.push('    pushed.add(kk); ordered.push(e);');
  L.push('  }');
  L.push('  return ordered.slice(0, limit);');
  L.push('}');
  L.push('');
  L.push('/** 给 UI 用的一句话覆盖率说明（如实反映取证范围） */');
  L.push('export function legacyCoverageText() {');
  L.push('  const c = LEGACY_META.counts;');
  L.push('  return `${c.numericIds} 个数字 ID / ${c.entries} 条，其中 ${c.withData} 条带数据值`');
  L.push('    + `（${c.splitFamiliesFullyVerified}/${c.splitFamilies} 个「拆分」家族的数据值已全部取证，`');
  L.push('    + `${c.splitFamiliesPartial} 个只取证了一部分）`;');
  L.push('}');
  L.push('');
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((e) => {
    console.error('生成失败：', e.message);
    console.error('（数字 ID 必须来自 wiki 取证，抓不到就不要生成 —— 绝不退回手写数据）');
    process.exit(1);
  });
}

export {
  extractTables, parseTable, parseIdTable, parseFlattenGroups, parseDataValueTables,
  assignDataValues, cleanName, fetchRendered, stripTags,
  PAGE_ZH_BLOCKS, PAGE_ZH_ITEMS, PAGE_EN_BLOCKS, PAGE_EN_ITEMS,
  PAGE_PREFLAT, PAGE_FLATTEN, WIKI, WIKI_EN,
};
