// 第五阶段验证：原始会话导入（实时回补 + 启动吸附 + 外部脚本入口）
import {
  lineToTurn, ingestEvent, textOfEvent, whoOfEvent, shouldIngestEvent,
  importEvents, importConfigOf,
} from './index.js';
import fs from 'node:fs';

const persona = JSON.parse(fs.readFileSync('./persona.json', 'utf8'));
const TEST_NAME = '小墨';
const base = () => ({ serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.50, melatonin: 0.40 });
const freshMind = () => ({ hormones: { ...base(), at: Date.now() }, messageCount: 0 });

let ok = 0, fail = 0;
const check = (name, got, want) => {
  const pass = got === want;
  console.log('  ' + (pass ? '✓' : '✗') + ' ' + name + '  → ' + JSON.stringify(got) + (pass ? '' : '（期望 ' + JSON.stringify(want) + '）'));
  pass ? ok++ : fail++;
};

console.log('=== 行文本抽取（任意形状的 jsonl 行）===');
check('harness 形状 user/message', lineToTurn({ type: 'user/message', data: { content: [{ type: 'text', text: '你好' }] } }).who, 'user');
check('harness 形状 assistant/message', lineToTurn({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好呀' }] } } }).who, 'me');
check('role 形状', lineToTurn({ role: 'assistant', content: '在呢' }).who, 'me');
check('kind 形状', lineToTurn({ kind: 'user', message: '早安' }).who, 'user');
check('top 文本', lineToTurn({ type: 'bot', text: '晚安' }).who, 'me');
check('只骨架行跳过', lineToTurn({ type: 'turn/start', data: { turn: 3 } }), null);
check('空对象跳过', lineToTurn({}), null);

console.log('\n=== 事件级工具（与实时管线同源）===');
check('user 事件取文本', textOfEvent({ type: 'user/message', data: { content: [{ type: 'text', text: '今天天气不错' }] } }), '今天天气不错');
check('assistant 事件取文本', textOfEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '是呀' }] } } }), '是呀');
check('user 事件说话人', whoOfEvent({ type: 'user/message' }), 'user');
check('assistant 事件说话人', whoOfEvent({ type: 'assistant/message' }), 'me');
check('user/message 可导入', shouldIngestEvent({ type: 'user/message', data: { content: [{ type: 'text', text: '你好' }] } }), true);
check('assistant/message 可导入', shouldIngestEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好呀' }] } } }), true);
check('空文本不可导入', shouldIngestEvent({ type: 'user/message', data: { content: [{ type: 'text', text: '  ' }] } }), false);
check('骨架事件不可导入', shouldIngestEvent({ type: 'turn/start', data: { turn: 1 } }), false);

console.log('\n=== 导入回放（同一套激素/回灌/折叠管线）===');
// 12 条 情绪词消息 → appraise 命中 → serotonin 显著高于基线 0.55
let mind = freshMind();
const events = [];
for (let i = 0; i < 12; i++) {
  events.push({ type: 'user/message', time: Date.now() + i * 1000, data: { content: [{ type: 'text', text: '太棒了，真的好开心' }] } });
}
importEvents(mind, events, persona, TEST_NAME, 0, 200);
check('全部 12 条都导了', mind.messageCount, 12);
check('情绪词真的进了激素（serotonin>基线）', mind.hormones.serotonin > 0.55, true);
check('记忆珠子也折了', Array.isArray(mind.memories) && mind.memories.length === 12, true);
check('用户消息会走闭环回灌（pendingJudge 被清）', mind.pendingJudge, undefined);

console.log('\n=== 回灌：夸夸 + 责备 + 投入落差 ===');
mind = freshMind();
importEvents(mind, [{ type: 'assistant/message', time: Date.now(), data: { message: { content: [{ type: 'text', text: 'A'.repeat(200) }] } } }], persona, TEST_NAME, 0, 200);
importEvents(mind, [{ type: 'user/message', time: Date.now() + 60000, data: { content: [{ type: 'text', text: '小墨最棒！' }] } }], persona, TEST_NAME, 0, 200);
check('夸夸回灌（serotonin↑）', mind.hormones.serotonin > 0.55, true);
check('夸夸落 judged 记录', mind.judged[mind.judged.length - 1].kind, 'self');
importEvents(mind, [{ type: 'user/message', time: Date.now() + 120000, data: { content: [{ type: 'text', text: '你搞错了，不是这样' }] } }], persona, TEST_NAME, 0, 200);
check('责备落 judged 记录', mind.judged[mind.judged.length - 1].kind, 'bad');
mind = freshMind();
importEvents(mind, [{ type: 'assistant/message', time: Date.now(), data: { message: { content: [{ type: 'text', text: 'A'.repeat(200) }] } } }], persona, TEST_NAME, 0, 200);
importEvents(mind, [{ type: 'user/message', time: Date.now() + 1000, data: { content: [{ type: 'text', text: '嗯' }] } }], persona, TEST_NAME, 0, 200);
check('投入落差落 judged 记录', mind.judged[mind.judged.length - 1].kind, 'gap');

console.log('\n=== 上限与截断 ===');
mind = freshMind();
const many = [];
for (let i = 0; i < 50; i++) many.push({ type: 'user/message', time: Date.now() + i, data: { content: [{ type: 'text', text: '哈' }] } });
const took = importEvents(mind, many, persona, TEST_NAME, 10, 200);
check('maxEvents=10 只取 10 条', mind.messageCount, 10);
check('回报条数与导入一致', took.length, 10);
mind = freshMind();
importEvents(mind, [{ type: 'user/message', time: Date.now(), data: { content: [{ type: 'text', text: 'A'.repeat(500) }] } }], persona, TEST_NAME, 0, 200);
check('导入截断 200、珠子落盘再截到 140', mind.memories[0].text.length, 140);

console.log('\n=== 导入配置 ===');
check('缺省 backfill 开', importConfigOf({}).backfill, true);
check('缺省上限 500 事件', importConfigOf({}).backfillMaxEvents, 500);
check('缺省单条 200 字', importConfigOf({}).backfillMaxText, 200);
check('persona.import 覆盖生效', importConfigOf({ import: { backfillMaxEvents: 100 } }).backfillMaxEvents, 100);

console.log('\n' + ok + ' 通过 / ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
