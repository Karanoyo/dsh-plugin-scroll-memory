// dsh-plugin-scroll-memory —— Browser client half.
//
// 只做一件事：DeepSeek Harness 侧栏「插件」页（官方
// @deepseek-ai/dsh-client-ui-plugin-manager 渲染的已装插件列表，以及
// @deepseek-ai/dsh-client-ui-plugin-market 渲染的「发现」插件市场）里，
// 无论是在「已安装」还是在「发现」市场，你在列表中往下翻、点卡片进入详情页、
// 再返回列表时，让你回到原处；在「已安装」与「发现」两个 Tab 之间来回切换时，
// 两边的滚动位置也各自独立记忆并无缝还原，互不干扰。别的一概不碰。
//
// 为什么必须精确锚定，而不是"探测一下差不多就行"：
// 官方那个页面 DOM 里同时存在四个可滚动区域，作用域一宽就互相污染——
//   [data-plugin-panel]    包列表页（.fO69Vq_page = height:100% + overflow:auto）
//   [data-plugin-detail]   点卡片进去的插件设置页
//   [data-plugin-rows]     设置页里「包含的组件」清单（另一个可滚列表）
//   .fO69Vq_installContent / .fO69Vq_wizardScroll   安装向导里的滚动区
// 第一版实现用 document.body 当根 + "挑最靠外可滚动容器"，结果三件事全犯了：
// 记住了设置页的位置又覆盖回列表、安装向导也被记账、以及点「刷新」时因为刷新
// 的 DOM 特征（就地更新、卡片不清空）与"返回列表"被当成同一种信号，旧
// scrollTop 被按回去，导致刷新后回不到顶点。
//
// 本版全部锚点取自官方 lib/client.js 的既有属性（官方自己也用
// document.querySelector('[data-plugin-package="…"])、[data-plugin-panel] 取节点），
// 不是猜的：
//   [data-plugin-panel]         列表容器，且它自己就是滚动 owner
//                               L3414-3416 + .fO69Vq_page{height:100%;overflow:auto}
//   [data-plugin-package="x"]   一张插件卡       L2222
//   [data-plugin-detail="x"]    插件设置页       L2426
//   setView({kind:"item"})      点卡片的同页切换 L3388；crumb backToList L117/L2429
//   refresh()                   刷新，就地更新、不清空卡片  L1183-1184
//
// "返回列表"的判定因此是精确的：[data-plugin-detail] 由存在变为不存在。
// 刷新时详情页压根不存在，这个信号永不触发 —— 刷新功能完全不受影响。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-scroll-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // 🧩 React 依赖（官方 slot 条目组件由 React 渲染；官方全部客户端半侧都在
    //    factory 顶部这样取，与头部配置区一起靠前，绝不在函数内懒加载）
    var react = require('react')
    var reactJsx = require('react/jsx-runtime')

    // ═══════════════════════════════════════════════════════════════
    // 🎛️ 头部配置区（改完重启 dsh web + 硬刷新生效）
    // ═══════════════════════════════════════════════════════════════

    var NS = 'dsh-plugin-scroll-memory'

    // 🕹️ 插件总开关（False/True）
    var 启用开关 = true

    // 🐛 调试日志总开关（False/True）；异常 warn 不受此开关控制，永远输出。
    //    打开后每次「执行刷新」分配一个自增流水号 #N，全部链路日志带 #N 前缀输出，
    //    控制台里按 #N 即可串联还原一次完整流程（滚动 → Flush → 返回 → 恢复）
    //    🧠 这只是「默认值」：插件选项页的「开启调试日志」开关写入 localStorage
    //    记忆后，apply 启动时读取记忆值覆盖它（无记忆/记忆非法时才用这里的默认）
    var 调试开关 = false

    // 💾 调试开关的 localStorage 记忆键：选项页开关负责写入，启动时读取覆盖默认值
    var 调试开关记忆键 = 'dsh-psm:调试开关'

    // 🔢 诊断流水号：执行刷新每进入一轮自增一次，链路日志用它串联同一轮的所有步骤
    var 诊断流水号 = 0

    // 💾 sessionStorage 键前缀；存储被禁时改用内存 Map，同样用它做键
    var 存储键前缀 = 'dsh-psm:'

    // 📌 最多保留多少屏存档（不同筛选/装机状态各算一屏）
    var 存档保留上限 = 12

    // ⏱️ 滚动记录防抖毫秒
    var 记录防抖毫秒 = 120

    // 🔁 恢复重试：内容返回后最多等这么久、每隔多久再设一次 scrollTop
    //    （React commit 之后仍可能重置滚动，所以不能只设一次）
    var 恢复等待上限毫秒 = 2000
    var 恢复重试间隔毫秒 = 60

    // 📏 判定为列表顶部的像素阈值（数值型参数，默认 2，抵御高分屏 DPI 缩放的子像素微偏差）
    var 顶部判定阈值像素 = 2

    // 🍞 恢复成功后的角落提示
    var 提示开关 = false
    var 提示显形毫秒 = 1400

    // 🧭 可选增强：点「刷新」按钮后把面板滚回顶点（False/True）。
    //    官方 refresh() 是就地更新、本身不重置滚动；这个开关替你把"刷新"变回
    //    "刷新即回顶"的常见预期。默认关闭，且只改 scrollTop，绝不动按钮本身。
    var 刷新回顶点开关 = false

    // 🌐 跨页面记忆滚动位置开关（False/True）：离开插件列表去会话页等其他页面，返回时自动恢复滚动偏好
    var 跨页记忆开关 = true

    // ═══════════════════════════════════════════════════════════════
    // 🎯 官方锚点（全部有源码出处，见文件头注释）
    // ═══════════════════════════════════════════════════════════════

    // 🌐 命名空间（物理隔离两套视图的滚动存档与状态）
    var 已安装命名空间 = 'installed'
    var 发现市场命名空间 = 'discover'
    var 发现最新存档键名 = '__latest__'

    var 列表面板选择器 = '[data-plugin-panel]'
    // 🎯 官方已安装插件卡属性：社区扩展包用 data-plugin-package，官方内置插件用 data-plugin-item
    var 插件卡选择器 = '[data-plugin-package], [data-plugin-item]'
    // 🎯 官方已安装详情页选择器：社区包 data-plugin-detail，内置插件 data-plugin-item-detail，组件行 data-plugin-row-detail
    var 详情页选择器 = '[data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]'

    // 🎯 官方发现市场契约锚点（来自 @deepseek-ai/dsh-client-ui-plugin-market）
    var 发现市场面板选择器 = '[data-plugin-tab="discover"]'
    var 市场卡片选择器 = '[data-market-entry]'
    var 市场详情页选择器 = '[data-market-detail]'

    // ═══════════════════════════════════════════════════════════════
    // 📢 日志与容错（绝不静默失败）
    // ═══════════════════════════════════════════════════════════════

    var 日志被禁计数 = 0

    function 调试日志() {
      if (调试开关 !== true) return
      if (日志被禁计数 > 3) return
      if (typeof console === 'undefined' || typeof console.log !== 'function') return
      try {
        var 参数 = ['[dsh-psm]'].concat(Array.prototype.slice.call(arguments))
        console.log.apply(console, 参数)
      } catch (错误) {
        日志被禁计数 += 1
      }
    }

    // 🧵 链路日志（DRY 统一调试函数）：在调试日志基础上自动拼「#流水号」前缀，
    //    让控制台里同一轮「执行刷新」产生的所有日志能按 #N 串联还原完整流程。
    //    💡 滚动事件等发生在两轮刷新之间的日志会带上最近一轮的流水号，依然可关联。
    function 链路日志(内容) {
      调试日志('#' + 诊断流水号 + ' ' + 内容)
    }

    function 记录异常(位置, 错误) {
      if (typeof console === 'undefined' || typeof console.warn !== 'function') return
      try {
        console.warn('[dsh-psm] ' + 位置 + ' 失败：' + String(错误))
      } catch (忽略) {
        // warn 也被环境禁掉时没有别的出路
      }
    }

    // 🧠 读取用户记忆的调试开关（localStorage）：无记录/环境不支持/值非法 → 返回 null（用默认值）
    //    🛡️ 整个函数体必须包进 try：浏览器「阻止所有 Cookie」等配置下，访问
    //    window.localStorage 属性本身（含 typeof 解析）就会抛 SecurityError ——
    //    裸露在外会让 apply 第一行就抛异常，拖垮整个插件（既有 存储可用() 探针
    //    就是把 typeof 包在 try 里的，此处为同款惯例）。
    function 读取记忆调试开关() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null
        var 原文 = localStorage.getItem(调试开关记忆键)
        if (原文 === '1') return true
        if (原文 === '0') return false
        return null
      } catch (错误) {
        记录异常('读取调试开关记忆', 错误)
        return null
      }
    }

    // 💾 写入调试开关记忆（localStorage）：供选项页开关在用户操作时持久化
    //    📤 返回 true=落库成功 / false=不可用或失败——供 保存修改 做「先落库再提交」
    //    的防假成功判定（Univer 原版同款语义：settings.set 返回 false 则不提交）。
    //    🛡️ 同上：typeof 检查也必须包进 try，杜绝属性访问级 SecurityError 逃逸
    function 写记忆调试开关(值) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return false
        localStorage.setItem(调试开关记忆键, 值 === true ? '1' : '0')
        return true
      } catch (错误) {
        记录异常('写入调试开关记忆', 错误)
        return false
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 🎨 样式（仅服务可选的提示气泡）
    // ═══════════════════════════════════════════════════════════════

    var 样式文本 = [
      '.dpsm-toast{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
      'padding:7px 13px;border-radius:8px;font:500 12px/18px system-ui,"Segoe UI",sans-serif;',
      'color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-2,#333);',
      'box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:0;transform:translateY(6px);',
      'transition:opacity .16s ease,transform .16s ease;pointer-events:none}',
      '.dpsm-toast[data-visible="1"]{opacity:1;transform:translateY(0)}',
      '@media (prefers-reduced-motion:reduce){.dpsm-toast{transition:none}}',
      // 🎨 选项页配置卡片样式（1:1 复刻 dsh-univer-office 规范）
      '.dpsm_settingsCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:14px 16px;margin:12px 0}',
      '.dpsm_settingsHead{display:flex;flex-direction:column;gap:4px}',
      '.dpsm_settingsName{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.dpsm_settingsDescription{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dpsm_settingsBody{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px}',
      '.dpsm_settingsField{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.dpsm_settingsFieldHead{display:flex;align-items:center;gap:8px}',
      '.dpsm_settingsLabel{min-width:0;flex:1;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
      '.dpsm_settingsFieldActions{display:inline-flex;align-items:center;gap:8px}',
      '.dpsm_settingsSwitch{box-sizing:border-box;position:relative;width:36px;height:20px;flex:0 0 auto;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background 120ms ease}',
      '.dpsm_settingsSwitch_on{background:var(--dsw-alias-brand-primary)}',
      '.dpsm_settingsSwitch:disabled{cursor:default;opacity:.5}',
      '.dpsm_settingsSwitch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dpsm_settingsSwitchThumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      '.dpsm_settingsSwitch_on .dpsm_settingsSwitchThumb{transform:translateX(16px)}',
      '.dpsm_settingsHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.dpsm_settingsFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dpsm_settingsDiscard,.dpsm_settingsSave{padding:5px 14px;appearance:none;border:1px solid transparent;border-radius:8px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
      '.dpsm_settingsDiscard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}',
      '.dpsm_settingsDiscard:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}',
      '.dpsm_settingsSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.dpsm_settingsSave:hover:not(:disabled){opacity:.9}',
      '.dpsm_settingsDiscard:disabled,.dpsm_settingsSave:disabled{cursor:default;opacity:.4}',
      '.dpsm_settingsDiscard:focus-visible,.dpsm_settingsSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '@media (prefers-reduced-motion:reduce){.dpsm_settingsSwitch,.dpsm_settingsSwitchThumb{transition:none}}'
    ].join('')

    var 样式标签ID = 'dsh-plugin-scroll-memory/scroll-memory.css'

    function 安装样式() {
      if (typeof document === 'undefined') return function () {}
      try {
        if (document.querySelector('style[data-plugin-css=' + JSON.stringify(样式标签ID) + ']') !== null) {
          return function () {}
        }
        var 标签 = document.createElement('style')
        标签.dataset.plugin = NS
        标签.dataset.pluginCss = 样式标签ID
        标签.textContent = 样式文本
        document.head.appendChild(标签)
        return function 移除样式() {
          try {
            if (标签 !== null && 标签.parentNode !== null) 标签.parentNode.removeChild(标签)
          } catch (错误) {
            记录异常('移除样式标签', 错误)
          }
        }
      } catch (错误) {
        记录异常('安装样式', 错误)
        return function () {}
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // ⚙️ 插件选项页配置开关（1:1 复刻 Univer Office 样式与保存按钮）
    // ═══════════════════════════════════════════════════════════════

    // 📊 数据结构设计图：
    //   <草稿状态> (草稿状态对[0]) : boolean ──► 用户在界面点击开关仅改变草稿态
    //     ├── 点击「放弃修改」 ──► 草稿态复位为已存状态 (是否已修改=false)
    //     └── 点击「保存」    ──► 草稿态写入 localStorage + 闭包变量 <调试开关> (是否已修改=false)
    //
    // ❓ 为什么采用草稿态 + 保存按钮：1:1 还原 Univer Office (dsh-univer-office) 的官方
    //    配置卡片交互与视觉规范，让用户有明确的「修改 - 确认/放弃」操作闭环。

    // ⚙️ React 函数组件：官方 keyed 配置条目契约（官方 README「配置页」）——
    //    详情页以 view:'page' 渲染完整表单，摘要位以 view:'summary' 渲染单行简介。
    //    🛡️ 缺 summary 分支的话，官方一旦在卡片列表渲染摘要，整张卡片会被塞进列表。
    function 配置组件(props) {
      if (props !== null && props !== undefined && props.view === 'summary') {
        return reactJsx.jsx('span', {
          children: '调试日志默认关闭；进入本页可开启，保存后本浏览器记住选择。'
        })
      }

      // 📍 已保存生效的持久化状态（已存值 仅用于渲染期求值：useState 初值）
      var 已存状态对 = react.useState(调试开关 === true)
      var 已存值 = 已存状态对[0]
      var 置已存值 = 已存状态对[1]

      // 📍 未保存的草稿状态（草稿值 仅用于渲染期求值：类名/aria 态；
      //    💡 事件回调内必须读 草稿状态对[0] 实时值，绝不能用渲染期捕获的 草稿值）
      var 草稿状态对 = react.useState(已存值)
      var 草稿值 = 草稿状态对[0]
      var 置草稿值 = 草稿状态对[1]

      function 是否有修改() {
        return 草稿状态对[0] !== 已存状态对[0]
      }

      // 🔁 拨动开关：仅改变草稿状态
      //    💡 必须用函数式更新：读取本次渲染捕获的 草稿状态对[0] 在 React 连点/批处理
      //    边缘下是过期闭包值，可能丢翻转；函数式让 React 传入最新状态，无此隐患。
      function 切换开关() {
        置草稿值(function (当前值) { return !(当前值 === true) })
      }

      // 🛑 放弃修改：草稿复位回已存值
      function 放弃修改() {
        if (!是否有修改()) return
        置草稿值(已存状态对[0])
      }

      // 💾 保存修改：先落库，成功才提交（防假成功）
      //    🛡️ 顺序关键（审查修复）：必须「写记忆 → 置已存值 → 改闭包变量」。
      //    旧顺序把 写记忆调试开关 放最后，localStorage 写失败（隐私模式/配额满/
      //    被禁）时 UI 已显示保存成功、运行时已生效，但记忆没落库——刷新后回到
      //    旧值，用户被"假成功"欺骗（Univer 原版语义：set 返回 false 则不提交，
      //    失败时按钮保持可用让用户重试）。
      function 保存修改() {
        if (!是否有修改()) return
        var 新值 = 草稿状态对[0] === true
        if (写记忆调试开关(新值) !== true) {
          记录异常('保存调试开关', new Error('记忆写入失败，本次修改未提交（按钮保持可用，可重试）'))
          return
        }
        置已存值(新值)
        调试开关 = 新值
        调试日志('选项页配置保存：调试日志已' + (新值 ? '开启' : '关闭') + '（已写入 localStorage 记忆）')
      }

      var 开关类名 = 'dpsm_settingsSwitch' + (草稿值 ? ' dpsm_settingsSwitch_on' : '')

      return reactJsx.jsxs('div', {
        className: 'dpsm_settingsCard',
        children: [
          // 头部：标题与描述
          reactJsx.jsxs('div', {
            className: 'dpsm_settingsHead',
            children: [
              reactJsx.jsx('span', {
                className: 'dpsm_settingsName',
                children: '滚动记忆 (Scroll Memory)'
              }),
              reactJsx.jsx('span', {
                className: 'dpsm_settingsDescription',
                children: '从插件详情/配置页返回列表时，恢复原本的浏览滚动位置。'
              })
            ]
          }),
          // 主体：配置项列表 + 底部按钮栏
          reactJsx.jsxs('div', {
            className: 'dpsm_settingsBody',
            children: [
              // 调试日志选项行
              reactJsx.jsxs('div', {
                className: 'dpsm_settingsField',
                children: [
                  reactJsx.jsxs('div', {
                    className: 'dpsm_settingsFieldHead',
                    children: [
                      reactJsx.jsx('span', {
                        className: 'dpsm_settingsLabel',
                        children: '开启调试日志'
                      }),
                      reactJsx.jsx('div', {
                        className: 'dpsm_settingsFieldActions',
                        children: reactJsx.jsx('button', {
                          type: 'button',
                          role: 'switch',
                          className: 开关类名,
                          'aria-checked': 草稿值 === true,
                          'aria-label': '开启调试日志',
                          onClick: 切换开关,
                          children: reactJsx.jsx('span', {
                            className: 'dpsm_settingsSwitchThumb'
                          })
                        })
                      })
                    ]
                  }),
                  reactJsx.jsx('p', {
                    className: 'dpsm_settingsHint',
                    children: '在控制台输出带有自增流水号的 [dsh-psm] 详细链路日志，用于排查滚动恢复问题；默认关闭。'
                  })
                ]
              }),
              // 底部按钮栏：放弃修改 + 保存
              reactJsx.jsxs('div', {
                className: 'dpsm_settingsFooter',
                children: [
                  reactJsx.jsx('button', {
                    type: 'button',
                    className: 'dpsm_settingsDiscard',
                    disabled: !是否有修改(),
                    onClick: 放弃修改,
                    children: '放弃修改'
                  }),
                  reactJsx.jsx('button', {
                    type: 'button',
                    className: 'dpsm_settingsSave',
                    disabled: !是否有修改(),
                    onClick: 保存修改,
                    children: '保存'
                  })
                ]
              })
            ]
          })
        ]
      })
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔍 面板与滚动目标：一次定位，绝不做全局扫描
    // ═══════════════════════════════════════════════════════════════

    function 取列表面板() {
      if (typeof document === 'undefined') return null
      if (typeof document.querySelector !== 'function') return null
      try {
        return document.querySelector(列表面板选择器)
      } catch (错误) {
        记录异常('查询列表面板', 错误)
        return null
      }
    }

    // 🔍 识别当前活跃的视图类别（installed 或 discover）
    function 取当前视图类别(面板) {
      if (面板 === null || typeof 面板.querySelector !== 'function') return null
      try {
        // 💡 优先检测是否包含发现市场专属根容器 [data-plugin-tab="discover"] 或市场详情页 [data-market-detail]
        if (面板.querySelector(发现市场面板选择器) !== null || 面板.querySelector(市场详情页选择器) !== null) {
          return 发现市场命名空间
        }
        return 已安装命名空间
      } catch (错误) {
        记录异常('识别当前视图类别', 错误)
        return 已安装命名空间
      }
    }

    // 🔍 详情页是否存在（支持按当前视图类别分流判断）
    function 详情页是否存在(面板, 视图类别) {
      if (面板 === null || typeof 面板.querySelector !== 'function') return false
      try {
        var 类别 = 视图类别 || 取当前视图类别(面板)
        if (类别 === 发现市场命名空间) {
          return 面板.querySelector(市场详情页选择器) !== null
        }
        return 面板.querySelector(详情页选择器) !== null
      } catch (错误) {
        记录异常('查询详情页锚点', 错误)
        return false
      }
    }

    function 取元素溢出Y(元素) {
      var 文档 = 元素.ownerDocument
      if (文档 === null || 文档 === undefined) return ''
      var 视图 = 文档.defaultView
      if (视图 === null || 视图 === undefined) return ''
      if (typeof 视图.getComputedStyle !== 'function') return ''
      try {
        var 样式 = 视图.getComputedStyle(元素)
        if (样式 === null || 样式 === undefined) return ''
        return String(样式.overflowY || '')
      } catch (错误) {
        return ''
      }
    }

    function 自身是否可滚动(元素) {
      if (元素 === null || 元素 === undefined || 元素.nodeType !== 1) return false
      var 溢出Y = 取元素溢出Y(元素)
      // 💡 字符串 === 完整匹配模式（不是 in / indexOf 的子串匹配）
      if (溢出Y !== 'auto' && 溢出Y !== 'scroll' && 溢出Y !== 'overlay') return false
      try {
        return 元素.scrollHeight - 元素.clientHeight >= 4
      } catch (错误) {
        return false
      }
    }

    function 计算元素深度(元素) {
      var 深度 = 0
      var 当前 = 元素
      // 🛡️ 双亲属性都试；走到 null 必终止，绝不死循环
      while (当前 !== null && 当前 !== undefined) {
        深度 += 1
        if (当前.parentElement !== undefined) {
          当前 = 当前.parentElement
        } else if (当前.parentNode !== undefined) {
          当前 = 当前.parentNode
        } else {
          当前 = null
        }
      }
      return 深度
    }

    function 解析滚动目标(面板) {
      if (面板 === null) return null
      // 🥇 官方 .fO69Vq_page 自身就是 height:100% + overflow:auto，直接用面板
      if (自身是否可滚动(面板)) return 面板
      // 🥈 兜底：万一官方改成"面板内某层滚动"，取面板内最靠外的可滚后代。
      //     🔒 边界关键：只在面板内部找，绝不扩散到 body —— 这是不污染别处的底线
      if (typeof 面板.querySelectorAll !== 'function') return null
      var 后代 = null
      try {
        后代 = 面板.querySelectorAll('*')
      } catch (错误) {
        记录异常('扫描面板内可滚后代', 错误)
        return null
      }
      var 最优 = null
      var 最优深度 = Number.POSITIVE_INFINITY
      for (var 序号 = 0; 序号 < 后代.length; 序号 += 1) {
        var 深度 = 计算元素深度(后代[序号])
        if (深度 >= 最优深度) continue
        if (自身是否可滚动(后代[序号])) {
          最优深度 = 深度
          最优 = 后代[序号]
        }
      }
      return 最优
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔏 身份签名：只认官方插件卡，天然排除其余三个区域
    // ═══════════════════════════════════════════════════════════════

    function 计算列表签名(面板, 视图类别) {
      if (面板 === null) return ''
      var 类别 = 视图类别 || 取当前视图类别(面板)
      // 🛒 发现市场：按用户需求选定「仅记忆发现页面的最新滚动高度」，直接返回固定最新键名
      if (类别 === 发现市场命名空间) {
        if (typeof 面板.querySelector === 'function' && 面板.querySelector(发现市场面板选择器) !== null) {
          return 发现最新存档键名
        }
        return ''
      }
      // 📦 已安装列表：提取官方 [data-plugin-package] 与 [data-plugin-item] 排序签名
      if (typeof 面板.querySelectorAll !== 'function') return ''
      var 卡片 = null
      try {
        卡片 = 面板.querySelectorAll(插件卡选择器)
      } catch (错误) {
        记录异常('查询插件卡锚点', 错误)
        return ''
      }
      if (卡片.length === 0) return ''
      var 包名表 = []
      for (var 序号 = 0; 序号 < 卡片.length; 序号 += 1) {
        var 元素 = 卡片[序号]
        // 🔑 必须是 typeof 比较：`元素.getAttribute === 'function'` 是拿函数本身
        //    和字符串比，恒为假，会静默走 null 分支导致签名永远为空（真实犯过）。
        var 包名 = null
        if (typeof 元素.getAttribute === 'function') {
          包名 = 元素.getAttribute('data-plugin-package') || 元素.getAttribute('data-plugin-item')
        }
        if (包名 === null || 包名 === '') continue
        包名表.push(包名)
      }
      if (包名表.length === 0) return ''
      // 🧮 排序保证与 DOM 顺序无关：React 重渲染打乱节点顺序签名不变
      return 包名表.slice().sort().join('|')
    }

    function 解析存档值(原文) {
      if (原文 === null || 原文 === undefined || 原文 === '') return null
      try {
        var 对象 = JSON.parse(原文)
        if (对象 === null || typeof 对象 !== 'object') return null
        var 位置 = Number(对象.top)
        if (!isFinite(位置) || 位置 < 0) return null
        return 对象
      } catch (错误) {
        调试日志('存档无法解析，视为无效：' + String(错误))
        return null
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 💾 存档存储：sessionStorage 优先，被禁时降级内存 Map
    // ═══════════════════════════════════════════════════════════════

    var 内存存档表 = new Map()
    var 存档键序列表 = []
    var 存储可用标记 = null

    function 存储可用() {
      if (存储可用标记 !== null) return 存储可用标记
      try {
        if (typeof sessionStorage === 'undefined' || sessionStorage === null) {
          存储可用标记 = false
          return 存储可用标记
        }
        var 探针键 = 存储键前缀 + '__probe__'
        sessionStorage.setItem(探针键, '1')
        sessionStorage.removeItem(探针键)
        存储可用标记 = true
      } catch (错误) {
        调试日志('sessionStorage 不可用，降级内存存档：' + String(错误))
        存储可用标记 = false
      }
      return 存储可用标记
    }

    function 读取原始存储(键) {
      if (存储可用() === true) {
        try {
          return sessionStorage.getItem(键)
        } catch (错误) {
          记录异常('读取存档', 错误)
          return null
        }
      }
      return 内存存档表.has(键) ? 内存存档表.get(键) : null
    }

    function 写入原始存储(键, 值) {
      if (存储可用() === true) {
        try {
          sessionStorage.setItem(键, 值)
        } catch (错误) {
          记录异常('写入存档', 错误)
          return
        }
      } else {
        内存存档表.set(键, 值)
      }
      // 🧹 FIFO 淘汰：超上限丢最早那条，存储不无限增长
      var 位置 = 存档键序列表.indexOf(键)
      if (位置 >= 0) 存档键序列表.splice(位置, 1)
      存档键序列表.push(键)
      while (存档键序列表.length > 存档保留上限) {
        var 待删键 = 存档键序列表.shift()
        if (待删键 === 键) continue
        if (存储可用() === true) {
          try {
            sessionStorage.removeItem(待删键)
          } catch (错误) {
            记录异常('淘汰旧存档', 错误)
          }
        } else {
          内存存档表.delete(待删键)
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 📍 记录：只在列表页记账，且只记面板自身的位置
    // ═══════════════════════════════════════════════════════════════

    var 记录定时器 = 0
    var 当前记录目标 = null
    var 当前记录签名 = ''
    var 上次详情页存在 = false

    // 📊 双轨视图状态数据结构（已安装 vs 发现市场）
    var 视图状态表 = {
      installed: {
        最后已知滚动位置: null,
        当前记录签名: '',
        上次详情页存在: false
      },
      discover: {
        最后已知滚动位置: null,
        当前记录签名: 发现最新存档键名,
        上次详情页存在: false
      }
    }
    // 🚦 上次激活视图类别（用于感知 Tab 切换跃变）
    var 上次激活视图类别 = null

    // 保持单值引用供向下兼容与自检读取
    var 最后已知滚动位置 = null
    var 上次面板存在 = false
    var 程序滚动中标记 = false

    function 清除记录定时器() {
      if (记录定时器 === 0) return
      try {
        clearTimeout(记录定时器)
      } catch (错误) {
        记录异常('清除记录定时器', 错误)
      }
      记录定时器 = 0
    }

    // 🔑 生成带有命名空间的存储键
    function 生成存储键(视图类别, 签名) {
      if (视图类别 === 发现市场命名空间) {
        return 存储键前缀 + 发现市场命名空间 + ':' + 发现最新存档键名
      }
      return 存储键前缀 + 已安装命名空间 + ':' + (签名 || '__latest__')
    }

    // 💾 落库核心（DRY 公共函数）：把指定位置写入对应视图的存储中
    function 落库位置(位置, 签名, 视图类别) {
      var 类别 = 视图类别 || 上次激活视图类别 || 已安装命名空间
      var 存入位置 = 位置 <= 顶部判定阈值像素 ? 0 : Math.round(位置)
      var 存入签名 = 签名 || (视图状态表[类别] ? 视图状态表[类别].当前记录签名 : '') || 发现最新存档键名
      if (!存入签名 && 类别 === 已安装命名空间) return 存入位置

      var 键名 = 生成存储键(类别, 存入签名)
      var 存档数据 = JSON.stringify({ top: 存入位置, ts: Date.now() })

      // 💡 已安装列表：同时写入命名空间下的最新兜底与老版本兼容键
      if (类别 === 已安装命名空间) {
        写入原始存储(存储键前缀 + 已安装命名空间 + ':__latest__', JSON.stringify({ top: 存入位置, ts: Date.now(), sig: 存入签名 }))
        写入原始存储(存储键前缀 + 存入签名, 存档数据)
        写入原始存储(存储键前缀 + '__latest__', JSON.stringify({ top: 存入位置, ts: Date.now(), sig: 存入签名 }))
      }

      写入原始存储(键名, 存档数据)
      链路日志('落库：[' + 类别 + '] 存入 ' + 存入位置 + 'px → ' + 键名)
      return 存入位置
    }

    function 执行记录(目标, 签名) {
      if (目标 === null) return
      var 位置 = -1
      try {
        位置 = 目标.scrollTop
      } catch (错误) {
        记录异常('读取 scrollTop', 错误)
        return
      }
      if (位置 <= 0) {
        链路日志('防抖记录：已在顶部（' + 位置 + 'px），跳过写入（顶部归位由 Flush 显式落库 0 负责）')
        return
      }
      落库位置(位置, 签名)
    }

    function 安排记录(目标, 签名) {
      if (目标 === null || 签名 === '') return
      清除记录定时器()
      try {
        记录定时器 = setTimeout(function () {
          记录定时器 = 0
          执行记录(目标, 签名)
        }, 记录防抖毫秒)
      } catch (错误) {
        记录异常('安排记录定时器', 错误)
      }
    }

    function 滚动处理器(事件) {
      // 🛡️ 排除程序自身滚动行为（恢复设置、多帧守护校准、选项页归零复位等），以程序行为为主，绝不误当成用户偏好
      if (程序滚动中标记 === true) return
      if (恢复中标记 === true && Math.abs((事件 && 事件.target ? 事件.target.scrollTop : 0) - 恢复目标位置) <= 2) return
      if (守护剩余次数 > 0 && Math.abs((事件 && 事件.target ? 事件.target.scrollTop : 0) - 守护目标位置) <= 2) return

      if (当前记录目标 === null) {
        if (调试开关 === true) {
          var 探测面板 = 取列表面板()
          if (探测面板 !== null) {
            链路日志('滚动事件：当前未跟踪（选项页内滚动或列表未就绪），忽略不记账')
          }
        }
        return
      }
      if (事件 === null || 事件 === undefined) return
      var 目标 = 事件.target
      if (目标 !== 当前记录目标) return
      // 🛑 用户手动介入时取消任何进行中的自动恢复与守护
      if ((恢复中标记 === true || 守护剩余次数 > 0) && Math.abs(目标.scrollTop - (恢复目标位置 || 守护目标位置)) > 4 && 目标.scrollTop > 0) {
        链路日志('滚动事件：检测到手动滚动（当前 ' + 目标.scrollTop + 'px），立即取消自动恢复与多帧守护')
        取消恢复()
        等待返回恢复 = false
      }
      // 🎯 同步捕获器（根因修复核心）：在滚动事件发生的当下同步记录真实位置进对应视图状态
      var 捕获面板 = 取列表面板()
      if (捕获面板 !== null) {
        var 当前视图 = 取当前视图类别(捕获面板)
        var 详情在 = 详情页是否存在(捕获面板, 当前视图)
        if (详情在 === false) {
          var 状态 = 视图状态表[当前视图]
          if (状态) {
            状态.最后已知滚动位置 = 目标.scrollTop
          }
          最后已知滚动位置 = 目标.scrollTop
          链路日志('滚动事件：[' + 当前视图 + '] 列表态同步捕获位置 ' + 最后已知滚动位置 + 'px')
        } else {
          链路日志('滚动事件：[' + 当前视图 + '] 详情页已存在，拒收本次 scroll（防钳制假 0 混入），面板当前 ' + 目标.scrollTop + 'px')
        }
      }
      安排记录(当前记录目标, 当前记录签名)
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔙 恢复：多帧守护恢复 + 待恢复状态机，抵御浏览器异步回流冲刷
    // ═══════════════════════════════════════════════════════════════

    var 恢复中标记 = false
    var 恢复目标位置 = 0
    var 恢复等待签名 = ''
    var 恢复起始时间 = 0
    var 恢复定时器 = 0

    // 🛡️ 多帧守护机制：首次设置后持续守护 320ms，防止 React commit / 浏览器 Layout 重排把位置冲刷归零
    var 守护定时器 = 0
    var 守护剩余次数 = 0
    var 守护目标位置 = 0
    var 守护容器目标 = null

    // 🤖 程序驱动滚动安全赋值：包装原生 scrollTop 写入，自动上锁并在微任务/定时器后释放，排除程序自身滚动
    // 💡 数据结构设计图：
    //    目标元素.scrollTop = 位置 ──► 同步/微任务派发 scroll 事件 ──► 滚动处理器检测到 <程序滚动中标记> ──► 静默放行不污染
    // ❓ 为什么这样处理：浏览器对 scrollTop 赋值会派发真实的 scroll 事件，若不阻断，会导致恢复成功的值再次被捕获落库
    function 程序设置滚动(目标元素, 位置) {
      if (目标元素 === null || 目标元素 === undefined) return
      程序滚动中标记 = true
      try {
        目标元素.scrollTop = 位置
      } catch (错误) {
        记录异常('程序设置 scrollTop', 错误)
      }
      try {
        setTimeout(function () {
          程序滚动中标记 = false
        }, 50)
      } catch (忽略) {
        程序滚动中标记 = false
      }
    }

    function 停止守护() {
      if (守护定时器 !== 0) {
        try {
          clearTimeout(守护定时器)
        } catch (错误) {
          记录异常('清除守护定时器', 错误)
        }
        守护定时器 = 0
      }
      守护剩余次数 = 0
      守护目标位置 = 0
      守护容器目标 = null
    }

    function 执行守护检查() {
      if (守护剩余次数 <= 0 || 守护容器目标 === null) {
        停止守护()
        return
      }
      守护剩余次数 -= 1
      try {
        var 当前位置 = 守护容器目标.scrollTop
        // 🛑 如果检测到用户主动滚轮介入（偏离且大于 4px，并且不是被冲刷归零）
        if (当前位置 > 0 && Math.abs(当前位置 - 守护目标位置) > 4) {
          链路日志('守护 #' + (8 - 守护剩余次数) + '/8：检测到用户主动滚动（' + 当前位置 + 'px），停止守护并让位')
          停止守护()
          return
        }
        // 🔄 若被异步回流冲刷回 0 或发生偏差，立即重新拉回原位
        if (Math.abs(当前位置 - 守护目标位置) > 2) {
          程序设置滚动(守护容器目标, 守护目标位置)
          链路日志('守护 #' + (8 - 守护剩余次数) + '/8：被回流冲刷至 ' + 当前位置 + 'px，重新校准回 ' + 守护目标位置 + 'px')
        }
      } catch (错误) {
        停止守护()
        return
      }
      if (守护剩余次数 > 0) {
        try {
          守护定时器 = setTimeout(执行守护检查, 40)
        } catch (错误) {
          停止守护()
        }
      } else {
        停止守护()
      }
    }

    function 启动守护(目标, 位置) {
      停止守护()
      守护容器目标 = 目标
      守护目标位置 = 位置
      守护剩余次数 = 8 // 8 次 x 40ms = 320ms 持续平稳守护期
      链路日志('启动多帧守护：目标 ' + 位置 + 'px，共 8 次检查（每 40ms）')
      try {
        守护定时器 = setTimeout(执行守护检查, 40)
      } catch (错误) {
        停止守护()
      }
    }

    function 取消恢复() {
      // 🧪 取证日志：仅在确有进行中的恢复/守护时输出，避免每轮例行调用刷屏
      if (恢复中标记 === true || 恢复定时器 !== 0 || 守护剩余次数 > 0) {
        链路日志('取消恢复：清除进行中的恢复/守护（恢复中=' + 恢复中标记 + '，守护剩余=' + 守护剩余次数 + '）')
      }
      恢复中标记 = false
      恢复目标位置 = 0
      恢复等待签名 = ''
      if (恢复定时器 !== 0) {
        try {
          clearTimeout(恢复定时器)
        } catch (错误) {
          记录异常('清除恢复定时器', 错误)
        }
        恢复定时器 = 0
      }
      停止守护()
    }

    // 🍞 恢复成功后的角落提示（挂载于插件列表面板内，严守宿主 DOM 边界，杜绝追加到 document.body）
    function 显示提示(位置, 宿主面板) {
      if (提示开关 !== true) return
      if (typeof document === 'undefined') return
      var 面板 = 宿主面板 || 取列表面板()
      if (面板 === null || typeof 面板.appendChild !== 'function') return
      try {
        var 气泡 = document.createElement('div')
        气泡.className = 'dpsm-toast'
        气泡.textContent = '已回到第 ' + Math.round(位置) + ' 像素处'
        面板.appendChild(气泡)
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(function () {
            气泡.dataset.visible = '1'
          })
        } else {
          气泡.dataset.visible = '1'
        }
        setTimeout(function () {
          try {
            气泡.dataset.visible = '0'
            setTimeout(function () {
              if (气泡.parentNode !== null) 气泡.parentNode.removeChild(气泡)
            }, 220)
          } catch (错误) {
            记录异常('移除提示气泡', 错误)
          }
        }, 提示显形毫秒)
      } catch (错误) {
        记录异常('显示提示气泡', 错误)
      }
    }

    function 排下一次恢复() {
      if (恢复定时器 !== 0) return
      try {
        恢复定时器 = setTimeout(function () {
          恢复定时器 = 0
          尝试设置位置()
        }, 恢复重试间隔毫秒)
      } catch (错误) {
        记录异常('安排恢复定时器', 错误)
        取消恢复()
      }
    }

    function 尝试设置位置() {
      if (恢复中标记 !== true) return
      // 🔄 每次重新定位：React 重建后旧 DOM 引用可能已失效，重新取面板、重新解析目标
      var 面板 = 取列表面板()
      if (面板 === null) {
        链路日志('恢复尝试：列表面板已不在文档，放弃本次恢复')
        取消恢复()
        return
      }
      var 目标 = 解析滚动目标(面板)
      if (目标 === null) {
        if (Date.now() - 恢复起始时间 >= 恢复等待上限毫秒) {
          链路日志('恢复尝试：等待滚动目标超时，放弃')
          取消恢复()
          return
        }
        链路日志('恢复尝试：滚动目标暂缺，' + 恢复重试间隔毫秒 + 'ms 后重试')
        排下一次恢复()
        return
      }
      var 当前视图 = 取当前视图类别(面板)
      var 当前签名 = 计算列表签名(面板, 当前视图)
      if (当前签名 !== 恢复等待签名) {
        if (Date.now() - 恢复起始时间 >= 恢复等待上限毫秒) {
          链路日志('恢复尝试：等待签名匹配超时，放弃')
          取消恢复()
          return
        }
        链路日志('恢复尝试：[' + 当前视图 + '] 签名未就绪，' + 恢复重试间隔毫秒 + 'ms 后重试')
        排下一次恢复()
        return
      }
      程序设置滚动(目标, 恢复目标位置)
      链路日志('恢复成功：[' + 当前视图 + '] scrollTop 已设为 ' + 恢复目标位置 + 'px（实测回读 ' + 目标.scrollTop + 'px），启动多帧守护')
      显示提示(恢复目标位置, 面板)
      var 成功位置 = 恢复目标位置
      if (视图状态表[当前视图]) {
        视图状态表[当前视图].最后已知滚动位置 = 成功位置
      }
      最后已知滚动位置 = 成功位置
      链路日志('恢复成功：同步捕获变量已回写为 ' + 成功位置 + 'px')
      恢复中标记 = false
      恢复等待签名 = ''
      if (恢复定时器 !== 0) {
        clearTimeout(恢复定时器)
        恢复定时器 = 0
      }
      启动守护(目标, 成功位置)
    }

    function 排队恢复(签名, 位置) {
      取消恢复()
      恢复中标记 = true
      恢复等待签名 = 签名
      恢复目标位置 = 位置
      恢复起始时间 = Date.now()
      链路日志('排队恢复：目标 ' + 位置 + 'px，签名 ' + 签名.split('|').length + ' 卡，等待上限 ' + 恢复等待上限毫秒 + 'ms')
      尝试设置位置()
    }

    // ═══════════════════════════════════════════════════════════════
    // 🛰️ 刷新主循环：一次定位 + 一次签名 + 唯一的恢复判据
    // ═══════════════════════════════════════════════════════════════

    var 刷新已排程 = false

    // 🚦 待恢复状态机：捕获从选项页退回列表的跃变，保持 2000ms 窗口期直至卡片列表就绪
    var 等待返回恢复 = false
    var 等待返回起始时间 = 0

    function 执行刷新() {
      刷新已排程 = false
      if (启用开关 !== true) return
      诊断流水号 += 1
      var 面板 = 取列表面板()

      // ─────────────────────────────────────────────────────────────
      // 场景一：离开设置面板（面板不在文档中，例如进入聊天会话页）
      // ─────────────────────────────────────────────────────────────
      if (面板 === null) {
        if (跨页记忆开关 === true && 上次激活视图类别 !== null) {
          var 活跃状态 = 视图状态表[上次激活视图类别]
          if (活跃状态 && 活跃状态.上次详情页存在 === false) {
            var 离开位置 = 活跃状态.最后已知滚动位置 === null ? 0 : 活跃状态.最后已知滚动位置
            链路日志('离开插件页：固化活跃视图 [' + 上次激活视图类别 + '] 最后位置 ' + 离开位置 + 'px')
            落库位置(离开位置, 活跃状态.当前记录签名, 上次激活视图类别)
          }
        }
        if (当前记录目标 !== null || 当前记录签名 !== '' || 上次详情页存在 === true || 等待返回恢复 === true) {
          链路日志('刷新轮：不在插件页（无 [data-plugin-panel]），放弃跟踪并复位全部状态')
        }
        当前记录目标 = null
        当前记录签名 = ''
        上次详情页存在 = false
        等待返回恢复 = false
        最后已知滚动位置 = null
        上次面板存在 = false
        上次激活视图类别 = null
        if (视图状态表.installed) {
          视图状态表.installed.最后已知滚动位置 = null
          视图状态表.installed.当前记录签名 = ''
          视图状态表.installed.上次详情页存在 = false
        }
        if (视图状态表.discover) {
          视图状态表.discover.最后已知滚动位置 = null
          视图状态表.discover.当前记录签名 = 发现最新存档键名
          视图状态表.discover.上次详情页存在 = false
        }
        取消恢复()
        return
      }

      var 当前视图 = 取当前视图类别(面板)
      var 状态 = 视图状态表[当前视图]
      var 详情存在 = 详情页是否存在(面板, 当前视图)

      // ─────────────────────────────────────────────────────────────
      // 场景二：Tab 切换跃变（在「已安装」与「发现」之间来回切换）
      // ─────────────────────────────────────────────────────────────
      if (上次激活视图类别 !== null && 上次激活视图类别 !== 当前视图) {
        var 旧状态 = 视图状态表[上次激活视图类别]
        if (旧状态 && 旧状态.上次详情页存在 === false) {
          var 离开旧位置 = 旧状态.最后已知滚动位置 === null ? 0 : 旧状态.最后已知滚动位置
          链路日志('Tab 切换跃变：从 [' + 上次激活视图类别 + '] 切到 [' + 当前视图 + ']，立即落库旧 Tab 位置 ' + 离开旧位置 + 'px')
          落库位置(离开旧位置, 旧状态.当前记录签名, 上次激活视图类别)
        }
        链路日志('Tab 切换跃变：激活新 Tab [' + 当前视图 + '] 的待恢复状态机')
        等待返回恢复 = true
        等待返回起始时间 = Date.now()
        当前记录目标 = null
      }
      上次激活视图类别 = 当前视图

      // ─────────────────────────────────────────────────────────────
      // 场景三：即刻落库 Flush（从列表刚刚进入选项/详情页 false -> true）
      // ─────────────────────────────────────────────────────────────
      var 需要复位选项页 = false
      if (状态.上次详情页存在 === false && 详情存在 === true) {
        var 捕获位置 = 状态.最后已知滚动位置 === null ? 0 : 状态.最后已知滚动位置
        链路日志('Flush：[' + 当前视图 + '] 检测到刚进入详情页，即刻落库位置 ' + 捕获位置 + 'px')
        落库位置(捕获位置, 状态.当前记录签名, 当前视图)
        清除记录定时器()
        取消恢复()
        等待返回恢复 = false
        需要复位选项页 = true
      }

      // ─────────────────────────────────────────────────────────────
      // 场景四：从详情页返回列表（true -> false）
      // ─────────────────────────────────────────────────────────────
      if (状态.上次详情页存在 === true && 详情存在 === false) {
        链路日志('待恢复状态机：[' + 当前视图 + '] 检测到从详情页退出，激活恢复（窗口 ' + 恢复等待上限毫秒 + 'ms）')
        等待返回恢复 = true
        等待返回起始时间 = Date.now()
      }

      // ─────────────────────────────────────────────────────────────
      // 场景五：从外部页面重新进入面板（上次面板不存在 -> 存在）
      // ─────────────────────────────────────────────────────────────
      if (跨页记忆开关 === true && 上次面板存在 === false && 详情存在 === false) {
        链路日志('待恢复状态机：检测到从外部页面进入插件列表，激活跨页偏好恢复（窗口 ' + 恢复等待上限毫秒 + 'ms）')
        等待返回恢复 = true
        等待返回起始时间 = Date.now()
      }
      上次面板存在 = true

      var 目标 = 解析滚动目标(面板)
      if (目标 === null) {
        链路日志('刷新轮：[' + 当前视图 + '] 面板在但抽不到滚动目标，暂缓跟踪')
        当前记录目标 = null
        当前记录签名 = ''
        状态.上次详情页存在 = 详情存在
        上次详情页存在 = 详情存在
        return
      }

      var 签名 = 计算列表签名(面板, 当前视图)
      链路日志('刷新轮快照：视图=' + 当前视图 + '，详情存在=' + 详情存在 + '，上次详情=' + 状态.上次详情页存在 +
        '，等待返回恢复=' + 等待返回恢复 + '，面板 scrollTop=' + 目标.scrollTop +
        'px，捕获变量=' + (状态.最后已知滚动位置 === null ? 'null' : 状态.最后已知滚动位置 + 'px') +
        '，签名=' + (签名 === '' ? '(空)' : 签名))

      if (需要复位选项页 === true) {
        程序设置滚动(目标, 0)
      }

      // ─────────────────────────────────────────────────────────────
      // 场景六：执行待恢复（恢复到目标位置）
      // ─────────────────────────────────────────────────────────────
      if (等待返回恢复 === true && 详情存在 === false) {
        if (Date.now() - 等待返回起始时间 > 恢复等待上限毫秒) {
          链路日志('待恢复：[' + 当前视图 + '] 等待超时（>' + 恢复等待上限毫秒 + 'ms），放弃')
          等待返回恢复 = false
        } else if (签名 !== '') {
          var 存档 = null
          if (当前视图 === 发现市场命名空间) {
            存档 = 解析存档值(读取原始存储(生成存储键(发现市场命名空间, 发现最新存档键名)))
          } else {
            存档 = 解析存档值(读取原始存储(生成存储键(已安装命名空间, 签名)))
            if (存档 === null) {
              存档 = 解析存档值(读取原始存储(存储键前缀 + 签名))
            }
            if (存档 === null) {
              var 最近存档 = 解析存档值(读取原始存储(生成存储键(已安装命名空间, '__latest__')))
              if (最近存档 === null) {
                最近存档 = 解析存档值(读取原始存储(存储键前缀 + '__latest__'))
              }
              if (最近存档 !== null) {
                存档 = 最近存档
                链路日志('待恢复：已安装精确签名无存档，弹性命中 __latest__ = ' + 最近存档.top + 'px')
              }
            }
          }

          if (存档 !== null) {
            try {
              if (存档.top <= 顶部判定阈值像素) {
                链路日志('待恢复：[' + 当前视图 + '] 存档在顶部（' + 存档.top + 'px <= 阈值），执行顶部归位')
                if (目标.scrollTop > 顶部判定阈值像素) {
                  程序设置滚动(目标, 0)
                }
                当前记录目标 = 目标
                当前记录签名 = 签名
                状态.当前记录签名 = 签名
                状态.上次详情页存在 = 详情存在
                上次详情页存在 = 详情存在
                等待返回恢复 = false
                return
              }
              if (Math.abs(目标.scrollTop - 存档.top) > 顶部判定阈值像素) {
                链路日志('待恢复：[' + 当前视图 + '] 存档 ' + 存档.top + 'px ≠ 当前 ' + 目标.scrollTop + 'px，排队恢复')
                排队恢复(签名, 存档.top)
                当前记录目标 = 目标
                当前记录签名 = 签名
                状态.当前记录签名 = 签名
                状态.上次详情页存在 = 详情存在
                上次详情页存在 = 详情存在
                等待返回恢复 = false
                return
              }
              链路日志('待恢复：[' + 当前视图 + '] 当前位置已在原位（' + 目标.scrollTop + 'px），结束等待')
              等待返回恢复 = false
            } catch (错误) {
              记录异常('执行待恢复', 错误)
              等待返回恢复 = false
            }
          } else {
            链路日志('待恢复：[' + 当前视图 + '] 无任何历史存档，结束等待')
            等待返回恢复 = false
          }
        } else {
          链路日志('待恢复：[' + 当前视图 + '] 列表正在重绘中（签名为空），排程下一帧...')
          排程刷新()
        }
      }

      // 同步状态
      状态.上次详情页存在 = 详情存在
      上次详情页存在 = 详情存在
      if (详情存在 === true) {
        取消恢复()
        当前记录目标 = null
        当前记录签名 = ''
        状态.当前记录签名 = ''
        链路日志('状态同步：[' + 当前视图 + '] 当前在详情页，停止跟踪')
        return
      }

      try {
        var 官方正在刷新 = 面板.getAttribute('aria-busy') === 'true'
        if (官方正在刷新 === true && 详情存在 === false) {
          if (签名 !== '') {
            链路日志('检测到官方列表正在刷新（aria-busy=true），主动归零存档与捕获变量')
            落库位置(0, 签名, 当前视图)
          }
          状态.最后已知滚动位置 = 0
          最后已知滚动位置 = 0
          取消恢复()
          等待返回恢复 = false
        }
      } catch (忽略) {}

      当前记录目标 = 目标
      当前记录签名 = 签名
      状态.当前记录签名 = 签名

      if (签名 === '') {
        链路日志('状态同步：[' + 当前视图 + '] 抽不到列表条目，不记账')
        return
      }

      if (状态.最后已知滚动位置 === null && 等待返回恢复 === false && 恢复中标记 === false && 守护剩余次数 === 0) {
        状态.最后已知滚动位置 = 目标.scrollTop
        最后已知滚动位置 = 目标.scrollTop
      }
      链路日志('状态同步：[' + 当前视图 + '] 列表态跟踪中（面板 scrollTop=' + 目标.scrollTop + 'px，捕获=' + 状态.最后已知滚动位置 + 'px）')
    }

    function 排程刷新() {
      if (刷新已排程 === true) return
      刷新已排程 = true
      if (typeof requestAnimationFrame === 'function') {
        try {
          requestAnimationFrame(function () {
            执行刷新()
          })
          return
        } catch (错误) {
          记录异常('requestAnimationFrame 排程', 错误)
        }
      }
      try {
        setTimeout(执行刷新, 0)
      } catch (错误) {
        记录异常('setTimeout 排程刷新', 错误)
        刷新已排程 = false
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔄 可选项：点「刷新」后面板回顶点（默认关，且绝不动按钮功能）
    // ═══════════════════════════════════════════════════════════════

    function 点击处理器(事件) {
      if (刷新回顶点开关 !== true) return
      if (事件 === null || 事件 === undefined) return
      var 目标 = 事件.target
      if (目标 === null || 目标 === undefined) return
      var 面板 = 取列表面板()
      if (面板 === null) return
      if (是否面板头部点击(目标, 面板) !== true) return
      if (当前记录签名 !== '') {
        落库位置(0, 当前记录签名)
      }
      最后已知滚动位置 = 0
      取消恢复()
      等待返回恢复 = false
      var 滚动目标 = 解析滚动目标(面板)
      if (滚动目标 === null) return
      try {
        程序设置滚动(滚动目标, 0)
        调试日志('刷新回顶点已生效：已归零滚动并重置偏好')
      } catch (错误) {
        记录异常('刷新回顶点', 错误)
      }
    }

    function 是否面板头部点击(目标, 面板) {
      if (typeof 面板.querySelector !== 'function') return false
      var 头部 = null
      try {
        头部 = 面板.querySelector('header')
      } catch (错误) {
        记录异常('查询面板 header', 错误)
        return false
      }
      if (头部 === null) return false
      var 当前 = 目标
      var 步数 = 0
      while (当前 !== null && 当前 !== undefined && 步数 < 12) {
        if (当前 === 头部) return true
        if (当前 === 面板) return false
        当前 = 当前.parentElement !== undefined ? 当前.parentElement : (当前.parentNode !== undefined ? 当前.parentNode : null)
        步数 += 1
      }
      return false
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔌 监听装配与卸载
    // ═══════════════════════════════════════════════════════════════

    var 观察器 = null
    var 滚动监听已挂 = false
    var 点击监听已挂 = false
    var 移除样式句柄 = null

    function 启动监听() {
      if (typeof document === 'undefined') {
        调试日志('无 document 环境，插件不挂载')
        return false
      }
      if (typeof MutationObserver !== 'function') {
        调试日志('本环境无 MutationObserver，插件不挂载（而不是半残运行）')
        return false
      }
      try {
        观察器 = new MutationObserver(function () {
          排程刷新()
        })
        观察器.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true
        })
      } catch (错误) {
        记录异常('建立 MutationObserver', 错误)
        观察器 = null
        return false
      }
      if (typeof document.addEventListener === 'function') {
        try {
          document.addEventListener('scroll', 滚动处理器, { capture: true, passive: true })
          滚动监听已挂 = true
        } catch (错误) {
          记录异常('挂载 scroll 监听', 错误)
        }
        if (刷新回顶点开关 === true) {
          try {
            document.addEventListener('click', 点击处理器, { capture: true, passive: true })
            点击监听已挂 = true
          } catch (错误) {
            记录异常('挂载 click 监听', 错误)
          }
        }
      }
      调试日志('监听已启动：body childList+subtree，scroll 捕获段')
      return true
    }

    function 停止监听() {
      清除记录定时器()
      取消恢复()
      停止守护()
      等待返回恢复 = false
      刷新已排程 = false
      if (观察器 !== null) {
        try {
          观察器.disconnect()
        } catch (错误) {
          记录异常('断开 MutationObserver', 错误)
        }
        观察器 = null
      }
      if (滚动监听已挂 === true && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        try {
          document.removeEventListener('scroll', 滚动处理器, { capture: true, passive: true })
        } catch (错误) {
          记录异常('卸载 scroll 监听', 错误)
        }
        滚动监听已挂 = false
      }
      if (点击监听已挂 === true && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        try {
          document.removeEventListener('click', 点击处理器, { capture: true, passive: true })
        } catch (错误) {
          记录异常('卸载 click 监听', 错误)
        }
        点击监听已挂 = false
      }
      当前记录目标 = null
      当前记录签名 = ''
      上次详情页存在 = false
      上次面板存在 = false
      最后已知滚动位置 = null
      if (移除样式句柄 !== null) {
        移除样式句柄()
        移除样式句柄 = null
      }
      // 🧹 卸载即清账：清理残留气泡，不留任何 DOM 痕迹
      try {
        var 遗留气泡 = document.querySelectorAll('.dpsm-toast')
        for (var 气泡序号 = 0; 气泡序号 < 遗留气泡.length; 气泡序号 += 1) {
          if (遗留气泡[气泡序号].parentNode !== null) 遗留气泡[气泡序号].parentNode.removeChild(遗留气泡[气泡序号])
        }
      } catch (忽略) {}
      // 🧹 卸载即清账：不留任何 storage 痕迹
      for (var 序号 = 0; 序号 < 存档键序列表.length; 序号 += 1) {
        if (存储可用() === true) {
          try {
            sessionStorage.removeItem(存档键序列表[序号])
          } catch (错误) {
            记录异常('清理存档键', 错误)
          }
        } else {
          内存存档表.delete(存档键序列表[序号])
        }
      }
      存档键序列表 = []
      内存存档表.clear()
      调试日志('监听已停止，存档已清空')
    }

    // ═══════════════════════════════════════════════════════════════
    // 🚀 插件入口
    // ═══════════════════════════════════════════════════════════════

    // ⚙️ 向官方 plugins.bundle.config slot 注册配置卡片（键 = 包名；官方 README
    //    「配置页」：自带配置的插件把配置渲染在本页）。
    //    🛡️ 双通道兜底（审查加固）：官方 pm client 是 ctx.slots 直注同款；但
    //    univer-office / voice-input 走 ctx.inject(['slots'], …) 服务请求模式——
    //    若真实页面 ctx.slots 未注入，直注通道静默跳过会导致卡片不出现且无日志，
    //    故回退服务请求模式；两条通道都不可用才记 warn（绝不静默失败）。
    //    🛡️ slot 注册失败绝不拖垮滚动记忆主功能：全部异常捕获后仅记 warn。
    function 注册配置开关(ctx) {
      if (ctx === null || ctx === undefined) return
      try {
        if (ctx.slots !== null && ctx.slots !== undefined &&
            typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
          ctx.slots.inject('plugins.bundle.config', function () {
            return ctx.slots.register({
              name: 'plugins.bundle.config',
              key: NS
            }, 配置组件)
          })
          调试日志('选项页配置卡片已注册（ctx.slots 直注，plugins.bundle.config，key=' + NS + '）')
          return
        }
        if (typeof ctx.inject === 'function') {
          ctx.inject(['slots'], function (服务ctx) {
            try {
              if (服务ctx === null || 服务ctx === undefined ||
                  服务ctx.slots === null || 服务ctx.slots === undefined ||
                  typeof 服务ctx.slots.inject !== 'function' || typeof 服务ctx.slots.register !== 'function') {
                记录异常('注册选项页配置卡片(服务请求通道)', new Error('注入的 ctx 上仍无可用 slots'))
                return
              }
              服务ctx.slots.inject('plugins.bundle.config', function () {
                return 服务ctx.slots.register({
                  name: 'plugins.bundle.config',
                  key: NS
                }, 配置组件)
              })
              调试日志('选项页配置卡片已注册（ctx.inject 服务请求回退，plugins.bundle.config，key=' + NS + '）')
            } catch (错误) {
              记录异常('注册选项页配置卡片(服务请求通道)', 错误)
            }
          })
          return
        }
        记录异常('注册选项页配置卡片', new Error('ctx 上既无 slots 也无 inject 服务，跳过注册（卡片不会出现在详情页）'))
      } catch (错误) {
        记录异常('注册选项页配置卡片', 错误)
      }
    }

    function apply(ctx) {
      // 🧠 启动时读取用户记忆的调试开关（有记录则覆盖头部默认值）
      var 记忆值 = 读取记忆调试开关()
      if (记忆值 !== null) 调试开关 = 记忆值
      调试日志('调试开关初始值：' + 调试开关 + (记忆值 === null ? '（头部默认）' : '（来自 localStorage 记忆）'))

      if (启用开关 !== true) {
        调试日志('启用开关为 false，插件加载但不动作')
        return
      }
      if (typeof document === 'undefined') {
        调试日志('非浏览器环境，插件不动作')
        return
      }
      移除样式句柄 = 安装样式()
      if (启动监听() !== true) {
        if (移除样式句柄 !== null) {
          移除样式句柄()
          移除样式句柄 = null
        }
        return
      }
      if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
        try {
          ctx.effect(function () {
            return function 插件卸载清理() {
              停止监听()
            }
          }, NS + ': lifecycle')
        } catch (错误) {
          记录异常('注册生命周期 effect', 错误)
        }
      } else {
        调试日志('ctx.effect 不可用，跳过生命周期注册')
      }

      // ⚙️ 注册插件选项页的「开启调试日志」卡片（双通道兜底，见 注册配置开关 注释）
      注册配置开关(ctx)
    }

    // 📤 导出。inject 声明 'slots'：选项页配置开关要往官方 plugins.bundle.config
    //    slot 注册；滚动记忆本体依旧纯 DOM 观察，不依赖 locale。
    exports.name = NS
    exports.inject = ['slots']
    exports.apply = apply

    // 🧪 自检出口：把内部状态与纯函数交出去，供 tools/selftest.mjs 断言
    exports.内部接口 = {
      取列表面板: 取列表面板,
      取当前视图类别: 取当前视图类别,
      计算列表签名: 计算列表签名,
      详情页是否存在: 详情页是否存在,
      自身是否可滚动: 自身是否可滚动,
      解析滚动目标: 解析滚动目标,
      解析存档值: 解析存档值,
      是否面板头部点击: 是否面板头部点击,
      计算元素深度: 计算元素深度,
      执行刷新: 执行刷新,
      顶部判定阈值像素: 顶部判定阈值像素,
      生成存储键: 生成存储键,
      读取最后已知滚动位置: function (视图类别) {
        var 类别 = 视图类别 || 上次激活视图类别 || 已安装命名空间
        if (视图状态表[类别] && 视图状态表[类别].最后已知滚动位置 !== null) {
          return 视图状态表[类别].最后已知滚动位置
        }
        return 最后已知滚动位置
      },
      读取等待返回恢复: function () {
        return 等待返回恢复
      },
      读取守护剩余次数: function () {
        return 守护剩余次数
      },
      读取上次详情页存在: function (视图类别) {
        var 类别 = 视图类别 || 上次激活视图类别 || 已安装命名空间
        if (视图状态表[类别]) {
          return 视图状态表[类别].上次详情页存在
        }
        return 上次详情页存在
      },
      读取上次面板存在: function () {
        return 上次面板存在
      },
      读取程序滚动中标记: function () {
        return 程序滚动中标记
      },
      读取跨页记忆开关: function () {
        return 跨页记忆开关
      },
      读取当前记录目标: function () {
        return 当前记录目标
      },
      读取当前记录签名: function (视图类别) {
        var 类别 = 视图类别 || 上次激活视图类别 || 已安装命名空间
        if (视图状态表[类别] && 视图状态表[类别].当前记录签名 !== '') {
          return 视图状态表[类别].当前记录签名
        }
        return 当前记录签名
      },
      读取上次激活视图类别: function () {
        return 上次激活视图类别
      },
      读取调试开关: function () {
        return 调试开关 === true
      },
      读取记忆调试开关: 读取记忆调试开关,
      写记忆调试开关: 写记忆调试开关,
      配置组件: 配置组件
    }

    return module.exports
  },
})
