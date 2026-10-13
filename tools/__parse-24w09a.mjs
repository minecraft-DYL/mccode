// 从「Java版24w09a」section=2（新内容/常规）里抽出该快照「加入的」全部物品堆叠组件。
// 这是 1.20.5 组件化首批组件的权威出处：wiki 原文写着
//   「加入了以下物品堆叠组件（均省略命名空间 minecraft:）：」
// 后面跟一个 treeview，逐个列出 {{nbt|类型|组件名}}。
//
// 边界纪律：只在「加入了以下物品堆叠组件」到该列表结束之间取样，
// 且只保留 ALL_COMPONENTS 里真实存在的 id —— 不做任何推测补齐。

import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_COMPONENTS } from '../src/data/components-wiki.js';

const raw = readFileSync(new URL('./__24w09a-s2.txt', import.meta.url), 'utf8');

const ANCHOR = '加入了以下物品堆叠组件';
const start = raw.indexOf(ANCHOR);
if (start < 0) { console.error('❌ 没找到锚点，说明页面结构变了，不要继续'); process.exit(1); }

// 列表的结束：下一个不缩进的小节级内容（'''…''' 或 == 标题）。这里取下一个「'''」。
let end = raw.indexOf("'''", start + ANCHOR.length);
if (end < 0) end = raw.length;
const block = raw.slice(start, end);

console.log(`锚点位置 ${start}，区块长度 ${block.length} 字符\n`);
console.log('--- 区块前 300 字 ---');
console.log(block.slice(0, 300).replace(/\n/g, ' ⏎ '));
console.log('--- 区块后 200 字 ---');
console.log(block.slice(-200).replace(/\n/g, ' ⏎ '));
console.log();

// 抽 {{nbt|type|name}} 与 {{nbt|type|name|...}}
const names = new Set();
for (const m of block.matchAll(/\{\{nbt\|([^}|]*)\|([^}|]*)/g)) {
  const id = m[2].trim();
  if (!/^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*)?$/.test(id)) continue;
  names.add(id);
}
// 也抽 <code>xxx</code> 形式（部分条目可能不用 nbt 模板）
for (const m of block.matchAll(/<code>([a-z][a-z0-9_\/]*)<\/code>/g)) names.add(m[1]);

const all = [...names].sort();
const known = all.filter((n) => ALL_COMPONENTS.some((c) => c.id === n));
const unknown = all.filter((n) => !ALL_COMPONENTS.some((c) => c.id === n));

console.log(`24w09a 区块里抽到 ${all.length} 个标识符；其中在组件清单里的 ${known.length} 个：`);
console.log('  ' + known.join(' '));
console.log(`\n不在组件清单里的 ${unknown.length} 个（可能是普通标签名/字段名，忽略）：`);
console.log('  ' + unknown.join(' '));

writeFileSync(new URL('./__since-24w09a.json', import.meta.url),
  JSON.stringify(Object.fromEntries(known.map((k) => [k, {
    since: '1.20.5', snapshot: '24w09a',
    evidence: '加入了以下物品堆叠组件（均省略命名空间 minecraft:）：',
    source: 'Java版24w09a section=2（新内容/常规）',
  }])), null, 2), 'utf8');
console.log('\n已写出 tools/__since-24w09a.json');
