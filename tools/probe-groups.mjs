// probe-groups.mjs —— 诊断版本归组与序数（临时探针，pinning 用户报障）
import { parseVersion, majorLabel, versionOrder, VersionIndex } from '../src/core/versions.js';

console.log('=== 1) 远古 / 特殊版本号解析 ===');
for (const id of ['rd-132211', 'rd-20090515', 'c0.30_01c', 'inf-20100618', 'a1.2.6', 'b1.7.3', '1.0', '26.1', '26.4-snapshot-3', '24w09a', '1.21.11']) {
  const p = parseVersion(id);
  console.log(
    id.padEnd(15),
    'major=' + String(majorLabel(id)).padEnd(10),
    'order=' + String(versionOrder(id)).padEnd(15),
    'kind=' + String(p.kind).padEnd(9),
    'nums=' + JSON.stringify(p.nums),
    p.week != null ? 'week=' + p.week : '',
  );
}

console.log('\n=== 2) manifest 归组实测 ===');
const man = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
const idx = new VersionIndex(man);
console.log('版本总数:', idx.versions.length);
console.log('最新 release:', man.latest.release, '| 最新 snapshot:', man.latest.snapshot);

const groups = idx.groupByMajor({ includeSnapshots: true });
console.log('分组数:', groups.length);
console.log('\n前 14 组:');
for (const g of groups.slice(0, 14)) {
  const kinds = {};
  for (const v of g.items) kinds[v.type] = (kinds[v.type] || 0) + 1;
  console.log(
    '  ' + String(g.label).padEnd(14),
    String(g.items.length).padStart(4) + ' 个  ',
    JSON.stringify(kinds),
    '  例: ' + g.items.slice(0, 3).map((v) => v.id).join(', '),
  );
}

console.log('\n=== 3) 26.x 各组分内容 ===');
for (const g of groups.filter((x) => /^26\./.test(String(x.label)))) {
  const kinds = {};
  for (const v of g.items) kinds[v.type] = (kinds[v.type] || 0) + 1;
  console.log('  ' + String(g.label).padEnd(10), String(g.items.length).padStart(4), JSON.stringify(kinds), ' → ', g.items.map((v) => v.id).slice(0, 8).join(', '));
}

console.log('\n=== 4) 单独立组的快照（majorLabel 没归到 release 上） ===');
const odd = groups.filter((g) => /w\d|pre|rc|snapshot/i.test(String(g.label)));
console.log('异常组数:', odd.length, ' 例:', odd.slice(0, 12).map((g) => g.label + '(' + g.items.length + ')').join(', '));

console.log('\n=== 5) manifest 里的远古版本（按清单顺序 = 时间顺序） ===');
const ancients = idx.versions.filter((v) => v.type === 'old_alpha' || v.type === 'old_beta');
console.log('远古版本数:', ancients.length);
for (const v of ancients) console.log('  ' + v.type.padEnd(10) + v.id);
