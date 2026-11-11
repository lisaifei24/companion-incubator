// 第八阶段验证（0.2.2）：芯皮分离——引擎不认宿主
// 验证点：
//   ① engine.mjs 只 import node 内置，不碰 dsh/cordis/ctx
//   ② 只 import engine.mjs（不加载 host-dsh）就能跑完整一轮：折话→情绪→记忆→提示词
//   ③ host-dsh.mjs 里没有机制（不出现激素常量、折叠阈值、词表）
//   ④ index.js 门面把两边的导出都接上，老的 import './index.js' 一行不用改
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  → ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

console.log('=== 一、引擎零宿主依赖 ===');
const engineSrc = fs.readFileSync(join(HERE, 'engine.mjs'), 'utf8');
const engineImports = [...engineSrc.matchAll(/^\s*import[\s\S]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const uniq = [...new Set(engineImports)];
check('engine 只 import node 内置', uniq.every((s) => s.startsWith('node:')), uniq.join(', '));
// 只查代码，不查注释——注释里写「这一层没有 dsh」本来就该出现这个词
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:'"])\/\/.*$/gm, '$1');
const engineCode = stripComments(engineSrc);
check('engine 代码里不出现 dsh/cordis', !/\bdsh\b|cordis/i.test(engineCode));
check('engine 不出现 ctx. 调用', !/\bctx\.(on|inject|effect|emit)\b/.test(engineCode));

console.log('');
console.log('=== 二、只加载引擎也能跑完整一轮 ===');
const eng = await import('./engine.mjs');
check('engine 独立可 import', typeof eng.foldMemory === 'function');
const persona = { names: { self: '测试体', other: '对方' }, memory: { keepDetail: 5, digestBatch: 3, digestCap: 3 } };
const mind = {
  hormones: Object.fromEntries(['serotonin', 'dopamine', 'cortisol', 'oxytocin', 'melatonin'].map((k) => [k, 0.5])),
  messageCount: 0, memories: [], digest: [], skill: {},
};
const h = mind.hormones;
eng.foldMemory(mind, '我今天有点累，但见到你挺好的', 'user', persona, h);
eng.foldMemory(mind, '那就先歇着，我在', 'me', persona, h);
check('折话后有珠子', mind.memories.length > 0, mind.memories.length + ' 颗');
const mood = eng.moodFromHormones(h);
check('能从激素判出情绪', typeof mood === 'string' && mood.length > 0, mood);
const prompt = eng.buildPrompt(mind, persona, {});
check('能组装提示词', typeof prompt === 'string' && prompt.length > 20, prompt.length + ' 字');
const recalled = eng.recallContext(mind);
check('能检索记忆', typeof recalled === 'string', recalled.length + ' 字');

console.log('');
console.log('=== 三、皮里没有机制 ===');
const hostSrc = fs.readFileSync(join(HERE, 'host-dsh.mjs'), 'utf8');
check('皮不定义激素基线', !/HORMONE_DEF|HORMONE_KEYS/.test(hostSrc));
check('皮不定义折叠阈值', !/keepDetail\s*[:=]\s*\d|digestBatch\s*[:=]\s*\d/.test(hostSrc));
check('皮不定义词表', !/TASK_PRAISE_RE|BLAME_RE|RULES\s*=/.test(hostSrc));
check('皮只做接线（apply + inject）', /export function apply\(ctx\)/.test(hostSrc) && /export const inject/.test(hostSrc));
const hostLines = hostSrc.split('\n').length;
check('皮够薄（< 120 行）', hostLines < 120, hostLines + ' 行');

console.log('');
console.log('=== 四、门面兼容老用法 ===');
const facade = await import('./index.js');
check('门面导出 apply', typeof facade.apply === 'function');
check('门面导出 inject', Array.isArray(facade.inject) && facade.inject.length === 2);
check('门面转发引擎函数', typeof facade.foldMemory === 'function' && typeof facade.readMind === 'function');
check('门面导出数量 >= 30', Object.keys(facade).length >= 30, Object.keys(facade).length + ' 个');

console.log('');
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
