#!/usr/bin/env node
// build-exe.mjs —— 用 Node 26 自带的 --build-sea 打单文件 exe
//
// 为什么走 SEA：Node 26 的 `node --build-sea=config.json` 一步完成「生成 blob + 注入可执行文件」，
// 不再需要 postject，也不依赖 NSIS / csc / electron 这些外部工具链。
//
// 【踩过的坑】SEA 把 main 脚本当 CommonJS 执行，所以主程序必须是 .cjs（见 sea-server.cjs），
// 否则运行时报 `Cannot use import statement outside a module`。
// 另外本文件的前导 shebang 要求文件不能带 UTF-8 BOM，所以不要用 PowerShell 的
// `Set-Content -Encoding utf8` 回写本文件（会插 BOM，并顺带按 ANSI 读坏中文）。
//
// 产物：dist/MC编辑器.exe —— 内置静态服务器 + 全部站点文件（内嵌 assets），双击即用。
//
// 用法：node tools/build-exe.mjs

import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, sep, extname, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..'));
const DIST = join(ROOT, 'dist');
const OUT_EXE = join(DIST, 'MC编辑器.exe');
const CONFIG = join(DIST, 'sea-config.json');
const MAIN = join(ROOT, 'tools', 'sea-server.cjs');

/** 需要内嵌进 exe 的站点内容 */
// ⚠️ data/ 必须内嵌。capabilities.js 会在运行时 fetch('data/version-segments.json')，
// 少打这个目录 exe 里就会 404 → 静默退回内置基线（11 段），
// 那份 wiki 逐条取证的 27 段数据（含 5 处对已知起点的更正）在 exe 里等于不存在，而且不报错。
const INCLUDE_DIRS = ['src', 'data'];
const INCLUDE_FILES = ['index.html'];

/** 不内嵌的东西 */
// 注意：data/ 下有 version-segments.schema1-backup.json 这类备份，属于开发过程产物，不打进去。
const SKIP_EXT = new Set(['.map']);
const SKIP_DIR = new Set(['node_modules', '.git', '.shots', 'dist']);
const SKIP_FILE_SUFFIX = ['-backup.json', '.bak'];
// data/wiki/** 只是取证留档（303 个原始 wikitext 文件、约 4 MB），运行时没有任何代码读它
// ——已 grep 确认 src/ 内零引用，运行时只 fetch data/version-segments.json。
// 不排除的话 exe 会白白胖 7.8 MB。
const SKIP_REL_DIRS = new Set(['data/wiki']);

function walk(absDir, out) {
  for (const name of readdirSync(absDir)) {
    if (SKIP_DIR.has(name)) continue;
    const abs = join(absDir, name);
    if (SKIP_REL_DIRS.has(toPosix(relative(ROOT, abs)))) continue;
    const st = statSync(abs);
    if (st.isDirectory()) { walk(abs, out); continue; }
    if (SKIP_EXT.has(extname(name).toLowerCase())) continue;
    if (SKIP_FILE_SUFFIX.some((sx) => name.toLowerCase().endsWith(sx))) continue;
    if (name.startsWith('.')) continue;
    out.push(abs);
  }
  return out;
}

const toPosix = (p) => p.split(sep).join('/');

/* ---------------- 1. 收集资产 ---------------- */
if (!existsSync(MAIN)) { console.error(`缺少主程序：${MAIN}`); process.exit(1); }

const files = [];
for (const f of INCLUDE_FILES) {
  const abs = join(ROOT, f);
  if (!existsSync(abs)) { console.error(`缺少必需文件：${f}`); process.exit(1); }
  files.push(abs);
}
for (const d of INCLUDE_DIRS) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) { console.error(`缺少必需目录：${d}`); process.exit(1); }
  walk(abs, files);
}

const assets = {};
let totalBytes = 0;
for (const abs of files) {
  const key = toPosix(relative(ROOT, abs));
  assets[key] = abs;
  totalBytes += statSync(abs).size;
}

// 护栏：内嵌的站点文件不能带 UTF-8 BOM。
// 成因：PowerShell 的 `Set-Content -Encoding utf8`（PS 5.1）会静默写入 BOM。
// 危害：磁盘字节数 ≠ exe 提供字节数（实测 index.html 3629 vs 3626），
// 且 `.mjs`/`.cjs` 前面的 BOM 会破坏 shebang。
// 这里只警告不中止——BOM 不会让功能坏掉，但会让「逐字节一致」这类验收永远对不上。
const bomFiles = [];
for (const [key, abs] of Object.entries(assets)) {
  const fd = openSync(abs, 'r');
  const head = Buffer.alloc(3);
  try { readSync(fd, head, 0, 3, 0); } finally { closeSync(fd); }
  if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) bomFiles.push(key);
}
if (bomFiles.length) {
  console.warn(`\n⚠️  以下内嵌文件带 UTF-8 BOM（会让磁盘体积与 exe 提供的体积对不上，建议剥掉）：`);
  for (const f of bomFiles) console.warn(`     ${f}`);
  console.warn('   剥离方法（字节级，不要走 PowerShell 字符串）：');
  console.warn("     $b=[IO.File]::ReadAllBytes($p); $o=New-Object byte[] ($b.Length-3);");
  console.warn("     [Array]::Copy($b,3,$o,0,$o.Length); [IO.File]::WriteAllBytes($p,$o)\n");
}

console.log(`收集到 ${Object.keys(assets).length} 个站点文件，合计 ${(totalBytes / 1024).toFixed(1)} KB`);

/* ---------------- 2. 生成 SEA 配置 ---------------- */
mkdirSync(DIST, { recursive: true });
const config = {
  main: MAIN,
  output: OUT_EXE,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
writeFileSync(CONFIG, JSON.stringify(config, null, 2), 'utf8');
console.log(`已写出 SEA 配置：${CONFIG}`);

/* ---------------- 3. 调用 node --build-sea ---------------- */
console.log('正在构建 exe（Node SEA）…');
const t0 = Date.now();
try {
  const out = execFileSync(process.execPath, [`--build-sea=${CONFIG}`], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (out && out.trim()) console.log(out.trim());
} catch (err) {
  console.error('构建失败：');
  if (err && err.stdout) console.error(String(err.stdout));
  if (err && err.stderr) console.error(String(err.stderr));
  if (!err.stdout && !err.stderr) console.error(err && err.message ? err.message : err);
  process.exit(1);
}

if (!existsSync(OUT_EXE)) {
  console.error('构建命令返回成功，但没找到产物：' + OUT_EXE);
  process.exit(1);
}
const size = statSync(OUT_EXE).size;
console.log('');
console.log(`构建完成：${OUT_EXE}`);
console.log(`大小 ${(size / 1024 / 1024).toFixed(1)} MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('双击即可运行；启动后会在 127.0.0.1 上选一个空闲端口并自动打开浏览器。');
