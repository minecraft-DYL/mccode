// nbt-labels 自检：不碰 DOM，纯数据层验证（可随时 node tools/nbt-labels-check.mjs）
import { nbtLookup, nbtLabel, nbtTypeLabel, searchNbtTags, NBT_TAGS, NBT_TAG_TYPES } from '../src/data/nbt-labels.js';

let bad = 0;
const show = (k, opt) => {
  const h = nbtLookup(k, opt);
  console.log(`${k}${opt ? ` (scope=${opt.scope})` : ''} → ${h ? `${h.name} [${h.type}] ${h.scope}` : '（未取证）'}`);
  return h;
};

console.log('== 抽样 ==');
for (const [k, o] of [
  ['CustomName'], ['Enchantments'], ['display'], ['Lore'], ['lvl'], ['HideFlags'],
  ['id'], ['Pos'], ['Motion'], ['Health'], ['FallDistance'],
  ['id', { scope: '物品' }], ['id', { scope: '容器方块实体' }],
  ['count'], ['Count'], ['components'], ['Items'], ['LootTable'],
  ['cooking_time_spent'], ['operation'], ['amplifier'], ['type'], ['自定义乱编的键'],
]) show(k, o);

console.log('\n== 类型名 ==');
for (const t of ['INT', 'int-array', 'bool', 'compound|string', 'list<compound>']) {
  console.log(`${t} → ${nbtTypeLabel(t)}`);
}

console.log('\n== 补全前缀 "en" ==');
for (const t of searchNbtTags('en', { limit: 8 })) console.log(`  ${t.key.padEnd(16)} ${t.name}  [${t.scope}]`);
console.log('== 补全前缀 "Custom" ==');
for (const t of searchNbtTags('Custom', { limit: 8 })) console.log(`  ${t.key.padEnd(22)} ${t.name}  [${t.scope}]`);
console.log('== 中文名搜索 "空气" ==');
for (const t of searchNbtTags('空气', { limit: 5 })) console.log(`  ${t.key.padEnd(16)} ${t.name}`);

console.log(`\n条目总数 ${NBT_TAGS.length}；类型 ${NBT_TAG_TYPES.length}`);
const noSince = NBT_TAGS.filter((t) => t.since == null).length;
console.log(`since 为 null（未取证）: ${noSince}/${NBT_TAGS.length}`);

// 一致性断言：每条都要有 key/name/type/scope/desc
for (const t of NBT_TAGS) {
  if (!t.key || !t.name || !t.type || !t.scope || !t.desc) { console.log('❌ 字段缺失: ' + JSON.stringify(t).slice(0, 120)); bad++; }
}
console.log(bad ? `\n❌ ${bad} 条字段缺失` : '\n✅ 全部条目字段完整');
