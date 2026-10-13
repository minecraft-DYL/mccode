// fetch-packformat.mjs —— 从 Mojang piston-meta 逐版本读取 pack_version，生成权威数据包版本表
// 数据源与编辑器运行时同源（launchermeta → piston-meta），不依赖记忆
const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

// 关心 1.13 起（数据包诞生）到当前，按版本号排序取样
const WANT = [
  '1.13', '1.13.1', '1.13.2', '1.14', '1.14.4', '1.15', '1.15.2', '1.16', '1.16.5',
  '1.17', '1.17.1', '1.18', '1.18.2', '1.19', '1.19.3', '1.19.4',
  '1.20', '1.20.1', '1.20.2', '1.20.3', '1.20.4', '1.20.5', '1.20.6',
  '1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8',
  '1.21.9', '1.21.10', '1.21.11', '26.1', '26.2', '26.3',
];

const res = await fetch(MANIFEST);
const man = await res.json();
const byId = new Map(man.versions.map((v) => [v.id, v]));

console.log('版本\t\tpack_version 原始值');
console.log('─'.repeat(72));
const table = [];
for (const id of WANT) {
  const v = byId.get(id);
  if (!v) { console.log(`${id}\t\t(清单中不存在)`); continue; }
  try {
    const d = await (await fetch(v.url)).json();
    const pv = d.pack_version;
    let shown = JSON.stringify(pv);
    if (pv && typeof pv === 'object') {
      if ('data' in pv) shown = `data=${pv.data} resource=${pv.resource}`;
      else shown = `data=${pv.data_major}.${pv.data_minor} resource=${pv.resource_major}.${pv.resource_minor}`;
    }
    console.log(`${id}\t\t${shown}`);
    const rec = { id };
    if (pv && typeof pv === 'object') {
      if ('data' in pv) { rec.data = pv.data; rec.v2 = false; }
      else { rec.dataMajor = pv.data_major; rec.dataMinor = pv.data_minor; rec.v2 = true; }
    }
    table.push(rec);
  } catch (e) {
    console.log(`${id}\t\tERR ${e.message}`);
  }
}
console.log('\n=== 结构化 ===');
console.log(JSON.stringify(table, null, 0));
