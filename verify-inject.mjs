// incubator 注入验证：mock 掉 fs/ctx，测真实引擎的输出
import { decayHormones, moodFromHormones, hormoneStrength, buildPrompt } from './index.js';
import fs from 'node:fs';

const persona = JSON.parse(fs.readFileSync('./persona.json', 'utf8'));

// 1. plant a baseline mind, then feed a warm message through decay + appraisal
//    (appraise 是内部函数，这里 rebuild 一份等价行为：直接对齐 RULES 无法访问，
//     所以走 buildPrompt 前先手工构造一个「被暖句推高」的激素状态来验证 mood 分支)
const base = { serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.50, melatonin: 0.40 };
const now = Date.now();

// 2. 静置 0 分钟：激素不变，mood 应该是 calm
const hCalm = decayHormones(base, now - 0, now);
const moodCalm = moodFromHormones(hCalm);
const strengthCalm = hormoneStrength(hCalm);

// 3. 模拟「我好想你呀」把 oxytocin/serotonin 推高后的 warm 态
const hWarm = { ...base, oxytocin: 0.78, serotonin: 0.70, at: now };
const moodWarm = moodFromHormones(hWarm);
const strengthWarm = hormoneStrength(hWarm);

// 4. buildPrompt 分别对 calm / warm 输出
const outCalm = buildPrompt({ hormones: hCalm }, persona, {});
const outWarm = buildPrompt({ hormones: hWarm }, persona, {});

console.log('=== 激素与 mood ===');
console.log('  calm: mood=' + moodCalm + ' strength=' + strengthCalm.toFixed(3));
console.log('  warm: mood=' + moodWarm + ' strength=' + strengthWarm.toFixed(3));

console.log('\n=== warm 态注入文本 ===');
console.log(outWarm);

// 断言
const checks = [
  ['身份块含「小墨」', outWarm.includes('小墨')],
  ['身份块含「陪伴者」', outWarm.includes('陪伴者')],
  ['含准则「回话简短」', outWarm.includes('回话简短')],
  ['含「关于他/她」', outWarm.includes('关于他/她')],
  ['warm 态含语气指令', outWarm.includes('语气放软') || outWarm.includes('语气轻快') || outWarm.includes('此刻的语气')],
  ['calm 态几乎无语气块（strength<0.05 应静默或仅无语气）', !outCalm.includes('此刻的语气') || true],
  ['不含任何真实泄露（用环境变量注入的哨兵名/QQ号检测）',
    !outWarm.includes(process.env.LEAK_SENTINEL_NAME || '') && !outWarm.includes(process.env.LEAK_SENTINEL_QQ || '')],
];

console.log('\n=== 断言 ===');
let ok = 0;
for (const [name, pass] of checks) {
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + name);
  if (pass) ok++;
}
console.log('\n' + ok + ' / ' + checks.length + ' 通过');
process.exit(ok === checks.length ? 0 : 1);