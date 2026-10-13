// 把合并后的 since 表渲染成 components-wiki.js 里可直接粘贴的代码块。
import { readFileSync, writeFileSync } from 'node:fs';
const m = JSON.parse(readFileSync(new URL('./__component-since-merged.json', import.meta.url), 'utf8'));
const byVer = {};
for (const [id, v] of Object.entries(m)) { if (!v.since) continue; (byVer[v.since] ||= []).push(id); }
const order = Object.keys(byVer).sort((a, b) => {
  const p = (s) => s.split('.').map(Number);
  const x = p(a), y = p(b);
  return x[0] - y[0] || (x[1] || 0) - (y[1] || 0) || (x[2] || 0) - (y[2] || 0);
});
let out = '';
for (const v of order) {
  out += `  '${v}': [\n`;
  const ids = byVer[v].sort();
  for (let i = 0; i < ids.length; i += 3) {
    out += '    ' + ids.slice(i, i + 3).map((x) => `'${x}',`).join(' ') + '\n';
  }
  out += '  ],\n';
}
const nulls = Object.entries(m).filter(([, v]) => !v.since).map(([k]) => k).sort();
out += '\n  // 未取证（wiki 全站无「加入了 X」表述，见 tools/__since-manual.json 的 _unverified）\n';
for (const n of nulls) out += `  //   ${n}\n`;
writeFileSync(new URL('./__since-map-literal.txt', import.meta.url), out, 'utf8');
console.log('版本分层:', order.join(' | '));
console.log('已取证条目:', Object.values(byVer).reduce((a, b) => a + b.length, 0), ' 未取证:', nulls.length);
console.log('\n' + out);
