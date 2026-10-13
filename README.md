# MC 编辑器 · Minecraft Java 版可视化编辑器

一个**纯静态、零构建、零依赖**的 Minecraft Java 版编辑器。用原生 HTML + ES Module + 手写 CSS 实现，直接跑在浏览器里。

核心特征：**一切能力都以「版本选择」为前置**。选好版本后，每个页面会自动启用/禁用，并按该版本的语法生成内容（例如 `/give` 在 1.20.5 前后是两套完全不同的物品参数写法）。

```
┌─────────────┐   版本能力矩阵（段 → 大版本 → 小版本）
│  版本选择    │──▶ 决定：哪些功能可用 + 用哪套语法
└─────────────┘
        │
        ├─▶ 物品 / 实体 / 粒子 选择器   （按版本实时检索 ID + 图标）
        ├─▶ NBT 编辑器                  （SNBT 校验 + 结构树 + 二进制 .dat 读写）
        ├─▶ 物品组件                    （1.20.5+ 数据组件，含 NBT ⇄ 组件 迁移）
        ├─▶ 命令编辑器                  （文本 / 命令浏览器 / 节点图）
        └─▶ 输出通道                    （.mcfunction / 数据包 / 命令方块 / 聊天框）
```

---

## 快速开始

**必须用 HTTP 打开，不能双击 `index.html`。**
浏览器的 ES Module 与 `fetch` 在 `file://` 协议下会被 CORS 策略拦截，页面会白屏。

```powershell
cd D:\ku\traecode\mccode
python -m http.server 8777 --bind 127.0.0.1
# 然后浏览器打开 http://127.0.0.1:8777/
```

没有 Python 也可以用 Node：`npx serve -l 8777` 或 `npx http-server -p 8777`。

建议 Chrome / Edge 103+（需要 `DecompressionStream` 才能读 zip/jar 与 `.dat`）。

首次打开会自动从 Mojang 拉版本清单（约 1 秒），然后：

1. **版本选择** — 选目标版本
2. 点 **开始检索** — 拉取该版本的物品/实体/粒子（26.3 实测约 4.3 秒，物品 2478 条）
3. 其余页面即可使用

---

## 九项能力 × 版本

| 能力 | 说明 | 关键版本节点 |
| --- | --- | --- |
| 编辑 NBT | SNBT 文本 + 结构树 + 二进制 `.dat` | 1.8 命令首次能读写 NBT；1.20.5 起物品维度改用组件（实体/方块实体仍是 NBT） |
| 编辑物品组件 | 数据组件（Data Components） | **1.20.5（24w09a）起**取代物品 NBT；1.21.2 起大幅扩充（`tool`/`food`/`consumable`…） |
| 编辑命令 | 命令文本校验 + 命令浏览器 | 1.13 命令体系重写（`/execute`、`/data`）；1.20.5 `/give` 物品参数改为 `[组件]` |
| 编辑 .mcfunction | 函数文件 / 数据包 | **1.12 起**引入函数；1.13 起移入 `data/<命名空间>/function/` |
| 编辑命令方块 | 生成 `setblock` / `give` | 1.4.2 加入；1.9 加循环型/连锁型；**1.19 起类型与朝向改为方块状态** |
| 编辑聊天框指令 | 单条指令规范化 | 全版本 |
| 物品选择器 | ID + 图标 + 中文名 | 1.13 起 ID 扁平化为字符串，才能完整枚举；更早版本用数字 ID |
| 实体选择器 | ID + 中文名 | 1.8 起目标选择器可用 |
| 粒子选择器 | ID + 中文名 | 1.13 起粒子数据驱动（`particles/*.json`） |

版本矩阵的每一条改动都可以在 **版本能力矩阵** 页的时间轴节点图上查看，并附 zh.minecraft.wiki 出处。

---

## 页面导览

| 页面 | 作用 |
| --- | --- |
| **概览** | 当前版本的能力徽章、快捷入口、环境与数据源状态 |
| **版本选择** | 918 个版本的树状选择（大版本 → 小版本）、数据源切换、注册表检索、检索日志 |
| **版本能力矩阵** | 时间轴节点图（横轴=技术分段，纵轴=9 条能力泳道）、版本×能力二维对照表、分段明细。**「一切的前置」的可视化** |
| **选择器** | 物品 / 实体 / 粒子三标签页，分页 + 搜索 + 图标懒加载，一键送到命令编辑器或节点图 |
| **NBT 编辑器** | SNBT 实时校验与高亮、可折叠结构树、打开/导出二进制 `.dat`（自动识别 gzip）、生成命令 |
| **物品组件** | 组件目录（22 个常用组件，标注引入版本）、结构化编辑、NBT ⇄ 组件 双向迁移 |
| **命令编辑器** | 三种模式：**节点图**（拖拽连线，实时生成命令）、文本编辑（语法高亮 + 校验）、命令浏览器（只列该版本真实存在的命令） |
| **输出通道** | 同一份命令落地为：聊天框单条指令 / `.mcfunction` 文件 / 数据包 zip（零依赖手写 ZIP）/ 命令方块 `setblock` + 连锁命令方块链 |

节点图操作：拖动节点移动 · 从右侧圆点拖到左侧圆点连线 · `Ctrl+滚轮` 缩放 · 右键删除节点 · 双击连线删除。

---

## 数据来源与检索策略

编辑器**不内置任何游戏资源**，全部按需从网络获取；网络不可用时回退到本机 jar。

| 数据 | 首选 | 兜底 |
| --- | --- | --- |
| 版本清单 | `launchermeta.mojang.com` （实测 CORS `*`） | 备用清单路径 → `bmclapi2` 镜像（浏览器中无 CORS 头，仅作最终兜底） |
| 物品/实体/粒子 ID 与图标 | GitHub tree API 枚举路径 + jsDelivr 取贴图 | ① 官方 client jar（按版本详情里的 URL 下载后本地解包）② **手动选择本机 `.minecraft/versions` 目录** |
| 语言文件（中文名） | `assets/minecraft/lang/zh_cn.json` | — |

- 版本清单缓存 6 小时（`localStorage`）
- 仓库文件清单缓存于内存，切换页面不重复请求
- GitHub 匿名 API 限流 60 次/小时，命中会提示改用 jar 数据源

**解包能力**：零依赖 ZIP 读取靠浏览器原生 `DecompressionStream('deflate-raw')`，NBT 的 gzip 靠 `DecompressionStream('gzip')` —— 没有引入任何 zip/nbt 第三方库。

---

## 目录结构

```
mccode/
├── index.html                    # 唯一入口（NavigationView 骨架）
├── package.json                  # 仅用于跑测试脚本；无构建步骤
├── LICENSE                       # GPL-3.0 全文
├── THIRD-PARTY.md                # vendored 样式与数据源的归属说明
├── data/
│   └── version-segments.json     # zh.minecraft.wiki 取证数据（缺失时回退内置基线）
├── src/
│   ├── app.css                   # 应用层布局（令牌全部取自 vendor）
│   ├── main.js                   # 入口：主题、外壳、版本清单初始化
│   ├── vendor/                   # 来自 WinUIonWeb 的样式（GPL-3.0，逐字复制）
│   │   ├── winui-theme.css
│   │   └── winui-animations.css
│   ├── core/                     # 无 DOM 依赖的纯逻辑层
│   │   ├── util.js               # h() 建元素、fetch 超时、localStorage、并发池
│   │   ├── zip.js                # ZIP 中央目录解析（含 ZIP64 兜底）
│   │   ├── versions.js           # 版本号解析 / manifest 索引 / 新旧版本号体系
│   │   ├── capabilities.js       # 9 项能力定义 + 技术分段矩阵
│   │   ├── registry.js           # 物品/实体/粒子枚举（GitHub / jar / 本机目录）
│   │   ├── nbt.js                # SNBT 解析器 + 二进制 NBT 读写 + gzip
│   │   ├── commands.js           # 命令定义与按版本的语法形态 + 物品参数生成
│   │   └── store.js              # 全局状态、订阅、草稿持久化
│   ├── graph/
│   │   ├── nodegraph.js          # 通用节点图引擎（拖拽/连线/缩放/序列化）
│   │   ├── command-graph.js      # 命令节点类型 + 从节点图编译出命令
│   │   └── timeline.js           # 版本能力时间轴 + 分段详情
│   └── ui/
│       ├── controls.js           # 手写 WinUI 风格控件（按钮/输入框/对话框/Toast…）
│       ├── shell.js              # 导航路由、页头、状态栏、快捷键
│       └── pages/                # 8 个页面模块
└── tools/                        # 自测脚本（不参与运行时）
    ├── unit-test.mjs             # 核心逻辑单元测试（83 项）
    ├── cdp-test.mjs              # 单页探针：控制台异常 / 网络失败 / 状态快照
    ├── cdp-tour.mjs              # 8 页逐页巡测 + 截图
    ├── cdp-interact.mjs          # 真实交互端到端：填输入框 / 点按钮 / 断言界面真的变了
    ├── fetch-packformat.mjs      # 探测数据包版本（留档：piston-meta 不含 pack_version）
    ├── fetch-wiki.py             # wiki 抓取（留档：Cloudflare 403，仅浏览器通道可用）
    └── fetch-wiki.py             # wiki 抓取尝试（脚本直连会被 Cloudflare 403）
```

---

## 自测

```powershell
npm run test:unit            # 核心逻辑：117 项断言
npm run test:pages           # 需要先起本地服务；逐页巡测 + 输出截图到 .shots/
npm run test:interact        # 真实交互端到端：13 个场景（填输入框 / 点按钮 / 断言界面变化）
npm run test:probe           # 单页深度探针
```

`test:unit` 覆盖：版本号解析与序数（含 26.x 新体系必须晚于所有 1.x 的回归用例）、物品语法分派（1.20.4 vs 1.20.5）、命令生成与校验、SNBT 解析/序列化往返、二进制 NBT 大小端往返、三种数组标签往返、gzip、NBT ⇄ 组件 迁移、顶层分隔工具。

浏览器侧测试用 CDP 直连（`tools/cdp-*.mjs`）：通过 Edge 的 `--remote-debugging-port` 抓 `Runtime.exceptionThrown`、`Log.entryAdded`、`Network.loadingFailed`，并在页面里注入探针读取真实 DOM 与全局状态。

---

## 已知限制

- **必须走 HTTP**：`file://` 下 ES Module 会被 CORS 拦截。
- **`data/version-segments.json` 的取证范围**：目前覆盖 11 个关键技术分段；未取证的字段标为「未取到，待核实」，界面上会显示为「内置基线」而不是伪装成已核实。
- **zh.minecraft.wiki 有 Cloudflare 校验**：脚本（curl / python）直连返回 403，只有浏览器环境可读。因此取证数据是离线整理后随仓库分发的，不在运行时抓取。
- **GitHub 匿名 API 限流**：60 次/小时。命中后请切换到 jar 数据源。
- **本机 jar 选择**依赖 File System Access API（Chrome / Edge），Firefox 不支持。
- **版本矩阵的颗粒度**：分段锚点取「发生技术性失效/生效」的版本；快照版本不单独成段，而是归入所属大版本。
- 26.x 新版本号体系下的资源结构与 1.21.x 末期一致（`items/` 与 `particles/` 均为数据驱动），可完整枚举。

---

## 许可证

本项目以 **GPL-3.0-or-later** 发布（因为分发来自 WinUIonWeb 的 GPL-3.0 样式文件）。见 [`LICENSE`](LICENSE) 与 [`THIRD-PARTY.md`](THIRD-PARTY.md)。

Minecraft 是 Mojang Studios / Microsoft 的商标。本项目为非官方工具，与 Mojang 无关联。
