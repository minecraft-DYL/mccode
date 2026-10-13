// nbt-upstream-bugs-check.mjs —— 两个「上游文件」缺陷的**回归护栏**。
//
// 历史：src/core/nbt.js 的 NBTArray 构造器、src/graph/json-graph.js 的 isContainer
// 曾经各有一个真缺陷，当时的桥接层 src/ui/nbt-json-bridge.js 只能绕开。
// 现在两个缺陷都已在**根上**修掉（见下），所以本脚本的作用从「钉住缺陷」翻转为
// 「防止根修复被回退」——它断言的是**正确行为**，不是缺陷存在。
//
// 用法：node tools/nbt-upstream-bugs-check.mjs
//
// 修的是什么：
//   ① NBTArray：`constructor(kind, items = []) { super(...items) }` —— items 只有一个数字时
//      super(100) === Array(100)，造出「长度 100 的稀疏数组」。已改为显式 push，
//      并保留 ArraySpeciesCreate 兼容（map/slice 内部会以「单个数字 = 长度」调用构造器）。
//   ② isContainer：`typeof v === 'object'` 对 NBTNumber（Number 子类）也成立，
//      于是 1b 被判成容器，读 Object.keys 得到 ['suffix']，往返变成 {suffix:"b"}。
//      已排除 Number/String/Boolean 包装类型（Array 不排除，数组本来就该是容器）。

import { parseSNBT, toSNBT, NBTNumber, NBTArray } from '../src/core/nbt.js';
import { graphFromJson, jsonFromGraph } from '../src/graph/json-graph.js';
import { nbtToPlain, plainToNbt } from '../src/ui/nbt-json-bridge.js';

let pass = 0, fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `\n       ${detail}` : ''}`);
};

/* ─────────── 回归 ①：NBTArray 构造器 ─────────── */
console.log('══ 回归 ①：src/core/nbt.js 的 NBTArray 构造器 ══\n');
{
  const one = new NBTArray('L', [100]);
  t('单数字元素长度必须是 1（曾错成 100）', one.length === 1, `new NBTArray('L',[100]).length = ${one.length}`);
  t('单数字元素序列化正确', toSNBT(one) === '[L;100l]', `toSNBT → ${toSNBT(one)}`);
  t('两元素正常', new NBTArray('L', [100, 200]).length === 2);
  t('空数组长度为 0', new NBTArray('L').length === 0);
  t('kind 保留', new NBTArray('L', [1, 2]).kind === 'L');

  // Array 子类的内部调用（ArraySpeciesCreate 以「单个数字 = 新数组长度」调构造器）不能被破坏
  const a = new NBTArray('L', [1, 2, 3]);
  t('map 仍然工作（ArraySpeciesCreate 兼容）',
    JSON.stringify(a.map((x) => x * 2)) === '[2,4,6]', `map → ${JSON.stringify(a.map((x) => x * 2))}`);
  t('slice 仍然工作', a.slice(1).length === 2);
  t('filter 仍然工作', a.filter((x) => x > 1).length === 2);

  t('parseSNBT 往返不受影响', toSNBT(parseSNBT('[L;100]').value) === '[L;100l]',
    `parseSNBT('[L;100]') → ${toSNBT(parseSNBT('[L;100]').value)}`);
}

/* ─────────── 回归 ②：json-graph 的 isContainer ─────────── */
console.log('\n══ 回归 ②：src/graph/json-graph.js 的 isContainer ══\n');
{
  const v = parseSNBT('{X:"hello",N:1b}').value;
  t("NBTNumber 的自有可枚举键确实只有 ['suffix']（这就是它被骗的原因）",
    JSON.stringify(Object.keys(new NBTNumber(1, 'b'))) === '["suffix"]',
    `Object.keys = ${JSON.stringify(Object.keys(new NBTNumber(1, 'b')))}`);

  // 直接把 NBT 值喂给宿主 —— 现在必须是正确的
  const raw = graphFromJson(v);
  const titles = raw.nodes.map((n) => n.title);
  t('宿主不再把 NBTNumber 当容器（无 suffix 节点）', !titles.includes('suffix'),
    `节点标题 = ${JSON.stringify(titles)}`);

  const rawBack = jsonFromGraph({ nodes: new Map(raw.nodes.map((n) => [n.id, n])), links: raw.links });
  t('宿主往返不再产生 {suffix:"b"}', JSON.stringify(rawBack.N) !== '{"suffix":"b"}',
    `jsonFromGraph → ${JSON.stringify(rawBack)}`);

  // NBTArray 仍必须被当成容器（数组本来就该是容器）
  const arrTitles = graphFromJson({ G: new NBTArray('L', [100]) }).nodes.map((n) => n.title);
  t('NBTArray 仍被当作容器展开', arrTitles.some((x) => /\[1\]/.test(x)), `节点标题 = ${JSON.stringify(arrTitles)}`);
}

/* ─────────── 桥接层仍然必要：类型保真 ─────────── */
console.log('\n══ 桥接层 src/ui/nbt-json-bridge.js（仍然必要，守的是「类型保真」不是「绕开崩溃」）══\n');
{
  const v = parseSNBT('{X:"hello",N:1b,G:[L;100]}').value;
  const { plain, types } = nbtToPlain(v);
  t('降级后是纯 JSON（无包装类型泄漏）',
    plain.N === 1 && !(plain.N instanceof Number), `typeof plain.N = ${typeof plain.N}`);

  const g = graphFromJson(plain);
  const back = plainToNbt(
    jsonFromGraph({ nodes: new Map(g.nodes.map((n) => [n.id, n])), links: g.links }), types);
  t('桥接往返保留 1b 后缀', /N:\s*1b/.test(toSNBT(back)), `往返 → ${toSNBT(back)}`);
  t('桥接往返保留 [L;100l] 数组类型', /\[L;100l\]/.test(toSNBT(back)), `往返 → ${toSNBT(back)}`);
  t('桥接往返完全不丢键', /X:/.test(toSNBT(back)) && /N:/.test(toSNBT(back)) && /G:/.test(toSNBT(back)),
    `往返 → ${toSNBT(back)}`);
}

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`);
console.log(fail === 0
  ? '✅ 两个上游缺陷的根修复都还在，桥接层的类型保真也还在。'
  : `❌ 有 ${fail} 条断言不成立 —— 要么根修复被回退了，要么桥接层被改了，逐条查上面。`);
process.exitCode = fail ? 1 : 0;
