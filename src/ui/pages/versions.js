// pages/versions.js —— 版本选择（一切的前置）+ 数据源与注册表检索

import { h, clear, fmtNum, bytes, esc } from '../../core/util.js';
import { state, notify, setVersion, loadRegistry, pushStatus, versionLabel, registryCacheSummary, clearAllRegistryCache, registryWarmupStatus, setAutoRetrieve } from '../../core/store.js';
import { parseVersion, channelName, isPreRelease } from '../../core/versions.js';
import { CAPABILITIES, STATUS_LABEL } from '../../core/capabilities.js';
import { SOURCE_LABEL, pickJars, readHandle, jarIdFromName } from '../../core/registry.js';
import { button, combo, textBox, infoBar, badge, statCard, progressRing, toggleSwitch, emptyState, toast, codeBlock, icon } from '../controls.js';

/**
 * 会自己显示忙碌态的按钮。
 * 为什么不靠 state.registryBusy 重渲染：`registry:busy` 通知只会刷新状态栏，
 * 页面不会重建，于是按钮既不变成「检索中…」也不禁用 —— 用户看到的就是「点了没反应」。
 * 缓存命中时整个检索瞬间返回，这个观感问题尤其明显。所以忙碌态由按钮自己管。
 */
function busyButton({ label, busyLabel = '检索中…', variant = 'default', iconName = null, title = '', onRun }) {
  const el = button({ label, variant, small: true, iconName, title });
  el.__busy = false;
  el.addEventListener('click', async () => {
    if (el.__busy) return;
    el.__busy = true;
    el.disabled = true;
    el.classList.add('is-busy');
    clear(el);
    el.appendChild(progressRing(14));
    el.appendChild(h('span', { text: busyLabel }));
    try { await onRun(); }
    finally {
      el.__busy = false;
      el.disabled = false;
      el.classList.remove('is-busy');
      clear(el);
      if (iconName) el.appendChild(icon(iconName, 14));
      el.appendChild(h('span', { text: label }));
    }
  });
  return el;
}

export const meta = {
  id: 'versions',
  title: '版本选择',
  subtitle: '选择 Minecraft Java 版版本 —— 编辑器其余所有能力的总开关',
  icon: 'layers',
};

export function render(root) {
  clear(root);
  const idx = state.versionIndex;

  if (!idx) {
    root.appendChild(infoBar({ level: 'warning', title: '版本清单尚未就绪', text: '正在从 Mojang 拉取版本清单，请稍候；若长时间无响应，可点击左下角刷新按钮重试。' }));
    root.appendChild(h('div', { style: { display: 'flex', justifyContent: 'center', padding: '40px' } }, progressRing(34, 'lg')));
    return;
  }

  /* ---------- 当前版本 + 能力摘要 ---------- */
  const caps = state.matrix ? state.matrix.capsAt(state.version) : null;
  const seg = state.matrix ? state.matrix.segmentAt(state.version) : null;
  const capBadges = h('div.row');
  for (const cap of CAPABILITIES) {
    const st = caps ? caps[cap.key] : 'unsupported';
    const b = badge(`${cap.name} · ${STATUS_LABEL[st]}`, st === 'ok' ? 'ok' : st === 'partial' ? 'partial' : st === 'degraded' ? 'degraded' : 'no');
    b.title = cap.desc;
    capBadges.appendChild(b);
  }

  const currentCard = h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: `当前版本：${state.version || '未选择'}` }),
        h('p.card-sub', { text: state.version ? `${channelName(parseVersion(state.version).kind)} · 所在分段「${seg ? seg.title : '—'}」` : '' }),
      ]),
      h('div.row', null, [
        button({ label: '跳到最新正式版', variant: 'default', small: true, iconName: 'clock', onClick: () => setVersion(idx.latest.release) }),
        button({ label: '刷新清单', variant: 'subtle', small: true, iconName: 'reload', onClick: () => reloadIndex() }),
      ]),
    ]),
    h('div.row', { style: { marginTop: '4px' } }, capBadges),
    seg ? h('p.tiny.muted', { style: { margin: '10px 0 0', lineHeight: '1.6' }, text: seg.change }) : null,
  ]);
  root.appendChild(currentCard);

  /* ---------- 两栏：版本树 + 数据源 ---------- */
  const grid = h('div.grid-2');
  grid.appendChild(versionPickerCard());
  grid.appendChild(registryCard());
  root.appendChild(grid);

  /* ---------- 能力对照（当前版本 vs 分段） ---------- */
  root.appendChild(capTableCard(caps, seg));
}

function reloadIndex() {
  (async () => {
    const { initVersions } = await import('../../core/store.js');
    try {
      await initVersions({ force: true });
      notify('versions');
      toast('版本清单已刷新');
    } catch (e) { toast('刷新失败：' + e.message, 'error'); }
  })();
}

/* ============================ 版本树 ============================ */

let versionFilter = { q: '', type: 'all' };

function versionPickerCard() {
  const idx = state.versionIndex;
  const list = h('div', { style: { maxHeight: '560px', overflow: 'auto', marginTop: '8px' } });
  const totalHint = h('div.tiny.muted');

  /** 只重画版本列表，不重建输入框（否则输入即失焦） */
  function fillList() {
    const groups = idx.groupByMajor({ includeSnapshots: versionFilter.type !== 'release' });
    const filtered = groups.map((g) => ({
      ...g,
      items: g.items.filter((v) => {
        if (versionFilter.type === 'release' && v.type !== 'release') return false;
        if (versionFilter.type === 'snapshot' && v.type === 'release') return false;
        if (versionFilter.q) {
          const q = versionFilter.q.toLowerCase();
          if (!v.id.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
    })).filter((g) => g.items.length);

    clear(list);
    const curMajor = state.version ? state.version.replace(/^(\d+(?:\.\d+)?).*$/, '$1').replace(/^(\d+\.\d+)(\.\d+)?$/, '$1') : '';
    /** 一个桶的徽标流（正式版 / 开发版共用） */
    function bucketRow(items) {
      const wrap = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 4px 10px 14px' } });
      for (const v of items) {
        const isCur = v.id === state.version;
        const b = h('span', {
          class: 'badge' + (isCur ? ' accent' : isPreRelease(v.id) ? '' : ' ok'),
          title: `${v.id} · ${channelName(v.type)} · ${new Date(v.releaseTime).toLocaleDateString('zh-CN')}`,
          style: { cursor: 'default', padding: '3px 9px' },
          text: v.id,
        });
        b.addEventListener('click', async () => {
          await setVersion(v.id);
          notify('version');
          toast(`已切换到 ${v.id}`);
        });
        wrap.appendChild(b);
      }
      return wrap;
    }

    for (const g of filtered) {
      const open = versionFilter.q ? true : g.label === curMajor || g.items.some((v) => v.id === state.version);
      const det = h('details', { style: { marginBottom: '2px' } });
      if (open) det.setAttribute('open', '');
      const sum = h('summary', { style: { cursor: 'default', padding: '7px 8px', borderRadius: '6px', fontSize: '13px', fontWeight: '600' } });
      sum.appendChild(h('span', { text: `${g.label} 系列` }));

      // 同一个大版本里正式版与快照/预发布混在一起很难扫读，按通道拆开
      const rel = g.items.filter((v) => v.type === 'release');
      const dev = g.items.filter((v) => v.type !== 'release');
      sum.appendChild(h('span.badge', { style: { marginLeft: '8px' }, text: rel.length && dev.length ? `${rel.length} 正式 + ${dev.length} 开发` : `${g.items.length}` }));
      det.appendChild(sum);

      if (rel.length) det.appendChild(bucketRow(rel));

      if (dev.length) {
        const hasCur = dev.some((v) => v.id === state.version);
        const bd = h('details', { style: { marginLeft: '12px' } });
        // 只有开发版时直接展开；否则默认折叠，但当前版本在里面或正在搜索时自动展开
        if (!rel.length || hasCur || versionFilter.q) bd.setAttribute('open', '');
        const bs = h('summary', { style: { cursor: 'default', padding: '4px 6px', fontSize: '12px', color: 'var(--text-secondary)' } });
        bs.appendChild(h('span', { text: '开发版（快照 / 预发布 / 候选 / 愚人节）' }));
        bs.appendChild(h('span.badge', { style: { marginLeft: '6px' }, text: `${dev.length}` }));
        bd.appendChild(bs);
        bd.appendChild(bucketRow(dev));
        det.appendChild(bd);
      }

      list.appendChild(det);
    }
    if (!filtered.length) list.appendChild(emptyState('没有匹配的版本', '换个关键词，或把类型过滤改为「全部」'));

    const shown = filtered.reduce((n, g) => n + g.items.length, 0);
    totalHint.textContent = (versionFilter.q || versionFilter.type !== 'all')
      ? `匹配 ${fmtNum(shown)} 个 / 共 ${fmtNum(idx.versions.length)} 个版本`
      : `共 ${fmtNum(idx.versions.length)} 个版本`;
  }

  const tb = textBox({
    placeholder: '搜索版本号，如 1.20.5 / 26.3 / snapshot',
    onInput: () => { versionFilter.q = tb.value.trim(); fillList(); },
  });
  tb.value = versionFilter.q;
  setTimeout(fillList, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '选择版本' }),
      totalHint,
    ]),
    h('div.row', null, [
      h('div', { style: { flex: '1', minWidth: '180px' } }, tb),
      combo({
        options: [{ value: 'all', label: '全部类型' }, { value: 'release', label: '仅正式版' }, { value: 'snapshot', label: '仅开发版' }],
        value: versionFilter.type,
        onChange: (v) => { versionFilter.type = v; fillList(); },
      }),
    ]),
    list,
    h('p.tiny.muted', { style: { marginTop: '8px' }, text: '提示：26.x 是新的「年份.序号」版本号体系；快照/预发布/候选版同样可作为编辑目标。' }),
  ]);
}

function rootOf(el) { return el.closest('.page-view') || document.getElementById('pageView'); }
function renderCurrent() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }
function debounced(fn) { let t; return () => { clearTimeout(t); t = setTimeout(fn, 220); }; }

/* ============================ 数据源与注册表 ============================ */

function registryCard() {
  const reg = state.registry;
  const busy = state.registryBusy;

  const statRow = h('div.grid-3', { style: { marginTop: '10px' } }, [
    statCard('物品', reg ? fmtNum(reg.items.length) : '—'),
    statCard('实体', reg ? fmtNum(reg.entities.length) : '—'),
    statCard('粒子', reg ? fmtNum(reg.particles.length) : '—'),
  ]);

  const log = h('div.code', { style: { maxHeight: '170px', marginTop: '10px' } });
  log.innerHTML = state.status.slice(0, 14).map((s) => {
    const color = { error: '#ff8a80', warning: '#ffcc80', success: '#b5e8a0' }[s.level] || 'var(--text-secondary)';
    return `<div style="color:${color}">${new Date(s.at).toLocaleTimeString('zh-CN')} · ${esc(s.text)}</div>`;
  }).join('') || '<span class="muted">暂无日志</span>';

  /* ---- 缓存占用面板 ---- */
  const cacheInfo = h('div.tiny.muted', { style: { marginTop: '6px' } });

  async function renderCacheInfo() {
    clear(cacheInfo);
    const warm = registryWarmupStatus ? registryWarmupStatus() : null;
    const warmText = warm && warm.status && warm.status !== 'idle'
      ? `　·　启动预热：${{ running: '进行中', done: '已完成', failed: '失败（已静默）', cancelled: '已取消', idle: '未开始' }[warm.status] || warm.status}`
      : '';
    try {
      const s = await registryCacheSummary();
      if (!s || !s.count) {
        cacheInfo.appendChild(h('span', { text: `缓存：空（尚未检索过，或已被清理）${warmText}` }));
        return;
      }
      cacheInfo.appendChild(h('span', {
        text: `缓存：${s.count} 个版本（基线 ${s.fullCount} · 增量 ${s.deltaCount}`
          + `${s.staleCount ? ` · 待重建 ${s.staleCount}` : ''}`
          + `${s.unknownCount ? ` · 未取证 ${s.unknownCount}` : ''}）`
          + `　·　占用 ${bytes(s.entryBytes)}`
          + `　·　若全量存储需 ${bytes(s.fullDataBytes)}（省 ${s.savingRatio}×，引擎 ${s.engine}）`
          + warmText,
      }));
    } catch (e) {
      cacheInfo.appendChild(h('span', { text: `缓存统计失败：${e.message}` }));
    }
  }
  setTimeout(() => { void renderCacheInfo(); }, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '数据源与注册表检索' }),
      busy ? progressRing(16) : (reg ? badge('已就绪', 'ok') : badge('未检索', 'no')),
    ]),
    h('p.card-sub', { text: '物品 / 实体 / 粒子的 ID、显示名与图标都会按当前版本重新检索。' }),

    h('div.row', { style: { marginTop: '10px' } }, [
      combo({
        options: [
          { value: 'github', label: SOURCE_LABEL.github },
          { value: 'remotejar', label: SOURCE_LABEL.remotejar },
          { value: 'localjar', label: SOURCE_LABEL.localjar },
        ],
        value: state.registrySource,
        onChange: (v) => { state.registrySource = v; toast(`数据源已切换为：${SOURCE_LABEL[v]}`); },
      }),
      busyButton({
        label: '开始检索', busyLabel: '检索中…', variant: 'accent', iconName: 'reload',
        title: '按当前数据源检索物品 / 实体 / 粒子；命中缓存会很快返回',
        onRun: async () => { await loadRegistry({}); renderCurrent(); },
      }),
      busyButton({
        label: '强制重新检索', busyLabel: '重新检索中…', variant: 'default', iconName: 'reload',
        title: '忽略缓存，重新从数据源拉取全部列表',
        onRun: async () => { await loadRegistry({ force: true }); renderCurrent(); },
      }),
    ]),
    h('div.row', { style: { marginTop: '8px' } }, [
      busyButton({
        label: '选择本机 jar 文件（支持 mod jar）', busyLabel: '读取 jar 中…', variant: 'default', iconName: 'box',
        onRun: () => chooseLocalJar(),
      }),
      h('span.tiny.muted', { text: '本机 jar 兜底：网络不可达或版本过于特殊时使用' }),
    ]),

    h('div.row', { style: { marginTop: '8px', alignItems: 'center' } }, [
      toggleSwitch({
        label: '切换版本后自动检索',
        checked: state.autoRetrieve !== false,
        onChange: (v) => { setAutoRetrieve(v); renderCurrent(); },
      }),
      h('span.tiny.muted', {
        text: state.autoRetrieve !== false
          ? '切到新版本会立刻按该版本重新拉物品 / 实体 / 粒子（命中缓存约 10 毫秒，首次约 3 秒）'
          : '已关闭：切版本只改版本号，物品列表保持不变，直到你手动点「开始检索」',
      }),
    ]),

    statRow,
    reg ? h('p.tiny.muted', { style: { marginTop: '8px' }, text: `数据源：${SOURCE_LABEL[reg.source] || reg.source}${reg.note ? ' · ' + reg.note : ''}` }) : null,
    reg ? h('div.row', { style: { marginTop: '4px' } }, [
      button({ label: '查看物品', variant: 'subtle', small: true, onClick: () => { state.page = 'pickers'; state.pickerKind = 'items'; notify('navigate'); } }),
      button({ label: '查看实体', variant: 'subtle', small: true, onClick: () => { state.page = 'pickers'; state.pickerKind = 'entities'; notify('navigate'); } }),
      button({ label: '查看粒子', variant: 'subtle', small: true, onClick: () => { state.page = 'pickers'; state.pickerKind = 'particles'; notify('navigate'); } }),
    ]) : null,

    // —— 缓存管理 ——
    // 用户要求「检索会缓存，下次同版本不用重检；当然可以删掉 temp」。
    // 之前只有 store.js 的 API，没有入口，用户没法自己删。这里补上。
    h('div.row', { style: { marginTop: '10px' } }, [
      busyButton({
        label: '查看缓存占用', busyLabel: '统计中…', variant: 'subtle', iconName: 'layers',
        title: '查看各版本增量缓存的占用、基线链与相对全量存储省了多少',
        onRun: async () => { await renderCacheInfo(); },
      }),
      busyButton({
        label: '清理全部缓存', busyLabel: '清理中…', variant: 'default', iconName: 'trash',
        title: '删掉全部 temp 缓存；删除后下次检索会重新走网络，仍然可用',
        onRun: async () => {
          try {
            const r = await clearAllRegistryCache();
            const n = (r && r.removed) || 0;
            toast(n ? `已清理 ${n} 个缓存条目（${(r && r.engine) || '内存'}）` : '本来就没有缓存条目', n ? 'success' : 'info');
          } catch (e) {
            toast('清理失败：' + e.message, 'error');
          }
          await renderCacheInfo();
        },
      }),
    ]),
    cacheInfo,

    h('div.card-title', { style: { fontSize: '13px', marginTop: '14px' }, text: '检索日志' }),
    log,
  ]);
}

async function chooseLocalJar() {
  try {
    // ① File System Access：直接选 .jar 文件（原版 jar 与 mod jar 都行）
    if (window.showOpenFilePicker) {
      const res = await pickJars();
      if (!res.entries.length) return;
      let picked = res.entries[0];
      if (res.entries.length > 1) {
        const { dialog } = await import('../controls.js');
        const list = h('div.list');
        let sel = null;
        for (const e of res.entries) {
          const li = h('div.li', { style: { cursor: 'default' } }, [
            h('span.li-id', { text: e.id || jarIdFromName(e.name) }),
            badge(e.size ? `${(e.size / 1048576).toFixed(1)} MB` : e.name, ''),
          ]);
          li.addEventListener('click', () => {
            sel = e;
            list.querySelectorAll('.li').forEach((x) => x.classList.remove('is-sel'));
            li.classList.add('is-sel');
          });
          list.appendChild(li);
        }
        const ok = await dialog({
          title: `已选择 ${res.entries.length} 个 jar`,
          body: h('div', null, [
            h('p.tiny.muted', { text: '选择要用于检索的 jar（原版与 mod jar 都支持；mod jar 会扫描它自己的 assets/<命名空间>/）。' }),
            list,
          ]),
          actions: [
            { label: '取消', value: false },
            { label: '用这个 jar 检索', value: true, variant: 'accent' },
          ],
          width: '520px',
        });
        if (!ok || !sel) return;
        picked = sel;
      }
      const file = await readHandle(picked);
      await loadRegistry({ source: 'localjar', jar: file, force: true, jarId: jarIdFromName(picked.name) });
      renderCurrent();
      return;
    }

    // ② 退回 <input type=file accept=".jar">（Firefox / Safari 等）
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jar,application/java-archive';
    input.multiple = false;
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      await loadRegistry({ source: 'localjar', jar: f, force: true, jarId: jarIdFromName(f.name) });
      renderCurrent();
    });
    input.click();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('选择失败：' + e.message, 'error');
  }
}

/* ============================ 能力对照表 ============================ */

function capTableCard(caps, seg) {
  const rows = CAPABILITIES.map((cap) => {
    const st = caps ? caps[cap.key] : 'unsupported';
    return h('tr', null, [
      h('td', null, [h('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: cap.color, marginRight: '7px' } }), h('span', { text: cap.name })]),
      h('td.c', null, badge(STATUS_LABEL[st], st === 'ok' ? 'ok' : st === 'partial' ? 'partial' : st === 'degraded' ? 'degraded' : 'no')),
      h('td.muted.tiny', { text: cap.desc }),
      h('td.tiny', { text: st === 'ok' ? '编辑器完整支持' : st === 'partial' ? '支持，但字段受限' : st === 'degraded' ? '已变更，编辑器按新版语义处理' : '此版本不存在该能力，界面会自动禁用' }),
    ]);
  });
  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: `${state.version || '当前版本'} 能用哪些功能` }),
      seg ? badge(`分段 ${seg.id}`, 'accent') : null,
    ]),
    h('table.tbl', null, [
      h('thead', null, h('tr', null, [h('th', { text: '能力' }), h('th.c', { text: '状态' }), h('th', { text: '含义' }), h('th', { text: '编辑器行为' })])),
      h('tbody', null, rows),
    ]),
  ]);
}

export function summaryLine() {
  const c = state.matrix && state.version ? state.matrix.capsAt(state.version) : null;
  return c ? `物品选择器 ${STATUS_LABEL[c.itemPicker]} · 组件 ${STATUS_LABEL[c.components]}` : '';
}

void codeBlock; void toggleSwitch; void bytes; void versionLabel;
