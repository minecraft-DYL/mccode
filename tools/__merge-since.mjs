// 合并三路取证，产出最终的「组件 → 引入版本」表。
//   ① 数据组件 section=130「历史」        → tools/__component-since.json
//   ② Java版24w09a section=2「新内容/常规」→ tools/__since-24w09a.json
//   ③ 手工核对/补查结果                    → tools/__since-manual.json（可选）
// 口径：取「最早」的一次明确记录；同名以更早的为准。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ALL_COMPONENTS } from '../src/data/components-wiki.js';

const load = (f) => (existsSync(new URL(f, import.meta.url)) ? JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')) : {});

const history = load('./__component-since.json');
const batch = load('./__since-24w09a.json');
const manualRaw = load('./__since-manual.json');
// __since-manual.json 里 _note / _unverified 是说明字段，不是组件条目
const manual = Object.fromEntries(Object.entries(manualRaw).filter(([k]) => !k.startsWith('_')));

/** 版本号比较：数字.数字[.数字] */
function vkey(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}
function earlier(a, b) {
  const ka = vkey(a), kb = vkey(b);
  if (!ka) return b;
  if (!kb) return a;
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i] ? a : b;
  }
  return a;
}

const merged = {};
const ids = ALL_COMPONENTS.map((c) => c.id);
for (const id of ids) {
  const cands = [history[id], batch[id], manual[id]].filter((x) => x && x.since);
  if (!cands.length) { merged[id] = { since: null }; continue; }
  let best = cands[0];
  for (const c of cands) {
    if (earlier(best.since, c.since) === c.since) best = c;
  }
  merged[id] = best;
}

const found = ids.filter((i) => merged[i].since);
const miss = ids.filter((i) => !merged[i].since);

console.log(`组件总数 ${ids.length}`);
console.log(`已取证 ${found.length}   未取证 ${miss.length}\n`);

// 按版本分层输出，便于人工复核
const byVer = {};
for (const i of found) (byVer[merged[i].since] ||= []).push(i);
for (const v of Object.keys(byVer).sort((a, b) => {
  const ka = vkey(a), kb = vkey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
})) {
  console.log(`【${v}】共 ${byVer[v].length} 条`);
  console.log('  ' + byVer[v].sort().join(' '));
}

console.log(`\n仍未取证 ${miss.length} 条：`);
console.log('  ' + miss.join(' '));

writeFileSync(new URL('./__component-since-merged.json', import.meta.url),
  JSON.stringify(merged, null, 2), 'utf8');
console.log('\n已写出 tools/__component-since-merged.json');
