// 第九阶段验证（0.2.2）：安装器 + BOM 容错
// 验证点：
//   ① BOM 的 persona.json 能读（Windows 记事本/PowerShell 常见）
//   ② BOM 的 mind.json 能读（不静默返回空记忆）
//   ③ 安装器：装到假 profile、幂等重跑、不覆盖已填的人格、不搬 mind.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  → ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const BOM = '\uFEFF';

console.log('=== 一、BOM 容错（引擎侧） ===');
// 造一个临时 persona：把 engine 所在目录复制成沙盒，避免动真文件
const sandbox = fs.mkdtempSync(join(tmpdir(), 'ci9-'));
for (const f of ['engine.mjs', 'host-dsh.mjs', 'index.js', 'package.json', 'cordis.patch.yml']) {
  fs.copyFileSync(join(HERE, f), join(sandbox, f));
}
// persona 带 BOM
fs.writeFileSync(join(sandbox, 'persona.json'),
  BOM + JSON.stringify({ names: { self: '阿岚', owner: '小舟' }, persona: { identity: '安静的人', rules: [], about: '' } }),
  'utf8');
process.env.COMPANION_DATA_DIR = fs.mkdtempSync(join(tmpdir(), 'ci9-data-'));

const eng = await import('file:///' + join(sandbox, 'engine.mjs').replace(/\\/g, '/'));
const persona = eng.loadPersona();
check('带 BOM 的 persona.json 读得出名字', persona.names.self === '阿岚', persona.names.self);
check('带 BOM 的 persona.json 读得出身份', String(persona.persona.identity).length > 0);

// mind 带 BOM
eng.writeMind({ hormones: {}, messageCount: 99, memories: [], digest: [] });
const mindPath = join(process.env.COMPANION_DATA_DIR, 'mind.json');
const rawMind = fs.readFileSync(mindPath, 'utf8');
fs.writeFileSync(mindPath, BOM + rawMind, 'utf8');
const back = eng.readMind();
check('带 BOM 的 mind.json 读得出计数', back.messageCount === 99, 'messageCount=' + back.messageCount);

console.log('');
console.log('=== 二、安装器 ===');
const fakeProfile = fs.mkdtempSync(join(tmpdir(), 'ci9-prof-'));
fs.writeFileSync(join(fakeProfile, 'package.json'), '{"name":"fake"}', 'utf8');
const target = join(fakeProfile, 'node_modules', '@local', 'companion-incubator');

const runInstall = (extra = []) => execFileSync(process.execPath, [join(HERE, 'install.mjs'), '--profile', fakeProfile, ...extra], { encoding: 'utf8' });

let out = runInstall();
check('第一次安装成功', fs.existsSync(join(target, 'engine.mjs')));
check('装了引擎和皮', fs.existsSync(join(target, 'engine.mjs')) && fs.existsSync(join(target, 'host-dsh.mjs')));
check('生成了 persona.json', fs.existsSync(join(target, 'persona.json')));
check('没搬 mind.json（运行时数据不跟着走）', !fs.existsSync(join(target, 'mind.json')));

// 用户填人格
fs.writeFileSync(join(target, 'persona.json'),
  JSON.stringify({ names: { self: '阿岚', owner: '小舟' }, persona: { identity: '安静的人', rules: [], about: '' } }),
  'utf8');

out = runInstall();
const after = JSON.parse(fs.readFileSync(join(target, 'persona.json'), 'utf8'));
check('重装不覆盖已填的人格', after.names.self === '阿岚', after.names.self);
check('重装幂等（提示保住了人格）', /保住原来的人格文件/.test(out));
check('重装后引擎还在', fs.existsSync(join(target, 'engine.mjs')));

// --dry 不落盘
const fake2 = fs.mkdtempSync(join(tmpdir(), 'ci9-prof2-'));
fs.writeFileSync(join(fake2, 'package.json'), '{"name":"fake2"}', 'utf8');
execFileSync(process.execPath, [join(HERE, 'install.mjs'), '--profile', fake2, '--dry'], { encoding: 'utf8' });
check('--dry 真的不落盘', !fs.existsSync(join(fake2, 'node_modules')));

// 装好的包能独立加载
const installed = await import('file:///' + join(target, 'index.js').replace(/\\/g, '/'));
check('装好的包能 import', typeof installed.apply === 'function' && Array.isArray(installed.inject));

console.log('');
console.log('=== 三、清理 ===');
let cleaned = true;
for (const d of [sandbox, fakeProfile, fake2, process.env.COMPANION_DATA_DIR]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { cleaned = false; }
}
check('临时目录已清理', cleaned);

console.log('');
console.log(pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
