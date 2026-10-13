// main.js —— 应用入口

import { state, subscribe, notify, setTheme, initVersions, loadRegistry, pushStatus, setVersion, capsOf, capStatus, capAvailable, capLabel, versionLabel } from './core/store.js';
import { mount } from './ui/shell.js';
import { supportsZip } from './core/zip.js';

/** file:// 下 ES Module 与 fetch 会被 CORS 拦，直接白屏。给一句人话解释。 */
function fileProtocolNotice() {
  const host = document.getElementById('app') || document.body;
  const dir = decodeURIComponent(location.pathname).replace(/[\\/][^\\/]*$/, '');
  host.innerHTML = `
  <div style="max-width:780px;margin:9vh auto;padding:0 24px;font:14px/1.85 'Segoe UI Variable','Segoe UI',system-ui;color:#e8e8e8">
    <h1 style="font-size:23px;margin:0 0 8px">需要通过 HTTP 打开</h1>
    <p style="color:#9aa0a6;margin:0 0 22px">
      当前是 <code style="background:#2a2a2e;padding:1px 6px;border-radius:4px">file://</code> 协议。
      浏览器的 ES Module 与 fetch 在这个协议下会被 CORS 策略拦截，所以页面起不来。
    </p>
    <div style="background:#1b1b1f;border:1px solid #34343a;border-radius:10px;padding:15px 18px;font-family:Consolas,'Cascadia Mono',monospace;font-size:13px;line-height:1.9">
      <div style="color:#7a7a82"># 在项目目录下启动一个静态服务</div>
      cd &quot;${dir}&quot;<br>
      python -m http.server 8777 --bind 127.0.0.1
    </div>
    <p style="color:#9aa0a6;margin-top:18px">
      然后访问 <b style="color:#4cc2ff">http://127.0.0.1:8777/</b>
      &nbsp;（没有 Python 的话可用 <code style="background:#2a2a2e;padding:1px 6px;border-radius:4px">npx serve -l 8777</code>）
    </p>
  </div>`;
}

async function boot() {
  if (location.protocol === 'file:') { fileProtocolNotice(); return; }

  setTheme(state.theme || 'dark');

  if (!supportsZip) {
    pushStatus('当前浏览器不支持 DecompressionStream：jar 数据源与 .dat 解压将不可用（建议 Chrome / Edge 103+）', 'warning');
  }

  mount();

  try {
    await initVersions({});
  } catch (e) {
    pushStatus('版本清单初始化失败：' + e.message, 'error');
  }
  notify('navigate');

  // 若之前已检索过同一版本，直接复用内存缓存（不重复请求）
  if (state.registry && state.registry.version === state.version) notify('registry');
}

window.addEventListener('error', (e) => {
  pushStatus(`运行错误：${e.message} @ ${e.filename}:${e.lineno}`, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  pushStatus(`未处理的 Promise 拒绝：${e.reason && e.reason.message ? e.reason.message : e.reason}`, 'error');
});

// 暴露给调试与自动化测试
// versionOrder / packFormat 等纯函数可从 core 模块按需 import，这里只暴露运行时状态与动作
window.__MCE__ = {
  state, notify, subscribe, initVersions, loadRegistry,
  setVersion, capsOf, capStatus, capAvailable, capLabel, versionLabel,
  /** 切页（自动化测试与调试用；hashchange 监听会自动重渲染） */
  goto(page) { location.hash = '#' + page; },
};

boot();
