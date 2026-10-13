// 直接测 capabilities.js 对新 schema（effects）的合并，不依赖浏览器。
// 背景：外部取证文件从「每段自带 caps」改成「每段给 effects 变迁列表」，
// 只认 caps 会让全部能力静默变成 unsupported（整个能力矩阵全灭且不报错）。
import { readFileSync } from 'node:fs';
import { CapabilityMatrix, CAP_KEYS, capKeyOf, SEGMENTS } from '../src/core/capabilities.js';

const ext = JSON.parse(readFileSync('./data/version-segments.json', 'utf8'));

// 构造假 VersionIndex：注意本文件约定 order 越小越新（与 versions.js 的 versionOrder 相反）。
const CHRONO = [
  'c0.30_01c', 'Classic 0.0.15a', 'Classic 0.0.16a', 'a1.2.6',
  '1.0', '1.2.5', '1.3.1', '1.4.2', '1.7.2', '1.8', '1.9', '1.11', '1.12', '1.12.2',
  '1.13', '1.14', '1.15', '1.16', '1.19', '1.19.4', '1.20.2', '1.20.3', '1.20.4',
  '1.20.5', '1.21', '1.21.2', '1.21.4', '1.21.5', '1.21.6', '1.21.9',
  '26.1', '26.2', '26.3', '26.4-snapshot-1',
];
const order = new Map();
CHRONO.forEach((v, i) => order.set(v, CHRONO.length - i)); // 最老 = 最大，最新 = 最小
// 外部段的 anchor 可能有额外写法，补进索引
for (const s of ext.segments) {
  const a = s.anchor || s.anchorVersion;
  if (a && !order.has(a)) order.set(a, CHRONO.length);
}
const fakeIndex = { order, versions: CHRONO.map((id) => ({ id })) };

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 能力键归一 ===');
t('chatchat → chatcommand', capKeyOf('chatchat') === 'chatcommand');
t('chatcommand 原样', capKeyOf('chatcommand') === 'chatcommand');
t('minecraft:nbt → nbt', capKeyOf('minecraft:nbt') === 'nbt');
t('认不出的键返回 null（不猜）', capKeyOf('totally_unknown') === null);

console.log('\n=== 合并新 schema ===');
const builtin = new CapabilityMatrix(SEGMENTS, fakeIndex);
const m = builtin.merge(ext);

t('loadedFrom = wiki', m.loadedFrom === 'wiki');
// 外部 27 段；内置里锚点恰好被外部覆盖的会被删掉，没被覆盖的（如 seg-origin 锚在 1.0，
// 而外部用的是 Classic 0.0.16a / 1.3.1）合理保留 —— 所以段数落在 [27, 27+11] 之间。
const extAnchors = new Set(ext.segments.map((s) => String(s.anchor || s.anchorVersion)));
t('段数 = 外部段 + 未被外部锚点覆盖的内置段',
  m.segments.length >= ext.segments.length && m.segments.length <= ext.segments.length + SEGMENTS.length,
  `实际 ${m.segments.length}，外部 ${ext.segments.length}，内置 ${SEGMENTS.length}`);
t('没有重复锚点', new Set(m.segments.map((s) => s.anchor)).size === m.segments.length,
  m.segments.map((s) => s.anchor).join(' | '));
const survivors = m.segments.filter((s) => !ext.segments.some((e) => e.id === s.id));
t('保留的内置段全部是「锚点未被外部覆盖」的', survivors.every((s) => !extAnchors.has(s.anchor)),
  survivors.map((s) => s.anchor).join(', '));
// 保留的内置段不能与相邻外部段自相矛盾（1.0 段的能力状态应与 Classic 段一致）
const seg10 = m.segments.find((s) => s.anchor === '1.0');
if (seg10) {
  const classic = m.capsAt('c0.30_01c');
  const overlap = CAP_KEYS.filter((k) => seg10.caps[k] !== 'unsupported' || classic[k] !== 'unsupported');
  t('1.0 段的非 unsupported 能力与 Classic 段不矛盾',
    overlap.every((k) => !(seg10.caps[k] === 'unsupported' && classic[k] !== 'unsupported')),
    overlap.map((k) => `${k}:${seg10.caps[k]}/${classic[k]}`).join(' '));
}

console.log('\n=== 每个能力至少被赋值过（不能全 unsupported）===');
for (const k of CAP_KEYS) {
  const seen = new Set(m.segments.map((s) => s.caps[k]));
  t(`${k} 有多种状态（非恒定）`, seen.size > 1, `只有 ${[...seen].join(',')}`);
}

console.log('\n=== 关键版本的能力状态 ===');
const at = (v) => m.capsAt(v) || {};
const c263 = at('26.3');
t('26.3 components = ok', c263.components === 'ok', c263.components);
t('26.3 chatcommand = ok', c263.chatcommand === 'ok', c263.chatcommand);
t('26.3 itemPicker = ok', c263.itemPicker === 'ok', c263.itemPicker);

const c205 = at('1.20.5');
t('1.20.5 components = ok（组件起点）', c205.components === 'ok', c205.components);
t('1.20.5 nbt = degraded（物品 NBT 被组件取代）', c205.nbt === 'degraded', c205.nbt);

const c19 = at('1.19');
t('1.19 components = unsupported（组件还没出）', c19.components === 'unsupported', c19.components);

const c113 = at('1.13');
t('1.13 components = unsupported', c113.components === 'unsupported', c113.components);
t('1.13 itemPicker = ok（扁平化后可枚举）', c113.itemPicker === 'ok', c113.itemPicker);
t('1.13 entityPicker = ok', c113.entityPicker === 'ok', c113.entityPicker);

const c1122 = at('1.12.2');
t('1.12.2 itemPicker = unsupported', c1122.itemPicker === 'unsupported', c1122.itemPicker);
t('1.12.2 mcfunction = ok（函数 1.12 加入）', c1122.mcfunction === 'ok', c1122.mcfunction);
t('1.12.2 nbt = ok', c1122.nbt === 'ok', c1122.nbt);

const c172 = at('1.7.2');
t('1.7.2 nbt = partial（只有 /give dataTag）', c172.nbt === 'partial', c172.nbt);
t('1.7.2 itemPicker = unsupported', c172.itemPicker === 'unsupported', c172.itemPicker);

const c142 = at('1.4.2');
t('1.4.2 commandblock = ok（命令方块加入）', c142.commandblock === 'ok', c142.commandblock);

const cClassic = at('c0.30_01c');
t('Classic command = partial（只能聊天栏）', cClassic.command === 'partial', cClassic.command);
t('Classic chatcommand = ok', cClassic.chatcommand === 'ok', cClassic.chatcommand);
t('Classic nbt = unsupported', cClassic.nbt === 'unsupported', cClassic.nbt);

console.log('\n=== 旧 schema 仍然可用（回归）===');
const legacy = {
  segments: [{
    id: 'seg-legacy', title: '旧格式', anchor: '1.20.5', anchorType: 'release', date: '2024-04-23',
    change: 'x', caps: { nbt: 'degraded', components: 'ok', command: 'ok', mcfunction: 'ok',
      commandblock: 'ok', chatcommand: 'ok', itemPicker: 'ok', entityPicker: 'ok', particlePicker: 'ok' },
    subs: [], sources: [],
  }],
};
const m2 = new CapabilityMatrix(SEGMENTS, fakeIndex).merge(legacy);
t('旧 schema 的 caps 仍被读取', m2.capsAt('1.20.5').components === 'ok', m2.capsAt('1.20.5').components);

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══`);
process.exit(fail ? 1 : 0);
