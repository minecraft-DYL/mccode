# 第三方资源与许可归属

本项目的**全部业务代码**（`index.html`、`src/app.css`、`src/core/**`、`src/graph/**`、`src/ui/**`、`tools/**`）为本项目原创。

---

## 1. WinUI 设计令牌与动效样式（vendored，逐字复制）

原本想直接引用 WinUIonWeb 的样式，但它不是 npm 包、也没有可在浏览器里 CORS 直链的稳定入口，为了保证「双击即用、零构建」，采用**把样式文件复制进仓库**（vendoring）的方式。

| 项 | 内容 |
| --- | --- |
| 来源项目 | **WinUIonWeb** |
| 仓库 | <https://github.com/Furry-Xiyi/WinUIonWeb> |
| 作者 | Furry-Xiyi |
| 默认分支 | `master` |
| 许可 | **GNU General Public License v3.0** (GPL-3.0) |
| 许可文件 | <https://github.com/Furry-Xiyi/WinUIonWeb/blob/master/LICENSE> |
| 核实记录 | 通过 <https://cdn.jsdelivr.net/gh/Furry-Xiyi/WinUIonWeb@master/LICENSE> 取得，`35149` 字节，与 FSF 官方 GPL-3.0 文本一致；<https://api.github.com/repos/Furry-Xiyi/WinUIonWeb> 确认 owner 为 `Furry-Xiyi`、默认分支为 `master` |

被复制进本项目的文件：

| 本地路径 | 内容 | 字节数 |
| --- | --- | --- |
| `src/vendor/winui-theme.css` | WinUI 3 设计令牌（`@property` 定义的 CSS 变量：颜色、圆角、阴影、字体、动效时长）、明暗主题、控件基础样式 | 48 885 |
| `src/vendor/winui-animations.css` | WinUI 动效（缓动曲线、过渡、进入/离开动画） | 17 728 |

这两个文件**逐字复制、未做任何修改**。本项目另写 `src/app.css` 承载应用层布局，所有视觉令牌都从这两个文件里取，不硬编码颜色。

### 为什么本项目按 GPL-3.0 发布

因为分发了 GPL-3.0 的 WinUIonWeb 样式文件，本项目整体按 **GPL-3.0-or-later** 发布。完整许可证文本见根目录 [`LICENSE`](LICENSE)。

若你希望本项目改用其他许可证，替代方案是：删除 `src/vendor/` 下两个文件，把 `src/app.css` 里的 `var(--*)` 令牌换成本项目自有的配色。

---

## 2. 运行时数据源（不随本仓库分发）

以下数据在**运行时**由浏览器从公开接口获取，版权归各自所有者。本项目不复制、不再分发这些内容。

| 数据 | 来源 | 用途 | CORS |
| --- | --- | --- | --- |
| 版本清单 | <https://launchermeta.mojang.com/mc/game/version_manifest_v2.json> | 版本号、发布日期、发布通道、排序 | 开放 `*` |
| 版本详情 | `piston-meta.mojang.com`（由清单中的 `url` 字段提供） | 该版本的下载信息 | 开放 `*` |
| 资源仓库 | <https://github.com/InventivetalentDev/minecraft-assets>，经 <https://cdn.jsdelivr.net> 分发 | 物品/方块贴图、`items/` 与 `particles/` 定义、`zh_cn.json` 语言文件 | 开放 `*` |
| 资源文件清单 | <https://api.github.com/repos/InventivetalentDev/minecraft-assets/git/trees/{tag}?recursive=1> | 枚举某版本的全部资源路径 | 开放 `*`（匿名限流 60 次/小时） |
| 版本史料 | <https://zh.minecraft.wiki> | `data/version-segments.json` 中每一条技术性更改的出处依据 | 仅限浏览器（有 Cloudflare 校验，脚本直连会 403） |

Minecraft 是 Mojang Studios / Microsoft 的商标与版权作品。本项目是**非官方工具**，与 Mojang Studios、Microsoft 无任何关联。

---

## 3. 关于 `data/version-segments.json`

该文件由本项目人工整理，**每一条改动都带 `sources` 字段**指向 zh.minecraft.wiki 的对应页面。

- 已取证的条目：`verified: true`
- 未取证的条目：写 `未取到，待核实`，并在界面上标为「内置基线」，**不臆造日期或改动内容**
- 该文件缺失时，编辑器自动回退到 `src/core/capabilities.js` 里的内置基线，功能不受影响
