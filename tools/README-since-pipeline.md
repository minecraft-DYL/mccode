# 组件 `since`（引入版本）取证流水线

`src/data/components-wiki.js` 里那 119 条 `since` **不是凭记忆填的**。
这个目录下的脚本可以把整张表从 wiki 原文重新推出来，任何人可以复核。

## 一键复现

```bat
node tools\__parse-comp-history.mjs     :: ① 数据组件 历史节 → __component-since.json
node tools\__parse-24w09a.mjs           :: ② Java版24w09a 新内容/常规 → __since-24w09a.json
node tools\__merge-since.mjs            :: ③ 合并三路证据 → __component-since-merged.json
node tools\__render-since-map.mjs       :: ④ 渲染成可粘贴的代码块
```

`__parse-24w09a.mjs` 依赖 `__24w09a-s2.txt`（`Java版24w09a` section=2 的 wikitext 原文），
`__parse-comp-history.mjs` 依赖 `__data-comp-history.txt`（`数据组件` section=130 的原文）。
两份原文都留在目录里，所以上面四条命令离线可跑。

重新抓原文（需要过 Cloudflare，脚本走真实浏览器）：

```bat
node tools\wiki-get.mjs raw "数据组件" 130      > tools\__data-comp-history.txt
node tools\wiki-get.mjs raw "Java版24w09a" 2    > tools\__24w09a-s2.txt
```

## 三路证据

| 路 | 来源 | 覆盖 | 文件 |
|---|---|---|---|
| ① | [`数据组件` section=130 历史](https://zh.minecraft.wiki/index.php?title=数据组件&action=raw&section=130) —— 逐快照写「加入了 X 组件」 | 1.20.5 之后的新增（1.21 / 1.21.2 / 1.21.5 / 1.21.11 / 26.1 / 26.2 / 26.3） | `__component-since.json` |
| ② | [`Java版24w09a` section=2 新内容/常规](https://zh.minecraft.wiki/index.php?title=Java版24w09a&action=raw&section=2) —— 原文「加入了以下物品堆叠组件（均省略命名空间 minecraft:）：」+ treeview 逐条列出 | 1.20.5 首批 49 条 | `__since-24w09a.json` |
| ③ | 人工补查 | 仅 `lodestone_tracker` 一条 | `__since-manual.json` |

**② 为什么必需**：历史节对首批组件只写了一句「加入了数据组件。」，不逐个列名。
光靠 ① 只能拿到 82 条，② 补上首批后到 118 条。

## 结果

```
组件总数 121
已取证   119     未取证 2
版本分布 1.20.5:50  1.21:1  1.21.2:11  1.21.5:31  1.21.11:6  26.1:6  26.2:1  26.3:13
```

## 仍未取证的 2 条（**故意留空，不许编版本号**）

`creative_slot_lock`、`map_post_processing`。

两条都被 wiki 归在「临时组件」，页面只描述功能、不给引入版本；历史节里没有出现；
全站 `insource` 正则搜索 `/加入了[^。]{0,60}<名字>/` 命中 **0 条**。
查证过程逐条记在 `__since-manual.json` 的 `_unverified` 字段里。

UI 对这 2 条显示「引入版本未取证」，不显示任何版本号。

## 口径注意事项

- 取「最早的一次明确记录」。同一个组件被多路命中时按版本号取最小。
- **「默认组件」≠「组件引入」**：`物品格式` 的历史节列的是「各快照的默认组件集合」，
  只能说明某组件在那个版本被某个物品**默认**带上，不能当作引入版本，所以没有采用。
- `lodestone_tracker` 在 24w09a 以 `lodestone_target` 之名加入、24w10a 改名；
  两个快照同属 1.20.5，故记为 `1.20.5`，并把旧名登记进 `COMPONENT_ALIASES`。

## 相关自测

```bat
node tools\nbt-labels-check.mjs          :: NBT 标签汉化表
node tools\nbt-bridge-check.mjs          :: NBT ↔ 纯 JSON 桥（5 个样例 + 幂等）
node tools\nbt-upstream-bugs-check.mjs   :: 两个上游缺陷的复现与绕行断言
node tools\cdp-nbt-i18n.mjs              :: 真浏览器验收（NBT/组件页 + 补全 + 节点图）
```
