// fuzzy.js —— 条目模糊搜索：子序列匹配 + 编辑距离容错 + 别名（基岩版译名 / 旧译名）
// 用户要求：「输物品 ID/中文名/基岩版名，模糊搜索 + 补全，常见拼写错误也要能补上」

export function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[\s_\-·。、，,.!'"（）()\[\]]/g, '');
}

/**
 * 子序列匹配：q 的字符按序出现在 s 中（允许穿插）。
 * 返回 0..1 的紧凑度（跨度越接近 q 长度越好）；未匹配返回 -1。
 * 例：q="ds" 能命中 "diamondsword"。
 */
export function subsequenceScore(q, s) {
  if (!q) return 0;
  if (!s) return -1;
  let qi = 0, first = -1, last = -1;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { if (first < 0) first = i; last = i; qi++; }
  }
  if (qi < q.length) return -1;
  const span = last - first + 1;
  return 1 - (span - q.length) / Math.max(1, s.length);
}

/** 带上限剪枝的编辑距离，用于拼写容错（Levenshtein） */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/**
 * 词首缩写匹配：q 的字符依次命中 s 各个「词」的首字符。
 * 例：q="ds" → diamond_sword（d 是 diamond 首字、s 是 sword 首字）命中；
 *     而 beetroot_seeds 里的 d、s 都在词内部（beetroot / seeds），不命中。
 * 返回 0..1 的质量，未命中返回 -1。
 */
export function wordInitialsScore(q, s) {
  if (!q || !s) return -1;
  const tokens = [];
  let cur = '';
  for (const ch of s) {
    const isCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
    if (ch === '_' || ch === '-' || ch === ' ' || isCJK) {
      if (cur) { tokens.push(cur); cur = ''; }
      if (isCJK) tokens.push(ch);
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  if (tokens.length < q.length) return -1;
  let ti = 0;
  for (let i = 0; i < q.length; i++) {
    let found = -1;
    for (let j = ti; j < tokens.length; j++) {
      if (tokens[j][0] === q[i]) { found = j; break; }
    }
    if (found < 0) return -1;
    ti = found + 1;
  }
  // 命中的 token 越紧凑越好（不跳词）
  return 1 - (ti - q.length) / Math.max(1, tokens.length);
}

/**
 * 给单个条目打分。返回 -1 表示不匹配；分数越高越靠前。
 * @param {object} e       条目
 * @param {string} q       查询串
 * @param {string[]} aliases 该条目的别名（基岩版 ID、旧译名、常用俗称）
 */
export function scoreEntry(e, q, aliases = null) {
  const nq = normalize(q);
  if (!nq) return 0;
  const nid = normalize(e.id);
  const nname = normalize(e.name);
  // 词首缩写必须用「保留下划线」的原始形式，否则词边界丢失、缩写判断失效
  const rid = String(e.id == null ? '' : e.id).toLowerCase().replace(/^minecraft:/, '');
  const rname = String(e.name == null ? '' : e.name).toLowerCase();
  const nali = aliases && aliases.length ? aliases.map(normalize).filter(Boolean) : [];

  if (nid === nq) return 1000;
  if (nname && nname === nq) return 990;
  if (nali.some((a) => a === nq)) return 950;

  if (nid.startsWith(nq)) return 900 - Math.min(60, nid.length * 0.4);
  if (nname && nname.startsWith(nq)) return 880 - Math.min(60, nname.length * 0.4);
  if (nali.some((a) => a.startsWith(nq))) return 860;

  // 词首缩写（ds → diamond_sword、sb → stone_bricks）：必须排在「子串包含」之前。
  // diamond_sword 和 beetroot_seeds 内部都含 "ds"，只走 includes 会拿同一个分数，
  // 排序退化成按字母表 → 缩写搜索失效（实测踩过这个坑）。
  if (nq.length >= 2) {
    const ini = Math.max(
      wordInitialsScore(nq, rid),
      rname ? wordInitialsScore(nq, rname) : -1,
    );
    if (ini >= 0) return 810 + ini * 40;
  }

  if (nid.includes(nq)) return 700;
  if (nname && nname.includes(nq)) return 680;
  if (nali.some((a) => a.includes(nq))) return 640;

  // 松散子序列（字符按序出现即可，允许穿插）
  if (nq.length >= 2) {
    const sub = Math.max(subsequenceScore(nq, nid), nname ? subsequenceScore(nq, nname) : -1);
    if (sub >= 0) return 400 + sub * 100;
  }

  // 拼写容错：查询够长时才启用，避免短查询命中一大片噪声
  if (nq.length >= 4) {
    const d = Math.min(editDistance(nq, nid, 2), nname ? editDistance(nq, nname, 2) : 3);
    if (d <= 2) return 300 - d * 60;
  }
  return -1;
}

/**
 * 搜索条目列表并排序。
 * @param {object[]} entries
 * @param {string} q
 * @param {object} o { aliasesOf(e) -> string[], limit }
 */
export function searchEntries(entries, q, { aliasesOf = null, limit = 40 } = {}) {
  if (!q || !normalize(q)) return [];
  const out = [];
  for (const e of entries) {
    const s = scoreEntry(e, q, aliasesOf ? aliasesOf(e) : null);
    if (s > 0) out.push({ e, s });
  }
  // 同分排序：只用确定性的字母序。
  // 试过「ID 更短者优先」当通用性代理，结果 diorite_slab 压过了 diamond_sword —— 长度不是相关度，
  // 而「哪个物品更常用」没有可取证的数据源，编不得。缩写天然歧义，交给下拉列表让用户挑。
  out.sort((a, b) => b.s - a.s || String(a.e.id).localeCompare(String(b.e.id)));
  return out.slice(0, limit).map((x) => x.e);
}
