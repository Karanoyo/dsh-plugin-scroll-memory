// dsh-plugin-scroll-memory —— Node half.
//
// 这个插件是纯浏览器半侧的：所有逻辑都在设置面板的 DOM 上跑，主机进程里
// 没有任何事可做。这里是合法的最小 profile 层，只声明插件身份。
//
// 形状依据（本机正在运行的真实产物）：
//   @linxin666/dsh-client-ui-plugin-manager/lib/index.js 末行是
//   `export { apply, inject, name };` —— 即 Node 半与浏览器半各自导出一组
//   apply/inject/name，两侧在不同运行时由不同入口加载，同名导出是正常形态。
//   dsh-jump-to-top 的先例同样是「主机端只保证 bundle 是合法的 profile 层」。
//
// 刻意为之的空：不开路由、不起服务、不写文件、不注册工具、不碰 network。
export const name = 'dsh-plugin-scroll-memory'
export const inject = []
export function apply () {}
