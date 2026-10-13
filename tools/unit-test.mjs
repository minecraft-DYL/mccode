// unit-test.mjs —— 核心逻辑单元测试（纯 Node，不需要浏览器）
// 覆盖：版本序数 / 语法分派 / SNBT 往返 / 二进制 NBT 往返 / gzip / 命令生成 / 命令校验
import {
  parseVersion, isNewScheme, majorLabel, channelName, versionOrder,
  isAncient, ANCIENT_ORDER, isAprilFools, APRIL_FOOLS,
  isDatapackEra, isBlockStateEra, isComponentEra,
} from '../src/core/versions.js';
import {
  stackSyntax, buildGive, buildSetblock, buildSummon, buildParticle,
  validateCommand, commandsFor, findCommand, formFor, parseItemArg,
  nbtToComponents, componentsToNbt, splitTopLevel, indexOfTopLevel,
} from '../src/core/commands.js';
import { packFormat, packFormatSince, packMeta, buildDatapack } from '../src/core/datapack.js';
import { ZipReader } from '../src/core/zip.js';
import {
  parseSNBT, toSNBT, formatSNBT, readNBT, writeNBT, gzip, gunzip, maybeGunzip, NBTNumber, NBTArray,
} from '../src/core/nbt.js';
import { normalize, subsequenceScore, editDistance, scoreEntry, searchEntries, wordInitialsScore } from '../src/core/fuzzy.js';
import { aliasesFor, isBedrockOnly, resolveBedrock, BEDROCK_LEGACY } from '../src/data/item-aliases.js';
import { ALL_COMPONENTS, componentById, searchComponents, COMPONENT_ALIASES } from '../src/data/components-wiki.js';
import { validateComponents, validateCommandText, validateVersionId, availableSince, formFitsVersion, summarize } from '../src/core/validate.js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `\n      期望 ${e}\n      实际 ${a}`);
}
const section = (t) => console.log(`\n── ${t} ──`);

/* ---------------- 版本号解析 ---------------- */
section('版本号解析');
eq('1.20.5 → nums', parseVersion('1.20.5').nums, [1, 20, 5]);
eq('26.3 → nums', parseVersion('26.3').nums, [26, 3]);
eq('26.3 属于新体系', isNewScheme('26.3'), true);
eq('1.21.4 不属于新体系', isNewScheme('1.21.4'), false);
eq('24w09a → 快照', parseVersion('24w09a').kind, 'snapshot');
eq('24w09a → week=2409', parseVersion('24w09a').week, 2409);
eq('1.21.4-pre1 → pre', parseVersion('1.21.4-pre1').kind, 'pre');
eq('26.3-snapshot-1 → snapshot', parseVersion('26.3-snapshot-1').kind, 'snapshot');
eq('本地目录名 1.21.11-v- 归一化', parseVersion('1.21.11-v-').nums, [1, 21, 11]);
eq('majorLabel 1.21.4', majorLabel('1.21.4'), '1.21');
eq('majorLabel 26.3', majorLabel('26.3'), '26.3');
eq('channelName', channelName('release'), '正式版');

/* ---------------- 版本序数（本次修复的回归用例） ---------------- */
section('版本序数排序');
const orderCases = ['1.0', '1.12.2', '1.13', '1.19.4', '1.20.4', '1.20.5', '1.21.1', '1.21.4', '1.21.11', '24w09a', '26.1', '26.3', '26.4-snapshot-3'];
let monotonic = true, bad = '';
for (let i = 1; i < orderCases.length; i++) {
  if (!(versionOrder(orderCases[i]) > versionOrder(orderCases[i - 1]))) { monotonic = false; bad = `${orderCases[i - 1]} < ${orderCases[i]}`; }
}
ok('版本序数严格单调递增', monotonic, bad ? `断点 ${bad}` : '');
ok('26.3 晚于 1.21.11', versionOrder('26.3') > versionOrder('1.21.11'));
ok('26.3 晚于 1.0（回归：曾是反的）', versionOrder('26.3') > versionOrder('1.0'));
ok('1.21.11 晚于 1.21.4', versionOrder('1.21.11') > versionOrder('1.21.4'));
ok('1.20.5 晚于 1.20.4', versionOrder('1.20.5') > versionOrder('1.20.4'));
ok('同版本 release 晚于 rc 晚于 pre',
  versionOrder('1.21.4') > versionOrder('1.21.4-rc1') && versionOrder('1.21.4-rc1') > versionOrder('1.21.4-pre1'));

/* ---------------- 远古版本（回归：2009 年的版本曾被判为比 26.3 还新） ---------------- */
section('远古版本序数（rd / c / inf / a / b）');
ok('rd-132211 是最旧（序数 0）', versionOrder('rd-132211') === 0, String(versionOrder('rd-132211')));
ok('远古 issue：rd-132211 不再晚于 26.3', versionOrder('rd-132211') < versionOrder('26.3'));
ok('远古 < 1.0', versionOrder('b1.8.1') < versionOrder('1.0'));
ok('alpha < beta', versionOrder('a1.2.6') < versionOrder('b1.7.3'));
ok('beta < 1.0', versionOrder('b1.7.3') < versionOrder('1.0'));
ok('26.3 仍是最大', versionOrder('26.3') > versionOrder('b1.8.1') && versionOrder('26.3') > versionOrder('1.21.11'));
ok('远古版本 kind=old', parseVersion('rd-132211').kind === 'old', parseVersion('rd-132211').kind);
ok('isAncient 正确', isAncient('rd-132211') && isAncient('b1.7.3') && !isAncient('1.0'));
ok('远古不命中数据包时代（回归）', isDatapackEra('rd-132211') === false);
ok('远古不命中方块状态时代（回归）', isBlockStateEra('rd-132211') === false);
ok('远古不命中组件时代（回归）', isComponentEra('rd-132211') === false);
ok('远古不命中新版本号体系（回归）', isNewScheme('rd-132211') === false);
ok('远古版本排在单调序列最前', versionOrder('rd-132211') < versionOrder('1.0'));

section('版本分组标签');
ok('周快照按年归组（回归：曾 437 个独立组）', majorLabel('24w09a') === '2024 年快照', majorLabel('24w09a'));
ok('新体系年月归组', majorLabel('26.3-snapshot-1') === '26.3', majorLabel('26.3-snapshot-1'));
ok('1.x 归大版本', majorLabel('1.21.11') === '1.21', majorLabel('1.21.11'));
ok('Beta 归组', majorLabel('b1.7.3').includes('Beta'), majorLabel('b1.7.3'));
ok('远古时序表覆盖 61 个版本', ANCIENT_ORDER.length === 61, String(ANCIENT_ORDER.length));
ok('远古时序表单调且去重', ANCIENT_ORDER.every((v, i) => i === 0 || v !== ANCIENT_ORDER[i - 1]));

section('愚人节版本 / 老式预发布命名');
ok('愚人节识别', isAprilFools('24w14potato') && isAprilFools('23w13a_or_b') && isAprilFools('20w14infinite'));
ok('非愚人节不误判', !isAprilFools('24w14a') && !isAprilFools('24w14potatoX'));
ok('愚人节 kind=snapshot（回归：曾判成 release）', parseVersion('24w14potato').kind === 'snapshot', parseVersion('24w14potato').kind);
ok('愚人节 week 解析正确', parseVersion('24w14potato').week === 2414, String(parseVersion('24w14potato').week));
ok('愚人节独立归组', majorLabel('24w14potato') === '愚人节快照', majorLabel('24w14potato'));
ok('愚人节 9 个', APRIL_FOOLS.length === 9, String(APRIL_FOOLS.length));
ok('老式 Pre-Release 判为 pre（回归：曾判成 release）', parseVersion('1.14 Pre-Release 4').kind === 'pre', parseVersion('1.14 Pre-Release 4').kind);
ok('老式 Pre-Release nums', JSON.stringify(parseVersion('1.14 Pre-Release 4').nums) === '[1,14]', JSON.stringify(parseVersion('1.14 Pre-Release 4').nums));
ok('预发布早于同版本正式版', versionOrder('1.14 Pre-Release 4') < versionOrder('1.14'));

/* ---------------- 语法分派 ---------------- */
section('物品语法分派');
eq('1.20.4 → nbt', stackSyntax('1.20.4'), 'nbt');
eq('1.20.5 → components', stackSyntax('1.20.5'), 'components');
eq('26.3 → components', stackSyntax('26.3'), 'components');
eq('1.13 → nbt', stackSyntax('1.13'), 'nbt');

/* ---------------- 命令生成 ---------------- */
section('命令生成');
const g1 = buildGive('26.3', { targets: '@s', item: 'minecraft:diamond_sword', count: 1, componentList: ['custom_name="神剑"'] });
ok('26.3 /give 用组件语法', g1.includes('[custom_name="神剑"]'), g1);
ok('26.3 /give 无 NBT 花括号', !/\{\s*CustomName/.test(g1), g1);
const g2 = buildGive('1.20.4', { targets: '@s', item: 'minecraft:diamond_sword', count: 1, nbt: '{CustomName:\'{"text":"神剑"}\'}' });
ok('1.20.4 /give 用 NBT 语法', g2.includes("{CustomName:"), g2);
ok('/setblock 生成', buildSetblock('26.3', { pos: '~ ~1 ~', block: 'minecraft:chest', nbt: '{Items:[]}' }).startsWith('setblock ~ ~1 ~ minecraft:chest'), buildSetblock('26.3', { pos: '~ ~1 ~', block: 'minecraft:chest', nbt: '{Items:[]}' }));
ok('/summon 生成', buildSummon('26.3', { entity: 'minecraft:pig', pos: '~ ~ ~', nbt: '{NoAI:1b}' }).startsWith('summon minecraft:pig ~ ~ ~'), buildSummon('26.3', { entity: 'minecraft:pig', pos: '~ ~ ~', nbt: '{NoAI:1b}' }));
ok('/particle 生成', buildParticle('26.3', { particle: 'minecraft:flame' }).startsWith('particle minecraft:flame'), buildParticle('26.3', { particle: 'minecraft:flame' }));

// 版本降级：组件必须自动转成 NBT，不能静默丢属性
const dg1 = buildGive('1.20.4', { item: 'minecraft:diamond_sword', componentList: ['custom_name="剑"'], count: 1 });
ok('1.20.4 收到组件时自动降级为 NBT（回归：曾整体丢失）', dg1.includes('{CustomName'), dg1);
const dg2 = buildGive('1.20.4', { item: 'minecraft:diamond_sword', componentList: ['enchantments={levels:{"minecraft:sharpness":5}}'] });
ok('降级保留附魔', /Enchantments/.test(dg2), dg2);
const dg3 = buildGive('1.12', { item: 'minecraft:diamond_sword', componentList: ['custom_name="剑"'], count: 1 });
ok('1.12 降级并保留 [data] 数字项', /diamond_sword 1 0 \{/.test(dg3), dg3);
ok('26.3 仍走组件语法（不被降级）', buildGive('26.3', { item: 'minecraft:diamond_sword', componentList: ['custom_name="剑"'] }).includes('[custom_name='));

/* ---------------- 命令校验（回归） ---------------- */
section('命令校验');
const v26 = validateCommand('/give @s minecraft:stone', '26.3');
ok('26.3 下 /give 可用（回归：曾判为不存在）', v26.ok === true, v26.message);
ok('26.3 下 /give 语法为组件式', /\[|\{/.test(v26.form ? v26.form.syntax : ''), v26.form && v26.form.syntax);
const v10 = validateCommand('/give @s minecraft:stone 1 0 {CustomName:"x"}', '1.10');
ok('1.10 下 /give 用旧式语法模板（含 dataTag）', v10.ok === true && /dataTag|\[data\]/.test(v10.form.syntax), v10.message + ' / ' + (v10.form && v10.form.syntax));
ok('26.3 与 1.10 的 /give 语法模板不同',
  formFor(findCommand('give'), '26.3').syntax !== formFor(findCommand('give'), '1.10').syntax);
ok('未知命令给出警告', validateCommand('/notacommand123', '26.3').level === 'warning');
ok('空命令报错', validateCommand('   ', '26.3').ok === false);
eq('26.3 可用命令数 > 1.0', commandsFor('26.3').length > 0, true);
ok('/give 在 26.3 的可用列表里', commandsFor('26.3').some((c) => c.name === 'give'));
ok('formFor(/give, 26.3) 有 since', !!formFor(findCommand('give'), '26.3').since);

/* ---------------- SNBT 往返 ---------------- */
section('SNBT 解析 / 序列化');
const r1 = parseSNBT('{CustomName:\'{"text":"hi"}\',Unbreakable:1b,Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}');
ok('SNBT 解析成功', r1.ok === true, r1.error || '');
ok('Unbreakable 是字节型', r1.ok && r1.value.Unbreakable instanceof NBTNumber && r1.value.Unbreakable.tagType === 'byte', r1.ok && String(r1.value.Unbreakable));
ok('lvl 是短整型', r1.ok && r1.value.Enchantments[0].lvl.tagType === 'short');
const round1 = roundTrip('{a:1b,b:2s,c:3,d:4L,e:1.5f,f:2.5d,g:"s",h:[1,2,3],i:{j:1b}}');
ok('SNBT 往返一致', round1.ok, round1.msg);
const bytesArr = parseSNBT('{data:[B;1b,2b,3b]}');
ok('字节数组解析', bytesArr.ok && bytesArr.value.data instanceof NBTArray && bytesArr.value.data.kind === 'B', bytesArr.error || '');
eq('字节数组序列化', bytesArr.ok && toSNBT(bytesArr.value.data), '[B;1b,2b,3b]');
ok('非法 SNBT 报错', parseSNBT('{a:}').ok === false);
ok('未闭合报错', parseSNBT('{a:1').ok === false);
const fmt = formatSNBT('{a:1,b:2}');
ok('格式化输出多行', fmt.ok && fmt.text.includes('\n'), fmt.ok ? fmt.text : fmt.error);
eq('压缩成一行', toSNBT(parseSNBT('{\n  a: 1b,\n  b: "x"\n}').value), '{a:1b,b:"x"}');

function roundTrip(snbt) {
  const r = parseSNBT(snbt);
  if (!r.ok) return { ok: false, msg: '解析失败 ' + r.error };
  const out = toSNBT(r.value);
  const r2 = parseSNBT(out);
  if (!r2.ok) return { ok: false, msg: '回读失败 ' + r2.error };
  const back = toSNBT(r2.value);
  return { ok: out === back, msg: `${out} !== ${back}` };
}

/* ---------------- 二进制 NBT 往返 ---------------- */
section('二进制 NBT 往返');
const obj = { name: 'Steve', hp: new NBTNumber(20, 'float'), flag: new NBTNumber(1, 'byte'), list: [1, 2, 3].map((n) => new NBTNumber(n, 'int')), nested: { x: new NBTNumber(5, 'long') } };
const bin = writeNBT(obj, { name: 'root' });
ok('writeNBT 产出字节', bin instanceof Uint8Array && bin.length > 0, `len=${bin.length}`);
const rb = readNBT(bin);
ok('readNBT 根名回读', rb.name === 'root', rb.name);
ok('readNBT 字符串回读', rb.value.name === 'Steve', String(rb.value.name));
ok('readNBT float 回读', Math.abs(Number(rb.value.hp) - 20) < 1e-6, String(rb.value.hp));
ok('readNBT 列表回读', Array.isArray(rb.value.list) && rb.value.list.length === 3, JSON.stringify(rb.value.list));
ok('readNBT long 回读', Number(rb.value.nested.x) === 5, String(rb.value.nested.x));
const binLE = writeNBT(obj, { name: 'root', littleEndian: true });
const rbLE = readNBT(binLE, { littleEndian: true });
ok('小端 NBT 往返', rbLE.value.name === 'Steve' && Number(rbLE.value.nested.x) === 5);
ok('大端与小端字节流确实不同', writeNBT(obj, { name: 'root' }).join(',') !== binLE.join(','));

section('数组标签往返');
const arrObj = {
  ints: new NBTArray('I', [1, 2, -3, 2147483647]),
  longs: new NBTArray('L', [10, 20, -30]),
  bytes: new NBTArray('B', [1, 2, 127]),
};
const arrBack = readNBT(writeNBT(arrObj, { name: 'arr' })).value;
eq('INT_ARRAY 往返', Array.from(arrBack.ints).map(Number), [1, 2, -3, 2147483647]);
eq('LONG_ARRAY 往返', Array.from(arrBack.longs).map(Number), [10, 20, -30]);
eq('BYTE_ARRAY 往返', Array.from(arrBack.bytes).map(Number), [1, 2, 127]);
ok('INT_ARRAY 的 kind 保留为 I', arrBack.ints instanceof NBTArray && arrBack.ints.kind === 'I', arrBack.ints && arrBack.ints.kind);
const arrLE = readNBT(writeNBT(arrObj, { name: 'arr', littleEndian: true }), { littleEndian: true }).value;
eq('小端 INT_ARRAY 往返', Array.from(arrLE.ints).map(Number), [1, 2, -3, 2147483647]);
eq('小端 LONG_ARRAY 往返', Array.from(arrLE.longs).map(Number), [10, 20, -30]);
const snbtArr = parseSNBT('{d:[I;1,-3,2147483647],e:[L;10,20],f:[B;1,2,127]}');
ok('数组 SNBT 解析', snbtArr.ok, snbtArr.error || '');
eq('数组 SNBT 序列化', snbtArr.ok && toSNBT(snbtArr.value.d), '[I;1,-3,2147483647]');
eq('长整数组序列化带 l 后缀', snbtArr.ok && toSNBT(snbtArr.value.e), '[L;10l,20l]');
eq('字节数组序列化带 b 后缀', snbtArr.ok && toSNBT(snbtArr.value.f), '[B;1b,2b,127b]');
const mixedArr = parseSNBT('[I;1b,2s,3i]');
ok('整型数组接受混合后缀（wiki: [I;1b,2s,3i]）', mixedArr.ok, mixedArr.error || '');
eq('混合后缀整型数组可序列化', mixedArr.ok && toSNBT(mixedArr.value), '[I;1,2,3]');
const snbtArrBin = writeNBT(snbtArr.value, { name: 'arr2' });
const snbtArrBack = readNBT(snbtArrBin).value;
eq('SNBT 数组 → 二进制 → 回读', Array.from(snbtArrBack.d).map(Number), [1, -3, 2147483647]);

/* ---------------- gzip ---------------- */
section('gzip / maybeGunzip');
const raw = new TextEncoder().encode('hello minecraft nbt '.repeat(40));
const z = await gzip(raw);
ok('gzip 压缩产出', z.length > 0 && z.length < raw.length, `${raw.length} → ${z.length}`);
const un = await gunzip(z);
ok('gunzip 还原一致', un.length === raw.length && un.every((b, i) => b === raw[i]));
const auto = await maybeGunzip(raw);
ok('maybeGunzip 对未压缩数据原样返回', auto.length === raw.length);
const auto2 = await maybeGunzip(z);
ok('maybeGunzip 自动解压 gzip', auto2.length === raw.length);
const gzDat = await gzip(bin);
const rbGz = readNBT(await maybeGunzip(gzDat));
ok('gzip 包裹的 NBT 可读', rbGz.value.name === 'Steve');

/* ---------------- 组件迁移 ---------------- */
section('NBT ⇄ 组件 迁移');
const nbtIn = parseSNBT('{CustomName:\'{"text":"剑"}\',Unbreakable:1b,CustomModelData:123,Enchantments:[{id:"minecraft:sharpness",lvl:5s}]}');
const comps = nbtToComponents(nbtIn.value);
ok('迁移出 custom_name', 'custom_name' in comps, JSON.stringify(comps));
ok('迁移出 unbreakable', 'unbreakable' in comps);
ok('迁移出 custom_model_data', 'custom_model_data' in comps);
ok('迁移出 enchantments', 'enchantments' in comps);
const backNbt = componentsToNbt({ custom_name: '"剑"', unbreakable: '{}' });
ok('组件回迁 NBT 有 CustomName', 'CustomName' in backNbt, JSON.stringify(backNbt));

/* ---------------- 顶层分隔 ---------------- */
section('顶层分割工具');
eq('splitTopLevel 忽略括号内逗号', splitTopLevel('a=1,b=[1,2],c={x:1,y:2}', ',').length, 3);
eq('indexOfTopLevel 找到顶层等号', indexOfTopLevel('custom_name="神剑"', '='), 11);
eq('indexOfTopLevel 不匹配括号内', indexOfTopLevel('a[b=1]', '='), -1);
eq('parseItemArg 组件式', parseItemArg('minecraft:stone[custom_name="x"]', '26.3').item, 'minecraft:stone');
eq('parseItemArg NBT 式', parseItemArg('minecraft:stone{CustomName:"x"}', '1.20.4').nbt, '{CustomName:"x"}');

/* ---------------- 时代判断 ---------------- */
section('语义化时代判断');
ok('1.12 不是数据包时代（回归：恒真的 >=0 曾把它误判为是）', isDatapackEra('1.12') === false);
ok('1.13 是数据包时代', isDatapackEra('1.13') === true);
ok('26.3 是数据包时代', isDatapackEra('26.3') === true);
ok('1.18 非方块状态时代', isBlockStateEra('1.18') === false);
ok('1.19 是方块状态时代', isBlockStateEra('1.19') === true);
ok('26.3 是方块状态时代', isBlockStateEra('26.3') === true);
ok('1.20.4 非组件时代', isComponentEra('1.20.4') === false);
ok('1.20.5 是组件时代', isComponentEra('1.20.5') === true);
ok('1.21.4 是组件时代', isComponentEra('1.21.4') === true);

/* ---------------- 数据包 pack_format ---------------- */
section('数据包 pack_format（对照 wiki 官方模板 + 本机 jar）');
// 权威样本：zh.minecraft.wiki Template:Data pack format 的 release 分支
const PF_CASES = [
  ['1.13', 4], ['1.15', 5], ['1.16.2', 6], ['1.17', 7], ['1.18', 8], ['1.18.2', 9],
  ['1.19', 10], ['1.19.4', 12], ['1.20', 15], ['1.20.2', 18], ['1.20.3', 26], ['1.20.4', 26],
  ['1.20.5', 41], ['1.21', 48], ['1.21.1', 48], ['1.21.2', 57], ['1.21.4', 61],
  ['1.21.5', 71], ['1.21.6', 80], ['1.21.7', 81], ['1.21.9', '88.0'], ['1.21.11', '94.1'],
  ['26.1', '101.1'], ['26.2', '107.1'], ['26.3', '121.0'],
];
const pfBad = [];
for (const [v, exp] of PF_CASES) {
  const got = packFormat(v);
  if (got !== exp) pfBad.push(`${v}: 期望 ${exp} 实际 ${got}`);
}
ok('packFormat 全部命中权威值（25 个样本）', pfBad.length === 0, pfBad.join('; '));
// 本机 jar 内 version.json 的 pack_version，独立于 wiki 的第二个证据源
eq('jar 交叉验证 1.20.1 → 15', packFormat('1.20.1'), 15);
eq('jar 交叉验证 1.20.4 → 26（回归：表里曾错写 22）', packFormat('1.20.4'), 26);
eq('jar 交叉验证 1.21.1 → 48（回归：表里曾缺项而回退成 4）', packFormat('1.21.1'), 48);
eq('jar 交叉验证 1.21.11 → 94.1', packFormat('1.21.11'), '94.1');
eq('jar 交叉验证 26.3 → 121.0（回归：曾猜成 71）', packFormat('26.3'), '121.0');
eq('packFormatSince(1.20.5)', packFormatSince('1.20.5'), '1.20.5');
eq('packFormatSince(1.20.6)', packFormatSince('1.20.6'), '1.20.5');
ok('1.21.9+ 用 min_format/max_format',
  'min_format' in packMeta('26.3', 'x').pack && !('pack_format' in packMeta('26.3', 'x').pack),
  JSON.stringify(packMeta('26.3', 'x')));
eq('26.3 的 min_format', packMeta('26.3', 'x').pack.min_format, [121, 0]);
ok('1.20.5 仍用 pack_format',
  'pack_format' in packMeta('1.20.5', 'x').pack && packMeta('1.20.5', 'x').pack.pack_format === 41,
  JSON.stringify(packMeta('1.20.5', 'x')));

section('数据包 ZIP（自写 → 自解 → 校验）');
const dp = buildDatapack({ namespace: 'demo', functionName: 'main', lines: ['say hi', 'give @s minecraft:stone'], version: '26.3' });
ok('buildDatapack 成功', dp.ok, dp.error || '');
ok('ZIP 局部头魔数 PK\\x03\\x04', dp.bytes[0] === 0x50 && dp.bytes[1] === 0x4b && dp.bytes[2] === 3 && dp.bytes[3] === 4,
  `${dp.bytes[0].toString(16)} ${dp.bytes[1].toString(16)}`);
ok('ZIP 以 EOCD 结尾', dp.bytes[dp.bytes.length - 22] === 0x50 && dp.bytes[dp.bytes.length - 21] === 0x4b);
const zr = new ZipReader(dp.bytes);
ok('ZipReader 解析出 2 个条目', zr.size === 2, `size=${zr.size}`);
ok('含 pack.mcmeta', zr.has('pack.mcmeta'));
ok('含 mcfunction', zr.has('data/demo/function/main.mcfunction'));
const backMeta = await zr.readJSON('pack.mcmeta');
eq('回读 pack.mcmeta 的 min_format', backMeta.pack.min_format, [121, 0]);
const backFn = await zr.readText('data/demo/function/main.mcfunction');
ok('回读函数内容', backFn === 'say hi\ngive @s minecraft:stone\n', JSON.stringify(backFn));
ok('1.12 拒绝导出数据包', buildDatapack({ version: '1.12', lines: ['say'] }).ok === false);
const dpOld = buildDatapack({ namespace: 'oldpack', functionName: 'f', lines: ['say x'], version: '1.20.5' });
ok('1.20.5 数据包用旧格式', JSON.parse(new TextDecoder().decode(dpOld.files[0].data)).pack.pack_format === 41);

/* ---------------- 模糊搜索 / 物品别名 ---------------- */
section('模糊搜索（/give 输入框用）');
eq('normalize 去命名空间与分隔符', normalize('minecraft:Diamond_Sword'), 'diamondsword');
ok('子序列命中：ds → diamond_sword', subsequenceScore('ds', 'diamondsword') >= 0, String(subsequenceScore('ds', 'diamondsword')));
ok('子序列未命中返回 -1', subsequenceScore('xyz', 'diamondsword') === -1);
eq('编辑距离：拼写错误', editDistance('diamonsword', 'diamondsword', 3), 1);
eq('编辑距离上限剪枝', editDistance('abcdef', 'zzzzzz', 2), 3);

const FAKE = [
  { id: 'diamond_sword', name: '钻石剑' },
  { id: 'stone', name: '石头' },
  { id: 'sugar_cane', name: '甘蔗' },
  { id: 'cod', name: '生鳕鱼' },
  { id: 'torch', name: '火把' },
];
const pick = (q) => searchEntries(FAKE, q, { aliasesOf: aliasesFor, limit: 3 }).map((x) => x.id);
eq('精确 ID', pick('diamond_sword')[0], 'diamond_sword');
eq('中文名精确', pick('石头')[0], 'stone');
eq('中文名子串', pick('钻石')[0], 'diamond_sword');
eq('缩写 ds', pick('ds')[0], 'diamond_sword');
eq('拼写错误 diamon_sword', pick('diamon_sword')[0], 'diamond_sword', pick('diamon_sword').join(','));
eq('大写与命名空间', pick('MINECRAFT:Stone')[0], 'stone');
ok('无关查询无结果', pick('qqqqzzzz').length === 0, pick('qqqqzzzz').join(','));
ok('空查询返回空', searchEntries(FAKE, '   ', {}).length === 0);

// 回归：真实数据集里 diamond_sword 与 beetroot_seeds 内部都含 "ds"，
// 只按子串打分会让两者同分、排序退化成按字母表，缩写搜索就废了。
const REAL = [
  { id: 'diamond_sword', name: '钻石剑' },
  { id: 'beetroot_seeds', name: '甜菜种子' },
  { id: 'stone_bricks', name: '石砖' },
  { id: 'golden_sword', name: '金剑' },
  { id: 'wooden_sword', name: '木剑' },
  { id: 'sugar_cane', name: '甘蔗' },
];
const rpick = (q) => searchEntries(REAL, q, { aliasesOf: aliasesFor, limit: 4 }).map((x) => x.id);
eq('词首缩写 ds 必须压过 beetroot_seeds', rpick('ds')[0], 'diamond_sword', rpick('ds').join(','));
eq('词首缩写 bs → beetroot_seeds', rpick('bs')[0], 'beetroot_seeds', rpick('bs').join(','));
eq('词首缩写 sb → stone_bricks', rpick('sb')[0], 'stone_bricks', rpick('sb').join(','));
eq('词首缩写 gs → golden_sword', rpick('gs')[0], 'golden_sword', rpick('gs').join(','));
eq('词首缩写 ws → wooden_sword', rpick('ws')[0], 'wooden_sword', rpick('ws').join(','));
eq('词首缩写命中质量满分', wordInitialsScore('ds', 'diamond_sword'), 1);
eq('无词边界则不命中', wordInitialsScore('ds', 'beetroot_seeds'), -1);
eq('真实数据下基岩版旧名 reeds', rpick('reeds')[0], 'sugar_cane', rpick('reeds').join(','));

section('物品数据组件全表（wiki 取证）');
eq('组件总数 = 89 常规 + 29 实体变种 + 3 临时', ALL_COMPONENTS.length, 121);
eq('常规组件 89 条', ALL_COMPONENTS.filter((c) => c.group === '常规').length, 89);
eq('实体变种组件 29 条', ALL_COMPONENTS.filter((c) => c.group === '实体变种').length, 29);
eq('临时组件 3 条', ALL_COMPONENTS.filter((c) => c.group === '临时').length, 3);
ok('组件 ID 无重复', new Set(ALL_COMPONENTS.map((c) => c.id)).size === ALL_COMPONENTS.length);
ok('每条都有中文名', ALL_COMPONENTS.every((c) => c.name && c.name.length > 0));
ok('中文名确实含汉字（没漏本地化）', ALL_COMPONENTS.every((c) => /[\u4e00-\u9fff]/.test(c.name)),
  ALL_COMPONENTS.filter((c) => !/[\u4e00-\u9fff]/.test(c.name)).map((c) => c.id).join(','));
eq('custom_name 中文名', componentById('custom_name').name, '自定义名称');
eq('lore 中文名', componentById('lore').name, '物品提示框中的描述信息');
eq('enchantments 中文名', componentById('enchantments').name, '魔咒');
eq('带命名空间前缀也能查到', componentById('minecraft:lore').id, 'lore');
eq('hide_tooltip 走别名指向 tooltip_display', componentById('hide_tooltip').id, 'tooltip_display');
eq('别名表登记 hide_tooltip', COMPONENT_ALIASES.hide_tooltip, 'tooltip_display');
ok('未取证组件 since 为 null（不编版本号）', ALL_COMPONENTS.filter((c) => c.since === null).length > 0);
ok('已取证的 since 都是版本号字符串', ALL_COMPONENTS.filter((c) => c.since !== null).every((c) => /^\d+\.\d+(\.\d+)?$/.test(c.since)));
eq('搜中文名「描述」命中 lore', searchComponents('描述')[0].id, 'lore');
eq('搜中文名「魔咒」命中 enchantments', searchComponents('魔咒')[0].id, 'enchantments', searchComponents('魔咒').map((c) => c.id).join(','));
ok('搜中文名「附魔」命中 enchantable 与 enchantment_glint_override',
  ['enchantable', 'enchantment_glint_override'].every((id) => searchComponents('附魔').map((c) => c.id).includes(id)),
  searchComponents('附魔').map((c) => c.id).join(','));
ok('搜「耐久」同时命中 break_sound 与 max_damage',
  ['break_sound', 'max_damage'].every((id) => searchComponents('耐久').map((c) => c.id).includes(id)),
  searchComponents('耐久').map((c) => c.id).join(','));
eq('完整中文名精确命中排第一', searchComponents('最大耐久度')[0].id, 'max_damage');
eq('搜 ID 前缀 custom 命中 custom_name', searchComponents('custom_name')[0].id, 'custom_name');
eq('空查询返回前 N 条', searchComponents('', 5).length, 5);
eq('无匹配返回空', searchComponents('zzzzzz').length, 0);

section('语义校验（validate.js）');
const codes = (r) => r.issues.map((i) => i.code);
const has = (r, code) => codes(r).includes(code);

// —— 组件 ——
ok('1.12.2 用组件 → 报错（该版本还没有数据组件）', has(validateComponents('1.12.2', [{ key: 'custom_name', value: '"x"' }]), 'version.no-components'));
ok('1.20.5 正常组件 → 通过', validateComponents('1.20.5', [{ key: 'custom_name', value: '"我的物品"' }]).ok);
ok('未知组件 → 报错', has(validateComponents('1.20.5', [{ key: 'no_such_component', value: '1' }]), 'component.unknown'));
ok('未知组件给「你是不是想写」建议', (() => { const r = validateComponents('1.20.5', [{ key: 'custom_nam', value: '1' }]); return r.issues.some((i) => i.hint); })());
ok('max_stack_size=200 → 越界报错', has(validateComponents('1.20.5', [{ key: 'max_stack_size', value: '200' }]), 'value.range'));
ok('max_stack_size=99 → 通过（99 是上限）', validateComponents('1.20.5', [{ key: 'max_stack_size', value: '99' }]).ok);
ok('rarity=legendary → 枚举报错', has(validateComponents('1.20.5', [{ key: 'rarity', value: '"legendary"' }]), 'value.enum'));
ok('rarity=epic → 通过', validateComponents('1.20.5', [{ key: 'rarity', value: '"epic"' }]).ok);
ok('hide_tooltip → 提示已改名', has(validateComponents('1.20.5', [{ key: 'hide_tooltip', value: 'true' }]), 'component.renamed'));
ok('重复组件 → 警告', has(validateComponents('1.20.5', [{ key: 'custom_name', value: '"a"' }, { key: 'custom_name', value: '"b"' }]), 'component.duplicate'));
ok('空值 → 警告', has(validateComponents('1.20.5', [{ key: 'custom_name', value: '' }]), 'component.empty-value'));
ok('enchantments 非复合 → 报错', has(validateComponents('1.20.5', [{ key: 'enchantments', value: '5' }]), 'value.type'));
ok('lore 非数组 → 警告', has(validateComponents('1.20.5', [{ key: 'lore', value: '{"text":"x"}' }]), 'value.type'));
ok('dyed_color rgb 越界 → 报错', has(validateComponents('1.20.5', [{ key: 'dyed_color', value: '{rgb:99999999}' }]), 'value.range'));
ok('模组命名空间组件 → 只给 info 不报错', (() => { const r = validateComponents('1.20.5', [{ key: 'mymod:thing', value: '1' }]); return r.issues.some((i) => i.code === 'component.mod-namespace') && r.ok; })());

// —— 命令 ——
ok('/give @s minecraft:stone → 通过', validateCommandText('1.20.5', '/give @s minecraft:stone').ok);
ok('不存在的命令 → 报错', has(validateCommandText('1.20.5', '/notacommand'), 'command.unknown'));
ok('1.12.2 用 /damage → 报不可用', has(validateCommandText('1.12.2', '/damage @s 1'), 'command.unavailable'));
// 回归护栏：commands.js 的 formFor() 匹配不到版本时会兜底返回最后一个表单。
// /fill 只记了 1.13+ 一条，所以 1.12.2 不能拿到 1.13 语法。
ok('1.12.2 的 /fill 不能落回 1.13+ 语法 → 报 no-form', has(validateCommandText('1.12.2', '/fill ~ ~ ~ ~ ~2 ~ 1'), 'command.no-form'));
ok('1.20.5 的 /fill 正常通过', validateCommandText('1.20.5', '/fill ~ ~ ~ ~ ~2 ~ minecraft:stone').ok);
eq('formFitsVersion：1.13 表单不适用于 1.12.2', formFitsVersion({ since: '1.13' }, '1.12.2'), false);
eq('formFitsVersion：1.13 表单适用于 1.20.5', formFitsVersion({ since: '1.13' }, '1.20.5'), true);
eq('formFitsVersion：until 到期后不适用', formFitsVersion({ since: '1.8', until: '1.12.2' }, '1.20.5'), false);
ok('错误目标选择器 @x → 报错', has(validateCommandText('1.20.5', '/give @x minecraft:stone'), 'command.bad-selector'));
ok('坏 NBT 片段 → 报错', has(validateCommandText('1.20.5', '/give @s minecraft:stone {bad'), 'command.bad-snbt'));
ok('空命令 → 警告不报错', (() => { const r = validateCommandText('1.20.5', ''); return r.ok && r.warnings.length > 0; })());
ok('校验结果按严重度排序（error 在前）', (() => {
  // 注意：未知组件命中后会 continue，不会再有第二条 issue；
  // 所以这里要构造真能同时产出 error 与 warning 的输入。
  const r = validateComponents('1.20.5', [{ key: 'no_such_component', value: '1' }, { key: 'custom_name', value: '' }]);
  return r.issues.length === 2 && r.issues[0].level === 'error' && r.issues[1].level === 'warning';
})());

// —— 版本 ——
ok('清单里有的版本 → 通过', validateVersionId('1.20.5', { versions: [{ id: '1.20.5' }] }).ok);
ok('清单里没有的版本 → 报错', has(validateVersionId('9.9.9', { versions: [{ id: '1.20.5' }] }), 'version.unknown'));
ok('清单未加载 → 只给 info 不报错', (() => { const r = validateVersionId('1.20.5', null); return r.ok && r.issues.some((i) => i.code === 'version.no-index'); })());

// —— 版本时序工具 ——
eq('1.20.5 早于 1.21 → availableSince 为 false', availableSince('1.21', '1.20.5'), false);
eq('1.20.5 不晚于 1.21 → availableSince 为 true', availableSince('1.20.5', '1.21'), true);
eq('since 未知 → null（不硬判）', availableSince(null, '1.21'), null);
ok('summarize 出错时 level=error', summarize(validateComponents('1.12.2', [{ key: 'x', value: '1' }])).level === 'error');

section('物品别名（基岩版旧名 / 教育版专属）');
eq('基岩版旧名 reeds → 甘蔗', pick('reeds')[0], 'sugar_cane', pick('reeds').join(','));
eq('基岩版旧名 fish → 生鳕鱼', pick('fish')[0], 'cod', pick('fish').join(','));
eq('resolveBedrock 直接解析', resolveBedrock('reeds'), 'sugar_cane');
eq('resolveBedrock 容忍空格', resolveBedrock('horse armor leather'), null);
ok('教育版专属识别', isBedrockOnly('hard_glass') && isBedrockOnly('netherreactor'));
ok('普通物品不误判为专属', !isBedrockOnly('stone') && !isBedrockOnly('diamond_sword'));
ok('aliasesFor 反查命中', (aliasesFor({ id: 'sugar_cane' }) || []).includes('reeds'));
ok('无别名条目返回 null', aliasesFor({ id: 'stone' }) === null);
ok('别名表无空值', Object.values(BEDROCK_LEGACY).every((v) => typeof v === 'string' && v.length));

/* ---------------- 汇总 ---------------- */
console.log(`\n════════════════════════════════`);
console.log(`  通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('  失败项：'); fails.forEach((f) => console.log('   - ' + f)); }
console.log(`════════════════════════════════\n`);
process.exit(fail ? 1 : 0);
