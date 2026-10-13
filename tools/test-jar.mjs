// test-jar.mjs —— 用本机真实 jar 验证「命名空间感知」的 fromJar
// 目的：① 确认原版 jar 的注册表没被改坏；② 确认扫描到了所有命名空间；③ 确认没有把
//       textures/block/cactus_side 这类"非物品贴图"当成物品。
import { readFileSync, existsSync } from 'node:fs';
import { fromJar } from '../src/core/registry.js';

const CANDIDATES = [
  'D:/minecraft/.minecraft/versions/26.3/26.3.jar',
  'D:/minecraft/.minecraft/versions/1.21.1/1.21.1.jar',
  'D:/minecraft/.minecraft/versions/BBS/BBS.jar',
];
const path = CANDIDATES.find((p) => existsSync(p));
if (!path) { console.log('未找到本机 jar，跳过（候选：' + CANDIDATES.join(', ') + '）'); process.exit(0); }

const version = path.split('/').pop().replace(/\.jar$/, '');
console.log('测试 jar:', path);
const buf = readFileSync(path);
console.log('大小:', (buf.length / 1048576).toFixed(1), 'MB');

// 取官方 piston-meta 的 versionDetail（含 assetIndex），用于补中文语言表
let versionDetail = null;
try {
  const man = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
  const entry = man.versions.find((v) => v.id === version);
  if (entry) {
    versionDetail = await (await fetch(entry.url)).json();
    console.log('versionDetail: 已取到，assetIndex =', versionDetail.assetIndex && versionDetail.assetIndex.id);
  } else {
    console.log('versionDetail: manifest 中无此版本（mod jar 属正常），中文名将退回 en_us');
  }
} catch (e) {
  console.log('versionDetail 获取失败:', e.message);
}

const logs = [];
const reg = await fromJar({
  version, jar: buf, source: 'localjar', versionDetail,
  onStatus: (s) => { logs.push(s); if (!/提取注册表/.test(s)) console.log('  [status]', s); },
});

console.log('\n=== 结果 ===');
console.log('modLoader :', reg.modLoader);
console.log('命名空间数 :', reg.namespaces.length, '→', reg.namespaces.slice(0, 12).join(', '));
console.log('物品 :', reg.items.length);
console.log('实体 :', reg.entities.length);
console.log('粒子 :', reg.particles.length);

console.log('\n=== 物品抽样（前 8 个）===');
for (const it of reg.items.slice(0, 8)) console.log('  ', it.id.padEnd(34), it.name, '|', it.iconKind);

console.log('\n=== 检查：非物品贴图不得混入 ===');
const JUNK = ['cactus_side', 'oak_log_top', 'crafting_table_top', 'furnace_front', 'water_still'];
let junkHit = 0;
for (const j of JUNK) {
  const hit = reg.items.find((x) => x.id === j || x.id.endsWith(':' + j));
  if (hit) { junkHit++; console.log('  ❌ 混入:', hit.id); }
}
if (!junkHit) console.log('  ✅ 未混入任何非物品贴图');

console.log('\n=== 检查：常见物品必须在 ===');
for (const need of ['stone', 'diamond_sword', 'stick', 'redstone']) {
  const hit = reg.items.find((x) => x.id === need);
  console.log('  ' + (hit ? '✅' : '❌'), need, hit ? '→ ' + hit.name : '缺失');
}

console.log('\n=== 检查：命名空间保留 ===');
const nsSample = reg.items.filter((x) => x.id.includes(':')).slice(0, 5);
console.log(nsSample.length ? '  ' + nsSample.map((x) => x.id).join(', ') : '  （该 jar 只有 minecraft 命名空间，符合原版预期）');

console.log('\n=== 检查：中文名覆盖率 ===');
const named = reg.items.filter((x) => x.name && x.name !== x.id).length;
console.log(`  ${named} / ${reg.items.length}（${(named / reg.items.length * 100).toFixed(1)}%）`);

const unnamed = reg.items.filter((x) => x.name === x.id);
console.log('\n=== 仍无中文名的条目（前 60 个）===');
console.log('  ' + unnamed.slice(0, 60).map((x) => x.id).join(', '));
console.log('  总数:', unnamed.length);
const en = reg.items.filter((x) => /[A-Za-z]/.test(x.name) && !/[\u4e00-\u9fff]/.test(x.name));
console.log('\n=== 名字仍是纯英文的条目（前 40 个）===');
console.log('  ' + en.slice(0, 40).map((x) => x.id + '=' + x.name).join(', '));
console.log('  总数:', en.length);
