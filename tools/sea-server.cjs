#!/usr/bin/env node
// sea-server.cjs —— MC 编辑器单文件 exe 的内置静态服务器
//
// 【为什么是 .cjs】Node 的 SEA 把 main 脚本当 CommonJS 执行（embedderRunCjs），
// 用 ESM 写会直接 `SyntaxError: Cannot use import statement outside a module`。
// 实测踩过，所以这里固定 CommonJS，且不依赖 package.json 的 "type"。
//
// 为什么需要服务器：本编辑器是纯静态 ES module 站点，浏览器用 file:// 打开会因
// 模块加载策略直接失效，必须经由 HTTP 提供。
//
// 两种模式：
//   1) SEA（打包成 exe 后）：站点文件作为 assets 内嵌，从内存读出，不依赖外部目录。
//   2) dev（node tools/sea-server.cjs）：从磁盘读，仅用于本地调试。
//
// 用法：
//   MC编辑器.exe                 —— 起服务并自动打开浏览器
//   MC编辑器.exe --port 9000     —— 指定端口
//   MC编辑器.exe --no-open       —— 不自动开浏览器（测试用）
//   MC编辑器.exe --dir <路径>    —— dev 模式指定站点根目录

'use strict';

const { createServer } = require('node:http');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { join, normalize, extname, resolve, sep, dirname } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

/**
 * Windows 控制台默认代码页是 936(GBK)，而 Node 往 stdout 写的是 UTF-8 字节，
 * 双击 exe 时中文会显示成乱码。这里在打印 banner 之前把控制台切到 65001。
 * chcp 改的是「控制台」的属性（不是进程），子进程退出后依然生效。
 * 用 stdio inherit + >nul：既共享父进程的控制台，又不让它多打印一行。
 * 切不了也不影响服务本身，静默放过。
 */
function fixConsoleCodepage() {
  if (process.platform !== 'win32') return;
  try { spawnSync('cmd', ['/c', 'chcp 65001 >nul'], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }); }
  catch { /* 忽略：最坏情况只是 banner 中文花掉，URL 本身是 ASCII 仍可读 */ }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.mcmeta': 'application/json; charset=utf-8',
  '.mcfunction': 'text/plain; charset=utf-8',
  '.lang': 'text/plain; charset=utf-8',
};

/* ---------------- 参数 ---------------- */
function argOf(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const wantPort = parseInt(argOf('--port') || '', 10);
const noOpen = process.argv.includes('--no-open');
const devDirArg = argOf('--dir');

/* ---------------- SEA 资产层 ---------------- */
let sea = null;
try { sea = require('node:sea'); } catch { sea = null; }
const isSea = !!(sea && typeof sea.isSea === 'function' && sea.isSea());

// dev 模式的站点根目录；SEA 模式下不用它
let DEV_ROOT = resolve(devDirArg || process.cwd());
if (!isSea && !devDirArg) DEV_ROOT = resolve(join(__dirname, '..'));

/** 归一化成资产键：始终用正斜杠、不含前导 ./ */
function toKey(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

// 构建产物与工程文件不对外提供（dev 模式防手滑；SEA 模式下本来也不在 assets 里，属纵深防御）
const DENY_EXACT = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', '启动.bat', '启动.cmd']);
const DENY_PREFIX = ['tools/', 'node_modules/', '.git/', '.shots/', '.vscode/', 'dist/'];
function isDenied(key) {
  if (DENY_EXACT.has(key)) return true;
  if (key.split('/').some((seg) => seg.startsWith('.'))) return true;   // 任何点开头段
  return DENY_PREFIX.some((p) => key.startsWith(p));
}

function loadFile(key) {
  const k = toKey(key);
  if (isDenied(k)) return null;

  if (isSea) {
    let keys = [];
    try { keys = sea.getAssetKeys(); } catch { keys = []; }
    if (!keys.includes(k)) return null;
    // 文本资源按 UTF-8 取；二进制（图标等）走 ArrayBuffer
    try { return Buffer.from(sea.getAsset(k, 'utf8'), 'utf8'); }
    catch { try { return Buffer.from(sea.getAsset(k)); } catch { return null; } }
  }

  // dev：从磁盘读，且必须锁在 DEV_ROOT 内，防目录穿越
  const abs = normalize(join(DEV_ROOT, k));
  if (abs !== DEV_ROOT && !abs.startsWith(DEV_ROOT + sep)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return readFileSync(abs);
}

/* ---------------- 服务器 ---------------- */
const server = createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    let path = decodeURIComponent(u.pathname);
    if (path === '/' || path === '') path = '/index.html';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('405 只接受 GET');
      return;
    }

    const key = toKey(path);
    let body = loadFile(key);
    if (!body && !extname(key)) body = loadFile(key + '/index.html');   // 目录索引

    if (!body) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>404</title>'
        + '<body style="font-family:system-ui;padding:40px">'
        + '<h1>404</h1><p>没有这个文件：<code>' + key.replace(/[<>&]/g, '') + '</code></p>'
        + '<p><a href="/">回到编辑器</a></p>');
      return;
    }

    const type = MIME[extname(key).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 ' + (err && err.message ? err.message : String(err)));
  }
});

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* 打不开就让用户手点链接 */ }
}

const listenPort = Number.isFinite(wantPort) && wantPort > 0 ? wantPort : 0;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n端口 ' + listenPort + ' 已被占用。换一个：MC编辑器.exe --port ' + (listenPort + 1) + '\n');
  } else {
    console.error('\n服务启动失败：', (err && err.message) ? err.message : err, '\n');
  }
  process.exitCode = 1;
});

server.listen(listenPort, '127.0.0.1', () => {
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/';
  let assetCount = 0;
  try { assetCount = isSea ? sea.getAssetKeys().length : 0; } catch { assetCount = 0; }

  fixConsoleCodepage();

  console.log('');
  console.log('  MC 编辑器 已启动');
  console.log('  --------------------------------------------');
  console.log('  地址    ' + url);
  console.log('  模式    ' + (isSea ? '单文件 exe（内嵌 ' + assetCount + ' 个文件）' : '开发模式（读磁盘 ' + DEV_ROOT + '）'));
  console.log('  --------------------------------------------');
  console.log('  关掉这个窗口或按 Ctrl+C 即停止服务。');
  console.log('');

  if (!noOpen) openBrowser(url);
});

process.on('SIGINT', () => { console.log('\n已停止。'); server.close(() => process.exit(0)); });
