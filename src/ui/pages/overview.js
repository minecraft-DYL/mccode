// pages/overview.js —— 概览：当前版本状态、能力摘要、快捷入口、环境信息

import { h, clear, fmtNum } from '../../core/util.js';
import { state, notify, versionLabel, versionSummary } from '../../core/store.js';
import { CAPABILITIES, STATUS_LABEL } from '../../core/capabilities.js';
import { channelName, parseVersion, isPreRelease } from '../../core/versions.js';
import { SOURCE_LABEL } from '../../core/registry.js';
import { button, badge, infoBar, statCard, icon, emptyState } from '../controls.js';

export const meta = {
  id: 'overview',
  title: '概览',
  subtitle: '当前编辑目标的能力总览与快捷入口',
  icon: 'home',
};

const ENTRIES = [
  { page: 'versions', icon: 'layers', title: '版本选择', desc: '切换 MC 版本；一切能力的前置开关', cap: null },
  { page: 'matrix', icon: 'grid', title: '版本能力矩阵', desc: '段 → 大版本 → 小版本，哪些功能在哪段生效/失效', cap: null },
  { page: 'pickers', icon: 'box', title: '物品/实体/粒子选择器', desc: '按当前版本实时检索 ID、名称与图标', cap: 'itemPicker' },
  { page: 'nbt', icon: 'tag', title: 'NBT 编辑器', desc: 'SNBT 校验、结构树、二进制 .dat 读写', cap: 'nbt' },
  { page: 'components', icon: 'puzzle', title: '物品组件', desc: '1.20.5+ 数据组件，含 NBT ⇄ 组件迁移', cap: 'components' },
  { page: 'commands', icon: 'terminal', title: '命令编辑器', desc: '文本 / 浏览器 / 节点图三种编辑方式', cap: 'command' },
  { page: 'output', icon: 'export', title: '输出通道', desc: '.mcfunction / 命令方块 / 聊天框指令', cap: 'mcfunction' },
];

export function render(root) {
  clear(root);

  if (!state.versionIndex) {
    root.appendChild(infoBar({ level: 'warning', title: '正在初始化', text: '正在拉取 Mojang 版本清单，请稍候…' }));
    return;
  }

  const caps = state.matrix ? state.matrix.capsAt(state.version) : null;
  const seg = state.matrix ? state.matrix.segmentAt(state.version) : null;
  const okCount = caps ? CAPABILITIES.filter((c) => caps[c.key] === 'ok').length : 0;

  /* ---------- 顶部：当前版本 + 关键数字 ---------- */
  root.appendChild(h('div.grid-3', null, [
    statCard('当前版本', state.version || '未选择', state.version ? channelName(parseVersion(state.version).kind) : ''),
    statCard('完整可用能力', `${okCount} / ${CAPABILITIES.length}`, '其余能力部分可用或不可用'),
    statCard('注册表', state.registry ? `${fmtNum(state.registry.items.length)} 物品` : '未检索', state.registry ? `${fmtNum(state.registry.entities.length)} 实体 · ${fmtNum(state.registry.particles.length)} 粒子` : '去版本页检索'),
  ]));

  /* ---------- 能力摘要 ---------- */
  const badges = h('div.row', { style: { marginTop: '4px' } });
  for (const cap of CAPABILITIES) {
    const st = caps ? caps[cap.key] : 'unsupported';
    const b = badge(`${cap.name} · ${STATUS_LABEL[st]}`, st === 'ok' ? 'ok' : st === 'partial' ? 'partial' : st === 'degraded' ? 'degraded' : 'no');
    b.title = cap.desc;
    badges.appendChild(b);
  }

  root.appendChild(h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: `${versionLabel()} 的能力总览` }),
        h('p.card-sub', { text: `${versionSummary()}${seg ? ` · 所在分段「${seg.title}」` : ''}` }),
      ]),
      h('div.row', null, [
        button({ label: '查看矩阵', variant: 'default', small: true, iconName: 'grid', onClick: () => go('matrix') }),
        button({ label: '切换版本', variant: 'accent', small: true, iconName: 'layers', onClick: () => go('versions') }),
      ]),
    ]),
    badges,
    seg ? h('p.tiny.muted', { style: { marginTop: '10px', lineHeight: '1.65', text: seg.change } }) : null,
  ]));

  /* ---------- 快捷入口 ---------- */
  const grid = h('div.grid-2');
  for (const e of ENTRIES) {
    const st = e.cap && caps ? caps[e.cap] : null;
    const disabled = e.cap && st === 'unsupported';
    const card = h('div.card.tight', {
      style: { cursor: disabled ? 'default' : 'default', opacity: disabled ? '.55' : '1', marginBottom: '0' },
    }, [
      h('div.row', null, [
        h('span', { style: { color: 'var(--accent)' } }, icon(e.icon, 18)),
        h('span', { style: { fontWeight: '600', fontSize: '13.5px' }, text: e.title }),
        h('span.spacer'),
        st ? badge(STATUS_LABEL[st], st === 'ok' ? 'ok' : st === 'partial' ? 'partial' : st === 'degraded' ? 'degraded' : 'no') : null,
      ]),
      h('p.tiny.muted', { style: { margin: '6px 0 0', lineHeight: '1.5' }, text: e.desc }),
    ]);
    if (!disabled) {
      card.addEventListener('click', () => go(e.page));
      card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--accent)'; });
      card.addEventListener('mouseleave', () => { card.style.borderColor = ''; });
    }
    grid.appendChild(card);
  }
  root.appendChild(grid);

  /* ---------- 环境信息 ---------- */
  root.appendChild(h('div.card', null, [
    h('div.card-head', null, [h('h2.card-title', { text: '环境与数据源' })]),
    h('table.tbl', null, [
      h('tbody', null, [
        row('版本清单', state.versionIndex ? `${fmtNum(state.versionIndex.versions.length)} 个版本（最新正式版 ${state.versionIndex.latest.release}，最新快照 ${state.versionIndex.latest.snapshot}）` : '—'),
        row('清单来源', state.manifestAt ? `${new Date(state.manifestAt).toLocaleString('zh-CN')}${state.manifestFromCache ? '（缓存）' : '（本次拉取）'}` : '—'),
        row('能力矩阵数据', state.matrix ? (state.matrix.loadedFrom === 'wiki' ? 'wiki 取证（data/version-segments.json）' : '内置基线（待 wiki 核实）') : '—'),
        row('注册表数据源', state.registry ? (SOURCE_LABEL[state.registry.source] || state.registry.source) : (SOURCE_LABEL[state.registrySource] || state.registrySource) + '（未检索）'),
        row('UI 主题', `${state.theme === 'dark' ? '暗色' : '亮色'} · WinUI 令牌（vendored from WinUIonWeb）`),
      ]),
    ]),
  ]));

  /* ---------- 使用指引 ---------- */
  root.appendChild(h('div.card', null, [
    h('div.card-head', null, [h('h2.card-title', { text: '怎么用' })]),
    h('ol', { style: { margin: '0', paddingLeft: '20px', fontSize: '13px', lineHeight: '2' } }, [
      h('li', { text: '① 在「版本选择」里选好 MC 版本 —— 这决定后面所有页面的可用性与语法形态。' }),
      h('li', { text: '② 点「开始检索」拉取该版本的物品/实体/粒子 ID 与图标（首次约几秒）。' }),
      h('li', { text: '③ 在「选择器」里挑物品/实体/粒子，可一键送到命令编辑器或节点图。' }),
      h('li', { text: '④ 「NBT 编辑器」写 SNBT 或直接打开 .dat 文件；1.20.5+ 的物品数据请用「物品组件」页。' }),
      h('li', { text: '⑤ 「命令编辑器」的节点图里拖节点、连线；右侧实时出现生成的命令。' }),
      h('li', { text: '⑥ 「输出通道」把命令落地成 .mcfunction 文件、数据包 zip、命令方块 setblock 或聊天框一条指令。' }),
    ]),
  ]));

  if (!state.registry) {
    root.appendChild(infoBar({
      level: 'info',
      title: '还没有检索注册表',
      text: '物品 / 实体 / 粒子选择器需要先按当前版本检索一次。',
      actions: [button({ label: '去检索', variant: 'accent', small: true, onClick: () => go('versions') })],
    }));
  }

  void isPreRelease; void emptyState;
}

function row(k, v) {
  return h('tr', null, [h('td', { style: { width: '160px', color: 'var(--text-secondary)' }, text: k }), h('td', { text: v })]);
}

function go(page) { state.page = page; notify('navigate'); }
