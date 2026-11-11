// 第四阶段验证：S1/S2 内核
import { s1Predict, s2Check, updateSkill, s1s2Round, s1s2Unlocked } from './index.js';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

const persona = JSON.parse(fs.readFileSync(join(HERE, 'persona.json'), 'utf8'));
const TEST_NAME = '小墨';

let ok = 0, fail = 0;
const check = (name, got, want) => {
  const pass = got === want;
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + name + '  → ' + JSON.stringify(got) + (pass ? '' : '（期望 ' + JSON.stringify(want) + '）'));
  pass ? ok++ : fail++;
};

console.log('=== S1 直觉预测（只看长度/标点，不读内容）===');
check('短句→短回应', s1Predict('嗯', 'user').bucket, '短回应');
check('问号→问句', s1Predict('你今天怎么样？', 'user').bucket, '问句');
check('长句→长叙述', s1Predict('我们今天一起做了很多很多的事情，从早忙到晚，感觉还挺充实的呢。', 'user').bucket, '长叙述');

console.log('\n=== S2 意识细判（读原文）===');
check('夸夸→夸赞', s2Check('小墨最棒！', TEST_NAME).kind, '夸赞');
check('责备→责备', s2Check('你搞错了', TEST_NAME).kind, '责备');
check('夸奖→夸赞', s2Check('做得好，辛苦了', TEST_NAME).kind, '夸赞');
check('问号→问句', s2Check('你今天怎么样？', TEST_NAME).kind, '问句');
check('短句→短回应', s2Check('嗯', TEST_NAME).kind, '短回应');

console.log('\n=== 错题权重公式 1.0+2*(1-err)^2 ===');
const skill = {};
// 第一次对 → err=0 → weight 3.0
updateSkill(skill, '问句', 1);
check('全对时权重 3.0', Math.round(skill['问句'].weight * 100) / 100, 3);
// 再错一次 → err=0.5 → weight 1.5
updateSkill(skill, '问句', 0);
check('错一半权重 1.5', Math.round(skill['问句'].weight * 100) / 100, 1.5);
// 再错 → err=2/3 → weight 1.0+2*(1/9)=1.222
updateSkill(skill, '问句', 0);
check('错2/3权重约1.22', Math.round(skill['问句'].weight * 100) / 100, 1.22);

console.log('\n=== 完整一轮 + 解锁 ===');
const mind = { messageCount: 250, hormones: { serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.5, melatonin: 0.4 } };
check('250 条已解锁', s1s2Unlocked(mind, persona), true);
const round = s1s2Round(mind, '小墨真棒！', 'user', TEST_NAME);
check('round active', round.active, true);
check('pred=夸赞', round.pred, '夸赞');
check('real=夸赞', round.real, '夸赞');
check('delta=1（对）', round.delta, 1);
check('skill 记了夸赞桶', mind.s1Skill['夸赞'] !== undefined, true);

console.log('\n' + ok + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);