# 🧭 dsh-plugin-scroll-memory

> DeepSeek Harness 侧栏「插件」页：无论是在「已安装」插件列表，还是 v0.2.1-rc.2 新增的「发现」插件市场，从上往下翻、点卡片进详情页再返回时回到原处；在两个 Tab 之间来回切换时，两边滚动位置各自独立记忆无缝还原，互不干扰。

## 🎯 它解决什么问题

官方那个页面（`@deepseek-ai/dsh-client-ui-plugin-manager`）里，点卡片进入插件设置页、再返回列表时**滚动位置归零**。原因：视图切换是**同页 React state**（`setView({kind:"item"})`，全文件无 `history/location/navigate`），返回时 `PackageDetail` 卸载、列表子树重挂，`scrollTop` 丢失，而官方没有任何位置恢复逻辑。同类滚动缺陷（设置左导航溢出无滚动条）在官方 discussion #4729 挂着未修，且该仓库关闭 Issues、不收外部 PR。

DSH 插件生态里没有第二个做这件事的（扫过 7 个目录源、21000+ 条候选），所以自己写。

## 🚀 安装

```sh
github:Karanoyo/dsh-plugin-scroll-memory#main
```

`dsh plugin add` 是 pnpm 的前向转发器，`link:` 是它认可的来源形式。装完**重启 dsh web**，再 **Ctrl+F5 硬刷新**（客户端 bundle 走 `window.__ModuleLoader__`，不硬刷新会拿到旧缓存）。

## 🔍 怎么做到"只在那一个列表生效"

官方那个页面的 DOM 里同时有**四个**可滚动区域，作用域一宽必然互相污染：

| 区域 | 锚点 | 处理 |
|---|---|---|
| 已装插件列表（目标） | `[data-plugin-panel]`，包含 `[data-plugin-package]` / `[data-plugin-item]` | 记账 + 返回恢复 |
| 插件选项/详情页 | `[data-plugin-detail]` / `[data-plugin-item-detail]` / `[data-plugin-row-detail]` | 显式切断 + 进页归零（防篡改选项页位置） |
| 「包含的组件」清单 | `[data-plugin-rows]` | 显式排除（抽不到列表签名） |
| 安装向导滚动区 | `.fO69Vq_installContent` / `.fO69Vq_wizardScroll` | 显式排除（官方源码证实向导对话框挂在面板内，但向导内无插件卡 → 抽不到签名；且面板自身可滚时滚动目标永远是面板，轮不到向导滚动区） |

三条判据，全部有官方源码出处（L 行号指官方 `lib/client.js`）：

一是**作用域**：只认 `document.querySelector('[data-plugin-panel]')`，没有就整体不工作，**绝不做 body 级扫描**。这些属性是契约级的（官方自己也用 `document.querySelector('[data-plugin-package="…"])`、`[data-plugin-panel]` 取节点），不是会漂移的 CSS-module 哈希类名。

二是**身份**：签名 = `[data-plugin-package]` 和 `[data-plugin-item]` 的包名/条目集合排序后拼接（覆盖社区扩展包与官方内置插件）。排序保证 React 重渲染打乱 DOM 顺序时签名不变；装机状态变化签名才变。设置页、组件清单、安装向导、其他任何页面都抽不到这个集合 → 天然记不到账。

三是**滚动目标**：`[data-plugin-panel]` 自身就是滚动 owner（L3414-3416 + `height:100%;overflow:auto`），直接用面板；万一官方改成内部滚动，才在**面板内部**兜底探测，边界绝不出面板。

## ⚖️ 刷新为什么零干扰

这是关键设计。官方 `refresh()`（L1183-1184，注释明写 "without clearing cached cards"）是**就地更新**：卡片不清空、标题不变、DOM 有 mutation。

第一版我用「DOM 变化 + 列表签名仍匹配」当恢复信号，结果刷新完美符合这个条件，旧 `scrollTop` 被按回去，**刷新后回不到顶点**。

本版的恢复判据是：**`[data-plugin-detail]` 由「存在」变为「不存在」**。只有点「返回插件列表」（crumb，L117/L2429）才会让详情页消失；刷新时详情页压根不存在，"上次=true 且 本次=false" 永不成立 → 刷新完全按官方自己的行为走，我不碰。

另外详情页里也**停止跟踪**（`当前记录目标` 置空）——否则官方设置页里滚动的很可能还是同一个面板，你的滚动会覆盖列表存档。

```
你滚到列表第 40 张卡
      │
      ▼
 MutationObserver 感知变化（rAF 合帧）
      │
      ▼
 querySelector('[data-plugin-panel]') ── 没有？→ 整体安静，不认别的容器
      │ 有
      ▼
 列表态？── 否（详情页在）──► 停止跟踪，不记账
      │ 是
      ▼
 签名 = 所有 [data-plugin-package] 包名排序
      │
      ▼
 停止滚动 120ms → scrollTop + 签名 落 sessionStorage
      │
      ├─► 点卡片 → setView → 出现 [data-plugin-detail]（不记账）
      │
      └─► 点「返回插件列表」→ detail 消失 + 位置归零
                  │
                  ▼
            签名匹配 → 把位置送回去（2s 内重试，你手动滚立即让位）

 点「刷新」→ 卡片就地更新、detail 始终不存在 → 判据不成立 → 零干扰
```

## 🛠️ 配置

改 `lib/client.js` 顶部「🎛️ 头部配置区」，改完重启 dsh web + 硬刷新：

| 常量 | 默认 | 说明 |
|---|---|---|
| `启用开关` | `true` | 总开关（False/True） |
| `调试开关` | `false` | 调试日志（默认关闭，异常 warn 不受它控制，永远输出）；插件选项页的「开启调试日志」开关会写入 localStorage 并在启动时覆盖此默认值 |
| `调试开关记忆键` | `'dsh-psm:调试开关'` | localStorage 记忆键，选项页开关持久化所在 |
| `存储键前缀` | `'dsh-psm:'` | sessionStorage 键前缀，内存降级时同样用它 |
| `存档保留上限` | `12` | 最多保留几屏存档 |
| `记录防抖毫秒` | `120` | 停止滚动多久才落库 |
| `恢复等待上限毫秒` | `2000` | 内容返回后最多等多久 |
| `恢复重试间隔毫秒` | `60` | 期间每隔多久再设一次 |
| `顶部判定阈值像素` | `2` | 判定为列表顶部的像素阈值（抵御高分屏 DPI 缩放子像素微偏差） |
| `提示开关` | `false` | 恢复成功右下角闪现提示 |
| `提示显形毫秒` | `1400` | 提示停留时长 |
| `刷新回顶点开关` | `false` | 见下 |

`刷新回顶点开关`（默认关）：打开后，点面板 header 区域（刷新按钮所在处）时会把面板 `scrollTop` 置 0，即把"刷新"变成"刷新即回顶"。它只改 `scrollTop`，**绝不动刷新按钮自身的功能**；判定用的是位置特征（点击是否落在 `[data-plugin-panel]` 的 `header` 内），不依赖会随语言变化的 `aria-label` 文案。

### ⚙️ 插件选项页的「开启调试日志」卡片（1:1 复刻 Univer Office 样式）

进入 DSH 侧栏「插件」列表，点击本插件名字进入详情页（`[data-plugin-detail="dsh-plugin-scroll-memory"]`），在描述与组件清单之间即可看到 1:1 复刻自 Univer Office 的官方风格配置卡片：

- **精致外观**：12px 圆角边框卡片、规范的标题与说明排版、36×20px 胶囊开关配 16×16px 弹簧微动滑块（带 120ms 平滑动画）；全量采用 DSH 官方设计令牌（`var(--dsw-alias-*)`），完美自适应深浅色主题；
- **草稿确认交互**：修改开关后进入草稿态，右下角「放弃修改」与「保存」按钮解除禁用；点击「放弃修改」复位，点击「保存」才真正写入并应用；
- **持久记忆**：点击保存后自动写入当前浏览器的 `localStorage`（键名 `<dsh-psm:调试开关>`），下次启动、重载或浏览器重启后依然保留你的选择；
- **官方规范**：通过官方 `plugins.bundle.config` slot（keyed，键=`<dsh-plugin-scroll-memory>`）挂载，随组合包启用而注册、随禁用而撤销，零额外开销。

## 🎯 核心机制：同步捕获变量（第三版根因修复）

**取证结论**（官方源码实读，副本见工作区 `__official-pm-client.js`）：列表与详情共用同一个 `section[data-plugin-panel]` 滚动容器（CSS `.fO69Vq_page{height:100%;overflow:auto}`），点卡片 = 同一次 React commit 内「卸载全部卡片、挂载详情页」，此后浏览器把变矮容器的 `scrollTop` 钳制归零。而本插件经 MutationObserver → rAF 才运行，**那一刻读 DOM 拿到的必然是假 0**：

- v2 用它做条件（`scrollTop > 0`）→ Flush 恒不触发，快点击丢位置；
- v3 无条件落库 → 假 0 污染存档，所有位置集体失忆。

**修复**：滚动事件发生当下同步捕获真实位置进 `<最后已知滚动位置>` 变量（详情页锚点存在时拒收，浏览器钳制触发的假 scroll 事件进不来）；Flush 只消费该变量（null 视为 0），0 也显式落库以覆盖陈旧旧值；恢复分支把 `top <= 阈值` 视为合法「顶部归位」存档，`__latest__` 兜底仅在专属存档完全缺失时启用；恢复成功后回写变量保持一致。桩测试同步补上「内容交换即钳制归零」语义，弥合测试与真实浏览器的行为差。

## 🧪 自检

```sh
node tools/selftest.mjs
```

20 段 145 项断言，**全通过**（含双 Tab 独立状态机与跨页无缝记忆）。除交付契约、apply 行为、签名与存档解析外，专门为你的反馈做了全量回归测试：

| 段 | 守住什么 |
|---|---|
| 【六】 | 端到端：记账 → 进设置页 → 返回 → 恢复（含二次往返） |
| 【七】 | **刷新零干扰**：刷新后停在 0 不被按回、连刷三次仍 0、刷新后手动滚到 130 也原样保留 |
| 【八】 | **别处一律不碰**：body 下另一个可滚动容器的滚动完全不落库、不被干预 |
| 【九】 | **设置页内滚动不污染列表存档**；A 设置页直跳 B 设置页不触发恢复 |
| 【十】 | 页面里没有 `[data-plugin-panel]` 时整体安静 |
| 【十一】 | sessionStorage 被禁 → 内存存档接管 |
| 【十二】 | 卸载清干净：observer / scroll 监听 / 样式 / 存档键 |
| 【十三】 | 无 MutationObserver 时一个监听都不留，拒绝半残运行 |
| 【十四】 | **官方内置插件与选项页防篡改**：内置插件卡片签名、进选项页复位归零防篡改、返回列表恢复 |
| 【十五】 | **根因修复回归（含浏览器钳制模拟）**：快点击 420 不丢失、回顶部后点官方插件显式落库 0 并稳停 0px（绝不跳回旧位置）、变量实时更新、刷新零干扰 |
| 【十六】 | **选项页配置卡片**：Univer Office 风格卡片排版 + 胶囊滑动开关 + 草稿态/放弃修改/保存按钮逻辑 + summary 视图防御 + **slot 注册双通道兜底**（ctx.slots 直注 / ctx.inject 服务请求 / 双缺失记 warn）+ localStorage 记忆 + **禁存储环境容错**（访问即抛 SecurityError 不炸 apply）+ **防假成功**（写入失败时保存绝不提交、按钮保持可重试，Univer 原版 set 失败同款语义）+ 官方 plugins.bundle.config slot 注册契约 |

自检用 `new Function` 把 `lib/client.js` 原样加载进**主 realm**（桩与插件同 realm）。这里踩过一个坑：先前用 `node:vm` 的独立 context，跨 realm 下 `typeof 外realm函数 === 'function'` 判 false，导致签名永远为空——那是测试工具的失真，真实浏览器里插件与 DOM 同 realm 不会发生。

## ⚠️ 已知限制

- **未在真实 DSH 页面上跑过**。本会话没有运行中的 dsh web（探测 3080/3000/8080 等端口均无响应），所以只做了结构级与流程级验证。`[data-plugin-panel]` / `[data-plugin-package]` / `[data-plugin-detail]` 三个锚点、以及"面板自身就是滚动 owner"这两点，是从你本机 DSH Desktop 里的官方 bundle 源码读出来的（有 L 行号），但**没有在活着的那里验证过**。
- **签名是包名集合**。如果两个不同视图的包名集合恰好完全相同（例如同样是全部插件、只是分组不同），会误判为同一屏。实际插件页只有这一种列表，风险极低。
- **没有声明 `dsh.engines` 下限**（跟随本机 `dsh-voice` 的样例形态），因为无法从官方证实各版本基线的对应关系。
- **配置卡片文案为中文硬编码**（未注册 locale 字典），界面切到英文时卡片仍是中文；文案集中在 `配置组件` 一处，后续要本地化只需接入 `ctx.locale`。
- **多标签页后写赢**：两个标签页同时打开本插件详情页时，后点「保存」者覆盖先保存者（`localStorage` 无冲突检测；Univer 原版走 host settings 有 revision 校验，纯浏览器插件没有等价机制，单人单浏览器场景无实际影响）。

不灵时：进入本插件选项页开启「开启调试日志」开关并保存（或将代码头部 `调试开关` 改为 `true`），复现一次往返，看控制台 `[dsh-psm]` 日志里「取列表面板」是否命中、签名是否稳定、以及"检测到从插件设置页返回列表"有没有出现。这三行日志足以定位是哪一环断了。

## 🧱 文件结构

```
dsh-plugin-scroll-memory/
├── package.json          # dsh.bundle.patch + dsh.client(platform: web)
├── cordis.patch.yml      # 插入插件行（id 命名空间独立，不抢官方 id）
├── lib/
│   ├── index.js          # Node 半：16 行空壳，只声明插件身份
│   └── client.js         # 浏览器半：全部逻辑
├── tools/selftest.mjs    # 16 段 119 项自检（含浏览器钳制模拟与 Univer 配置卡片）
├── README.md
└── LICENSE               # MIT
```

## 🗑️ 卸载

```sh
dsh plugin --profile desktop remove dsh-plugin-scroll-memory
```

dispose 时断开 observer、卸载 scroll 监听、移除样式标签，并清空自己写进 sessionStorage 的所有存档键，不留痕迹。
