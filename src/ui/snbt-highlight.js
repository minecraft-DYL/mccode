// snbt-highlight.js —— SNBT / JSON 文本高亮（NBT 编辑器与物品组件编辑器共用）
//
// 为什么单独一个模块：nbt.js 原本自带 highlightSNBT，components.js 只有白板文本框。
// 用户要求「所有编辑器都要有 JSON 高亮」，于是把高亮抽到这里，两个页面用同一份实现，
// 避免两套正则各自漂移。
//
// 两条路径：
//   · highlightSNBT(text)  —— 走 core/nbt.js 的完整 SNBT 词法器（能识别数值后缀 b/s/l/f/d、
//     类型化数组 [B;]、未加引号的键）。NBT 编辑器主用这条。
//   · highlightJSONish(text) —— 纯词法扫描、不做语法校验，SNBT 与 JSON 都能着色。
//     物品组件的值是「JSON 风格的 SNBT」，用这条更稳（缺引号的键也照样着色）。

import { h, esc } from '../core/util.js';
import { highlightSNBT as snbtToHtml } from '../core/nbt.js';

export { snbtToHtml as highlightSNBT };

const RE_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[bslfdBSLFD]?)|([A-Za-z_][\w.:+\-/]*)|([{}[\]():,;=])|(\s+)/g;

/**
 * JSON 风格 / SNBT 通用高亮。返回 HTML 字符串（调用方自己塞 innerHTML）。
 * 不改动语义、不做校验，永远能渲染 —— 半截输入也有颜色。
 *
 * 刻意复用 app.css 已有的 .k-* 令牌类（.code .k-str/.k-num/.k-lit/.k-sel），
 * 这样与 NBT 编辑器原有的 highlightSNBT 配色完全一致，且不需要新增全局样式。
 */
export function highlightJSONish(text) {
  const s = String(text ?? '');
  let out = '';
  let last = 0;
  RE_TOKEN.lastIndex = 0;
  let m;
  while ((m = RE_TOKEN.exec(s)) !== null) {
    if (m.index > last) out += esc(s.slice(last, m.index));
    const [full, comment, str, num, word, punct] = m;
    if (comment) out += `<span class="k-lit">${esc(comment)}</span>`;
    else if (str) out += `<span class="k-str">${esc(str)}</span>`;
    else if (num) out += `<span class="k-num">${esc(num)}</span>`;
    else if (word) {
      // 后跟 ':' 的裸词是键名；true/false/null 是字面量
      const rest = s.slice(m.index + full.length);
      const isKey = /^\s*:/.test(rest);
      const lower = word.toLowerCase();
      if (isKey) out += `<span class="k-key">${esc(word)}</span>`;
      else if (lower === 'true' || lower === 'false' || lower === 'null') out += `<span class="k-num">${esc(word)}</span>`;
      else out += `<span class="k-sel">${esc(word)}</span>`;
    } else if (punct) out += `<span class="k-lit">${esc(punct)}</span>`;
    else out += esc(full ?? '');
    last = m.index + full.length;
    if (full === '') break;   // 防御死循环
  }
  if (last < s.length) out += esc(s.slice(last));
  return out;
}

/**
 * 生成一个带高亮的编辑区：底层 <pre> 放高亮 HTML，上层透明 <textarea> 负责编辑。
 * 两个页面共用，保证「所见即所得」的高亮与文本严格对齐。
 *
 * 【返回值形状 —— 曾经的崩溃源头，务必按下面约定用】
 *   · 不传 o.attach（**项目里统一用这种**）：
 *       返回 { box, ta, pre, sync, autosize }
 *       box 是要放进 DOM 的容器，ta 才是真正的 <textarea>，
 *       sync() 在**程序化改写 ta.value 之后**必须调一次，否则高亮层不刷新。
 *   · 传 o.attach：
 *       自动把编辑区挂到 attach 上，并直接返回 <textarea>。
 *       这条分支保留给外部调用方，但因为它拿不到 sync()，
 *       凡是需要「代码改文本再重画高亮」的场景（节点图回写）都不能用它。
 *   两个分支都会给 textarea 挂 `__box` 指向外层容器，便于临时取容器。
 *
 *   ⚠️ 历史教训：nbt.js / components.js 曾经写成
 *        const ta = highlightArea(v, {...});
 *        ta.style.minHeight = '220px';
 *      不传 attach 时 ta 其实是 {box,ta,pre,…}，赋值 style.minHeight 会抛
 *      TypeError: Cannot set properties of undefined (setting 'minHeight')，整页白屏。
 *      现在两个页面的全部 3 处调用都统一走「对象返回值 + hl.ta」。
 *
 * 对齐做法：外层用 CSS Grid 把 pre 与 textarea 叠在同一个格子里（grid-area 相同），
 * 于是两者行高、内边距、换行完全一致，且不需要任何 JS 去同步高度。
 *
 * @param {string} value     初始文本
 * @param {object} o
 *   o.mono        字号（默认 12.5px）
 *   o.rows        最小行数，用于占位高度
 *   o.mode        'snbt' | 'json'  选高亮器
 *   o.placeholder
 *   o.onInput     (value, el) => void
 *   o.autoGrow    高度随内容自增（grid 下只需同步 rows）
 *   o.attach      可选；非空时把生成的编辑区挂到该元素上，并直接返回 textarea
 * @returns {HTMLTextAreaElement | {box:HTMLElement, ta:HTMLTextAreaElement, pre:HTMLElement, sync:Function, autosize:Function}}
 */
export function highlightArea(value, o = {}) {
  const mode = o.mode === 'json' ? 'json' : 'snbt';
  const paint = (t) => (mode === 'json' ? highlightJSONish(t) : snbtToHtml(t));

  const pre = h('pre.snbt-hl', { 'aria-hidden': 'true' });
  const ta = h('textarea.snbt-edit', {
    spellcheck: false, placeholder: o.placeholder || '',
    rows: o.rows || 6,
  });
  ta.value = value ?? '';

  const box = h('div.snbt-box', { style: { fontSize: (o.mono || 12.5) + 'px' } }, [pre, ta]);
  ta.__box = box;

  const sync = () => { pre.innerHTML = paint(ta.value) + '\n'; };
  /** grid 叠加下不用改高度，只需要保证行数够（内容超了就靠 rows 自增） */
  const autosize = () => {
    if (!o.autoGrow) return;
    const lines = String(ta.value || '').split('\n').length;
    const want = Math.max(lines + 1, o.rows || 6);
    if (Number(ta.rows) !== want) ta.rows = want;
  };
  ta.addEventListener('input', () => { autosize(); sync(); if (o.onInput) o.onInput(ta.value, ta); });

  sync();
  // 初始 autosize 放到下一个 tick：此时元素多半已进 DOM，能按真实内容定行数
  setTimeout(() => { autosize(); sync(); }, 0);

  const api = { box, ta, pre, sync, autosize };
  if (o.attach) { o.attach.appendChild(box); return ta; }
  return api;
}
