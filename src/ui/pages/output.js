// pages/output.js —— 三个产出通道：.mcfunction 函数文件 / 命令方块 / 聊天框单条指令

import { h, clear, copy, dl, esc } from '../../core/util.js';
import { state, notify, capAvailable, capLabel, saveDrafts } from '../../core/store.js';
import { isDatapackEra, isBlockStateEra } from '../../core/versions.js';
import { toSNBT, NBTNumber } from '../../core/nbt.js';
import { buildDatapack, packFormatSince } from '../../core/datapack.js';
import { highlightCommand, validateCommand, commandName } from '../../core/commands.js';
import { button, textBox, badge, infoBar, toast, combo, emptyState } from '../controls.js';

export const meta = {
  id: 'output',
  title: '输出通道',
  subtitle: '.mcfunction 函数 / 命令方块 / 聊天框一条指令 —— 同一份命令，三种落地方式',
  icon: 'export',
};

let mode = null;
let ns = 'mypack';
let funcName = 'main';
let cbType = 'impulse';
let cbConditional = false;
let cbAuto = true;

export function render(root) {
  clear(root);
  if (mode === null) mode = state.outputMode || 'chat';

  const tabRow = h('div.tabs');
  for (const it of [
    { key: 'chat', label: '聊天框指令' },
    { key: 'mcfunction', label: '.mcfunction 函数' },
    { key: 'commandblock', label: '命令方块' },
  ]) {
    const t = h('button.tab' + (it.key === mode ? '.is-active' : ''), { type: 'button' });
    t.textContent = it.label;
    t.addEventListener('click', () => { mode = it.key; state.outputMode = mode; saveDrafts(); rerender(); });
    tabRow.appendChild(t);
  }

  root.appendChild(tabRow);
  root.appendChild(sourceCard());

  if (mode === 'chat') root.appendChild(chatCard());
  else if (mode === 'mcfunction') root.appendChild(functionCard());
  else root.appendChild(commandBlockCard());
}

function rerender() { const r = document.getElementById('pageView'); if (r && r.__pageRender) r.__pageRender(); }

function lines() {
  return String(state.commandDraft || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/* ============================ 源 ============================ */

function sourceCard() {
  const ta = h('textarea.tb.mono', { rows: 5, spellcheck: false, style: { fontSize: '12.5px', lineHeight: '1.6' } });
  ta.value = state.commandDraft || '';
  ta.addEventListener('input', () => { state.commandDraft = ta.value; saveDrafts(); updatePreview(); });

  const check = h('div.row', { style: { marginTop: '8px' } });
  function updatePreview() {
    const ls = lines();
    clear(check);
    check.appendChild(badge(`${ls.length} 行命令`, ls.length ? 'ok' : 'no'));
    const bad = ls.map((l) => validateCommand(l, state.version)).filter((r) => !r.ok);
    if (bad.length) check.appendChild(badge(`${bad.length} 行有问题`, 'partial'));
    else if (ls.length) check.appendChild(badge('全部通过语法检查', 'ok'));
    if (bad.length) check.appendChild(h('span.tiny.muted', { text: bad[0].message }));
  }
  setTimeout(updatePreview, 0);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('h2.card-title', { text: '命令源（每行一条）' }),
      h('div.row', null, [
        button({
          label: '从节点图取命令', variant: 'subtle', small: true, iconName: 'link',
          onClick: async () => {
            if (!state.graph) return toast('节点图还是空的', 'error');
            const { commandsFromGraph, commandNodeTypes } = await import('../../graph/command-graph.js');
            const { NodeGraph } = await import('../../graph/nodegraph.js');
            const tmpHost = document.createElement('div');
            tmpHost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:600px';
            document.body.appendChild(tmpHost);
            const g = new NodeGraph(tmpHost, { types: new Map(Object.entries(commandNodeTypes(state.version))), data: state.graph });
            const { lines: out, sinks } = commandsFromGraph(g, state.version);
            g.destroy(); tmpHost.remove();
            state.commandDraft = [...out.map((o) => o.cmd), ...sinks.map((s) => s.cmd)].join('\n');
            saveDrafts(); rerender();
            toast('已从节点图取回命令');
          },
        }),
        button({
          label: '格式化', variant: 'subtle', small: true,
          onClick: () => { state.commandDraft = lines().join('\n'); saveDrafts(); rerender(); },
        }),
      ]),
    ]),
    ta,
    check,
  ]);
}

/* ============================ 聊天框 ============================ */

function chatCard() {
  const ls = lines();
  const first = ls[0] || '';
  const cmd = first.startsWith('/') ? first : '/' + first;
  const multi = ls.length > 1;

  const preview = h('div.code', { style: { marginTop: '8px' } });
  preview.innerHTML = highlightCommand(cmd, state.version);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '聊天框一条指令' }),
        h('p.card-sub', { text: '聊天栏一次只能执行一条命令；多行时这里取第一行，其余请用函数或命令方块。' }),
      ]),
      badge(first ? '就绪' : '无内容', first ? 'ok' : 'no'),
    ]),
    multi ? infoBar({ level: 'warning', title: `源里有 ${ls.length} 行`, text: '聊天框一次只接受一条命令，已取第一行。要一次跑完请切到「.mcfunction 函数」或把命令塞进命令方块链。' }) : null,
    !first ? emptyState('还没有命令', '回到「命令编辑器」写一条，或在上面直接输入') : h('div', null, [
      preview,
      h('div.row', { style: { marginTop: '10px' } }, [
        button({ label: '复制指令', variant: 'accent', small: true, iconName: 'copy', onClick: async () => { (await copy(cmd)) ? toast('已复制，去游戏里粘贴到聊天栏') : toast('复制失败', 'error'); } }),
        button({ label: '校验', variant: 'default', small: true, onClick: () => { const r = validateCommand(cmd, state.version); toast(r.message, r.ok ? 'info' : 'error'); } }),
      ]),
      h('p.tiny.muted', { style: { marginTop: '10px' }, text: capAvailable('chatcommand') ? '该版本支持在聊天框直接执行命令。' : '注意：该版本下聊天框命令能力受限或不可用。' }),
    ]),
  ]);
}

/* ============================ .mcfunction ============================ */

function functionCard() {
  const ls = lines();
  const content = ls.join('\n') + (ls.length ? '\n' : '');

  const nsInput = textBox({ value: ns, onInput: (v) => { ns = v.replace(/[^a-z0-9_.-]/gi, ''); updatePath(); }, width: '150px' });
  const fnInput = textBox({ value: funcName, onInput: (v) => { funcName = v.replace(/[^a-z0-9_./-]/gi, ''); updatePath(); }, width: '150px' });
  const pathBox = h('div.code', { style: { marginTop: '8px' } });

  function updatePath() {
    const modern = isDatapackEra(state.version);
    const dir = modern ? `data/${ns || 'mypack'}/function/` : `saves/<存档>/data/functions/`;
    clear(pathBox);
    pathBox.appendChild(h('div', { text: `${dir}${modern ? (funcName || 'main') : (funcName || 'main')}.mcfunction` }));
    pathBox.appendChild(h('div.tiny.muted', { style: { marginTop: '6px' }, text: modern ? `执行：/function ${ns || 'mypack'}:${funcName || 'main'}` : `执行：/function ${funcName || 'main'}` }));
    if (!modern) pathBox.appendChild(h('div.tiny.muted', { text: '注意：1.13 之前函数目录结构与命名空间不同，命令方块与函数均无命名空间。' }));
  }
  setTimeout(updatePath, 0);

  const preview = h('div.code', { style: { marginTop: '8px', maxHeight: '260px' } });
  preview.innerHTML = ls.map((l) => highlightCommand(l, state.version)).join('<br>') || '<span class="muted">（空）</span>';

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '.mcfunction 函数文件' }),
        h('p.card-sub', { text: '函数自 1.12 引入；1.13 起随数据包放在 data/<命名空间>/function/ 下。' }),
      ]),
      badge(capAvailable('mcfunction') ? capLabel('mcfunction') : '不可用', capAvailable('mcfunction') ? 'ok' : 'no'),
    ]),
    h('div.row', null, [
      h('span.tiny.muted', { text: '命名空间' }), nsInput,
      h('span.tiny.muted', { text: '函数名' }), fnInput,
      button({ label: '导出 .mcfunction', variant: 'accent', small: true, iconName: 'download', onClick: () => { dl(`${funcName || 'main'}.mcfunction`, content); toast(`已导出 ${funcName || 'main'}.mcfunction`); } }),
      button({
        label: '导出数据包 zip', variant: 'default', small: true, iconName: 'export',
        onClick: () => exportDatapack(ls, ns, funcName),
      }),
      button({ label: '复制内容', variant: 'subtle', small: true, iconName: 'copy', onClick: async () => { (await copy(content)) ? toast('已复制') : toast('复制失败', 'error'); } }),
    ]),
    h('div.tiny.muted', { style: { marginTop: '10px' }, text: '文件路径' }),
    pathBox,
    h('div.tiny.muted', { style: { marginTop: '10px' }, text: '文件内容预览' }),
    preview,
  ]);
}

async function exportDatapack(ls, namespace, fn) {
  if (!ls.length) { toast('没有命令可导出', 'error'); return; }
  const built = buildDatapack({ namespace, functionName: fn, lines: ls, version: state.version });
  if (!built.ok) { toast(built.error, 'error'); return; }
  dl(built.fileName, new Blob([built.bytes], { type: 'application/zip' }));
  toast(`已导出数据包 ${built.fileName}（pack_format ${built.packFormat}，自 ${packFormatSince(state.version)} 起生效）`);
}

/* packFormat / zipStore 已下沉到 src/core/datapack.js（纯逻辑，可单测） */

/* ============================ 命令方块 ============================ */

function commandBlockCard() {
  const ls = lines();
  const cmd = ls[0] || '';
  const modern = isDatapackEra(state.version);
  const stateful = isBlockStateEra(state.version);

  const typeMap = { impulse: 'command_block', repeating: 'repeating_command_block', chain: 'chain_command_block' };
  const blockId = typeMap[cbType];

  const nbt = {};
  nbt.Command = cmd ? (cmd.startsWith('/') ? cmd.slice(1) : cmd) : '';
  if (cbAuto) nbt.auto = 1;
  else nbt.auto = 0;

  let blockArg;
  if (stateful) {
    blockArg = `${blockId}[conditional=${cbConditional ? 'true' : 'false'}${cbType === 'impulse' ? ',facing=up' : ''}]${toSNBT(nbt)}`;
  } else if (modern) {
    blockArg = `${blockId}${toSNBT({ ...nbt, conditional: cbConditional ? 1 : 0 })}`;
  } else {
    blockArg = blockId.replace('minecraft:', '') + ` 0 replace ` + toSNBT({ ...nbt, conditional: cbConditional ? 1 : 0 });
  }
  const setblock = modern ? `setblock ~ ~ ~ ${blockArg}` : `setblock ~ ~ ~ ${blockArg}`;

  const giveArg = modern
    ? `give @s minecraft:${blockId}[block_entity_data={id:"minecraft:${blockId}",Command:"${(cmd || '').replace(/"/g, '\\"')}"}]`
    : `give @s ${blockId} 1 0 {BlockEntityTag:{Command:"${(cmd || '').replace(/"/g, '\\"')}"}}`;

  const preview = h('div.code', { style: { marginTop: '8px' } });
  preview.innerHTML = highlightCommand(setblock, state.version);

  return h('div.card', null, [
    h('div.card-head', null, [
      h('div', null, [
        h('h2.card-title', { text: '命令方块' }),
        h('p.card-sub', { text: '命令方块自 1.4.2 加入；1.9 起有循环型与连锁型；1.19 起类型与朝向改用方块状态，不再是 NBT。' }),
      ]),
      badge(capAvailable('commandblock') ? capLabel('commandblock') : '不可用', capAvailable('commandblock') ? 'ok' : 'no'),
    ]),

    h('div.row', null, [
      h('span.tiny.muted', { text: '类型' }),
      combo({
        options: [{ value: 'impulse', label: '脉冲 impulse' }, { value: 'repeating', label: '循环 repeating' }, { value: 'chain', label: '连锁 chain' }],
        value: cbType, onChange: (v) => { cbType = v; rerender(); },
      }),
      button({ label: `条件${cbConditional ? '：开启' : '：关闭'}`, variant: cbConditional ? 'accent' : 'default', small: true, onClick: () => { cbConditional = !cbConditional; rerender(); } }),
      button({ label: `自动执行${cbAuto ? '：开' : '：关'}`, variant: cbAuto ? 'accent' : 'default', small: true, onClick: () => { cbAuto = !cbAuto; rerender(); } }),
    ]),

    ls.length > 1 ? infoBar({ level: 'warning', title: `源里有 ${ls.length} 行`, text: '命令方块一次只承载一条命令。多行请用「连锁命令方块链」：每个方块一条命令，首块触发后依次执行。' }) : null,

    h('div.tiny.muted', { style: { marginTop: '10px' }, text: '① 用 /setblock 放置命令方块并写入命令' }),
    preview,
    h('div.row', { style: { marginTop: '8px' } }, [
      button({ label: '复制 setblock', variant: 'accent', small: true, iconName: 'copy', onClick: async () => { (await copy(setblock)) ? toast('已复制') : toast('复制失败', 'error'); } }),
    ]),

    h('div.tiny.muted', { style: { marginTop: '14px' }, text: '② 或直接拿到一个带命令的命令方块物品' }),
    h('div.code', { text: giveArg }),
    h('div.row', { style: { marginTop: '8px' } }, [
      button({ label: '复制 give', variant: 'default', small: true, iconName: 'copy', onClick: async () => { (await copy(giveArg)) ? toast('已复制') : toast('复制失败', 'error'); } }),
    ]),

    h('div.sep'),
    h('div.tiny.muted', { text: `当前版本语法族：${stateful ? '方块状态（1.19+）' : modern ? '方块状态 + NBT（1.13–1.18）' : '数字 ID + NBT（1.12 及以前）'}` }),
    ls.length > 1 ? h('div', null, [
      h('div.tiny.muted', { style: { marginTop: '8px' }, text: '连锁命令方块链（多行时的推荐做法）' }),
      h('div.code', { text: ls.map((l, i) => {
        const t = i === 0 ? 'command_block' : 'chain_command_block';
        const st = modern ? `[conditional=false,facing=up]` : '';
        // auto 在原版 NBT 里是 TAG_Byte，不是 TAG_Int。
        // toSNBT 默认把数字渲染成 int（auto:1i），靠游戏的数值强转虽然能跑，
        // 但形状是错的 —— 而且同一函数下面那个旧格式分支写的就是 auto:1b，两边不一致。
        // 这里用 NBTNumber 显式指定后缀 b，跟原版和旧分支对齐。
        const body = modern
          ? toSNBT({ auto: new NBTNumber(i === 0 ? 1 : 0, 'b'), Command: l.replace(/^\//, '') })
          : `{auto:${i === 0 ? 1 : 0}b,Command:"${l.replace(/^\//, '')}"}`;
        return `setblock ~${i ? ' ~' + i + ' ' : ' ~ '}~ ${t}${st}${body}`;
      }).join('\n') }),
    ]) : null,
  ]);
}

/* ============================ 最小 ZIP（store 模式，零依赖） ============================ */

void esc; void commandName;
