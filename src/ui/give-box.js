// give-box.js —— /give 指令输入框（用户要求：give 前缀锁死，后面输物品 ID / 中文名 / 基岩版名）
// 交互：锁定前缀 → 目标选择器 → 模糊补全物品（图标 + 中文名 + ID）→ 数量 → 实时生成命令。
// 选中后右侧显示图标；没有图标时由 itemIcon 回退为文字首字，绝不出现裸键名。
import { h, clear, copy } from '../core/util.js';
import { state } from '../core/store.js';
import { searchEntries } from '../core/fuzzy.js';
import { itemIcon } from './item-icon.js';
import { buildGive } from '../core/commands.js';
import { aliasesFor, isBedrockOnly, resolveBedrock } from '../data/item-aliases.js';

const TARGETS = [
  { v: '@s', d: '执行者自己' },
  { v: '@p', d: '最近的玩家' },
  { v: '@a', d: '所有玩家' },
  { v: '@r', d: '随机一名玩家' },
  { v: '@e', d: '所有实体' },
  { v: '@n', d: '最近的实体' },
];

const SUGG_MAX = 30;

/**
 * 构造一个 /give 输入框。
 * @param {object} o
 * @param {(v:{command:string,item:object|null,count:number,target:string})=>void} o.onChange
 */
export function giveBox({ onChange = null } = {}) {
  const st = { target: '@s', text: '', item: null, count: 1, sugg: [], active: -1 };

  const root = h('div.give-box');

  /* ---------------- 前缀（锁定） ---------------- */
  const prefix = h('div.give-prefix', { title: '命令名固定在 /give，不可编辑' }, [
    h('span.give-slash', { text: '/' }),
    h('span.give-word', { text: 'give' }),
    h('span.give-lock', { text: '锁定' }),
  ]);

  /* ---------------- 目标选择器（自绘，非原生 select） ---------------- */
  const targetBtn = h('button.give-target', { type: 'button', title: '选择目标' });
  const targetMenu = h('div.give-menu');
  let targetOpen = false;
  const closeTarget = () => { targetOpen = false; targetMenu.classList.remove('is-open'); };
  const openTarget = () => {
    closeSugg();
    targetOpen = true;
    clear(targetMenu);
    for (const t of TARGETS) {
      const it = h('div.give-menu-item' + (t.v === st.target ? '.is-active' : ''), null, [
        h('span.give-menu-label', { text: t.v }),
        h('span.give-menu-desc', { text: t.d }),
      ]);
      it.addEventListener('click', () => { st.target = t.v; closeTarget(); syncTarget(); emit(); input.focus(); });
      targetMenu.appendChild(it);
    }
    targetMenu.classList.add('is-open');
  };
  const syncTarget = () => { targetBtn.textContent = st.target; targetBtn.appendChild(h('span.give-caret', { text: '▾' })); };
  targetBtn.addEventListener('click', (e) => { e.stopPropagation(); targetOpen ? closeTarget() : openTarget(); });

  /* ---------------- 物品输入 + 补全 ---------------- */
  const input = h('input.give-input', {
    type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: '输物品 ID / 中文名 / 基岩版名，如 stone、石头、ds…',
  });
  const sugg = h('div.give-sugg');

  const closeSugg = () => { st.sugg = []; st.active = -1; clear(sugg); sugg.classList.remove('is-open'); };

  const pick = (e) => {
    st.item = e;
    st.text = e.id;
    input.value = e.id;
    closeSugg();
    renderIcon();
    emit();
  };

  const refreshSugg = () => {
    const items = (state.registry && state.registry.items) || [];
    if (!items.length || !st.text.trim()) { closeSugg(); return; }
    const hits = searchEntries(items, st.text, { aliasesOf: aliasesFor, limit: SUGG_MAX });
    st.sugg = hits;
    st.active = hits.length ? 0 : -1;
    drawSugg();
  };

  const drawSugg = () => {
    clear(sugg);
    if (!st.sugg.length) {
      sugg.classList.remove('is-open');
      const raw = st.text.trim();
      if (raw) {
        let msg = `没有匹配「${raw}」的物品。回车可直接把它当 ID 使用。`;
        if (isBedrockOnly(raw)) msg = `「${raw}」是基岩版 / 教育版专属内容，Java 版没有对应物品。`;
        else {
          const mapped = resolveBedrock(raw);
          if (mapped) msg = `「${raw}」是基岩版旧名，对应 Java 的 ${mapped}。回车采用它。`;
        }
        sugg.appendChild(h('div.give-sugg-empty', { text: msg }));
        sugg.classList.add('is-open');
      }
      return;
    }
    st.sugg.forEach((e, i) => {
      const row = h('div.give-sugg-row' + (i === st.active ? '.is-active' : ''), null, [
        itemIcon(e, 28),
        h('div.give-sugg-meta', null, [
          h('div.give-sugg-name', { text: e.name || e.id }),
          h('div.give-sugg-id', { text: e.id }),
        ]),
      ]);
      // 注意：mouseenter 里**不能**重建列表。重建会把光标下的这个节点 clear 掉，
      // 紧随其后的 mousedown 就落在一个已经被移除的元素上，pick() 永远不触发
      // —— 症状是「点了候选，命令里还是原来输入的那串字」。这里只切 class。
      row.addEventListener('mouseenter', () => {
        st.active = i;
        const prev = sugg.querySelector('.give-sugg-row.is-active');
        if (prev && prev !== row) prev.classList.remove('is-active');
        row.classList.add('is-active');
      });
      // mousedown 只负责保住输入框焦点（防止 blur 把列表收掉），真正的选中放在 click 上
      row.addEventListener('mousedown', (ev) => ev.preventDefault());
      row.addEventListener('click', (ev) => { ev.preventDefault(); pick(e); });
      sugg.appendChild(row);
    });
    sugg.classList.add('is-open');
    const act = sugg.querySelector('.is-active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    st.text = input.value;
    st.item = null;
    renderIcon();
    refreshSugg();
    emit();
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' && st.sugg.length) { ev.preventDefault(); st.active = (st.active + 1) % st.sugg.length; drawSugg(); return; }
    if (ev.key === 'ArrowUp' && st.sugg.length) { ev.preventDefault(); st.active = (st.active - 1 + st.sugg.length) % st.sugg.length; drawSugg(); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (st.sugg.length && st.active >= 0) pick(st.sugg[st.active]);
      else if (st.text.trim()) {
        // 允许直接输入原始 ID；也接受基岩版旧名（如 reeds → sugar_cane）
        const raw = st.text.trim().replace(/^minecraft:/, '');
        const items = (state.registry && state.registry.items) || [];
        const mapped = resolveBedrock(raw);
        const hit = items.find((x) => x.id === raw) || (mapped ? items.find((x) => x.id === mapped) : null) || null;
        if (hit) pick(hit); else { closeSugg(); emit(); }
      }
      return;
    }
    if (ev.key === 'Escape') { closeSugg(); return; }
  });

  input.addEventListener('focus', refreshSugg);
  input.addEventListener('blur', () => setTimeout(closeSugg, 120));

  /* ---------------- 数量 ---------------- */
  // Java 版物品单堆上限从来不是 6400：绝大多数是 64，少数 16/1，个别可堆叠到 99。
  // 用 /give 指令可以直接指定到 99 个（超出一堆，游戏照样给）。
  const COUNT_MAX = 99;
  const countInput = h('input.give-count', {
    type: 'number', min: '1', max: String(COUNT_MAX), value: '1',
    title: `数量（1–${COUNT_MAX}）。一般物品一堆 64；超过 64 属于超堆叠，靠 /give 指令给出。`,
  });
  countInput.addEventListener('input', () => {
    const n = parseInt(countInput.value, 10);
    st.count = Number.isFinite(n) && n > 0 ? Math.min(COUNT_MAX, n) : 1;
    if (Number.isFinite(n) && n > COUNT_MAX) countInput.value = String(COUNT_MAX);
    emit();
  });
  countInput.addEventListener('blur', () => { countInput.value = String(st.count); });

  /* ---------------- 图标槽 ---------------- */
  const iconSlot = h('div.give-icon-slot');
  const renderIcon = () => {
    clear(iconSlot);
    if (st.item) { iconSlot.appendChild(itemIcon(st.item, 32)); return; }
    iconSlot.appendChild(h('div.give-icon-empty', { title: '识别到物品后在这里显示图标', text: '?' }));
  };

  /* ---------------- 清空 ---------------- */
  const clearBtn = h('button.give-clear', { type: 'button', title: '清空物品' });
  clearBtn.textContent = '×';
  clearBtn.addEventListener('click', () => {
    st.item = null; st.text = ''; input.value = ''; closeSugg(); renderIcon(); emit(); input.focus();
  });

  /* ---------------- 组装 ---------------- */
  const line = h('div.give-line', null, [
    prefix,
    h('div.give-target-wrap', null, [targetBtn, targetMenu]),
    h('div.give-input-wrap', null, [input, sugg]),
    countInput,
    iconSlot,
    clearBtn,
  ]);

  const out = h('div.give-out');
  const cmdText = h('code.give-cmd');
  const copyBtn = h('button.btn.btn-sm.btn-subtle', { type: 'button', title: '复制命令' });
  copyBtn.textContent = '复制';
  copyBtn.addEventListener('click', async () => {
    const c = currentCommand();
    if (!c) return;
    try { await copy(c); copyBtn.textContent = '已复制'; setTimeout(() => { copyBtn.textContent = '复制'; }, 1200); }
    catch { copyBtn.textContent = '复制失败'; setTimeout(() => { copyBtn.textContent = '复制'; }, 1200); }
  });
  const hint = h('span.give-hint');
  out.appendChild(h('div.give-out-line', null, [cmdText, copyBtn]));
  out.appendChild(hint);

  root.appendChild(line);
  root.appendChild(out);

  /* ---------------- 输出 ---------------- */
  function resolvedId() {
    if (st.item) return st.item.id;
    const raw = st.text.trim().replace(/^minecraft:/, '');
    return raw || '';
  }

  function currentCommand() {
    const id = resolvedId();
    if (!id) return '';
    const full = id.includes(':') ? id : `minecraft:${id}`;
    const raw = buildGive(state.version, { targets: st.target, item: full, count: st.count });
    // buildGive 不带前导斜杠，这里补上，保证「复制」拿到的是可直接粘贴进聊天栏的完整命令
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  let lastEmit = '';
  function emit() {
    const cmd = currentCommand();
    cmdText.textContent = cmd || '/give …（先输入物品）';
    const raw = st.text.trim();
    if (st.item) {
      hint.textContent = `已识别：${st.item.name || st.item.id}（${st.item.id}）`
        + (st.count > 64 ? `　·　数量 ${st.count} 已超过一堆（64），属于超堆叠，只有指令能给出` : '');
    }
    else if (raw && isBedrockOnly(raw)) hint.textContent = `「${raw}」是基岩版 / 教育版专属内容，Java 版没有对应物品。`;
    else if (raw && resolveBedrock(raw)) hint.textContent = `「${raw}」是基岩版旧名，对应 Java 的 ${resolveBedrock(raw)}。`;
    else if (raw) hint.textContent = '未在注册表中匹配到；按回车可直接按 ID 使用';
    else hint.textContent = '提示：可输入中文名，或用缩写（如 ds → diamond_sword）；基岩版旧名（如 reeds）也认';
    if (onChange && cmd !== lastEmit) { lastEmit = cmd; onChange({ command: cmd, item: st.item, count: st.count, target: st.target }); }
  }

  // 点击外部关闭下拉
  const onDocDown = (ev) => {
    if (!root.contains(ev.target)) { closeSugg(); closeTarget(); return; }
    if (!st.target && !targetOpen) closeTarget();
    if (targetOpen && !targetMenu.contains(ev.target) && ev.target !== targetBtn) closeTarget();
  };
  document.addEventListener('mousedown', onDocDown);
  root.__dispose = () => document.removeEventListener('mousedown', onDocDown);

  syncTarget();
  renderIcon();
  emit();

  return root;
}

/** 供外部（如巡检脚本）读取当前注册表规模，便于自检 */
export function giveBoxSelfCheck() {
  return { hasRegistry: !!(state.registry && state.registry.items && state.registry.items.length) };
}
