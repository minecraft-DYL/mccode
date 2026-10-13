// pages/pickers.js —— 物品 / 实体 / 粒子选择器
// 展示 ID + 图标 + 显示名；数据来自 registry（网络资源仓库 / 官方 jar / 本机 jar），受版本选择影响

import { h, clear, fmtNum, copy, esc } from '../../core/util.js';
import { state, notify, loadRegistry, capAvailable, capLabel, setVersion } from '../../core/store.js';
import { hashColor, initials, SOURCE_LABEL } from '../../core/registry.js';
import { button, textBox, badge, infoBar, progressRing, emptyState, toast, combo, toggleSwitch, statCard } from '../controls.js';
import { buildGive, buildSummon, buildParticle, stackSyntax } from '../../core/commands.js';
import { isAncient, isDatapackEra, channelName, parseVersion } from '../../core/versions.js';
import { giveBox } from '../give-box.js';
import { itemIcon } from '../item-icon.js';
import { isBlockItem } from '../../data/blocks.js';
import {
  LEGACY_IDS, LEGACY_META, byLegacyId, searchLegacy,
  parseLegacyIdText, legacyIdText, legacyCoverageText,
} from '../../data/legacy-ids.js';

export const meta = {
  id: 'pickers',
  title: '选择器',
  subtitle: '物品 / 实体 / 粒子 —— ID、图标与显示名按当前版本实时检索',
  icon: 'box',
};

const PAGE = 120;
let ui = {
  kind: 'items', q: '', page: 0, withIcon: false, loadingIcons: new Set(),
  // 数字 ID 模式（1.13 之前）
  legacy: false, lq: '', lpage: 0, lsel: null, ldata: '', lcmd: '', lcmdAuto: true,
  ltargets: '@s', lcount: '1',
  // 物品列表是否隐藏「方块物品」（默认隐藏，与 1.13+ 的口径一致）
  hideBlockItems: true,
};
const selected = { items: null, entities: null, particles: null };

/* ==================== 版本边界：1.13 扁平化 ==================== */

/**
 * 该版本是否已经「扁平化」（用命名空间字符串 ID 而不是数字 ID）。
 *
 * 边界取证：扁平化随快照 17w43a 加入，随正式版 1.13 发布
 * （来源：https://zh.minecraft.wiki/w/Java版1.13/扁平化 —— 该页「命令」一节明确写
 *  「/give 的 [<data>] 部分已被移除」，即 1.13 起数字数据值不再存在）。
 *
 * 为什么不能直接用 core/versions.js 的 isDatapackEra：
 *   parseVersion('17w43a') 的 nums 是 []（只有 week=1743），而 isDatapackEra 对
 *   nums 为空的快照一律返回 false —— 那会把 17w43a 判成「还没扁平化」，正好判反。
 *   快照必须用 week 判：2017 年第 43 周及以后（>=1743）都已扁平化。
 */
export function isFlattenedVersion(id) {
  if (isAncient(id)) return false;          // aN/bN/rdN/inf… 全部早于 1.13
  const p = parseVersion(id);
  if (!p.nums.length) {
    if (p.week != null) return p.week >= 1743;   // 17w43a 起
    return isDatapackEra(id);                     // 兜底，交给既有判断
  }
  if (p.nums[0] >= 26) return true;
  return p.nums[0] === 1 && p.nums[1] >= 13;
}

/** 当前是否该显示「数字 ID 选择器」 */
function legacyMode() {
  if (isAncient(state.version)) return ui.legacy === true;  // 远古版本：点按钮才进
  return !isFlattenedVersion(state.version);
}

/* ==================== 数字 ID 模式：样式（app.css 不许动，就地注入，幂等） ==================== */

const LEGACY_CSS = `
.lg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
.lg-cell {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px; cursor: default; user-select: none;
  border-radius: var(--radius-md); border: 1px solid transparent;
  background: var(--card-bg-secondary, rgba(128,128,128,.06));
}
.lg-cell:hover { background: var(--ctrl-fill-secondary, rgba(128,128,128,.18)); }
.lg-cell.is-sel { border-color: var(--accent, #0067c0); background: color-mix(in srgb, var(--accent, #0067c0) 16%, transparent); }
.lg-txt { min-width: 0; }
.lg-id { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--text-primary); line-height: 1.25; }
.lg-name { font-size: 12.5px; color: var(--text-primary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lg-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lg-warn { font-size: 11px; color: var(--SystemFillColorCautionBrush, #c2841a); line-height: 1.3; }
.lg-cmd { width: 100%; font-family: var(--font-mono); font-size: 13px; }
.lg-src { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
.lg-src code { font-family: var(--font-mono); }
`;

function ensureStyles() {
  if (document.getElementById('mce-legacy-style')) return;
  document.head.appendChild(h('style#mce-legacy-style', { text: LEGACY_CSS }));
}

/* ==================== 数字 ID 模式：命令生成 ==================== */

/**
 * 生成 1.13 之前的 /give。
 *
 * 旧语法是 `give <目标> <物品> [<数量>] [<数据值>] [<数据标签>]`：
 * 数字 ID 和「数据值」是**两个独立参数**（`give @s 35 1 14`），不是 `35:14` 一个参数。
 * 页面上的 `35:14` 只是数字 ID 的书写方式，方便检索时区分变体。
 * 取证：zh.minecraft.wiki「Java版1.13/扁平化」命令一节 —— 「/give 的 [<data>] 部分已被移除」。
 *
 * 数据值没取证（entry.dataUnknown）时刻意**省略**这一个参数，而不是编一个数字：
 * 省略时游戏按 0 处理，UI 会同时把这件事讲清楚，并让用户自己填。
 */
function legacyGiveText(e, { targets = '@s', count = '1', data } = {}) {
  if (!e) return '';
  const parts = ['give', targets || '@s', String(e.num), String(count || '1')];
  const d = (data !== undefined && data !== '') ? data : e.data;
  if (d !== undefined && d !== null && d !== '') parts.push(String(d));
  return parts.join(' ');
}

/* ==================== 渲染入口 ==================== */

const KIND_META = {
  items: { cap: 'itemPicker', label: '物品', icon: 'box', hint: '物品 ID 与图标' },
  entities: { cap: 'entityPicker', label: '实体', icon: 'ghost', hint: '实体 ID' },
  particles: { cap: 'particlePicker', label: '粒子', icon: 'sparkle', hint: '粒子 ID' },
};

export function setKind(k) { ui.kind = k; ui.page = 0; ui.q = ''; }

export function render(root) {
  clear(root);
  ensureStyles();
  cmdInputEl = null;
  if (state.pickerKind) { ui.kind = state.pickerKind; state.pickerKind = null; }

  // 远古版本（aN / bN / rdN / inf…）：注册表本来就不存在，必须先决定用哪套 ID。
  // 这里刻意不看 state.registry —— 在一台已经检索过 1.20.5 的机器上，state.registry
  // 会留着上一版的条目，若按它分支就会给 b1.7.3 渲染出一张现代物品表，还挡住入口按钮。
  if (isAncient(state.version) && !legacyMode()) {
    root.appendChild(ancientCard());
    root.appendChild(selectedCard());
    return;
  }

  // 1.13 之前（或远古版本点了按钮）：走数字 ID 模式，不用命名空间 ID 注册表
  if (legacyMode()) {
    root.appendChild(legacyIntroCard());
    if (ui.kind === 'items') {
      // 用户要求：物品选择改成 /give 指令输入框，能改、改完还能重新填充
      root.appendChild(legacyGiveCard());
      root.appendChild(legacyPickerCard());
    } else {
      root.appendChild(legacyOtherKindCard());
    }
    root.appendChild(selectedCard());
    return;
  }

  const capKey = KIND_META[ui.kind].cap;
  if (!capAvailable(capKey)) {
    root.appendChild(infoBar({
      level: 'warning',
      title: `${KIND_META[ui.kind].label}选择器在 ${state.version} 不可用`,
      text: `当前版本该能力状态为「${capLabel(capKey)}」。${ui.kind === 'items' ? '1.13 起物品 ID 扁平化后才可完整枚举，更早版本物品以数字 ID 表示。' : '建议切换到 1.13 及以上的版本。'}`,
    }));
  }

  if (!state.registry) root.appendChild(needRegistryCard());
  else root.appendChild(pickerCard());

  // 物品页额外提供 /give 输入框（用户要求：物品选择改成 give 指令输入框）
  if (ui.kind === 'items' && !isAncient(state.version)) root.appendChild(giveCard());

  root.appendChild(selectedCard());
}

/* ==================== 数字 ID 模式：卡片 ==================== */

/** 顶部说明。文案与旧版保持一致，并补上「这张表是 1.12.2 的」这条事实。 */
function legacyIntroCard() {
  const v = state.version || '所选版本';
  const c = LEGACY_META.counts;
  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '1.13 之前：数字 ID 模式' }),
      badge(`${c.numericIds} 个数字 ID`, 'accent'),
    ]),
    infoBar({
      level: 'info',
      title: isAncient(v) ? `${v} 是远古版本，方块/物品也用数字 ID` : `${v} 使用数字 ID（尚未扁平化）`,
      text: '1.13 之前方块与物品用数字 ID 表示（例：1 = 石头、35:14 = 红色羊毛、276 = 钻石剑），'
        + '不存在 minecraft: 命名空间 ID，也没有物品组件。下面的数字 ID 选择器可按 ID 或中文名查找。',
    }),
    h('div.row', null, [
      button({ label: '切换到 1.13+ 用命名空间 ID', variant: 'default', iconName: 'versions', onClick: () => setVersion('1.13') }),
      button({ label: '切换到 1.12.2', variant: 'default', onClick: () => setVersion('1.12.2') }),
    ]),
    h('p.lg-src', {
      text: `数据表对应 1.12.2 的数字 ID。${c.nameEnOnly > 0 ? `其中 ${c.nameEnOnly} 条只有英文名。` : ''}`
        + (isAncient(v) ? ' 更早的版本只有这张表的子集，表外的方块在该版本并不存在。' : ''),
    }),
  ]);
}

/** 非物品页（实体/粒子）：1.13 之前它们也不用数字 ID，这里只如实说明，不编表 */
function legacyOtherKindCard() {
  const kind = KIND_META[ui.kind].label;
  return h('div.card', null, [
    h('div.card-head', null, [h('h2.card-title', { text: `${kind}：1.13 之前不是数字 ID` })]),
    infoBar({
      level: 'info',
      title: '数字 ID 选择器只覆盖方块与物品',
      text: `1.13 之前只有方块与物品用数字 ID；${kind}用的是字符串名，而且大小写规则与现在不同。`
        + '本工具没有为它抓取过历史名称表，所以这里不列表——编一张只会给出与该版本无关的现代 ID。',
    }),
    h('div.row', null, [
      button({ label: '切换到 1.13+', variant: 'accent', onClick: () => setVersion('1.13') }),
    ]),
  ]);
}

/** /give 输入框元素（跨卡片协作用，每次 render 重置） */
let cmdInputEl = null;

function syncCmd() {
  if (!cmdInputEl) return;
  if (ui.lcmdAuto) cmdInputEl.value = legacyGiveText(ui.lsel, { targets: ui.ltargets, count: ui.lcount, data: ui.ldata });
}

/**
 * /give 输入框（1.13 之前语法）。
 * 要求：可以随手改；改完点「重新填充」按当前选中的数字 ID 重新生成，不影响选择。
 */
function legacyGiveCard() {
  const e = ui.lsel;
  const numCount = e && e.dataUnknown ? byLegacyId(e.num).length : 0;

  const targetInput = h('input.mono', {
    type: 'text', value: ui.ltargets, id: 'legacy-targets',
    style: { width: '70px' }, title: '目标选择器',
    oninput: () => { ui.ltargets = targetInput.value; ui.lcmdAuto = true; syncCmd(); },
  });
  const countInput = h('input.mono', {
    type: 'text', value: ui.lcount, id: 'legacy-count',
    style: { width: '54px' }, title: '数量',
    oninput: () => { ui.lcount = countInput.value; ui.lcmdAuto = true; syncCmd(); },
  });
  const dataInput = h('input.mono', {
    type: 'text', value: ui.ldata, id: 'legacy-data',
    placeholder: e && e.data !== undefined ? String(e.data) : '数据值',
    style: { width: '80px' },
    title: '数据值（0–15）。留空则用已取证的数值；未取证的条目必须自己填',
    oninput: () => { ui.ldata = dataInput.value; ui.lcmdAuto = true; syncCmd(); },
  });

  cmdInputEl = h('input.lg-cmd#legacy-cmd', {
    type: 'text', value: legacyGiveText(e, { targets: ui.ltargets, count: ui.lcount, data: ui.ldata }),
    placeholder: '选中左侧任意条目后自动填充；也可以自己改',
    oninput: () => { ui.lcmdAuto = false; ui.lcmd = cmdInputEl.value; },
  });

  const status = h('span.tiny.muted#legacy-cmd-status');

  const refill = button({
    label: '重新填充', variant: 'accent', small: true, iconName: 'reload',
    onClick: () => {
      if (!ui.lsel) { toast('先选一个数字 ID', 'error'); return; }
      ui.lcmdAuto = true; ui.lcmd = ''; syncCmd();
      status.textContent = '已按当前选中的数字 ID 重新填充';
      toast('已重新填充命令');
    },
  });
  const copyCmd = button({
    label: '复制命令', variant: 'default', small: true, iconName: 'copy',
    onClick: async () => {
      const t = cmdInputEl.value.trim();
      if (!t) { toast('命令还是空的', 'error'); return; }
      (await copy('/' + t.replace(/^\//, ''))) ? toast('已复制命令') : toast('复制失败', 'error');
    },
  });
  const applyCmd = button({
    label: '按命令框重新选择', variant: 'default', small: true,
    onClick: () => {
      // 把输入框里的第 3 段当成数字 ID 解析回来（支持 35 或 35:14），让「改 → 反查」闭环
      const tok = cmdInputEl.value.trim().replace(/^\//, '').split(/\s+/)[2] || '';
      const parsed = parseLegacyIdText(tok);
      if (!parsed) { toast(`命令框第 3 段不是数字 ID：「${tok}」`, 'error'); return; }
      const hit = byLegacyId(parsed.num, parsed.data);
      if (!hit.length) { toast(`没有 ${tok} 这个数字 ID`, 'error'); return; }
      ui.lsel = hit[0]; ui.ldata = ''; ui.lcmdAuto = true; ui.lcmd = '';
      // 整页重画：选择变了，/give 卡片上的徽标、数据值提示与网格高亮都得跟着变
      rerender();
      toast(`已选中 ${legacyIdText(hit[0])} ${hit[0].name}`);
    },
  });

  refill.id = 'legacy-refill';
  copyCmd.id = 'legacy-copy';
  applyCmd.id = 'legacy-apply';

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '直接写一条 /give（1.13 之前语法）' }),
        h('p', { class: 'card-sub', text: 'give <目标> <数字ID> [数量] [数据值] [数据标签] —— 数字 ID 与数据值是两个独立参数' }),
      ]),
      badge(e ? `${legacyIdText(e)} ${e.name}` : '未选中', e ? 'accent' : ''),
    ]),
    h('div.row', null, [
      h('span.tiny.muted', { text: '目标' }), targetInput,
      h('span.tiny.muted', { text: '数量' }), countInput,
      h('span.tiny.muted', { text: '数据值' }), dataInput,
    ]),
    h('div', { style: { marginTop: '8px' } }, [cmdInputEl]),
    h('div.row', { style: { marginTop: '8px' } }, [refill, copyCmd, applyCmd, status]),
    e && e.dataUnknown
      ? infoBar({
        level: 'warning',
        title: `数据值未取证：${legacyIdText(e)} 有 ${numCount} 种数据值，但 wiki 没给出「哪一项 = 哪个数据值」`,
        text: `数字 ID ${e.num} 在 1.12.2 对应 ${numCount} 个不同物品/方块，具体数据值（0–${numCount - 1}）`
          + '在维基的扁平化对照表和 DV 表里对不上名字，所以这里不替你猜。'
          + '请在「数据值」框里自己填一个数字，命令会随之更新。留空则省略该参数，游戏按 0 处理。',
      })
      : null,
    e && e.data !== undefined
      ? h('p.lg-src', {
        text: `数据值 ${e.data} 由 wiki 的 DV 表按名字精确查到（取证通道：${e.dvSource === 'en' ? '英文 wiki DV 表 ↔ 英文扁平化表' : '中文 wiki DV 表 ↔ 中文扁平化表'}），不是按下标推断的。`,
      })
      : null,
  ]);
}

/** 数字 ID 选择器：按数字 / 数字:数据值 / 中文名 / 英文名（新旧都行）检索 */
function legacyPickerCard() {
  const resultsHost = h('div#legacy-grid');
  const countBadge = badge('', '');
  const pageInfo = h('span.tiny.muted');
  const prevBtn = button({ label: '上一页', variant: 'default', small: true, onClick: () => { ui.lpage--; refresh(); } });
  const nextBtn = button({ label: '下一页', variant: 'default', small: true, onClick: () => { ui.lpage++; refresh(); } });
  let list = [];

  // 1.13 之前方块与物品共用同一套数字 ID，但「方块 / 物品」的身份在这张表里是逐条记着的
  // （kind 来自 en 的方块 ID 表还是物品 ID 表），所以这里直接按 kind 滤，比事后用
  // 现代 isBlockItem(e.id) 反推更准（有些老方块在 1.13 后已经没有对应物品了）。
  const hiddenLegacyBlocks = ui.hideBlockItems ? LEGACY_IDS.filter((e) => e.kind === 'block') : [];
  const visible = ui.hideBlockItems ? LEGACY_IDS.filter((e) => e.kind !== 'block') : LEGACY_IDS;

  function refresh() {
    list = ui.lq ? searchLegacy(ui.lq, { limit: 2000 }) : visible;
    if (ui.hideBlockItems) list = list.filter((e) => e.kind !== 'block');
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (ui.lpage >= pages) ui.lpage = 0;
    const slice = list.slice(ui.lpage * PAGE, ui.lpage * PAGE + PAGE);

    clear(resultsHost);
    if (!slice.length) {
      resultsHost.appendChild(emptyState('没有匹配的数字 ID', ui.hideBlockItems
        ? '方块条目已隐藏，可在上方开关打开；也可以试 276、钻石剑、grass'
        : '试试 35、35:14、羊毛、grass —— 数字、中文名、英文新旧名都能搜'));
    } else {
      const grid = h('div.lg-grid');
      for (const e of slice) grid.appendChild(legacyCell(e));
      resultsHost.appendChild(grid);
    }
    countBadge.textContent = `匹配 ${fmtNum(list.length)}`;
    countBadge.className = 'badge' + (list.length ? ' ok' : ' no');
    pageInfo.textContent = `${ui.lpage + 1} / ${pages}`;
    prevBtn.disabled = ui.lpage === 0;
    nextBtn.disabled = ui.lpage >= pages - 1;
  }

  const tb = textBox({
    placeholder: '数字 ID / 数字:数据值 / 中文名 / 英文名（如 35、35:14、红色羊毛、grass）…',
    onInput: (v) => { ui.lq = v.trim(); ui.lpage = 0; refresh(); },
  });
  tb.id = 'legacy-q';
  tb.value = ui.lq;
  setTimeout(refresh, 0);

  const c = LEGACY_META.counts;
  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '数字 ID 选择器' }),
        h('p.card-sub', { text: `${legacyCoverageText()} · 表对应 1.12.2` }),
      ]),
      h('div.row', null, [countBadge]),
    ]),
    blockItemNotice(hiddenLegacyBlocks.length, () => { ui.hideBlockItems = !ui.hideBlockItems; ui.lpage = 0; rerender(); }),
    h('div.pk-toolbar', null, [
      h('div', { style: { flex: '1', minWidth: '260px' } }, tb),
      prevBtn, pageInfo, nextBtn,
    ]),
    resultsHost,
    h('div', { style: { marginTop: '10px' } }, [
      h('p.lg-src', {
        text: `数字 ID 与中文名取自 zh.minecraft.wiki「Java版数据值/扁平化前」的方块/物品 ID 表；`
          + `旧标识符（如 grass / snow / log2）取自 minecraft.wiki「Java Edition pre-flattening data values」；`
          + `1.13 新 ID 取自「Java版1.13/扁平化」。`
          + `${c.withData} 条带数据值（zh 通道 ${c.withDataZh} · en 通道 ${c.withDataEn}），`
          + `另有 ${c.dataUnknown} 条只查到数字 ID、数据值未取证（单元格里标了「数据值未取证」，不猜）。`,
      }),
    ]),
  ]);
}

function legacyCell(e) {
  const sel = ui.lsel && ui.lsel.num === e.num && ui.lsel.id === e.id && ui.lsel.data === e.data;
  const el = h('div.lg-cell' + (sel ? '.is-sel' : ''), {
    dataset: { legacyId: legacyIdText(e), num: String(e.num), stringId: e.id },
    title: `${legacyIdText(e)} = ${e.name}\n1.13+：${e.id}${e.legacy && e.legacy !== e.id ? `\n1.12.2 旧名：${e.legacy}` : ''}`,
  });
  el.appendChild(itemIcon({ id: e.id, name: e.name }, 30));
  const txt = h('div.lg-txt');
  txt.appendChild(h('div.lg-id', { text: legacyIdText(e) }));
  txt.appendChild(h('div.lg-name', { text: e.name }));
  txt.appendChild(h('div.lg-hint', {
    text: `1.13+ ${e.id}${e.legacy && e.legacy !== e.id ? ` · 旧名 ${e.legacy}` : ''}`,
  }));
  if (e.dataUnknown) txt.appendChild(h('div.lg-warn', { text: `数据值未取证（共 ${byLegacyId(e.num).length} 种）` }));
  el.appendChild(txt);
  el.addEventListener('click', () => {
    ui.lsel = e;
    ui.ldata = '';
    ui.lcmdAuto = true;
    ui.lcmd = '';
    // 整页重画而不是只重画网格：/give 卡片上的徽标、数据值提示也要跟着变
    // （只重画网格时，截图里会出现「网格选中了 35:14，徽标还写着未选中」）
    rerender();
  });
  return el;
}

/** /give 指令输入框卡片 */
function giveCard() {
  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '直接写一条 /give' }),
      h('span.tiny.muted', { text: '命令名前缀已锁定；后面输物品 ID、中文名或基岩版名，实时补全' }),
    ]),
    giveBox({
      onChange: ({ item }) => { if (item) selected.items = item; },
    }),
  ]);
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

/**
 * 远古版本（2009–2011）：没有命名空间 ID，也不该去网络拉「全部物品」。
 * 由 render() 直接挂载（不看 state.registry，避免上一版的注册表残留把入口挡掉）。
 */
function ancientCard() {
  const v = state.version || '所选版本';
  return h('div.card#ancient-intro', null, [
    h('div.card-head', null, [h('h2.card-title', { text: '该版本没有可枚举的 ID 注册表' })]),
    infoBar({
      level: 'warning',
      title: `${v} 是远古版本（2009–2011）`,
      text: '远古版本没有命名空间 ID 体系，方块/物品以数字 ID 表示，且种类极少（整个 Pre-classic 不到 20 种方块）。这里不提供网络检索——那只会给出与该版本无关的现代物品表。',
    }),
    h('div.row', null, [
      button({ label: '切换到 26.3（最新正式版）', variant: 'accent', iconName: 'versions', onClick: () => setVersion('26.3') }),
      button({ label: '查看 1.13 之前的数字 ID', variant: 'default', onClick: () => { ui.legacy = true; rerender(); } }),
    ]),
  ]);
}

function needRegistryCard() {
  const v = state.version || '所选版本';

  // 走到这里 ⟺ 版本已扁平化（未扁平化的由 render() 的 legacyMode() 分支接管，
  // 远古的由 ancientCard() 接管），所以只需要「按本版本检索」这一张卡。
  // 注意不要在这里用 !isDatapackEra 判断：17w43a–17w49b 这些快照已扁平化但
  // isDatapackEra 为 false（nums 为空），那会把它们误判成 1.13 之前。
  return h('div.card', null, [
    h('div.card-head', null, [h('h2.card-title', { text: '尚未检索注册表' })]),
    infoBar({
      level: 'info',
      title: `按 ${v} 检索`,
      text: '物品 / 实体 / 粒子的 ID、图标与中文名按该版本的实际资源内容拉取。数量由版本本身决定，检索完成后显示实际条数——这里不做估算。',
    }),
    h('div.row', null, [
      button({
        label: state.registryBusy ? '检索中…' : '立即检索', variant: 'accent', iconName: 'reload', disabled: state.registryBusy,
        onClick: async () => { await loadRegistry({}); rerender(); },
      }),
      state.registryBusy ? progressRing(18) : null,
    ]),
  ]);
}

/* ============================ 主选择器 ============================ */

function pickerCard() {
  const reg = state.registry;
  const meta = KIND_META[ui.kind];
  const raw = reg[ui.kind] || [];
  // 物品页默认把「方块物品」滤掉 —— 它们已经在独立的「方块」页里，两边重复出现没意义。
  // 口径来自 data/blocks.js 的 isBlockItem（方块 ID === 物品 ID），这里不硬编码任何条数。
  // 注意：种子 / 桶 / 食物这类「能放方块但本身不是方块」的物品**必须留下**（beetroot、lava_bucket…），
  // isBlockItem 对它们返回 false，所以不会被滤掉。
  const isItems = ui.kind === 'items';
  const { shown: all, hidden: hiddenBlockItems } = isItems
    ? splitBlockItems(raw, ui.hideBlockItems)
    : { shown: raw, hidden: [] };

  const gridHost = h('div');
  const countBadge = badge('', '');
  const pageInfo = h('span.tiny.muted');
  const prevBtn = button({ label: '上一页', variant: 'default', small: true, onClick: () => { ui.page--; refresh(); } });
  const nextBtn = button({ label: '下一页', variant: 'default', small: true, onClick: () => { ui.page++; refresh(); } });

  /** 只重画结果区，不重建输入框 —— 否则每敲一个字都会失焦 */
  function refresh() {
    const filtered = ui.q
      ? all.filter((e) => e.id.includes(ui.q.toLowerCase()) || (e.name && e.name.toLowerCase().includes(ui.q.toLowerCase())))
      : all;
    const list = ui.withIcon ? filtered.filter((e) => e.icon || e.iconLoader || e.kind === 'particle') : filtered;
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (ui.page >= pages) ui.page = 0;
    const slice = list.slice(ui.page * PAGE, ui.page * PAGE + PAGE);

    clear(gridHost);
    if (slice.length) {
      const grid = h('div.pk-grid');
      for (const e of slice) grid.appendChild(cell(e, meta));
      gridHost.appendChild(grid);
    } else {
      gridHost.appendChild(emptyState(`没有匹配的${meta.label}`, isItems && hiddenBlockItems.length ? '方块物品已隐藏，可在上方开关打开' : '换个关键词试试'));
    }
    countBadge.textContent = `匹配 ${fmtNum(list.length)}`;
    countBadge.className = 'badge' + (list.length ? ' ok' : ' no');
    pageInfo.textContent = `${ui.page + 1} / ${pages}`;
    prevBtn.disabled = ui.page === 0;
    nextBtn.disabled = ui.page >= pages - 1;
  }

  const tabRow = h('div.tabs');
  for (const [k, m] of Object.entries(KIND_META)) {
    const count = k === 'items' && ui.hideBlockItems
      ? splitBlockItems(reg[k] || [], true).shown.length
      : (reg[k] || []).length;
    const t = h('button.tab' + (k === ui.kind ? '.is-active' : ''), { type: 'button' });
    t.textContent = `${m.label}（${count}）`;
    t.addEventListener('click', () => { ui.kind = k; ui.page = 0; ui.q = ''; rerender(); });
    tabRow.appendChild(t);
  }

  const tb = textBox({
    placeholder: `搜索${meta.label} ID 或名称…（共 ${fmtNum(all.length)} 条）`,
    onInput: (v) => { ui.q = v.trim(); ui.page = 0; refresh(); },
  });
  tb.value = ui.q;
  setTimeout(refresh, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: `${meta.label}选择器` }),
        h('p.card-sub', { text: `${meta.hint} · 数据源：${SOURCE_LABEL[reg.source] || reg.source} · 版本 ${reg.version}` }),
      ]),
      h('div.row', null, [
        countBadge,
        button({ label: '重新检索', variant: 'subtle', small: true, iconName: 'reload', disabled: state.registryBusy, onClick: async () => { await loadRegistry({ force: true }); notify('registry'); } }),
      ]),
    ]),
    tabRow,
    blockItemNotice(hiddenBlockItems.length, () => { ui.hideBlockItems = !ui.hideBlockItems; ui.page = 0; rerender(); }),
    h('div.pk-toolbar', null, [
      h('div', { style: { flex: '1', minWidth: '220px' } }, tb),
      toggleSwitch({ label: '只看有图标', checked: ui.withIcon, onChange: (v) => { ui.withIcon = v; ui.page = 0; refresh(); } }),
      prevBtn,
      pageInfo,
      nextBtn,
    ]),
    gridHost,
  ]);
}

/**
 * 把列表拆成「要显示的」和「被隐藏的方块物品」。
 * enabled=false 时原样返回，什么都不藏。
 */
function splitBlockItems(list, enabled) {
  if (!enabled) return { shown: list, hidden: [] };
  const shown = [];
  const hidden = [];
  for (const e of list) (isBlockItem(e.id) ? hidden : shown).push(e);
  return { shown, hidden };
}

/**
 * 「已隐藏 N 个方块物品」提示条 + 去「方块」页 + 显示全部开关。
 * 用户看到物品突然变少会以为坏了，所以必须说清楚发生了什么、能一键跳过去、也能一键看全量。
 */
function blockItemNotice(hiddenCount, onToggle) {
  return h('div.pk-toolbar#block-item-notice', { style: { alignItems: 'center', gap: '8px' } }, [
    badge(`已隐藏 ${fmtNum(hiddenCount)} 个方块物品`, hiddenCount ? '' : 'no'),
    h('span.tiny.muted', {
      style: { flex: '1', minWidth: '160px' },
      text: '方块物品在独立的「方块」页里；这里只留不是方块的物品（种子、桶、食物、线、红石粉…）。',
    }),
    button({
      label: '去「方块」页查看', variant: 'default', small: true, iconName: 'box',
      onClick: () => { state.page = 'blocks'; notify('navigate'); },
    }),
    toggleSwitch({
      label: '显示方块物品', checked: !ui.hideBlockItems,
      onChange: () => onToggle(),
    }),
  ]);
}

function cell(e, meta) {
  const isSel = selected[ui.kind] && selected[ui.kind].id === e.id;
  const el = h('div.pk-cell' + (isSel ? '.is-sel' : ''), { title: `${e.name}\n${e.id}` });

  const box = h('div.pk-ico');
  const fallback = () => {
    clear(box);
    box.appendChild(h('div', {
      style: {
        width: '34px', height: '34px', borderRadius: '8px', display: 'grid', placeItems: 'center',
        background: hashColor(e.id), color: '#fff', fontSize: '13px', fontWeight: '700',
      },
      text: initials(e.name || e.id),
    }));
  };

  if (e.icon) {
    const img = h('img', { src: e.icon, alt: e.name, loading: 'lazy', onerror: fallback });
    box.appendChild(img);
  } else if (e.iconLoader) {
    // jar 源：图标按需从 jar 解出
    if (e.__blobUrl) box.appendChild(h('img', { src: e.__blobUrl, alt: e.name, loading: 'lazy', onerror: fallback }));
    else {
      box.appendChild(h('div', { style: { width: '34px', height: '34px', borderRadius: '8px', background: 'var(--subtle-tertiary)' } }));
      if (!e.__loading) {
        e.__loading = true;
        e.iconLoader().then((url) => {
          e.__loading = false;
          if (!url) { fallback(); return; }
          e.__blobUrl = url;
          clear(box);
          box.appendChild(h('img', { src: url, alt: e.name, loading: 'lazy', onerror: fallback }));
        }).catch(() => { e.__loading = false; fallback(); });
      }
    }
  } else {
    fallback();
  }

  el.appendChild(box);
  el.appendChild(h('div.pk-name', { text: e.name || e.id }));
  el.appendChild(h('div.pk-id', { text: e.id }));
  el.addEventListener('click', () => {
    selected[ui.kind] = e;
    rerender();
  });
  void meta;
  return el;
}

/* ============================ 已选中面板 ============================ */

function selectedCard() {
  const e = selected[ui.kind];
  if (!e) {
    return h('div.card.tight', null, [
      h('p.card-sub', { style: { margin: '0' }, text: '点选任意条目后，这里会给出可直接使用的 ID 与命令模板。' }),
    ]);
  }
  const V = state.version;
  const meta = KIND_META[ui.kind];

  let preview = '';
  let genLabel = '';
  if (ui.kind === 'items') {
    preview = buildGive(V, { targets: '@s', item: `minecraft:${e.id}`, count: 1 });
    genLabel = '/give';
  } else if (ui.kind === 'entities') {
    preview = buildSummon(V, { entity: `minecraft:${e.id}`, pos: '~ ~ ~' });
    genLabel = '/summon';
  } else {
    preview = buildParticle(V, { particle: `minecraft:${e.id}` });
    genLabel = '/particle';
  }

  const idLine = ui.kind === 'particles' ? e.id : `minecraft:${e.id}`;

  return h('div.card', null, [
    h('div.row', null, [
      badge(`已选中${meta.label}`, 'accent'),
      h('span.mono', { text: idLine }),
      h('span.muted.tiny', { text: e.name || '' }),
      h('span.spacer'),
      button({ label: '复制 ID', variant: 'default', small: true, iconName: 'copy', onClick: async () => { (await copy(idLine)) ? toast('已复制 ID') : toast('复制失败', 'error'); } }),
      button({ label: '送进命令编辑器', variant: 'default', small: true, iconName: 'terminal', onClick: () => { state.commandDraft = '/' + preview; state.page = 'commands'; notify('navigate'); } }),
      button({ label: '送进节点图', variant: 'accent', small: true, iconName: 'link', onClick: () => addNodeFor(e) }),
    ]),
    h('div', { style: { marginTop: '10px' } }, [
      h('div.tiny.muted', { text: `${genLabel} 模板（按 ${V} 的语法生成${ui.kind === 'items' ? ` · ${stackSyntax(V) === 'components' ? '数据组件' : 'NBT'} 语法` : ''}）` }),
      h('div.code', { text: preview }),
    ]),
  ]);
}

async function addNodeFor(e) {
  const { state: st } = await import('../../core/store.js');
  const type = ui.kind === 'items' ? 'give' : ui.kind === 'entities' ? 'summon' : 'particle';
  const key = ui.kind === 'items' ? 'item' : ui.kind === 'entities' ? 'entity' : 'particle';
  const g = st.graph || null;
  const id = e.id;
  const patch = { [key]: ui.kind === 'particles' ? `minecraft:${id}` : `minecraft:${id}` };
  if (!g) {
    const { defaultCommandGraph } = await import('../../graph/command-graph.js');
    st.graph = defaultCommandGraph(st.version);
  }
  st.graph.nodes.push({ id: `pick_${Date.now().toString(36)}`, type, x: 340, y: 260 + st.graph.nodes.length * 20, values: patch });
  notify('graph');
  toast(`已在节点图中添加 ${type} 节点`);
  st.page = 'commands';
  notify('navigate');
}

export function statsLine() {
  if (legacyMode()) {
    const c = LEGACY_META.counts;
    return `数字 ID ${c.numericIds} 个 · ${c.entries} 条 · 带数据值 ${c.withData}`;
  }
  const r = state.registry;
  if (!r) return '';
  return `物品 ${r.items.length} · 实体 ${r.entities.length} · 粒子 ${r.particles.length}`;
}

void combo; void statCard; void esc;
