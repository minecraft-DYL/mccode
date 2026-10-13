// 节点图适配器自检：node tools/nbt-graph-check.mjs
import { parseSNBT, toSNBT } from '../src/core/nbt.js';
import { nbtToGraph, graphToNbt, portTypeOf, previewOf, typeLabelOf, labelOf } from '../src/graph/nbt-graph-adapter.js';

// 用单引号包 JS 字符串、模板串绕开 SNBT 里的双引号嵌套，避免转义地狱
const Q = String.fromCharCode(34);   // 双引号
const SAMPLES = [
  ['物品 NBT（旧）', "{CustomName:'{" + Q + "text" + Q + ":" + Q + "剑" + Q + "}',Enchantments:[{id:" + Q + "minecraft:sharpness" + Q + ",lvl:5s}],Unbreakable:1b,NoSuchKey:1}"],
  ['实体 NBT', "{id:" + Q + "minecraft:pig" + Q + ",Pos:[1.0d,64.0d,2.0d],Motion:[0.0d,0.0d,0.0d],Health:10.0f,CustomName:'{" + Q + "text" + Q + ":" + Q + "猪" + Q + "}'}"],
  ['方块实体', "{id:" + Q + "minecraft:chest" + Q + ",x:1,y:2,z:3,Items:[{Slot:0b,id:" + Q + "minecraft:stone" + Q + ",Count:1b}]}"],
];

for (const [name, snbt] of SAMPLES) {
  console.log(`\n===== ${name} =====`);
  const r = parseSNBT(snbt);
  if (!r.ok) { console.log('解析失败：' + r.error); continue; }
  const g = nbtToGraph(r.value, { rootName: name });
  console.log(`节点 ${g.data.nodes.length} 个 / 类型 ${g.types.length} 个`);
  console.log(`meta: 键数=${g.meta.keyCount} 已汉化=${g.meta.namedCount} 最深=${g.meta.maxDepthSeen} 根类型=${g.meta.rootType}`);
  if (g.meta.unnamed.length) console.log(`未取证键: ${g.meta.unnamed.join(', ')}`);
  for (const n of g.data.nodes.slice(0, 12)) {
    console.log(`  ${String(n.id).padEnd(38)} ${String(n.__label).padEnd(30)} ${n.__preview}`);
  }
  if (g.data.nodes.length > 12) console.log(`  … 还有 ${g.data.nodes.length - 12} 个`);
  // 反向还原
  const back = graphToNbt(g.data);
  console.log(`反向还原: ok=${back.ok} 错误=${back.errors.join('|') || '无'}`);
}

console.log('\n===== 端口类型判定 =====');
const rt = parseSNBT('{a:1b,c:1s,d:1i,e:1l,f:1.0f,g:1.0d,h:"s",i:[1,2],j:[B;1b,2b],k:{x:1},l:0.5}');
for (const [k, v] of Object.entries(rt.value)) {
  console.log(`  ${k} → ${portTypeOf(v)}  (${typeLabelOf(v)})  ${previewOf(v)}`);
}

console.log('\n===== 中文名（查不到必须显示未取证） =====');
for (const k of ['CustomName', 'Enchantments', 'lvl', 'Items', 'Health', '坚决不存在的键']) {
  const l = labelOf(k, k);
  console.log(`  ${k.padEnd(14)} → ${l.label.padEnd(12)} ${l.type || '-'} ${l.scope ? '[' + l.scope + ']' : ''}`);
}
