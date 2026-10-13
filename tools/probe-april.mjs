// probe-april.mjs —— 找出 manifest 里不符合标准命名规则的快照（愚人节 / 特殊版本）
import { VersionIndex, parseVersion } from '../src/core/versions.js';

const man = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
const idx = new VersionIndex(man);

const STD = [
  /^\d{2}w\d{2}[a-z]$/i,                       // 24w09a
  /^\d+(?:\.\d+)*-(snapshot|pre|rc|preview)[-_]?\d*$/i, // 26.3-snapshot-1
  /^\d+(?:\.\d+)*$/,                           // 1.20.5 / 26.3
];

console.log('=== 不符合标准命名的快照（疑似愚人节 / 特殊版本） ===');
for (const v of idx.versions) {
  if (v.type !== 'snapshot') continue;
  const id = v.id;
  if (STD.some((r) => r.test(id))) continue;
  console.log('  ' + id.padEnd(28) + v.releaseTime.slice(0, 10) + '  parse=' + JSON.stringify(parseVersion(id)).slice(0, 90));
}

console.log('\n=== 已知愚人节版本在 manifest 中的存在性 ===');
const KNOWN = ['15w14a', '1.RV-Pre1', '3D Shareware v1.34', '20w14∞', '20w14infinite',
  '22w13oneBlockAtATime', '23w13a_or_b', '24w14potato', '25w14craftmine',
  '2.0', '26w14a'];
for (const k of KNOWN) {
  const v = idx.versions.find((x) => x.id === k);
  console.log('  ' + k.padEnd(24) + (v ? '✅ ' + v.type + '  ' + v.releaseTime.slice(0, 10) : '— 不在 manifest'));
}

console.log('\n=== 每年 4 月（周 13-16）前后的快照 ===');
for (const v of idx.versions) {
  if (v.type !== 'snapshot') continue;
  const d = v.releaseTime.slice(5, 7);
  if (d !== '04') continue;
  console.log('  ' + v.id.padEnd(24) + v.releaseTime.slice(0, 10));
}
