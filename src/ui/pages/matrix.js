// pages/matrix.js —— 版本能力矩阵：段 → 大版本 → 小版本
// 「一切的前置」的可视化：时间轴节点图 + 分段详情 + 版本×能力二维表

import { h, clear, esc } from '../../core/util.js';
import { state, notify } from '../../core/store.js';
import { CAPABILITIES, STATUS_LABEL, buildMatrixRows } from '../../core/capabilities.js';
import { renderTimeline, timelineLegend, segmentDetail, kindClass } from '../../graph/timeline.js';
import { channelName, parseVersion, isPreRelease } from '../../core/versions.js';
import { button, combo, badge, infoBar, progressRing, emptyState, toggleSwitch, codeBlock, statCard } from '../controls.js';

export const meta = {
  id: 'matrix',
  title: '版本能力矩阵',
  subtitle: '每个技术性更改为一段；段内可细分大版本，大版本可细分小版本',
  icon: 'grid',
};

let viewMode = 'timeline';
let tableLimit = 60;
let releasesOnly = true;
let selectedSeg = null;

export function render(root) {
  clear(root);
  const matrix = state.matrix;
  if (!matrix || !state.versionIndex) {
    root.appendChild(infoBar({ level: 'warning', title: '能力矩阵尚未就绪', text: '请先等待版本清单加载完成。' }));
    return;
  }

  const segments = matrix._sorted();

  /* ---------- 概览 ---------- */
  root.appendChild(h('div.grid-3', null, [
    statCard('技术分段', segments.length, '每个更改一段'),
    statCard('能力项', CAPABILITIES.length, '编辑器支持的功能'),
    statCard('版本总数', state.versionIndex.versions.length, `最新 ${state.versionIndex.latest.release}`),
  ]));

  const wikiCount = segments.filter((s) => s.verified).length;
  root.appendChild(infoBar({
    level: wikiCount ? 'success' : 'info',
    title: `数据来源：${matrix.loadedFrom === 'wiki' ? `wiki 取证（${wikiCount}/${segments.length} 段已核实）` : '内置基线（待 wiki 核实）'}`,
    text: matrix.loadedFrom === 'wiki'
      ? '已逐条比对 zh.minecraft.wiki 的版本记录，未取证条目在内置基线中标记。'
      : '把 wiki 取证结果写入 <code>data/version-segments.json</code> 即可自动覆盖内置基线；当前显示的是内置基线，版本号与日期仍需核实。',
  }));

  /* ---------- 视图切换 ---------- */
  const modeRow = h('div.row', { style: { marginBottom: '12px' } }, [
    button({ label: '时间轴节点图', variant: viewMode === 'timeline' ? 'accent' : 'default', small: true, iconName: 'layers', onClick: () => { viewMode = 'timeline'; rerender(); } }),
    button({ label: '对照表格', variant: viewMode === 'table' ? 'accent' : 'default', small: true, iconName: 'grid', onClick: () => { viewMode = 'table'; rerender(); } }),
    button({ label: '分段明细', variant: viewMode === 'segments' ? 'accent' : 'default', small: true, iconName: 'doc', onClick: () => { viewMode = 'segments'; rerender(); } }),
    h('span.spacer'),
    viewMode === 'timeline' ? timelineLegend() : null,
  ]);
  root.appendChild(modeRow);

  if (viewMode === 'timeline') root.appendChild(timelineCard(matrix, segments));
  else if (viewMode === 'table') root.appendChild(tableCard(matrix));
  else root.appendChild(segmentsCard(matrix, segments));
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

/* ============================ 时间轴 ============================ */

function timelineCard(matrix, segments) {
  const wrap = h('div.graph-wrap', { style: { height: 'auto', minHeight: '420px', overflowX: 'auto', padding: '0 0 10px' } });
  const detailHost = h('div', { style: { padding: '0 12px' } });

  const show = (seg, groups) => {
    selectedSeg = seg;
    clear(detailHost);
    detailHost.appendChild(h('div.sep'));
    detailHost.appendChild(segmentDetail(seg, groups, {
      onJumpVersion: (v) => {
        import('../../core/store.js').then(({ setVersion }) => setVersion(v).then(() => { notify('version'); }));
      },
    }));
  };

  const { segments: segs } = renderTimeline(wrap, {
    matrix,
    currentVersion: state.version,
    selectedId: selectedSeg ? selectedSeg.id : null,
    onSelect: show,
  });
  void segs;

  // 默认展示当前版本所在段
  if (!selectedSeg) {
    const cur = matrix.segmentAt(state.version);
    if (cur) show(cur, matrix.expandSegment(cur));
  }

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '时间轴节点图' }),
        h('p.card-sub', { text: '横轴 = 技术分段；纵轴 = 能力泳道。点击任一段或色块查看该段的能力状态与覆盖版本。' }),
      ]),
    ]),
    wrap,
    detailHost,
  ]);
}

/* ============================ 二维表 ============================ */

function tableCard(matrix) {
  const rows = buildMatrixRows(matrix, { releasesOnly, limit: tableLimit });
  const tbody = h('tbody');
  for (const r of rows) {
    const isCur = r.version === state.version;
    const tr = h('tr', { style: isCur ? { background: 'var(--subtle-secondary)' } : null });
    tr.appendChild(h('td', null, [
      h('span.mono', { style: { fontWeight: isCur ? '700' : '400' }, text: r.version }),
      isCur ? badge('当前', 'accent') : null,
      h('div.tiny.muted', { text: `${channelName(r.type)} · ${new Date(r.date).toLocaleDateString('zh-CN')}` }),
    ]));
    for (const cap of CAPABILITIES) {
      const st = r.caps ? r.caps[cap.key] : 'unsupported';
      tr.appendChild(h('td.c', { title: `${cap.name}：${STATUS_LABEL[st]}` }, [
        h('span', {
          style: {
            display: 'inline-block', width: '100%', minWidth: '34px', height: '18px', borderRadius: '4px',
            background: st === 'ok' ? 'color-mix(in srgb,#0f7b0f 55%,transparent)'
              : st === 'partial' ? 'color-mix(in srgb,#9d5d00 60%,transparent)'
                : st === 'degraded' ? 'color-mix(in srgb,#a03 55%,transparent)' : 'transparent',
            border: st === 'unsupported' ? '1px solid var(--divider-stroke)' : 'none',
          },
        }),
      ]));
    }
    tr.appendChild(h('td.tiny', { text: r.segment ? r.segment.title : '—' }));
    tbody.appendChild(tr);
  }

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '版本 × 能力 对照表' }),
      h('div.row', null, [
        toggleSwitch({ label: '仅正式版', checked: releasesOnly, onChange: (v) => { releasesOnly = v; rerender(); } }),
        combo({
          options: [{ value: '60', label: '显示 60 行' }, { value: '120', label: '显示 120 行' }, { value: '300', label: '显示 300 行' }],
          value: String(tableLimit),
          onChange: (v) => { tableLimit = Number(v); rerender(); },
        }),
      ]),
    ]),
    h('div', { style: { maxHeight: '620px', overflow: 'auto' } }, h('table.tbl', null, [
      h('thead', null, h('tr', null, [
        h('th', { text: '版本' }),
        ...CAPABILITIES.map((c) => h('th.c', { title: c.desc, style: { fontSize: '11px' }, text: c.short })),
        h('th', { text: '所属分段' }),
      ])),
      tbody,
    ])),
  ]);
}

/* ============================ 分段明细 ============================ */

function segmentsCard(matrix, segments) {
  const wrap = h('div');
  segments.forEach((s, i) => {
    const groups = matrix.expandSegment(s);
    const compact = h('div.row', { style: { flexWrap: 'wrap', gap: '3px', marginTop: '6px' } });
    for (const g of groups.slice(0, 6)) {
      compact.appendChild(badge(`${g.label} · ${g.items.length}`, ''));
    }
    if (groups.length > 6) compact.appendChild(badge(`…共 ${groups.length} 个大版本`, ''));

    const stRow = h('div.row', { style: { flexWrap: 'wrap', gap: '4px', marginTop: '6px' } });
    for (const cap of CAPABILITIES) {
      const st = s.caps[cap.key] || 'unsupported';
      stRow.appendChild(h('span.badge ' + kindClass(st), { title: cap.desc, text: `${cap.short} ${STATUS_LABEL[st]}` }));
    }

    const card = h('div.card', null, [
      h('div.card-head', null, [
        h('h2.card-title', null, [
          h('span.badge.accent', { text: `第 ${i + 1} 段` }),
          h('span', { text: s.title }),
        ]),
        h('div.row', null, [
          badge(s.anchor, ''),
          s.verified ? badge('wiki 已取证', 'ok') : badge('内置基线', 'partial'),
        ]),
      ]),
      h('p.card-body', { style: { lineHeight: '1.65', margin: '0' }, text: s.change }),
      stRow,
      compact,
      s.date ? h('p.tiny.muted', { style: { marginTop: '6px' }, text: `日期：${s.date}` }) : null,
    ]);
    card.addEventListener('click', () => { selectedSeg = s; viewMode = 'timeline'; rerender(); });
    wrap.appendChild(card);
  });
  return wrap;
}

void esc; void isPreRelease; void parseVersion; void progressRing; void emptyState; void codeBlock;
