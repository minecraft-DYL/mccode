// 桥接模块自测：NBT → 纯 JSON → NBT 必须无损（含数值后缀与 B/I/L 数组类型）。
import { parseSNBT, toSNBT, NBTNumber, NBTArray } from '../src/core/nbt.js';
import { nbtToPlain, plainToNbt, dumpTypes } from '../src/ui/nbt-json-bridge.js';
import { graphFromJson, jsonFromGraph, jsonGraphTypes, jsonGraphPorts } from '../src/graph/json-graph.js';

let fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}\n      得: ${got}\n      期: ${want}`);
};

const samples = [
  '{X:"hello",N:1b,S:5s,D:1.5d,F:2.5f,L:3L}',
  '{L:[B;1,2,3],I:[I;10,20],G:[L;100]}',
  '{E:[{id:"minecraft:sharpness",lvl:3s}],Name:\'{"text":"我的"}\'}',
  '{A:{B:{C:{D:[1,2,{E:"deep"}]}}}}',
  '{Unbreakable:1b,Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}',
];

// jsonFromGraph(graph) 期望的是「图实例」：nodes 必须是 Map（按节点 id 索引）。
// 直接塞 graphFromJson 返回的 {nodes:[...]} 数组会得到空对象 —— 那是调用姿势错，不是桥的错。
const asGraph = (data) => ({ nodes: new Map(data.nodes.map((n) => [n.id, n])), links: data.links });

console.log('=== ① nbtToPlain → plainToNbt 无损往返 ===');
for (const src of samples) {
  const r = parseSNBT(src);
  if (!r.ok) { console.log(`  ❌ 样例解析失败 ${src}: ${r.error}`); fail++; continue; }
  const want = toSNBT(r.value);
  const { plain, types } = nbtToPlain(r.value);
  const back = plainToNbt(plain, types);
  const got = toSNBT(back);
  eq(`往返 ${src.slice(0, 46)}`, got, want);
  // 纯 JSON 里绝不能出现 suffix/kind 这种内部字段
  const leaked = JSON.stringify(plain).includes('suffix') || JSON.stringify(plain).includes('"kind"');
  if (leaked) { console.log('  ❌ 纯 JSON 里泄漏了内部字段: ' + JSON.stringify(plain)); fail++; }
}

console.log('\n=== ② 类型表内容抽样 ===');
const r2 = parseSNBT('{N:1b,S:5s,L:[B;1,2,3]}');
const t2 = nbtToPlain(r2.value).types;
console.log('  ' + JSON.stringify(dumpTypes(t2)));

console.log('\n=== ③ 关键回归：N:1b 不能被宿主当成容器 ===');
{
  const src = '{X:"hello",N:1b}';
  const r = parseSNBT(src);
  const { plain, types } = nbtToPlain(r.value);
  const data = graphFromJson(plain);
  const titles = data.nodes.map((n) => n.title);
  eq('图上不出现 suffix 节点', titles.includes('suffix'), false);
  console.log('  节点标题: ' + JSON.stringify(titles));
  // 走完整图往返
  const back = plainToNbt(jsonFromGraph(asGraph(data)), types);
  console.log('  出图 toSNBT: ' + toSNBT(back));
  eq('N:1b 原样保留', toSNBT(back).includes('N: 1b') || toSNBT(back).includes('N:1b'), true);
}

console.log('\n=== ④ 数组类型 B/I/L 保留 ===');
{
  const src = '{L:[B;1,2,3],I:[I;10,20],G:[L;100]}';
  const r = parseSNBT(src);
  const { plain, types } = nbtToPlain(r.value);
  const back = plainToNbt(plain, types);
  const out = toSNBT(back);
  console.log('  出图 toSNBT: ' + out);
  eq('B 数组保留', out.includes('[B;'), true);
  eq('I 数组保留', out.includes('[I;'), true);
  eq('L 数组保留', out.includes('[L;'), true);
}

console.log('\n=== ⑤ 出图后仍能再进图（幂等）===');
{
  const src = '{N:1b,S:5s,L:[B;1,2,3],E:[{id:"minecraft:sharpness",lvl:3s}]}';
  let cur = parseSNBT(src).value;
  const first = toSNBT(cur);
  for (let i = 0; i < 3; i++) {
    const { plain, types } = nbtToPlain(cur);
    const data = graphFromJson(plain);
    cur = plainToNbt(jsonFromGraph(asGraph(data)), types);
  }
  eq('3 次图往返后仍一致', toSNBT(cur), first);
}

console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ 失败 ${fail} 项`}`);
process.exitCode = fail ? 1 : 0;
