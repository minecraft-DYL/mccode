// timeline.js —— 版本能力时间轴（段 → 大版本 → 小版本）
// 横轴：技术分段（每段一个节点）；纵轴：9 项能力泳道
// 色块表示该段区间内能力的生效状态

import { h, clear } from '../core/util.js';
import { CAPABILITIES, STATUS_LABEL } from '../core/capabilities.js';
import { channelName } from '../core/versions.js';

const SEG_W = 168;
// 左侧能力名标签是 position:sticky(left:0)，实际占 0~132px。
// 绝对定位的内容列必须整体右移这个宽度，否则首列会被标签盖住（曾出现 1.0 段只剩 ".0"）。
const LABEL_W = 140;

export function renderTimeline(host, { matrix, currentVersion = '', selectedId = null, onSelect = null } = {}) {
  clear(host);
  const segments = matrix._sorted();
  const track = h('div.tl-track', { style: { width: `${Math.max(LABEL_W + segments.length * SEG_W + 24, 900)}px` } });

  // ---------- 轴 ----------
  const axis = h('div.tl-axis', { style: { width: `${LABEL_W + segments.length * SEG_W}px` } });
  segments.forEach((s, i) => {
    const tick = h('div.tl-tick.major', { style: { left: `${LABEL_W + i * SEG_W}px` }, title: `${s.anchor} · ${s.title}` }, [
      h('span', { text: s.anchor }),
    ]);
    axis.appendChild(tick);
  });
  track.appendChild(axis);

  // ---------- 分段节点 ----------
  segments.forEach((s, i) => {
    const inner = matrix.expandSegment(s, { includePrerelease: true });
    const count = inner.reduce((n, g) => n + g.items.length, 0);
    const seg = h('div.tl-seg' + (selectedId === s.id ? '.is-sel' : ''), {
      style: { left: `${LABEL_W + i * SEG_W + 4}px`, width: `${SEG_W - 12}px` },
      title: `${s.anchor} — ${s.title}\n覆盖 ${inner.length} 个大版本 / ${count} 个小版本`,
    }, [
      h('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' }, text: `${i + 1}. ${s.title}` }),
      s.verified ? h('span.badge.ok', { style: { height: '16px', padding: '0 5px' }, text: 'wiki' }) : null,
    ]);
    seg.addEventListener('click', () => onSelect && onSelect(s, inner));
    track.appendChild(seg);
  });

  // ---------- 能力泳道 ----------
  const laneWrap = h('div.tl-lane');
  CAPABILITIES.forEach((cap) => {
    const row = h('div', { style: { position: 'relative', height: '30px' } });
    row.appendChild(h('div.tl-row-label', { text: cap.name }));
    segments.forEach((s, i) => {
      const st = s.caps[cap.key] || 'unsupported';
      const cell = h(`div.tl-cell.${st}`, {
        style: { left: `${LABEL_W + i * SEG_W + 4}px`, width: `${SEG_W - 12}px` },
        title: `${s.anchor} · ${cap.name}：${STATUS_LABEL[st]}`,
      });
      cell.addEventListener('click', () => onSelect && onSelect(s, matrix.expandSegment(s)));
      row.appendChild(cell);
    });
    laneWrap.appendChild(row);
  });
  track.appendChild(laneWrap);
  host.appendChild(track);

  // ---------- 当前版本标记 ----------
  if (currentVersion) {
    const seg = matrix.segmentAt(currentVersion);
    const i = segments.indexOf(seg);
    if (i >= 0) {
      const marker = h('div', {
        style: {
          position: 'absolute', left: `${LABEL_W + i * SEG_W + SEG_W / 2 - 1}px`, top: '0', bottom: '0', width: '2px',
          background: 'var(--accent)', zIndex: '6', pointerEvents: 'none',
        },
        title: `当前版本 ${currentVersion} 在此分段`,
      });
      marker.appendChild(h('div', {
        style: {
          position: 'absolute', top: '-2px', left: '-26px', fontSize: '10px', padding: '1px 5px', borderRadius: '4px',
          background: 'var(--accent)', color: 'var(--accent-text)', whiteSpace: 'nowrap',
        },
        text: currentVersion,
      }));
      track.appendChild(marker);
    }
  }
  return { segments, track };
}

export function timelineLegend() {
  return h('div.tl-legend', null, [
    legendItem('ok', '完整可用'),
    legendItem('partial', '部分可用'),
    legendItem('degraded', '已变更 / 被替代'),
    legendItem('unsupported', '不可用'),
  ]);
}

function legendItem(kind, label) {
  return h('span', null, [
    h('i', { class: kind, style: { background: kind === 'unsupported' ? 'transparent' : null, border: kind === 'unsupported' ? '1px solid var(--divider-stroke)' : 'none' } }),
    h('span', { text: label }),
  ]);
}

/** 段详情面板 */
export function segmentDetail(seg, groups, { onJumpVersion = null } = {}) {
  const rows = CAPABILITIES.map((cap) => {
    const st = seg.caps[cap.key] || 'unsupported';
    return h('tr', null, [
      h('td', null, [h('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: cap.color, marginRight: '7px' } }), h('span', { text: cap.name })]),
      h('td.c', null, h('span.badge ' + kindClass(st), { text: STATUS_LABEL[st] })),
      h('td.muted.tiny', { text: cap.desc }),
    ]);
  });

  const versionList = h('div');
  for (const g of groups) {
    const det = h('details', { style: { marginBottom: '6px' } });
    det.appendChild(h('summary', { style: { cursor: 'default', fontSize: '12.5px', fontWeight: '600' }, text: `${g.label}（${g.items.length} 个小版本）` }));
    const wrap = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '8px 0 4px' } });
    for (const it of g.items) {
      const b = h('span.badge', { title: `${it.id} · ${channelName(it.type)}` });
      b.textContent = it.id;
      if (onJumpVersion) { b.style.cursor = 'default'; b.addEventListener('click', () => onJumpVersion(it.id)); }
      wrap.appendChild(b);
    }
    det.appendChild(wrap);
    versionList.appendChild(det);
  }

  return h('div', null, [
    h('div.row', { style: { marginBottom: '8px' } }, [
      h('span.badge.accent', { text: `第 ${seg.id} 段` }),
      h('span.badge', { text: seg.anchor }),
      seg.verified ? h('span.badge.ok', { text: 'wiki 已取证' }) : h('span.badge.partial', { text: '内置基线 · 待核实' }),
      seg.date ? h('span.muted.tiny', { text: seg.date }) : null,
    ]),
    h('p', { style: { margin: '0 0 12px', lineHeight: '1.6' }, text: seg.change }),
    h('table.tbl', null, [
      h('thead', null, h('tr', null, [h('th', { text: '能力' }), h('th.c', { text: '状态' }), h('th', { text: '说明' })])),
      h('tbody', null, rows),
    ]),
    h('div.sep'),
    h('div.card-title', { style: { fontSize: '13.5px', marginBottom: '6px' }, text: '本段覆盖的大版本 / 小版本' }),
    versionList,
    seg.sources && seg.sources.length ? h('div', null, [
      h('div.sep'),
      h('div.tiny.muted', { text: '取证来源：' }),
      ...seg.sources.map((u) => h('div.tiny', null, h('a', { href: u, target: '_blank', rel: 'noreferrer', style: { color: 'var(--accent)' }, text: u }))),
    ]) : null,
  ]);
}

export function kindClass(st) {
  return { ok: 'ok', partial: 'partial', degraded: 'degraded', unsupported: 'no', true: 'ok', false: 'no' }[st] || '';
}
