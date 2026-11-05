// 原始会话导入 CLI：把任意 jsonl 文件或目录导进 mind.json。
//
// 用法（在 incubator 目录里跑）：
//   node import-session.mjs path/to/file.jsonl
//   node import-session.mjs path/to/logs            （目录，*.jsonl / *.json）
//   node import-session.mjs --wipe path/to/file.jsonl （先清空 mind.json 再导入）
//   node import-session.mjs --max-events 100 path/to/file.jsonl
//   node import-session.mjs --max-text 200 path/to/file.jsonl
//
// 导出：带计数与来源的导入报告（不打印任何行内容）。
import { importEvents, lineToTurn } from './index.js';
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIND_FILE = join(HERE, 'mind.json');
const PERSONA_FILE = join(HERE, 'persona.json');

const args = process.argv.slice(2);
let wipe = false;
let maxEvents = 0;
let maxText = 200;
const paths = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--wipe') wipe = true;
  else if (a === '--max-events') { maxEvents = Number(args[++i]); if (!Number.isFinite(maxEvents)) maxEvents = 0; }
  else if (a === '--max-text') { maxText = Number(args[++i]); if (!Number.isFinite(maxText)) maxText = 200; }
  else if (!a.startsWith('--')) paths.push(a);
  else { console.error('未知参数: ' + a); process.exit(1); }
}
if (!paths.length) {
  console.error('用法: node import-session.mjs [--wipe] [--max-events N] [--max-text N] <文件或目录> [...]');
  process.exit(1);
}

const persona = existsSync(PERSONA_FILE) ? JSON.parse(readFileSync(PERSONA_FILE, 'utf8')) : { names: {} };
const selfName = (persona.names && persona.names.self) || 'companion';

const mind = (wipe || !existsSync(MIND_FILE))
  ? { hormones: {}, messageCount: 0 }
  : JSON.parse(readFileSync(MIND_FILE, 'utf8'));
if (!mind.hormones || typeof mind.hormones !== 'object') mind.hormones = {};
if (!Number.isFinite(mind.messageCount)) mind.messageCount = 0;
// 激素字段缺失时用默认基线补齐，避免旧 mind.json 缺键
const DEF = { serotonin: 0.55, dopamine: 0.45, cortisol: 0.35, oxytocin: 0.50, melatonin: 0.40 };
for (const k of Object.keys(DEF)) if (typeof mind.hormones[k] !== 'number') mind.hormones[k] = DEF[k];
if (!mind.hormones.at) mind.hormones.at = Date.now();

let files = [];
for (const p of paths) {
  const abs = resolve(p);
  try {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      const names = readdirSync(abs).filter((n) => n.endsWith('.jsonl') || n.endsWith('.json')).sort();
      for (const n of names) files.push(join(abs, n));
    } else files.push(abs);
  } catch { console.error('读不到路径: ' + p); process.exit(1); }
}
if (!files.length) {
  console.error('没有找到可导入的文件');
  process.exit(1);
}

// 按文件名排序、按行解析成 { time, text, who } 事件序列（time 缺省按文件内顺序递增）
const events = [];
for (const file of files) {
  let bad = 0, lines = 0;
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines++;
      let obj;
      try { obj = JSON.parse(line); } catch { bad++; continue; }
      const turn = lineToTurn(obj);
      if (!turn) continue;
      events.push({
        time: (obj && typeof obj.time === 'number') ? obj.time : undefined,
        text: turn.text,
        who: turn.who,
      });
    }
  } catch (e) { console.error('读文件失败: ' + file + ' (' + e.message + ')'); process.exit(1); }
  if (bad) console.log('[跳过] ' + file + '：' + bad + ' 行非 JSON（共 ' + lines + ' 行）');
}

// 按时间排序（无 time 的排最后，保持文件内相对顺序）
const baseTime = Date.now() - events.length * 60000;
events.forEach((e, i) => { if (!Number.isFinite(e.time)) e.time = baseTime + i * 60000; });
events.sort((a, b) => a.time - b.time);

const before = mind.messageCount;
const report = importEvents(mind, events, persona, selfName, maxEvents, maxText);
const after = mind.messageCount;
mind.imports = mind.imports || [];
mind.imports.push({ at: Date.now(), files, events: report.length });
writeFileSync(MIND_FILE, JSON.stringify(mind), 'utf8');

console.log('导入完成');
console.log('  文件: ' + files.map((f) => f.replace(/\\/g, '/').split('/').pop()).join(', '));
console.log('  有效事件: ' + report.length + ' 条（' + events.length + ' 条候选）');
console.log('  消息计数: ' + before + ' → ' + after);
console.log('  mind.json 已写回');
