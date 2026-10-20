// tools/selftest.mjs —— dsh-plugin-scroll-memory 的结构级自检（Node 直跑，无需浏览器）
//
// 为什么要有它：插件的全部逻辑都作用在真实插件页的 DOM 上，本会话没有在跑的
// dsh web，无法做真实页面验收。为了「不靠肉眼猜、不靠嘴说通过」，这里用一个
// 迷你 DOM + 桩环境，把 lib/client.js 原样加载进来做断言。
//
// 场景 DOM 按官方 @deepseek-ai/dsh-client-ui-plugin-manager 的真实形状构造
// （锚点全部有官方源码出处）：
//   [data-plugin-panel]          列表页，且自身就是滚动 owner（overflow:auto）
//     └ header > button           刷新按钮（aria-label/图标）
//     └ section[data-plugin-scope=global][data-plugin-group]
//         └ ul > li[data-plugin-package="x"]    一张插件卡
//   [data-plugin-detail]          插件设置页（点卡片后同页 setView 切入）
//   body 下另有一个可滚动 config 区   用来证明「别处一律不碰」
//
// 运行：node tools/selftest.mjs   （退出码 0 = 全通过）

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const 本文件 = fileURLToPath(import.meta.url)
const 插件根 = path.resolve(path.dirname(本文件), '..')
const 客户端源码 = readFileSync(path.join(插件根, 'lib', 'client.js'), 'utf8')

// ═════════════════════════════════════════════════════════════════
// 📊 断言账本
// ═════════════════════════════════════════════════════════════════
let 通过数 = 0
let 失败数 = 0
const 失败清单 = []

function 记一格(是否通过, 说明, 细节) {
  if (是否通过) {
    通过数 += 1
    console.log('  ✅ ' + 说明)
    return
  }
  失败数 += 1
  失败清单.push(说明 + (细节 === undefined ? '' : ' | ' + 细节))
  console.log('  ❌ ' + 说明 + (细节 === undefined ? '' : '\n       ↳ ' + 细节))
}

function 相等(实际, 期望, 说明) {
  if (实际 === 期望) {
    记一格(true, 说明)
    return
  }
  let 同 = false
  try {
    同 = JSON.stringify(实际) === JSON.stringify(期望)
  } catch (忽略) {
    同 = false
  }
  记一格(同, 说明, 同 ? undefined : '实际 ' + String(实际) + ' ≠ 期望 ' + String(期望))
}

function 为真(条件, 说明, 细节) {
  记一格(Boolean(条件) === true, 说明, 条件 ? undefined : String(细节))
}

// ═════════════════════════════════════════════════════════════════
// 🧱 迷你 DOM：只实现 client.js 真正用到的那几个 API
// ═════════════════════════════════════════════════════════════════

const 数据属性转键 = (属性) => 属性.replace(/-([a-z])/g, (m, c) => c.toUpperCase())

function 取属性值(元素, 属性) {
  if (属性 === 'class') return 元素._类名 === undefined ? '' : 元素._类名
  if (属性.indexOf('data-') === 0) {
    const 键 = 数据属性转键(属性.slice(5))
    return 元素.dataset[键]
  }
  return 元素._属性[属性]
}

function 属性是否存在(元素, 属性) {
  if (属性 === 'class') return true
  if (属性.indexOf('data-') === 0) {
    const 键 = 数据属性转键(属性.slice(5))
    return Object.prototype.hasOwnProperty.call(元素.dataset, 键)
  }
  return Object.prototype.hasOwnProperty.call(元素._属性, 属性)
}

function 匹配简单选择器(元素, 简单) {
  let 剩余 = String(简单).trim()
  const 标签段 = /^([a-zA-Z][\w-]*|\*)/.exec(剩余)
  if (标签段 !== null) {
    const 标签 = 标签段[1]
    剩余 = 剩余.slice(标签.length)
    if (标签 !== '*' && 元素.tagName !== 标签.toUpperCase()) return false
  }
  const 片段 = /^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]|^\.([\w-]+)/
  let 段
  while (剩余.length > 0) {
    段 = 片段.exec(剩余)
    if (段 === null) return false
    if (段[1] !== undefined) {
      if (段[2] === undefined) {
        // 🎯 无值属性 [attr]：属性存在即命中，空字符串也算（官方 data-plugin-panel 就是无值属性）
        if (属性是否存在(元素, 段[1]) !== true) return false
      } else if (String(取属性值(元素, 段[1])) !== String(段[2])) {
        return false
      }
    } else if (段[3] !== undefined) {
      const 类名表 = String(取属性值(元素, 'class') || '').split(/\s+/)
      if (类名表.indexOf(段[3]) < 0) return false
    }
    剩余 = 剩余.slice(段[0].length)
  }
  return true
}

function 造元素(标签, 配置) {
  const 配置对象 = 配置 || {}
  const 元素 = {
    tagName: String(标签).toUpperCase(),
    nodeType: 1,
    dataset: {},
    _属性: 配置对象.属性 || {},
    _类名: 配置对象.类名 === undefined ? '' : 配置对象.类名,
    _溢出Y: 配置对象.溢出Y === undefined ? 'visible' : 配置对象.溢出Y,
    children: [],
    parentElement: null,
    parentNode: null,
    isConnected: 配置对象.isConnected === undefined ? true : 配置对象.isConnected,
    scrollTop: 配置对象.滚动 === undefined ? 0 : 配置对象.滚动,
    scrollHeight: 配置对象.scrollHeight === undefined ? 0 : 配置对象.scrollHeight,
    clientHeight: 配置对象.clientHeight === undefined ? 0 : 配置对象.clientHeight,
    textContent: 配置对象.文本 === undefined ? '' : 配置对象.文本,
    ownerDocument: null,
    // 🧰 client.js 依赖 getAttribute / setAttribute，桩必须给
    getAttribute: function (名) {
      const 值 = 取属性值(元素, 名)
      return 值 === undefined ? null : 值
    },
    setAttribute: function (名, 值) {
      if (名 === 'class') {
        元素._类名 = String(值)
        return
      }
      if (名.indexOf('data-') === 0) {
        元素.dataset[数据属性转键(名.slice(5))] = String(值)
        return
      }
      元素._属性[名] = String(值)
    },
    appendChild: function (子) {
      子.parentElement = 元素
      子.parentNode = 元素
      元素.children.push(子)
      return 子
    },
    removeChild: function (子) {
      const 位置 = 元素.children.indexOf(子)
      if (位置 >= 0) 元素.children.splice(位置, 1)
      子.parentElement = null
      子.parentNode = null
      return 子
    },
    contains: function (目标) {
      return 元素 === 目标 || 深度优先收集(元素, () => true, []).indexOf(目标) >= 0
    }
  }
  return 元素
}

function 挂子节点(父, 子表) {
  for (const 子 of 子表) {
    子.parentElement = 父
    子.parentNode = 父
    父.children.push(子)
  }
  return 父
}

function 深度优先收集(节点, 命中判断, 结果) {
  for (const 子 of 节点.children) {
    if (命中判断(子)) 结果.push(子)
    深度优先收集(子, 命中判断, 结果)
  }
  return 结果
}

function 造文档() {
  const 占位 = 造元素('#document')
  占位.nodeType = 9
  const head = 造元素('head')
  const body = 造元素('body')
  const documentElement = 造元素('html')
  const 全文 = {
    ...占位,
    head,
    body,
    documentElement,
    defaultView: null,
    _监听表: [],
    createElement: (标签) => {
      const 新 = 造元素(标签)
      新.ownerDocument = 全文
      return 新
    },
    addEventListener: (类型, 回调) => {
      全文._监听表.push({ 类型, 回调 })
    },
    removeEventListener: (类型, 回调) => {
      const 位置 = 全文._监听表.findIndex((项) => 项.类型 === 类型 && 项.回调 === 回调)
      if (位置 >= 0) 全文._监听表.splice(位置, 1)
    },
    _选择器全部: (根, 选择器) => {
      const 拆分 = String(选择器).split(',').map((项) => 项.trim()).filter(Boolean)
      return 深度优先收集(根, (元素) => 拆分.some((简单) => 匹配简单选择器(元素, 简单)), [])
    },
    querySelectorAll: function (选择器) {
      return 全文._选择器全部(全文, 选择器)
    },
    querySelector: function (选择器) {
      const 命中 = 全文.querySelectorAll(选择器)
      return 命中.length > 0 ? 命中[0] : null
    }
  }
  全文.defaultView = {
    getComputedStyle: (元素) => ({ overflowY: 元素._溢出Y })
  }
  for (const 节点 of [head, body, documentElement]) {
    节点.ownerDocument = 全文
    节点.parentNode = 全文
  }
  挂子节点(全文, [head, body, documentElement])
  return 全文
}

function 接线查询能力(根, 文档) {
  const 接线 = (元素) => {
    元素.ownerDocument = 文档
    元素.querySelectorAll = (选择器) => 文档._选择器全部(元素, 选择器)
    元素.querySelector = (选择器) => {
      const 命中 = 文档._选择器全部(元素, 选择器)
      return 命中.length > 0 ? 命中[0] : null
    }
    for (const 子 of 元素.children) 接线(子)
  }
  接线(根)
}

// ═════════════════════════════════════════════════════════════════
// 🧪 桩环境
// ═════════════════════════════════════════════════════════════════

function 造会话存储(是否抛错) {
  const 表 = new Map()
  return {
    setItem: (键, 值) => {
      if (是否抛错 === true) throw new Error('sessionStorage 被环境禁用')
      表.set(String(键), String(值))
    },
    getItem: (键) => (表.has(String(键)) ? 表.get(String(键)) : null),
    removeItem: (键) => {
      表.delete(String(键))
    },
    key: (序号) => {
      const 键表 = Array.from(表.keys())
      return 序号 < 键表.length ? 键表[序号] : null
    },
    get length() {
      return 表.size
    },
    _表: 表
  }
}

class 观察者桩 {
  constructor(回调) {
    this.回调 = 回调
    this.已观察 = null
    this.断开次数 = 0
  }

  observe(目标, 配置) {
    this.已观察 = { 目标, 配置 }
  }

  disconnect() {
    this.已观察 = null
    this.断开次数 += 1
  }

  手动触发() {
    if (typeof this.回调 === 'function') this.回调([])
  }
}

function 加载插件(选项) {
  const 配置 = 选项 || {}
  const 文档 = 造文档()
  const 存储 = 造会话存储(配置.禁用存储 === true)
  const 本地存储 = 配置.本地存储 === undefined ? 造会话存储(false) : 配置.本地存储
  const 观察者容器 = { 实例: null }
  const 载入结果 = { 规格: null }
  const window对象 = {
    __ModuleLoader__: {
      load: (规格) => {
        载入结果.规格 = 规格
      }
    }
  }
  class 记录观察者 extends 观察者桩 {
    constructor(回调) {
      super(回调)
      观察者容器.实例 = this
    }
  }
  // 🧭 关键：用 new Function 把客户端源码放进**主 realm** 执行，桩与插件代码
  //    同 realm。曾经用 vm.createContext，结果踩到 Node vm 的跨 realm 伪影：
  //    `typeof 外realm函数 === 'function'` 判 false，client.js 的 getAttribute
  //    探测静默走 null 分支，签名永远为空 —— 那是测试工具的失真，不是插件
  //    的 bug（真实浏览器里插件与 DOM 同 realm）。同 realm 后伪影消失。
  const 观察者参数 = 配置.无观察者 === true ? undefined : 记录观察者
  // 🧩 状态化 React 桩：状态单元按 hooks 调用序号持久化（跨渲染保持，忠实模拟
  //    真实 React 的重渲染语义）。每次「渲染」前测试须调用 重置渲染() 归零序号，
  //    同一组件实例的多次渲染即复用同一批状态单元；不重置则消耗新单元（=新实例）。
  const 状态池 = []
  let 钩子序号 = 0
  const react桩 = {
    重置渲染: () => { 钩子序号 = 0 },
    useState: (初值) => {
      const 序号 = 钩子序号
      钩子序号 += 1
      if (状态池[序号] === undefined) {
        状态池[序号] = [初值, (下一个) => {
          状态池[序号][0] = typeof 下一个 === 'function' ? 下一个(状态池[序号][0]) : 下一个
        }]
      }
      return 状态池[序号]
    }
  }
  const jsx桩 = {
    jsx: (类型, 属性) => ({ 类型, 属性 }),
    jsxs: (类型, 属性) => ({ 类型, 属性 })
  }
  const 工厂 = new Function(
    'window',
    'document',
    'sessionStorage',
    'localStorage',
    'MutationObserver',
    'requestAnimationFrame',
    'console',
    客户端源码
  )
  工厂(window对象, 文档, 存储, 本地存储, 观察者参数, (回调) => setTimeout(回调, 0), console)
  const 规格 = 载入结果.规格
  const 导出 = 规格.factory((名) => (名 === 'react' ? react桩 : 名 === 'react/jsx-runtime' ? jsx桩 : {}))
  return { 文档, 存储, 本地存储, 导出, 规格, 取观察者: () => 观察者容器.实例, 重置渲染: () => react桩.重置渲染() }
}

const 等待 = (毫秒) => new Promise((解决) => setTimeout(解决, 毫秒))

// ═════════════════════════════════════════════════════════════════
// 🎭 官方插件页形状（锚点按官方源码构造）
// ═════════════════════════════════════════════════════════════════

function 造官方插件页(文档, 选项) {
  const 配置 = 选项 || {}
  const 面板 = 造元素('section', { 溢出Y: 'auto', scrollHeight: 900, clientHeight: 600, 类名: 'page' })
  面板.dataset.pluginPanel = '' // 官方无值属性
  const 头部 = 造元素('header', {})
  const 刷新按钮 = 造元素('button', { 文本: '刷新' })
  挂子节点(头部, [刷新按钮])
  const 分区 = 造元素('section', {})
  分区.dataset.pluginScope = 'global'
  分区.dataset.pluginGroup = 'bundles'
  const 卡容器 = 造元素('ul', {})
  const 包名表 = 配置.包名 === undefined ? ['dsh-voice', 'dsh-context', 'dshmarket', 'dsh-mnemon'] : 配置.包名
  const 卡片 = 包名表.map((名) => {
    const 卡 = 造元素('li', { 文本: 名 })
    卡.dataset.pluginPackage = 名
    卡.dataset.pluginStatus = 'active'
    return 卡
  })
  挂子节点(卡容器, 卡片)
  挂子节点(分区, [卡容器])
  挂子节点(面板, [头部, 分区])
  return { 面板, 头部, 刷新按钮, 分区, 卡片 }
}

function 造官方发现市场页(文档, 选项) {
  const 配置 = 选项 || {}
  const 面板 = 造元素('section', { 溢出Y: 'auto', scrollHeight: 1200, clientHeight: 600, 类名: 'page' })
  面板.dataset.pluginPanel = ''
  const 头部 = 造元素('header', {})
  const 发现根 = 造元素('div', { 类名: 'section' })
  发现根.dataset.pluginTab = 'discover'
  const 卡容器 = 造元素('ul', { 类名: 'cards' })
  const 条目表 = 配置.条目 || ['dsh-community-tool', 'dsh-paddle-ocr', 'dsh-wechat-push', 'dsh-super-prompt']
  const 卡片 = 条目表.map((名) => {
    const 卡 = 造元素('li', { 文本: 名, 类名: 'card' })
    卡.dataset.marketEntry = 名
    return 卡
  })
  挂子节点(卡容器, 卡片)
  挂子节点(发现根, [卡容器])
  挂子节点(面板, [头部, 发现根])
  return { 面板, 头部, 发现根, 卡片, 卡容器 }
}

function 进入发现市场详情页(页, 条目名) {
  const 详情 = 造元素('div', { 类名: 'detail' })
  详情.dataset.marketDetail = 条目名 || 'dsh-paddle-ocr'
  const 返回按钮 = 造元素('button', { 文本: '返回', 类名: 'crumb' })
  挂子节点(详情, [返回按钮])
  页.发现根.children.length = 0
  挂子节点(页.发现根, [详情])
  页.详情 = 详情
  页.面板.scrollTop = 0 // 模拟浏览器钳制
  return 详情
}

function 返回发现市场列表(页, 选项) {
  const 配置 = 选项 || {}
  const 卡容器 = 造元素('ul', { 类名: 'cards' })
  const 条目表 = 配置.条目 || ['dsh-community-tool', 'dsh-paddle-ocr', 'dsh-wechat-push', 'dsh-super-prompt']
  const 卡片 = 条目表.map((名) => {
    const 卡 = 造元素('li', { 文本: 名, 类名: 'card' })
    卡.dataset.marketEntry = 名
    return 卡
  })
  挂子节点(卡容器, 卡片)
  页.发现根.children.length = 0
  挂子节点(页.发现根, [卡容器])
  页.卡片 = 卡片
  页.详情 = null
  页.面板.scrollTop = 0
}

function 装入页面(文档, 页) {
  挂子节点(文档.body, [页.面板])
  接线查询能力(文档.body, 文档)
  return 页
}

function 装别处可滚动区(文档) {
  const 别处 = 造元素('div', { 溢出Y: 'auto', scrollHeight: 500, clientHeight: 200, 类名: 'config', 文本: '别的页面' })
  别处.dataset.pluginConfig = ''
  挂子节点(文档.body, [别处])
  接线查询能力(文档.body, 文档)
  return 别处
}

function 进入插件设置页(页, 包名) {
  const 详情 = 造元素('div', { 文本: 包名 + ' 的设置' })
  详情.dataset.pluginDetail = 包名
  const 配置区 = 造元素('div', {})
  配置区.dataset.pluginConfig = ''
  挂子节点(详情, [配置区])
  挂子节点(页.面板, [详情])
  页.详情 = 详情
  // 🧪 忠实模拟真实浏览器行为：内容换为（较矮的）详情页后，浏览器把变矮容器的
  //    scrollTop 钳制（clamp）归零。旧桩缺这一步，导致 v2/v3 的Flush缺陷在测试里不可见！
  页.面板.scrollTop = 0
  return 详情
}

function 进入内置插件选项页(页, 条目名) {
  const 详情 = 造元素('div', { 文本: 条目名 + ' 的内置配置' })
  详情.dataset.pluginItemDetail = 条目名
  const 配置区 = 造元素('div', {})
  配置区.dataset.pluginConfig = ''
  挂子节点(详情, [配置区])
  挂子节点(页.面板, [详情])
  页.详情 = 详情
  // 🧪 同上：模拟浏览器钳制，保证桩与真实环境行为一致
  页.面板.scrollTop = 0
  return 详情
}

function 造内置插件卡片页(文档, 选项) {
  const 配置 = 选项 || {}
  const 面板 = 造元素('section', { 溢出Y: 'auto', scrollHeight: 1200, clientHeight: 600, 类名: 'page' })
  面板.dataset.pluginPanel = ''
  const 头部 = 造元素('header', {})
  const 刷新按钮 = 造元素('button', { 文本: '刷新' })
  挂子节点(头部, [刷新按钮])
  const 分区 = 造元素('section', {})
  分区.dataset.pluginScope = 'official'
  const 卡容器 = 造元素('ul', {})
  const 条目表 = 配置.条目 === undefined ? ['agent-teams', 'approval', 'autonomous-agent', 'audio-input', 'terminal', 'agent-loop', 'subagent', 'web-search'] : 配置.条目
  const 卡片 = 条目表.map((名) => {
    const 卡 = 造元素('li', { 文本: 名 })
    卡.dataset.pluginItem = 名
    return 卡
  })
  挂子节点(卡容器, 卡片)
  挂子节点(分区, [卡容器])
  挂子节点(面板, [头部, 分区])
  return { 面板, 头部, 刷新按钮, 分区, 卡片 }
}

function 返回插件列表(页) {
  if (页.详情 === undefined) return
  try {
    页.面板.removeChild === undefined ? null : 页.面板.removeChild(页.详情)
  } catch (忽略) {
    const 位置 = 页.面板.children.indexOf(页.详情)
    if (位置 >= 0) 页.面板.children.splice(位置, 1)
  }
  页.详情 = undefined
}

const 派发滚动 = (文档, 目标) => {
  const 监听 = 文档._监听表.find((项) => 项.类型 === 'scroll')
  if (监听 !== undefined) 监听.回调({ target: 目标 })
}

const 派发点击 = (文档, 目标) => {
  const 监听 = 文档._监听表.find((项) => 项.类型 === 'click')
  if (监听 !== undefined) 监听.回调({ target: 目标 })
}

// ═════════════════════════════════════════════════════════════════
// 🏁 开始
// ═════════════════════════════════════════════════════════════════

console.log('\n🧪 dsh-plugin-scroll-memory 自检（第二版：精确锚定 + 刷新零干扰）\n')

console.log('【一】交付契约')
{
  const 环境 = 加载插件()
  相等(环境.规格.id, 'dsh-plugin-scroll-memory', '__ModuleLoader__.load 的 id 是包名')
  为真(typeof 环境.规格.factory === 'function', 'factory 是函数')
  相等(环境.导出.name, 'dsh-plugin-scroll-memory', '导出 name')
  为真(Array.isArray(环境.导出.inject), "导出 inject 是数组（声明 'slots' 服务供配置卡片注册）")
  为真(typeof 环境.导出.apply === 'function', '导出 apply 是函数')
  为真(typeof 环境.导出.内部接口 === 'object', '导出 内部接口 供自检')
}

console.log('\n【二】apply(ctx)：样式、观察者、生命周期')
{
  const 环境 = 加载插件()
  装入页面(环境.文档, 造官方插件页(环境.文档))
  const 效果表 = []
  环境.导出.apply({ effect: (函数体) => { 效果表.push(函数体); return 函数体 } })
  相等(环境.文档.head.children.length, 1, '只注入一个 style 标签')
  相等(环境.文档.head.children[0].dataset.pluginCss, 'dsh-plugin-scroll-memory/scroll-memory.css', '样式标签 ID 正确')
  相等(环境.取观察者().已观察.配置, { childList: true, subtree: true }, '观察 body 的 childList+subtree')
  相等(效果表.length, 1, '注册一次 ctx.effect 生命周期')
  为真(环境.文档._监听表.some((项) => 项.类型 === 'scroll'), '挂上 document scroll 捕获监听')
  相等(环境.文档._监听表.some((项) => 项.类型 === 'click'), false, 'click 监听默认不挂（刷新回顶点默认关）')
}

console.log('\n【三】锚点与签名（只认官方 data 属性）')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  const 接口 = 环境.导出.内部接口
  相等(接口.取列表面板(), 页.面板, '取列表面板命中 [data-plugin-panel]')
  相等(接口.详情页是否存在(页.面板), false, '列表态详情页不存在')
  相等(接口.计算列表签名(页.面板), 'dsh-context|dsh-mnemon|dsh-voice|dshmarket', '签名 = 插件卡包名集合（已排序）')
  // 打乱 DOM 顺序，签名必须不变
  const 卡容器 = 页.分区.children[0]
  卡容器.children.length = 0 // 🧹 桩的挂子节点只追加不替换，先清空否则会变 8 张卡
  挂子节点(卡容器, 页.卡片.slice().reverse())
  相等(接口.计算列表签名(页.面板), 'dsh-context|dsh-mnemon|dsh-voice|dshmarket', '卡片顺序打乱签名不变（与 DOM 顺序无关）')
  // 装机状态变化，签名必须变
  const 新页 = 装入页面(环境.文档, 造官方插件页(环境.文档, { 包名: ['dsh-voice', 'dsh-context'] }))
  相等(接口.计算列表签名(新页.面板) === 接口.计算列表签名(页.面板), false, '装机状态变化签名随之变化')
  相等(接口.计算列表签名(null), '', '面板为 null 时签名为空')
  // 干净文档（本段前面为了对比往同一个 body 里装过两个面板，所以另起一个）
  相等(接口.计算列表签名(加载插件().文档.body), '', '没有任何插件页的文档签名为空 → 天然不记账')
}

console.log('\n【四】滚动目标：面板自身优先，面板内兜底，绝不扩散')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  const 接口 = 环境.导出.内部接口
  相等(接口.解析滚动目标(页.面板), 页.面板, '面板自身可滚 → 目标就是面板（官方 .fO69Vq_page 语义）')
  相等(接口.解析滚动目标(null), null, '面板为 null → null')

  // 面板自身不可滚时，才在面板内部找最靠外的可滚后代
  const 文档2 = 加载插件().文档
  const 页2 = 造官方插件页(文档2)
  页2.面板._溢出Y = 'hidden'
  页2.面板.scrollHeight = 600
  页2.面板.clientHeight = 600
  装入页面(文档2, 页2)
  const 外层 = 造元素('div', { 溢出Y: 'auto', scrollHeight: 800, clientHeight: 400 })
  const 内层 = 造元素('div', { 溢出Y: 'auto', scrollHeight: 800, clientHeight: 400 })
  挂子节点(外层, [内层])
  挂子节点(页2.面板, [外层])
  接线查询能力(文档2.body, 文档2)
  相等(接口.解析滚动目标(页2.面板), 外层, '面板不可滚 → 取面板内最靠外的可滚后代')
  相等(接口.解析滚动目标(外层) === 内层, false, '绝不穿透到面板之外的元素')
}

console.log('\n【五】存档解析的非法输入')
{
  const 环境 = 加载插件()
  const 接口 = 环境.导出.内部接口
  相等(接口.解析存档值(''), null, '空串无效')
  相等(接口.解析存档值('{ 坏 JSON'), null, '坏 JSON 无效')
  相等(接口.解析存档值('{"top":-5}'), null, '负数位置无效')
  相等(接口.解析存档值('{"top":"abc"}'), null, '非数字无效')
  相等(接口.解析存档值('{"top":0,"ts":1}').top, 0, '顶部 0 像素是合法存档（回顶部后归位的依据）')
  相等(接口.解析存档值('{"top":480,"ts":1}').top, 480, '合法存档解析成功')
  相等(接口.顶部判定阈值像素, 2, '顶部判定阈值已从头部配置区导出')
}

console.log('\n【六】端到端：记账 → 进设置页 → 返回 → 恢复')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)

  // 用户往下翻
  页.面板.scrollTop = 480
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  const 签名 = 环境.导出.内部接口.计算列表签名(页.面板)
  const 落库 = 环境.存储.getItem('dsh-psm:' + 签名)
  为真(落库 !== null, '停止滚动 120ms 后位置落库')
  if (落库 !== null) 相等(JSON.parse(落库).top, 480, '落库值正是 480')

  // 点卡片进设置页：DOM 出现 [data-plugin-detail]
  进入插件设置页(页, 'dsh-voice')
  环境.取观察者().手动触发()
  await 等待(10)
  相等(环境.导出.内部接口.读取上次详情页存在(), true, '进入设置页后标记详情页存在')
  相等(环境.导出.内部接口.读取当前记录目标(), null, '设置页里停止跟踪（防止覆盖列表存档）')

  // 在设置页里滚动：不得写入任何存档
  页.面板.scrollTop = 260
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 480, '设置页内滚动不覆盖列表存档')

  // 点「返回插件列表」：详情页消失 + 位置归零（React 重建的效果）
  返回插件列表(页)
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 480, '返回列表后位置恢复到 480')

  // 再往返一次，仍生效
  进入插件设置页(页, 'dsh-context')
  环境.取观察者().手动触发()
  await 等待(10)
  返回插件列表(页)
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 480, '第二次往返同样恢复到 480')
}

console.log('\n【七】刷新零干扰（你的反馈 1 回归测试）')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 520
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  const 签名 = 环境.导出.内部接口.计算列表签名(页.面板)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 520, '先记下 520')

  // 点「刷新」：官方 refresh() 就地更新，详情页始终不存在，位置归零
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 0, '刷新后停在 0，不被按回 520（反馈 1 修复）')

  // 反复刷新都不该被干预
  for (let 轮 = 0; 轮 < 3; 轮 += 1) {
    页.面板.scrollTop = 0
    环境.取观察者().手动触发()
    await 等待(10)
  }
  相等(页.面板.scrollTop, 0, '连续三次刷新后仍是 0')

  // 刷新到一半又滚到别的位置，也不该被篡改
  页.面板.scrollTop = 130
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 130, '刷新后滚到 130 也原样保留')
}

console.log('\n【八】别处一律不碰（你的反馈 2 回归测试）')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  const 别处 = 装别处可滚动区(环境.文档)
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)

  // 只滚动那个"别处"容器
  别处.scrollTop = 300
  派发滚动(环境.文档, 别处)
  await 等待(220)
  相等(环境.存储.length, 0, '别处容器的滚动完全不落库')
  相等(环境.导出.内部接口.读取当前记录目标(), 页.面板, '跟踪目标仍只认列表面板')

  // 从别处"返回"（DOM 变化）也不该触发恢复
  别处.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(别处.scrollTop, 0, '别处容器位置不受任何干预')
}

console.log('\n【九】设置页 → 设置页（不触发恢复）')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 400
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  进入插件设置页(页, 'dsh-voice')
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 90 // 设置页里也滚过
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 环境.导出.内部接口.计算列表签名(页.面板))).top, 400, '设置页里滚到 90 也没污染 400')
  // 返回插件列表 → 恢复 400；再次进入新设置页 → 选项页位置归零为 0（保护选项页不被篡改）
  返回插件列表(页)
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 400, '返回列表后成功恢复到 400')
  进入插件设置页(页, 'dsh-context')
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 0, '再次进入新插件选项页后滚动位置复位为 0（绝不篡改选项页位置）')
}

console.log('\n【十】不在插件页时整体安静')
{
  const 环境 = 加载插件()
  const 别处 = 装别处可滚动区(环境.文档)
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)
  别处.scrollTop = 250
  派发滚动(环境.文档, 别处)
  await 等待(220)
  相等(环境.存储.length, 0, '整个页面没有 [data-plugin-panel] 时什么都不做')
  相等(环境.导出.内部接口.读取当前记录目标(), null, '不跟踪任何容器')
}

console.log('\n【十一】sessionStorage 被禁 → 内存存档接管')
{
  const 环境 = 加载插件({ 禁用存储: true })
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 300
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  进入插件设置页(页, 'dsh-voice')
  环境.取观察者().手动触发()
  await 等待(10)
  返回插件列表(页)
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 300, '存储被禁时内存存档照样恢复')
}

console.log('\n【十二】卸载：监听、样式、存档全部清干净')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  const 效果表 = []
  环境.导出.apply({ effect: (函数体) => { 效果表.push(函数体); return 函数体 } })
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 500
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  为真(环境.存储.length >= 1, '卸载前确有存档')
  // cordis 语义：ctx.effect(callback) 的 callback 返回 disposer，要调 disposer 才真正清理
  const 卸载函数 = 效果表[0]()
  为真(typeof 卸载函数 === 'function', 'effect 回调如期返回 disposer')
  卸载函数()
  相等(环境.取观察者().断开次数, 1, 'observer 已 disconnect')
  相等(环境.文档.head.children.length, 0, '样式标签已移除')
  相等(环境.存储.length, 0, '存档键已清空')
  相等(环境.文档._监听表.length, 0, 'document 监听已全部移除')
}

console.log('\n【十四】官方内置插件（截图中 8 个插件）+ 即刻落库 + 待恢复状态机 + 防篡改全量测试')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造内置插件卡片页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)

  // 1. 验证内置插件卡片能正确计算签名
  const 接口 = 环境.导出.内部接口
  const 初始签名 = 接口.计算列表签名(页.面板)
  为真(初始签名.includes('terminal') && 初始签名.includes('web-search'), '官方内置插件 data-plugin-item 成功计入签名')

  // 2. 模拟真实用户行为：滚动到 420px，未等 120ms 防抖结束（仅 20ms），立刻点击卡片进入选项页！
  页.面板.scrollTop = 420
  派发滚动(环境.文档, 页.面板)
  await 等待(20) // 故意不等待 120ms 防抖，模拟手速极快的点击

  // 3. 进入「网页搜索」选项详情页（data-plugin-item-detail）
  进入内置插件选项页(页, 'web-search')
  环境.取观察者().手动触发()
  await 等待(10)

  // 🛡️ 核心验证一【即刻落库 Flush】：即使防抖定时器未到期，进入选项页时必须强行把 420 同步落库！
  const 即刻存档 = JSON.parse(环境.存储.getItem('dsh-psm:' + 初始签名) || '{}')
  相等(即刻存档.top, 420, '即刻落库成功：滚完立即点卡片，420px 也被完整保存而不丢失')

  // 🛡️ 核心验证二【选项页防篡改】：选项页自身的滚动条必须被复位归零，干脆从顶部 0px 开始展示！
  相等(页.面板.scrollTop, 0, '进入选项详情页后滚动位置被重置为 0（彻底解决篡改选项页位置问题）')
  相等(接口.详情页是否存在(页.面板), true, '精准识别出 [data-plugin-item-detail] 选项详情页')
  相等(接口.读取当前记录目标(), null, '选项页内停止记录目标（防止覆盖列表存档）')

  // 4. 用户在选项页内部向下滚动浏览配置项到 180px
  页.面板.scrollTop = 180
  派发滚动(环境.文档, 页.面板)
  await 等待(150)
  const 列表旧存档 = JSON.parse(环境.存储.getItem('dsh-psm:' + 初始签名) || '{}')
  相等(列表旧存档.top, 420, '选项页内滚动绝不污染列表存档，列表存档仍是 420')

  // 5. 点击左上角返回插件列表（模拟 React 异步挂载时序差：卡片先清空，下一帧再挂上）
  返回插件列表(页)
  // 模拟卡片容器在卸载选项页的瞬间先处于空状态
  const 原卡片列表 = 页.分区.children[0]
  页.分区.children = []
  环境.取观察者().手动触发()
  await 等待(10)

  // 🛡️ 核心验证三【待恢复状态机】：即使卡片此时为空（签名为空），待恢复状态机成功激活且不放弃！
  相等(接口.读取等待返回恢复(), true, '待恢复状态机成功激活，即使卡片未就绪也绝不丢失恢复机会')

  // 下一帧：卡片列表渲染挂载完毕
  页.分区.children = [原卡片列表]
  接线查询能力(页.面板, 环境.文档)
  环境.取观察者().手动触发()
  await 等待(50)

  // 🛡️ 核心验证四【多帧守护恢复】：成功恢复到 420px，且守护机制激活！
  相等(页.面板.scrollTop, 420, '从选项页返回列表后成功平稳恢复到原先的 420px 位置')
  为真(接口.读取守护剩余次数() > 0, '多帧守护机制已激活，正在保护滚动条不受异步回流冲刷')
  // 等待守护期（约320ms）平稳收尾
  await 等待(350)
  相等(接口.读取守护剩余次数(), 0, '守护期平稳结束')

  // 6. 再次点击右上角刷新按钮：零干扰
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 0, '点击刷新后依然停在 0，刷新按钮绝不受干扰')
}

console.log('\n【十五】根因修复回归：同步捕获 + 浏览器钳制模拟（快点击 / 回顶部 / 刷新零干扰）')
{
  const 环境 = 加载插件()
  const 页 = 装入页面(环境.文档, 造内置插件卡片页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)
  const 接口 = 环境.导出.内部接口
  const 签名 = 接口.计算列表签名(页.面板)

  // ── 场景 A：滚到 420px，防抖 120ms 未到期就立刻点官方插件（快点击丢位置，根因一回归）──
  页.面板.scrollTop = 420
  派发滚动(环境.文档, 页.面板) // 滚动事件当下同步捕获 → 变量 = 420
  await 等待(20) // 故意不等防抖到期
  进入内置插件选项页(页, 'terminal') // 桩已模拟浏览器钳制：面板 scrollTop 被冲刷归 0
  环境.取观察者().手动触发()
  await 等待(10)
  // Flush 绝不读被钳制的 DOM，消费的是同步捕获变量 → 420 完整落库！
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名) || '{}').top, 420, '钳制归零后 Flush 仍按同步捕获变量落库 420（快点击位置不丢失）')
  相等(页.面板.scrollTop, 0, '选项页展示位置归零（钳制 + 主动复位，不篡改选项页）')

  // 返回列表 → 应精确恢复 420
  返回插件列表(页)
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 420, '快点击场景返回列表后成功恢复到 420px')
  await 等待(350) // 守护期收尾 + 恢复成功已回写捕获变量 = 420

  // ── 场景 B：滑回最顶部 0px，再点官方插件（跳回旧位置，根因二回归）──
  页.面板.scrollTop = 0
  派发滚动(环境.文档, 页.面板) // 同步捕获 → 变量 = 0
  await 等待(220) // 等防抖到期：旧实现此处不写 0，存档残留 420（陈旧缓存证据）
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名) || '{}').top, 420, '防抖记录在顶部时跳过写入，存档仍是旧 420（待 Flush 覆盖）')
  进入内置插件选项页(页, 'web-search')
  环境.取观察者().手动触发()
  await 等待(10)
  // Flush 消费变量 = 0 → 显式落库 0，覆盖陈旧的 420！
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名) || '{}').top, 0, '在顶部点官方插件，Flush 显式落库 0px（覆盖旧 420，根治陈旧缓存）')

  // 返回列表 → 顶部归位分支：稳停 0px，绝不跳回 420 旧位置！
  返回插件列表(页)
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 0, '从顶部进入的官方插件返回列表后稳停 0px，绝不跳回下方 420 旧位置！')
  相等(接口.读取等待返回恢复(), false, '返回恢复状态机正常结束')

  // ── 场景 C：顶部再滚到 130px，再次快点击 → 变量实时性验证 ──
  页.面板.scrollTop = 130
  派发滚动(环境.文档, 页.面板) // 变量 = 130
  await 等待(20)
  进入内置插件选项页(页, 'agent-teams')
  环境.取观察者().手动触发()
  await 等待(10)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名) || '{}').top, 130, '变量随最新滚动实时更新，Flush 落库 130')
  返回插件列表(页)
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 130, '返回列表后恢复到最新的 130px')
  await 等待(350)

  // ── 场景 D：刷新按钮零干扰最终回归 ──
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 0, '顶部点击刷新依然保持 0px，原生刷新功能零干扰')

  // ── 场景 E（真实日志 #44 轮复现）：从顶部进入详情，且详情页内容较矮使面板不可滚动 ──
  //    旧结构：解析滚动目标返回 null → 执行刷新提前 return → Flush 被整体跳过 →
  //    存档残留旧位置 → 返回列表时被拉回下方旧位置（用户实测最后一个顽固症状）
  页.面板.scrollTop = 0
  派发滚动(环境.文档, 页.面板) // 同步捕获变量 = 0
  await 等待(20)
  进入内置插件选项页(页, 'terminal') // 桩钳制归零
  页.面板.scrollHeight = 600 // 🧪 模拟详情页较矮：scrollHeight == clientHeight → 目标 = null
  环境.取观察者().手动触发()
  await 等待(10)
  // 修复核心断言：Flush 已前置到目标解析之前，即使目标为 null 也必须完成落库！
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名) || '{}').top, 0, '面板不可滚动（目标 null）时 Flush 仍前置执行，0px 显式落库覆盖旧存档')
  返回插件列表(页)
  页.面板.scrollHeight = 1200 // 🧪 列表重挂，滚动性恢复
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 0, '从矮详情页返回列表后顶部归位，绝不跳回下方旧位置')
  await 等待(350)
}

console.log('\n【十三】无 MutationObserver 时拒绝半残运行')
{
  const 环境 = 加载插件({ 无观察者: true })
  装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.导出.apply({ effect: (函数体) => 函数体 })
  相等(环境.取观察者(), null, '没有 MutationObserver 时一个观察者都不建')
  相等(环境.文档.head.children.length, 0, '起不来就连样式都不留')
  相等(环境.文档._监听表.length, 0, '也不挂任何监听')
  记一格(true, '降级路径不抛错')
}

console.log('\n【十六】选项页调试开关：localStorage 记忆 + plugins.bundle.config 注册')
{
  // 1. 默认值：无记忆 → false（头部默认）
  const 环境1 = 加载插件()
  相等(环境1.导出.内部接口.读取记忆调试开关(), null, '无记忆记录时读取返回 null')
  相等(环境1.导出.内部接口.读取调试开关(), false, '无记忆时调试开关为头部默认 false（默认关闭）')

  // 2. 写记忆 → localStorage 落值，读回一致
  环境1.导出.内部接口.写记忆调试开关(true)
  相等(环境1.本地存储.getItem('dsh-psm:调试开关'), '1', '开关记忆写入 localStorage（1=开）')
  相等(环境1.导出.内部接口.读取记忆调试开关(), true, '写后读回 true')

  // 3. 「重启」：新环境共享同一 localStorage → apply 后记忆生效
  const 环境2 = 加载插件({ 本地存储: 环境1.本地存储 })
  环境2.导出.apply({ effect: (函数体) => 函数体 })
  相等(环境2.导出.内部接口.读取调试开关(), true, '重启后从 localStorage 记忆恢复开启状态')

  // 4. 反向：关掉再重启，记忆的是关闭
  环境2.导出.内部接口.写记忆调试开关(false)
  const 环境3 = 加载插件({ 本地存储: 环境1.本地存储 })
  环境3.导出.apply({ effect: (函数体) => 函数体 })
  相等(环境3.导出.内部接口.读取调试开关(), false, '记忆为关闭时重启后仍是关闭')

  // 5. 非法记忆值 → 回退默认
  环境1.本地存储.setItem('dsh-psm:调试开关', 'yes')
  相等(环境1.导出.内部接口.读取记忆调试开关(), null, '非法记忆值（非 0/1）视为无记录')

  // 6. inject 声明 slots；apply 向官方 slot 注册配置开关
  为真(环境1.导出.inject.indexOf('slots') >= 0, "导出 inject 声明 'slots' 服务")
  const 注册记录 = { 注入: [], 条目: null }
  环境1.导出.apply({
    effect: (函数体) => 函数体,
    slots: {
      inject: (名, 工厂) => {
        注册记录.注入.push(名)
        return 工厂()
      },
      register: (选项, 组件) => {
        注册记录.条目 = { 选项, 组件 }
        return () => {}
      }
    }
  })
  为真(注册记录.注入.indexOf('plugins.bundle.config') >= 0, "ctx.slots.inject 目标是官方 'plugins.bundle.config' slot")
  为真(注册记录.条目 !== null && 注册记录.条目.选项.key === 'dsh-plugin-scroll-memory', "注册键 = 本包名（官方以包名为键挂详情页）")
  为真(typeof 注册记录.条目.组件 === 'function', '注册的条目是 React 函数组件')

  // 6.5 双通道兜底：ctx 无 slots 时走 ctx.inject(['slots'], …) 服务请求模式
  {
    const 回退记录 = { 注入: [], 条目: null }
    环境1.导出.apply({
      effect: (函数体) => 函数体,
      inject: (服务表, 回调) => {
        回退记录.注入.push(服务表.join(','))
        回调({
          slots: {
            inject: (名, 工厂) => {
              回退记录.注入.push(名)
              return 工厂()
            },
            register: (选项, 组件) => {
              回退记录.条目 = { 选项, 组件 }
              return () => {}
            }
          }
        })
      }
    })
    为真(回退记录.注入.indexOf('slots') >= 0, "ctx.slots 缺失时回退 ctx.inject(['slots']) 服务请求")
    为真(回退记录.注入.indexOf('plugins.bundle.config') >= 0, '服务请求通道同样注册进官方配置 slot')
    为真(回退记录.条目 !== null && 回退记录.条目.选项.key === 'dsh-plugin-scroll-memory', '回退通道注册键同样是本包名')

    // 6.6 两条通道都不可用：绝不静默失败（记录异常走 console.warn）
    const 警告表 = []
    const 原始warn = console.warn
    console.warn = (内容) => { 警告表.push(String(内容)) }
    try {
      环境1.导出.apply({ effect: (函数体) => 函数体 })
    } finally {
      console.warn = 原始warn
    }
    为真(警告表.some((行) => 行.indexOf('注册选项页配置卡片') >= 0), '双通道都不可用时记 warn（绝不静默失败）')
  }

  // 6.7 存储访问即抛环境的容错（审查修复回归：typeof 检查必须在 try 内）
  {
    // 🧪 模拟浏览器「阻止所有 Cookie」配置：localStorage 的任何属性访问（getItem/setItem）
    //    都抛 SecurityError。行为断言：读返回 null、写不抛、apply 不炸。
    const 抛错本地存储 = new Proxy({}, {
      get: function () { throw new Error('SecurityError：存储被环境禁用（模拟）') },
      set: function () { throw new Error('SecurityError：存储被环境禁用（模拟）') }
    })
    const 环境4 = 加载插件({ 本地存储: 抛错本地存储 })
    相等(环境4.导出.内部接口.读取记忆调试开关(), null, 'localStorage 访问即抛时读取安全返回 null（不逃逸异常）')
    环境4.导出.内部接口.写记忆调试开关(true) // 🛡️ 不抛即通过（异常会被 为真 之外的断言机制视为崩溃）
    记一格(true, 'localStorage 访问即抛时写入静默容错（不逃逸异常）')
    环境4.导出.apply({ effect: (函数体) => 函数体 }) // 🛡️ apply 第一行就读记忆，不抛即通过
    记一格(true, '禁存储环境下 apply 全流程不炸（滚动主功能不受牵连）')

    // 🔒 源码结构断言：两个存储函数里 try { 必须出现在 typeof localStorage 之前（防回归）
    const 函数体检查 = (函数名) => {
      const 起点 = 客户端源码.indexOf('function ' + 函数名)
      if (起点 < 0) return null
      const 终点 = 客户端源码.indexOf('\n    }', 起点)
      const 函数体 = 客户端源码.slice(起点, 终点)
      return 函数体.indexOf('try {') < 函数体.indexOf('typeof localStorage')
    }
    为真(函数体检查('读取记忆调试开关') === true, '读取记忆调试开关：typeof 检查在 try 内（SecurityError 防线）')
    为真(函数体检查('写记忆调试开关') === true, '写记忆调试开关：typeof 检查在 try 内（SecurityError 防线）')
  }

  // 7. Univer Office 风格配置组件：卡片结构、草稿态、胶囊开关、放弃修改与保存
  const 渲染前 = 环境1.导出.内部接口.读取调试开关()
  const 组件输出 = 环境1.导出.内部接口.配置组件()
  相等(组件输出.属性.className, 'dpsm_settingsCard', '外层容器是 dpsm_settingsCard 卡片')

  // 7.0 summary 视图防御：摘要位只能拿到单行简介，绝不能是整张卡片
  const 摘要输出 = 环境1.导出.内部接口.配置组件({ view: 'summary' })
  相等(摘要输出.类型, 'span', "view:'summary' 时返回单行简介而非整卡（官方 keyed 条目契约）")
  相等(摘要输出.属性.className, undefined, '摘要输出不带卡片类名')

  const 主体 = 组件输出.属性.children[1]
  const 字段行 = 主体.属性.children[0]
  const 胶囊开关 = 字段行.属性.children[0].属性.children[1].属性.children
  const 底部栏 = 主体.属性.children[1]
  const 放弃按钮 = 底部栏.属性.children[0]
  const 保存按钮 = 底部栏.属性.children[1]

  相等(胶囊开关.属性.role, 'switch', '开关按钮声明 role=switch 规范')
  相等(胶囊开关.属性['aria-checked'], 渲染前, '初始勾选态与已存状态一致')
  相等(保存按钮.属性.disabled, true, '未修改时保存按钮处于禁用态')
  相等(放弃按钮.属性.disabled, true, '未修改时放弃按钮处于禁用态')

  // 模拟用户点击胶囊开关：仅修改草稿，未点击保存前不变更生效变量
  胶囊开关.属性.onClick()
  相等(环境1.导出.内部接口.读取调试开关(), 渲染前, '拨动开关仅改变草稿，未点击保存前不变更生效变量')

  // 模拟用户点击「保存」按钮
  保存按钮.属性.onClick()
  相等(环境1.导出.内部接口.读取调试开关(), !渲染前, '点击保存后，调试开关生效变量翻转')
  相等(环境1.本地存储.getItem('dsh-psm:调试开关'), !渲染前 ? '1' : '0', '点击保存后，写入 localStorage 记忆')

  // 7.5 防假成功回归（审查修复）：localStorage 可读但写入必失败时，保存绝不提交任何状态
  {
    // 🧪 桩：读正常（返回 '0' 已关闭），写必抛（模拟隐私模式/配额满）
    const 只读本地存储 = {
      getItem: () => '0',
      setItem: () => { throw new Error('QuotaExceededError：写入被拒（模拟）') },
      removeItem: () => {}
    }
    const 环境5 = 加载插件({ 本地存储: 只读本地存储 })
    环境5.导出.apply({ effect: (函数体) => 函数体 })
    相等(环境5.导出.内部接口.读取调试开关(), false, '写失败环境：apply 读到已关闭记忆，初始为 false')

    // 首次渲染 + 拨动草稿 → 重渲染 → 保存按钮必须解除禁用（脏态如实呈现）
    const 首渲染 = 环境5.导出.内部接口.配置组件()
    首渲染.属性.children[1].属性.children[0].属性.children[0].属性.children[1].属性.children.属性.onClick()
    环境5.重置渲染()
    const 二渲染 = 环境5.导出.内部接口.配置组件()
    const 二渲染保存 = 二渲染.属性.children[1].属性.children[1].属性.children[1]
    相等(二渲染保存.属性.disabled, false, '写失败环境：草稿修改后保存按钮解除禁用（脏态如实呈现）')

    // 点保存 → 写入抛错 → 必须整体不提交 → 再重渲染验证按钮仍可用（可重试）
    二渲染保存.属性.onClick()
    相等(环境5.导出.内部接口.读取调试开关(), false, '防假成功：写失败时运行时变量绝不翻转')
    环境5.重置渲染()
    const 三渲染 = 环境5.导出.内部接口.配置组件()
    const 三渲染保存 = 三渲染.属性.children[1].属性.children[1].属性.children[1]
    相等(三渲染保存.属性.disabled, false, '防假成功：保存失败后按钮保持可用（可重试），UI 绝不假装成功')

    // 返回值语义：失败 false / 成功 true
    为真(环境5.导出.内部接口.写记忆调试开关(true) === false, '写记忆调试开关 失败时返回 false（返回值语义）')
    为真(环境1.导出.内部接口.写记忆调试开关(true) === true, '写记忆调试开关 成功时返回 true（返回值语义）')
  }
}

console.log('\n【十七】跨页面偏好记忆：去会话页 ↔ 返回列表自动恢复与主动归零')
{
  const 环境 = 加载插件()
  let 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  const 接口 = 环境.导出.内部接口
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)

  const 签名 = 接口.计算列表签名(页.面板)

  // ── 场景 A：在插件列表浏览滚到 450px，然后离开去会话页面 ──
  页.面板.scrollTop = 450
  派发滚动(环境.文档, 页.面板)
  await 等待(220) // 防抖写入
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 450, '离开前成功记录列表滚动偏好 450px')

  // 模拟离开插件页去会话页（插件面板被 React 从 DOM 移除卸载）
  环境.文档.body.children.length = 0
  接线查询能力(环境.文档.body, 环境.文档)
  环境.取观察者().手动触发()
  await 等待(10)
  相等(接口.取列表面板(), null, '去会话页后当前无插件面板')
  相等(接口.读取最后已知滚动位置(), null, '去会话页后瞬态内存捕获变量被彻底清空（防跨页泄漏）')
  相等(接口.读取上次面板存在(), false, '记录上次面板已离开')

  // 模拟从会话页返回插件列表页（React 全新挂载列表面板，原生 scrollTop 必然为 0）
  页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  页.面板.scrollTop = 0 // 冷启动 0px
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 450, '从会话页返回列表后，成功恢复至用户离开前的 450px 偏好位置')
  await 等待(350) // 等多帧守护结束

  // ── 场景 B：用户主动滚回最顶部（0px），再去会话页 ──
  页.面板.scrollTop = 0
  派发滚动(环境.文档, 页.面板) // 手动滚回顶部
  await 等待(20)

  // 离开去会话页
  环境.文档.body.children.length = 0
  接线查询能力(环境.文档.body, 环境.文档)
  环境.取观察者().手动触发()
  await 等待(10)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 0, '滚回顶部离开后，存档被固化为 0px')

  // 再返回列表页：应该稳停在 0px，绝不拉回旧位置
  页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(50)
  相等(页.面板.scrollTop, 0, '主动回顶后离开再返回，稳稳停在顶部 0px，不被向下篡改')
  await 等待(350)

  // ── 场景 C：用户滚到 320px，点击官方刷新（aria-busy），重置偏好 ──
  页.面板.scrollTop = 320
  派发滚动(环境.文档, 页.面板)
  await 等待(220)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 320, '滚动到 320px 记账')

  // 模拟官方 refresh() 触发列表更新
  页.面板.setAttribute('aria-busy', 'true')
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(10)
  相等(JSON.parse(环境.存储.getItem('dsh-psm:' + 签名)).top, 0, '官方刷新中（aria-busy）时偏好存档被主动归零')

  // 刷新完毕
  页.面板.setAttribute('aria-busy', 'false')
  环境.取观察者().手动触发()
  await 等待(10)
  相等(页.面板.scrollTop, 0, '刷新后稳停在 0px')

  // ── 场景 D：程序内部滚动标记生效验证 ──
  为真(接口.读取程序滚动中标记() === false, '静止态下程序滚动标记为 false')
}

console.log('\n【十八】「发现」插件市场端到端：记账 → 进市场详情页 → 返回 → 恢复')
{
  const 环境 = 加载插件()
  let 页 = 装入页面(环境.文档, 造官方发现市场页(环境.文档))
  const 接口 = 环境.导出.内部接口
  环境.导出.apply({ effect: (函数体) => 函数体 })
  环境.取观察者().手动触发()
  await 等待(10)

  相等(接口.取当前视图类别(页.面板), 'discover', '成功识别当前视图为发现市场 (discover)')
  相等(接口.计算列表签名(页.面板), '__latest__', '发现市场签名收敛为 __latest__')

  // 用户在发现市场滚动到 360px
  页.面板.scrollTop = 360
  派发滚动(环境.文档, 页.面板)
  await 等待(220) // 防抖写入

  const 发现存档 = JSON.parse(环境.存储.getItem('dsh-psm:discover:__latest__'))
  为真(发现存档 !== null, '发现市场独立存档存在')
  相等(发现存档.top, 360, '发现市场存档位置正确落库为 360px')

  // 进入市场详情页：在同一发现根节点下，将卡片列表替换为详情页
  进入发现市场详情页(页, 'dsh-paddle-ocr')
  环境.取观察者().手动触发()
  await 等待(10)

  为真(接口.详情页是否存在(页.面板), '成功识别发现市场详情页 [data-market-detail]')
  相等(接口.读取当前记录目标(), null, '市场详情页内停止记录目标（防止污染市场列表存档）')

  // 点击返回按钮退出详情页，恢复卡片列表
  返回发现市场列表(页)
  环境.取观察者().手动触发()
  await 等待(50) // 待恢复状态机响应

  相等(页.面板.scrollTop, 360, '从市场详情页返回列表后成功平稳恢复到 360px')
  await 等待(350)
}

console.log('\n【十九】双 Tab（已安装 ↔ 发现市场）互相切换：独立记忆与无缝还原')
{
  const 环境 = 加载插件()
  const 接口 = 环境.导出.内部接口
  环境.导出.apply({ effect: (函数体) => 函数体 })

  // 1. 在「已安装」列表浏览滚动到 480px
  let 页 = 装入页面(环境.文档, 造官方插件页(环境.文档))
  环境.取观察者().手动触发()
  await 等待(10)
  页.面板.scrollTop = 480
  派发滚动(环境.文档, 页.面板)
  await 等待(20)

  // 2. 点击「发现」Tab 切换（同面板内替换为发现市场）
  const 发现市场 = 造官方发现市场页(环境.文档)
  页.面板.children.length = 0
  挂子节点(页.面板, [发现市场.头部, 发现市场.发现根])
  页.发现根 = 发现市场.发现根
  页.面板.scrollTop = 0 // 新 Tab 浏览器初始 0px
  环境.取观察者().手动触发()
  await 等待(50)

  相等(接口.取当前视图类别(页.面板), 'discover', '成功切换到发现市场视图')
  const 已安装存档 = JSON.parse(环境.存储.getItem('dsh-psm:installed:__latest__'))
  相等(已安装存档.top, 480, 'Tab 切换瞬间，已安装位置 480px 被即刻 Flush 落库')

  // 3. 在「发现」市场浏览滚动到 260px
  页.面板.scrollTop = 260
  派发滚动(环境.文档, 页.面板)
  await 等待(20)

  // 4. 点击切换回「已安装」Tab
  const 已安装列表 = 造官方插件页(环境.文档)
  页.面板.children.length = 0
  挂子节点(页.面板, [已安装列表.头部, 已安装列表.分区])
  页.面板.scrollTop = 0 // 重新切回初始 0px
  环境.取观察者().手动触发()
  await 等待(50) // 待恢复触发

  相等(接口.取当前视图类别(页.面板), 'installed', '成功切回已安装视图')
  const 发现存档 = JSON.parse(环境.存储.getItem('dsh-psm:discover:__latest__'))
  相等(发现存档.top, 260, 'Tab 切换瞬间，发现市场位置 260px 被即刻 Flush 落库')
  相等(页.面板.scrollTop, 480, '切回已安装列表后，成功恢复至 480px！两边互不干扰')
  await 等待(350)

  // 5. 再次点击切换回「发现」Tab
  页.面板.children.length = 0
  挂子节点(页.面板, [发现市场.头部, 发现市场.发现根])
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(50)

  相等(页.面板.scrollTop, 260, '再次切回发现市场后，成功恢复至 260px！')
  await 等待(350)
}

console.log('\n【二十】「发现」插件市场跨页面偏好记忆：离开去会话页 ↔ 返回市场恢复')
{
  const 环境 = 加载插件()
  const 接口 = 环境.导出.内部接口
  环境.导出.apply({ effect: (函数体) => 函数体 })

  let 页 = 装入页面(环境.文档, 造官方发现市场页(环境.文档))
  环境.取观察者().手动触发()
  await 等待(10)

  页.面板.scrollTop = 310
  派发滚动(环境.文档, 页.面板)
  await 等待(220) // 防抖写入

  // 离开插件面板去会话页（整面板从 body 卸载）
  环境.文档.body.children.length = 0
  接线查询能力(环境.文档.body, 环境.文档)
  环境.取观察者().手动触发()
  await 等待(10)
  相等(接口.取列表面板(), null, '离开去会话页后当前无插件面板')

  // 从会话页重新进入设置「发现」页面
  页 = 装入页面(环境.文档, 造官方发现市场页(环境.文档))
  页.面板.scrollTop = 0
  环境.取观察者().手动触发()
  await 等待(50)

  相等(页.面板.scrollTop, 310, '从会话页返回发现市场后，成功恢复至用户离开前的 310px！')
  await 等待(350)
}

// ═════════════════════════════════════════════════════════════════
// 🏁 汇总
// ═════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(64))
console.log('通过 ' + 通过数 + ' 项，失败 ' + 失败数 + ' 项')
if (失败数 > 0) {
  console.log('\n失败明细：')
  for (const 项 of 失败清单) console.log('  · ' + 项)
  console.log('\n❌ 自检未通过\n')
  process.exitCode = 1
} else {
  console.log('✅ 自检全部通过\n')
}
