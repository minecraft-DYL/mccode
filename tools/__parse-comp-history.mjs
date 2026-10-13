// 从 zh.minecraft.wiki「数据组件」section=130「历史」解析每个组件的引入版本。
// 输入：tools/__data-comp-history.txt（wiki-get.mjs raw "数据组件" 130 的原始输出）
// 输出：控制台 + tools/__component-since.json
//
// 只认「加入了 … 组件」这种明确表述。查不到就留 null，绝不推断。

import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_COMPONENTS } from '../src/data/components-wiki.js';

const raw = readFileSync(new URL('./__data-comp-history.txt', import.meta.url), 'utf8');

/* ---- 1. 把 {{HistoryLine|...}} 切成条目，抽出版本号与正文 ---- */
// 版本号规则：HistoryLine 的位置参数里，第一个非空的版本式参数是 release（如 1.20.5），
// dev= 是快照（如 24w09a）。后续只写 dev 的行沿用上一个 release（wiki 的表格就是靠 rowspan 表达的）。
//
// 必须做「顶层」参数切分：正文里嵌套着 {{convert|0.05|秒|游戏刻}} 之类的模板，
// 直接按 | 切会把 0.05 当成版本号（第一版实现就是这么错的，出来一堆 since:'0.05'）。
function splitTopLevel(s) {
  const out = [];
  let cur = '';
  let depth = 0;         // {{ }} 与 [[ ]] 的嵌套深度
  let inTag = false;     // <code> … </code>
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{' || two === '[[') depth++;
    else if (two === '}}' || two === ']]') depth = Math.max(0, depth - 1);
    else if (s[i] === '<') inTag = true;
    else if (s[i] === '>') inTag = false;
    if (s[i] === '|' && depth === 0 && !inTag) { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

const RE_VERSION = /^\d+\.\d+(\.\d+)?$/;
const RE_SNAPSHOT = /^\d{2}w\d{2}[a-z]$/;

const lines = [];
{
  const blocks = raw.split(/\n\|?\{\{HistoryLine/).slice(1);
  let curRelease = null;
  let curDev = null;
  for (const b of blocks) {
    const body = b.replace(/\}\}\s*$/, '');
    const parts = splitTopLevel(body);
    let release = null, dev = null, text = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i].trim();
      if (/^dev=/.test(p)) { dev = p.slice(4).trim(); continue; }
      if (RE_VERSION.test(p) || RE_SNAPSHOT.test(p)) { if (!release) release = p; continue; }
      text += (text ? '|' : '') + parts[i];
    }
    if (release) { curRelease = release; curDev = dev; }
    else if (dev) { curDev = dev; }                 // 只写 dev 的行：沿用 release，更新快照
    lines.push({ release: curRelease, dev: dev || curDev, text });
  }
}

/* ---- 2. 从正文里抽「加入了 X 组件」 ---- */
const additions = new Map();   // 组件id → { version, snapshot, evidence }

/** 把 {{cd|d=pretty|a|b|c}} / {{cd|a|b}} / <code>a</code> 里的组件名抽出来 */
function pickNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/\{\{cd\|([^{}]*)\}\}/g)) {
    const args = m[1].split('|').filter((x) => x && x !== 'd=pretty');
    for (const a of args) names.add(a.trim());
  }
  for (const m of text.matchAll(/<code>([^<]+)<\/code>/g)) names.add(m[1].trim());
  return [...names];
}

for (const ln of lines) {
  const text = ln.text;
  if (!text || !/组件/.test(text)) continue;
  for (const sentence of text.split(/(?<=。)/)) {
    if (!/加入/.test(sentence)) continue;
    for (const name of pickNames(sentence)) {
      // 组件 id：小写蛇形；实体变种组件还带一个斜杠（axolotl/variant、tropical_fish/base_color）
      if (!/^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*)?$/.test(name)) continue;
      if (!ALL_COMPONENTS.some((c) => c.id === name)) continue;   // 只收清单里真实存在的
      if (additions.has(name)) continue;                           // 取最早一次
      additions.set(name, {
        version: ln.release || null,
        snapshot: ln.dev || null,
        evidence: sentence.replace(/\{\{[^}]*\}\}/g, '…').slice(0, 200).trim(),
      });
    }
  }
}

/* ---- 3. 输出 ---- */
const ids = ALL_COMPONENTS.map((c) => c.id);
const out = {};
for (const id of ids) {
  const a = additions.get(id);
  out[id] = a ? { since: a.version, snapshot: a.snapshot, evidence: a.evidence } : { since: null };
}

const found = ids.filter((i) => out[i].since);
console.log(`组件总数 ${ids.length}；本次从「历史」节取证到 ${found.length} 条\n`);
for (const i of found.sort((a, b) => (out[a].since + '').localeCompare(out[b].since + ''))) {
  console.log(`  ${i.padEnd(28)} ${String(out[i].since).padEnd(8)} ${out[i].snapshot ? '(' + out[i].snapshot + ')' : ''}`);
}
const miss = ids.filter((i) => !out[i].since);
console.log(`\n历史节未覆盖的 ${miss.length} 条（需要去版本页 / 组件小节继续查，或确认它们就是 1.20.5 初始批次）：`);
console.log('  ' + miss.join(' '));

writeFileSync(new URL('./__component-since.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
console.log('\n已写出 tools/__component-since.json');
