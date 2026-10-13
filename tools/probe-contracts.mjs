// probe-contracts.mjs —— 取证：把 validate.js 依赖的每个跨模块函数的【真实返回形状】打出来
//
// 为什么要有这个文件：连着两个 bug 都是照着假想的返回形状写消费代码造成的
// （parseSNBT 实际返回 {ok,error,value}；tokenizeCommand 实际不返回 string[]）。
// 所以凡是要消费别的模块的返回值，先用这个脚本看真的长什么样，再写代码。
//
// 用法：node tools/probe-contracts.mjs

import { tokenizeCommand, commandName, findCommand, formFor, commandAvailable, stackSyntax } from '../src/core/commands.js';
import { parseSNBT } from '../src/core/nbt.js';

function head(s) {
  const t = JSON.stringify(s);
  return t && t.length > 200 ? t.slice(0, 200) + '…' : t;
}

console.log('==================== tokenizeCommand ====================');
for (const cmd of [
  'give @s minecraft:stone',
  'give @s minecraft:stone 64',
  'give @s minecraft:stone[custom_name="x"]',
  'execute as @s run say hi',
]) {
  const r = tokenizeCommand(cmd);
  console.log(`  in : ${cmd}`);
  console.log(`  out: ${head(r)}`);
  console.log(`  type: ${Array.isArray(r) ? 'array len=' + r.length : typeof r}`);
  if (Array.isArray(r)) {
    r.forEach((t, i) => console.log(`    [${i}] ${typeof t} = ${head(t)}`));
  }
  console.log('');
}

console.log('==================== commandName ====================');
for (const cmd of ['give @s x', '/give @s x', '  tp @s 0 0 0  ', 'notacommand', '']) {
  console.log(`  in ${JSON.stringify(cmd)} -> ${head(commandName(cmd))} (${typeof commandName(cmd)})`);
}

console.log('');
console.log('==================== findCommand ====================');
for (const n of ['give', 'damage', 'notacommand', '']) {
  const c = findCommand(n);
  console.log(`  ${JSON.stringify(n)} -> ${c ? 'found' : 'null'}  keys=${c ? Object.keys(c).join(',') : '-'}`);
  if (c) console.log(`     since=${head(c.since)} until=${head(c.until)} forms=${Array.isArray(c.forms) ? c.forms.length : typeof c.forms} category=${head(c.category)}`);
}

console.log('');
console.log('==================== formFor / commandAvailable / stackSyntax ====================');
for (const [ver, name] of [['1.20.5', 'give'], ['1.12.2', 'give'], ['1.12.2', 'damage'], ['1.20.5', 'damage']]) {
  const c = findCommand(name);
  const f = c ? formFor(c, ver) : null;
  const a = c ? commandAvailable(c, ver) : null;
  console.log(`  ${ver} /${name}: available=${a} form=${f ? head(f.syntax) : 'null'} args=${f && Array.isArray(f.args) ? head(f.args) : '-'}`);
}
for (const v of ['1.12.2', '1.20.5', '1.21.2']) console.log(`  stackSyntax(${v}) = ${head(stackSyntax(v))}`);

console.log('');
console.log('==================== parseSNBT ====================');
for (const s of ['{rgb:99999999}', '{levels:{"minecraft:sharpness":5}}', '[{"text":"x"}]', '5', '"hi"', 'true', '{bad', '']) {
  let r; let threw = null;
  try { r = parseSNBT(s); } catch (e) { threw = e.message; }
  console.log(`  in ${JSON.stringify(s)}`);
  console.log(`     ${threw ? 'THREW: ' + threw : head(r)}`);
  if (!threw && r && typeof r === 'object' && 'ok' in r) console.log(`     ok=${r.ok} value=${head(r.value)} err=${head(r.error)}`);
  console.log('');
}
