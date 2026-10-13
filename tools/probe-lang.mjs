// probe-lang.mjs —— 诊断 jar 内语言表加载（英文名 bug 的取证）
import { readFileSync } from 'node:fs';
import { ZipReader } from '../src/core/zip.js';

const JARS = [
  'D:/minecraft/.minecraft/versions/26.3/26.3.jar',
  'D:/minecraft/.minecraft/versions/1.21.1/1.21.1.jar',
  'D:/minecraft/.minecraft/versions/BBS/BBS.jar',
];

for (const path of JARS) {
  try { readFileSync(path, { flag: 'r' }); } catch { continue; }
  const zip = new ZipReader(readFileSync(path));
  const langs = zip.list('assets/minecraft/lang/');
  console.log('=== ' + path + ' ===');
  console.log('  lang 条目:', langs.length, '| zh 相关:', langs.filter((p) => /zh/i.test(p)).join(', ') || '无');
  const zhPath = langs.find((p) => p.endsWith('zh_cn.json'));
  if (!zhPath) { console.log('  ❌ 没有 zh_cn.json'); continue; }
  try {
    const txt = await zip.readText(zhPath);
    const j = JSON.parse(txt);
    const keys = Object.keys(j);
    console.log('  zh_cn.json 字节:', txt.length, '| 键数:', keys.length);
    console.log('  抽样: stone=' + j['block.minecraft.stone'] + ' | diamond_sword=' + j['item.minecraft.diamond_sword']);
  } catch (e) {
    console.log('  ❌ 读取/解析失败:', e.message);
  }
}
