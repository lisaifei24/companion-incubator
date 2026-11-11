#!/usr/bin/env node
/**
 * companion-incubator 安装器
 *
 * 为什么需要它：README 里那句「plugin_manager install_bundle <绝对路径>」
 * 对拿到这个仓库的人是断的——他得先知道代码在哪、profile 在哪、装到哪个
 * node_modules、要不要改 cordis.patch.yml。这四件事任何一件错，装完就是
 * 「插件列表里没有它」，而错误信息不会告诉他为什么。
 *
 * 这个脚本只做三件确定的事，每一件都可以重复跑（幂等）：
 *   ① 找到 dsh profile（默认 ~/.dsh/profiles/web，可用 --profile 指定）
 *   ② 把本包放到 <profile>/node_modules/@local/companion-incubator
 *      （默认复制；--link 建软链，改代码立即生效，适合开发）
 *   ③ 检查人格文件；缺了就从 example 生成一份空白模板，绝不覆盖已有的
 *
 * 它**不改** cordis.patch.yml —— 包里的 cordis.patch.yml 会作为 bundle
 * 自己声明挂载点，让 dsh 去处理比脚本盲改 YAML 安全。
 *
 * 用法：
 *   node install.mjs                 装到默认 profile
 *   node install.mjs --link          软链方式（开发用，改代码立即生效）
 *   node install.mjs --profile <dir> 指定 profile
 *   node install.mjs --dry           只看会做什么，不落盘
 */
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync,
  statSync, symlinkSync, lstatSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const DRY = flag('--dry');
const LINK = flag('--link');
const PROFILE = resolve(opt('--profile', join(homedir(), '.dsh', 'profiles', 'web')));
const TARGET = join(PROFILE, 'node_modules', '@local', 'companion-incubator');

const log = (m) => console.log(m);
const ok = (m) => console.log('  ✓ ' + m);
const warn = (m) => console.log('  ! ' + m);
const bad = (m) => console.log('  ✗ ' + m);

log('companion-incubator ' + PKG.version + ' 安装器');
log('');
log('源目录: ' + HERE);
log('目标  : ' + TARGET);
log('方式  : ' + (LINK ? '软链（开发）' : '复制') + (DRY ? '  [试运行，不落盘]' : ''));
log('');

// ── ① profile 存在吗 ─────────────────────────────────────────
log('一、检查 dsh profile');
if (!existsSync(PROFILE)) {
  bad('找不到 profile: ' + PROFILE);
  log('');
  log('   dsh 的 profile 一般在 ~/.dsh/profiles/<名字>。');
  log('   用 --profile 指定实际路径，例如：');
  log('     node install.mjs --profile "C:\\Users\\你\\.dsh\\profiles\\web"');
  process.exit(1);
}
ok('profile 存在');
const pkgFile = join(PROFILE, 'package.json');
if (existsSync(pkgFile)) {
  ok('profile 里有 package.json（是 dsh profile 没错）');
} else {
  warn('profile 里没有 package.json —— 可能指错了目录，继续但请自己确认');
}

// ── ② 放包 ───────────────────────────────────────────────────
log('');
log('二、安装到 profile');
if (!DRY) {
  mkdirSync(dirname(TARGET), { recursive: true });

  // ⚠️ 重装前先把用户的人格文件读进内存。
  // 下面会整目录删掉再放新的——如果不先抢救，用户填好的 persona.json
  // 会跟着旧目录一起没。人格文件是这个包里唯一「属于用户」的东西，
  // 其它（引擎/皮/文档）都可以被新版本覆盖，它不行。
  let savedPersona = null;
  const existingPersona = join(TARGET, 'persona.json');
  try {
    if (existsSync(existingPersona) && !lstatSync(existingPersona).isSymbolicLink()) {
      savedPersona = readFileSync(existingPersona, 'utf8');
    }
  } catch { /* 读不到就按没有处理 */ }

  // 清掉旧的（软链/目录都清），保证幂等
  try {
    if (existsSync(TARGET)) {
      const st = lstatSync(TARGET);
      if (st.isSymbolicLink()) unlinkSync(TARGET);
      else if (st.isDirectory()) {
        const { rmSync } = await import('node:fs');
        rmSync(TARGET, { recursive: true, force: true });
      } else unlinkSync(TARGET);
    }
  } catch { /* 清不掉就让下面的写入报错 */ }

  if (LINK) {
    try {
      symlinkSync(HERE, TARGET, platform() === 'win32' ? 'junction' : 'dir');
      ok('已建立软链 → ' + HERE);
    } catch (e) {
      bad('软链失败（' + e.message + '），退回复制');
      cpSync(HERE, TARGET, { recursive: true, filter: keepFile });
      ok('已复制');
    }
  } else {
    cpSync(HERE, TARGET, { recursive: true, filter: keepFile });
    ok('已复制');
  }

  // 把抢救出来的人格文件放回去（覆盖一切可能被新版本带来的空白模板）
  if (savedPersona !== null) {
    try {
      mkdirSync(TARGET, { recursive: true });
      writeFileSync(existingPersona, savedPersona, 'utf8');
      ok('已保住原来的人格文件（persona.json 没被覆盖）');
    } catch { warn('人格文件回写失败，请检查 ' + existingPersona); }
  }
} else {
  ok('（试运行）将把包放到上面那个路径');
}

// 复制时跳过的东西：版本库、依赖、运行时数据、用户日志、**用户的人格文件**
//
// ⚠️ persona.json 必须排除。仓库里那份是空白模板，如果跟着复制过去，
// 用户填好的身份就被空白覆盖了——重装一次，人就「失忆」一次。
// 人格文件的生成/保留由下面第 ③ 步单独负责。
function keepFile(src) {
  const name = basename(src);
  if (name === '.git' || name === 'node_modules') return false;
  if (name === 'mind.json' || name.startsWith('mind.json.')) return false;
  if (name === 'persona.json') return false;
  if (name === 'logs') return false;
  if (name.endsWith('.bak-before-split')) return false;
  return true;
}

// ── ③ 人格文件 ───────────────────────────────────────────────
log('');
log('三、人格文件');
const personaPath = join(TARGET, 'persona.json');
const examplePath = join(HERE, 'example.persona.json');

/** persona 填过没有：names.self 或 identity 有一个非空就算填过 */
function personaFilled(p) {
  try {
    const raw = readFileSync(p, 'utf8');
    // 去 BOM：Windows 记事本 / PowerShell Set-Content -Encoding UTF8 都会写 BOM，
    // 而 JSON.parse 见到 BOM 直接抛——这里不去掉就会把「填过」误判成「空白」
    const j = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    const self = String((j.names && j.names.self) || '').trim();
    const ident = String((j.persona && j.persona.identity) || '').trim();
    return self.length > 0 || ident.length > 0;
  } catch { return false; }
}

if (!DRY) {
  if (!existsSync(personaPath)) {
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, personaPath);
      ok('已生成 persona.json（照 example 的格式，请填上你是谁）');
    } else {
      warn('没有 persona.json，也没有 example 模板');
    }
  } else if (personaFilled(personaPath)) {
    ok('persona.json 已经有内容，保留不动');
  } else {
    ok('persona.json 是空白模板 —— 装好了，但还没写下「你是谁」');
    warn('下一步必须做的那件事就是填它，否则它不知道自己是谁');
  }
} else {
  ok('（试运行）会检查/生成 persona.json');
}

// ── 下一步 ───────────────────────────────────────────────────
log('');
log('四、接下来要做的');
log('  1) 编辑 ' + join(TARGET, 'persona.json'));
log('     填 names.self / names.owner 和 persona.identity —— 这一段决定它长成谁。');
log('  2) 重启 Harness（或重载插件），让插件行进入活跃状态。');
log('  3) 在插件列表里确认 companion-incubator 是启用的。');
log('  4) 跟它说第一句话。它从这一句开始记事。');
log('');
log('数据落在哪：默认 ~/.companion-incubator/mind.json');
log('  想换位置就设环境变量 COMPANION_DATA_DIR。');
log('  升级/重装插件不会动它 —— 记忆是那个人的经历，不是插件的配置。');
log('');
if (DRY) log('（试运行结束，什么都没改。去掉 --dry 就真装。）');
