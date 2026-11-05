// 第二阶段验证：闭环回灌 + S1/S2 阈值解锁
import { applyReaction, growthOf, s1s2Unlocked, s1s2Pass } from './index.js';
import fs from 'node:fs';

const persona = JSON.parse(fs.readFileSync('./persona.json', 'utf8'));
const base = () => ({ serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.50, melatonin: 0.40 });

let ok = 0, fail = 0;
const check = (name, got, want) => {
  const pass = got === want;
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + name + '  → ' + JSON.stringify(got) + (pass ? '' : '（期望 ' + JSON.stringify(want) + '）'));
  pass ? ok++ : fail++;
};

console.log('=== 闭环回灌 ===');
// 用中性名字「小墨」验证 selfName 会从 persona.names 拼接，不带真实人名。
const TEST_NAME = '小墨';
// 夸夸（self praise，需带 selfName）
let m = { hormones: base() };
let kind = applyReaction(m, '小墨最棒！', TEST_NAME);
check('self praise 识别', kind, 'self');
check('self praise serotonin↑', m.hormones.serotonin > 0.55, true);

// 夸奖（task）
m = { hormones: base() };
kind = applyReaction(m, '做得好，辛苦了', TEST_NAME);
check('task praise 识别', kind, 'task');

// 责备
m = { hormones: base() };
kind = applyReaction(m, '你搞错了，不是这样', TEST_NAME);
check('blame 识别', kind, 'bad');
check('bad serotonin↓', m.hormones.serotonin < 0.55, true);

// 投入落差
m = { hormones: base(), pendingJudge: { at: Date.now(), len: 200 } };
kind = applyReaction(m, '嗯', TEST_NAME);
check('gap 识别', kind, 'gap');
check('gap 只动 dopamine、不碰 oxytocin', m.hormones.oxytocin === 0.50, true);
check('gap 不碰 cortisol', m.hormones.cortisol === 0.35, true);

console.log('\n=== S1/S2 阈值解锁 ===');
const g = growthOf(persona);
console.log('  阈值 = ' + g.s1s2UnlockMessages);
check('阈值从 persona.growth 读到', g.s1s2UnlockMessages, 200);
check('99 条未解锁', s1s2Unlocked({ messageCount: 99 }, persona), false);
check('200 条已解锁', s1s2Unlocked({ messageCount: 200 }, persona), true);
check('未解锁时 s1s2Pass inactive', s1s2Pass({ messageCount: 10 }, 'hi', persona).active, false);
check('解锁后 s1s2Pass active', s1s2Pass({ messageCount: 300 }, 'hi', persona).active, true);

console.log('\n=== 零泄露 ===');
// 哨兵值从环境变量读，本仓库不落任何真实人名/QQ号。
const sentinels = [process.env.LEAK_SENTINEL_NAME, process.env.LEAK_SENTINEL_QQ].filter(Boolean);
for (const p of sentinels) {
  const leaked = JSON.stringify(persona).includes(p);
  check('persona 不含哨兵 ' + p, leaked, false);
}

console.log('\n' + ok + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);