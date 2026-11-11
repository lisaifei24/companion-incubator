/**
 * Companion Incubator — 入口门面
 *
 * 0.2.2 起内部分成两层：
 *   engine.mjs    芯：零宿主依赖，任何宿主都能直接用
 *   host-dsh.mjs  皮：只负责接 dsh 的三个钩子
 *
 * 这个文件保留为再导出，所以老的安装方式（bundle 指向 ./index.js）
 * 一行都不用改。想接别的宿主，import './engine.mjs' 即可，别碰这个门面。
 */
export * from './engine.mjs';
export { apply, inject } from './host-dsh.mjs';
