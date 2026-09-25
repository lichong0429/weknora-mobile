// 版本号的单一来源。
// 之前 Diagnostics.jsx 里硬编码 `APP_VERSION = 'v1.5.4'`，发到 1.7.0 后仍显示旧版本 ——
// 这类"到处硬编码"的常量必然漂移，所以直接读 package.json，不再手工同步。
import pkg from '../../package.json';

export const APP_VERSION = `v${pkg.version}`;
export default APP_VERSION;
