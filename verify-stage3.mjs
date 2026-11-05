// 第三阶段验证：通用记忆折叠骨架
import { foldMemory, memoryOf, scoreBead, keywordsRanked, recallContext, buildPrompt } from './index.js';
import fs from 'node:fs';

const persona = JSON.parse(fs.readFileSync('./persona.json', 'utf8'));

let ok = 0, fail = 0;
const check = (name, got, want) => {
  const pass = got === want;
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + name + '  → ' + JSON.stringify(got) + (pass ? '' : '（期望 ' + JSON.stringify(want) + '）'));
  pass ? ok++ : fail++;
};

console.log('=== memory 配置 ===');
const cfg = memoryOf(persona);
check('keepDetail 从 persona.memory 读到', cfg.keepDetail, 80);
check('digestBatch 读到', cfg.digestBatch, 20);
check('digestCap 读到', cfg.digestCap, 60);

console.log('\n=== 珠子评分（通用启发式）===');
const hCalm = { serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.50, melatonin: 0.40 };
const hWarm = { serotonin: 0.70, dopamine: 0.60, cortisol: 0.30, oxytocin: 0.80, melatonin: 0.40 };
const sShort = scoreBead('嗯', hCalm);
const sLong = scoreBead('今天我们一起把这个项目从零做到了能跑起来，还挺开心的。', hWarm);
check('长句+高情绪 > 短句+平静', sLong > sShort, true);

console.log('\n=== 折叠：攒够 keepDetail+digestBatch 才触发 ===');
let mind = { hormones: hCalm, memories: [], digest: [] };
for (let i = 0; i < 99; i++) {
  foldMemory(mind, '第' + i + '条消息，我们在聊一些事情。', (i % 2 === 0) ? 'user' : 'me', persona, hCalm);
}
// 99 条 < keepDetail(80)+digestBatch(20)=100，不该折叠
check('99 条不折叠', mind.memories.length === 99 && mind.digest.length === 0, true);
// 再折一条，正好 100，该折叠了
foldMemory(mind, '第 100 条，这一条触发折叠。', 'user', persona, hCalm);
check('100 条触发折叠：珠子回到 keepDetail', mind.memories.length === 80, true);
check('digest 生成 1 条', mind.digest.length === 1, true);
check('digest 里 count 正确', mind.digest[0].count === 20, true);
check('digest 有 keywords', Array.isArray(mind.digest[0].keywords) && mind.digest[0].keywords.length > 0, true);

console.log('\n=== 检索注入 ===');
const recall = recallContext(mind);
check('recall 含最近珠子块', recall.includes('我手上的记忆'), true);
check('recall 含 digest 块', recall.includes('更早的印象'), true);

// buildPrompt 里也带记忆
const prompt = buildPrompt(mind, persona, {});
check('buildPrompt 含记忆块', prompt.includes('我手上的记忆'), true);

console.log('\n=== 零泄露 ===');
// 哨兵值从环境变量读，本仓库不落任何真实人名/QQ号。
const sentinels = [process.env.LEAK_SENTINEL_NAME, process.env.LEAK_SENTINEL_QQ].filter(Boolean);
check('persona 无泄露', sentinels.every((p) => !JSON.stringify(persona).includes(p)), true);

console.log('\n' + ok + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);