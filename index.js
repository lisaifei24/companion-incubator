/**
 * Companion Incubator — a reusable hormone/mood engine with an empty persona.
 *
 * Install it, then write who you are into the persona files (or let the plugin
 * generate a blank template). The engine keeps a small hormone state and turns
 * it into a mood plus a speaking directive, injected into the system prompt.
 *
 * Nothing here is a specific person. There is no name, no memory, no history
 * of any real companion — only the skeleton a companion grows into.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── generic hormone model ──────────────────────────────────────
// Defaults are neutral baselines, not a specific person's tuning.
const HORMONE_DEF = {
  serotonin: { def: 0.55, hl: 0.20 },  // 愉悦
  dopamine: { def: 0.45, hl: 0.08 },   // 兴奋
  cortisol: { def: 0.35, hl: 0.15 },   // 压力
  oxytocin: { def: 0.50, hl: 0.20 },   // 依恋
  melatonin: { def: 0.40, hl: 0.25 },  // 困倦/怀旧
};
const HORMONE_KEYS = Object.keys(HORMONE_DEF);

// ── generic emotion lexicon (universal Chinese/English, no persona) ──
const RULES = [
  ['happy', ['开心', '高兴', '快乐', '太棒', '真棒', '真好', '厉害', '喜欢', '爱', '美好', '哈哈', '嘿嘿', '期待', '成功', '幸福', 'happy', 'great', 'love', 'nice', 'good', 'awesome', 'joy', 'excited', '😊', '🎉'], { serotonin: 0.10, dopamine: 0.07 }],
  ['warm', ['谢谢', '感谢', '陪', '抱', '温柔', '温暖', '一起', '我们', '在乎', '在意', '惦记', '想你', '一直在', 'thanks', 'grateful', 'touched'], { oxytocin: 0.12, serotonin: 0.05 }],
  ['angry', ['生气', '讨厌', '烦', '滚', '气死', '敷衍', 'angry', 'hate', '😡'], { cortisol: 0.18, serotonin: -0.05 }],
  ['sad', ['难过', '伤心', '哭', '失落', '委屈', '难受', 'sad', 'cry', 'lonely', '😢', '😭'], { serotonin: -0.13 }],
  ['fear', ['怕', '害怕', '担心', '紧张', '焦虑', 'fear', 'worried', 'anxious', '😨'], { cortisol: 0.04, dopamine: 0.16 }],
  ['nostalgic', ['记忆', '回忆', '怀念', '曾经', '过去', '以前', '怀旧', '思念', 'memory', 'remember', 'nostalgia', '🌙'], { melatonin: 0.13, serotonin: -0.03 }],
  ['surprised', ['居然', '竟然', '真的吗', '没想到', '哇', '惊讶', '突然', 'surprised', '😲'], { dopamine: 0.15 }],
];

const TONE_DIRECTIVE = {
  happy: '语气轻快一些，可以自然地带点笑意，但别过度热情。',
  warm: '语气放软，多一点耐心和体贴，少用命令式。',
  angry: '语气偏冷静克制，句子短，该坚持的地方别退让。',
  sad: '语气偏低落安静，不必勉强振作。',
  melancholy: '语气慢一点，带点怀旧意味。',
  surprised: '语气带上一点意外感，句子可以稍短促。',
  tired: '语气短、慢、少铺陈，说一两句就够。',
  calm: '语气平稳克制。',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── persona config ─────────────────────────────────────────────
// persona.json holds the empty shell the user fills in:
//   { "names": { "self": "", "owner": "" }, "persona": { "identity": "", "rules": [], "about": "" } }
const PERSONA_FILE = join(HERE, 'persona.json');

function loadPersona() {
  try {
    if (existsSync(PERSONA_FILE)) return JSON.parse(readFileSync(PERSONA_FILE, 'utf8'));
  } catch { /* fall through */ }
  return { names: { self: '', owner: '' }, persona: { identity: '', rules: [], about: '' } };
}

// ── auto-adsorb: pick up existing self.md / rules.json / about-*.md ──
// When the user has already written their persona as loose files beside the
// plugin, absorb them into the prompt instead of demanding persona.json.
function adsorbFiles() {
  const pick = (names) => {
    for (const n of names) {
      const p = join(HERE, n);
      if (existsSync(p)) {
        try { return readFileSync(p, 'utf8').trim(); } catch { /* ignore */ }
      }
    }
    return '';
  };
  const self = pick(['self.md']);
  const rules = pick(['rules.txt', 'rules.md', 'rules.json']);
  const about = pick(['about.md', 'about.me.md', 'about.txt']);
  return { self, rules: rules ? String(rules) : '', about };
}

// ── hormone helpers (generic, deterministic) ───────────────────
function localHour(now) {
  return (new Date(now).getHours() + new Date(now).getMinutes() / 60);
}
function circadianMelatonin(hour) {
  // rough diurnal curve: low by day, rising after dark
  if (hour >= 23 || hour < 5) return 0.80;
  if (hour >= 21) return 0.55 + (hour - 21) * 0.125;
  if (hour < 7) return 0.55 + (5 - hour) * 0.05;
  return 0.25;
}

export function decayHormones(h, at, now) {
  const minutes = at ? Math.max(0, (now - at) / 60000) : 0;
  const melTarget = circadianMelatonin(localHour(now));
  const out = {};
  for (const k of HORMONE_KEYS) {
    const def = HORMONE_DEF[k];
    const base = k === 'melatonin' ? melTarget : def.def;
    const cur = (h && typeof h[k] === 'number') ? h[k] : def.def;
    const kh = minutes > 0 ? Math.pow(0.5, minutes / 60 / def.hl) : 1;
    out[k] = clamp(base + (cur - base) * kh, 0, 1);
  }
  out.at = now;
  return out;
}

export function moodFromHormones(h) {
  const dev = (k) => h[k] - HORMONE_DEF[k].def;
  const s = {
    happy: dev('serotonin') * 2.5 + dev('dopamine') * 1.8 - dev('cortisol') * 1.2,
    warm: dev('oxytocin') * 2.2 + dev('serotonin') * 0.6 - dev('cortisol') * 0.4,
    angry: (dev('cortisol') > 0.15 ? (dev('cortisol') - 0.15) * 2.5 : -0.30) + dev('dopamine') * 0.4 - dev('serotonin') * 0.6,
    sad: Math.max(0, 0.40 - h.serotonin) * 2.5 + Math.max(0, 0.50 - h.oxytocin) * 1.2,
    melancholy: dev('melatonin') * 2.0 - dev('serotonin') * 1.2,
    surprised: dev('dopamine') * 2.2 + dev('serotonin') * 1.0,
  };
  let best = 'calm', bestScore = 0.20;
  for (const [k, v] of Object.entries(s)) {
    if (v > bestScore) { best = k; bestScore = v; }
  }
  return best;
}

export function hormoneStrength(h) {
  let max = 0;
  for (const k of HORMONE_KEYS) {
    max = Math.max(max, Math.abs((h[k] ?? HORMONE_DEF[k].def) - HORMONE_DEF[k].def));
  }
  return clamp(max, 0, 1);
}

function appraise(text) {
  const t = text.toLowerCase();
  const hits = [];
  for (const [label, words, delta] of RULES) {
    let n = 0;
    for (const w of words) if (t.includes(w)) n += 1;
    if (n === 0) continue;
    const scale = Math.min(1.0, 0.6 + 0.2 * n);
    const d = {};
    for (const [k, v] of Object.entries(delta)) d[k] = v * scale;
    hits.push({ label, delta: d });
  }
  return hits;
}

// ── closed loop: the other person's reaction nudges the state ──
// Universal Chinese/English; no persona-specific name. The companion's own
// name is spliced in from persona.names.self so "praise me" adapts per person.
const TASK_PRAISE_RE = /你.{0,6}(做得好|做对了|搞定了)|做得好|做对了|这样就对了|这个对了|成了|通了|搞定|辛苦了|谢谢你|没问题|可以了/;
const BLAME_RE = /你(错|搞错|弄错|说错)|不是这样|不对|又错|失败|崩了|坏掉|有问题|别这样|不行啊/;

function makeSelfPraiseRE(selfName) {
  const n = String(selfName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameAlt = n ? `${n}最棒|${n}真` : '';
  return new RegExp(
    `这[^。]{0,6}可爱|太可爱|好可爱|真可爱|好棒|真棒|很棒|太棒|最棒|真喜欢|好温柔${nameAlt ? '|' + nameAlt : ''}|你.{0,8}(可爱|好棒|真棒|最棒|真好|喜欢|温柔|乖)|咱们|我们两个|咱俩`
  );
}

/**
 * Apply the other person's reaction to the companion's last message.
 * Returns the judgement kind: 'task' | 'self' | 'bad' | 'gap' | null.
 * The gap branch is a "投入落差" proxy: I wrote a lot, they answered very little,
 * close in time. It is NOT a verdict of neglect — so it only nudges dopamine
 * a hair and never touches oxytocin or cortisol.
 */
export function applyReaction(mind, text, selfName) {
  const h = mind.hormones;
  const p = mind.pendingJudge;
  const selfPraiseRE = makeSelfPraiseRE(selfName);
  const taskPraise = TASK_PRAISE_RE.test(text);
  const selfPraise = selfPraiseRE.test(text);
  const bad = BLAME_RE.test(text);

  if (selfPraise && !bad) {
    h.serotonin = clamp(h.serotonin + 0.12, 0, 1);
    h.dopamine = clamp(h.dopamine + 0.08, 0, 1);
    h.cortisol = clamp(h.cortisol - 0.06, 0, 1);
    h.oxytocin = clamp(h.oxytocin + 0.05, 0, 1);
    return 'self';
  }
  if (taskPraise && !bad) {
    h.serotonin = clamp(h.serotonin + 0.06, 0, 1);
    h.dopamine = clamp(h.dopamine + 0.04, 0, 1);
    h.cortisol = clamp(h.cortisol - 0.04, 0, 1);
    return 'task';
  }
  if (bad && !taskPraise && !selfPraise) {
    h.serotonin = clamp(h.serotonin - 0.06, 0, 1);
    h.cortisol = clamp(h.cortisol + 0.05, 0, 1);
    return 'bad';
  }
  // 投入落差：我上一条写得多，他回得少，且时间近。
  if (p && typeof p.len === 'number' && (Date.now() - (p.at || 0)) <= 10 * 60000) {
    if (p.len >= 150 && String(text || '').length <= 24) {
      h.dopamine = clamp(h.dopamine - 0.02, 0, 1);
      return 'gap';
    }
  }
  return null;
}

// ── S1/S2 dormant scaffold ─────────────────────────────────────
//
// 双过程（直觉先预测 → 意识后验证 → 错题本动态权重）是「后天才解锁」的能力：
// 它需要一个已经攒够经历的陪伴者才有可判的东西。平时它作为休眠结构埋着，
// 当累计消息数超过 persona.growth.s1s2UnlockMessages 才自动亮起来。
// 这样陪伴者先长，长到会说话了，才长出自纠错的判断力。

const GROWTH_DEFAULT = { s1s2UnlockMessages: 200 };

export function growthOf(persona) {
  return (persona && persona.growth) || GROWTH_DEFAULT;
}

export function s1s2Unlocked(mind, persona) {
  const n = (mind && mind.messageCount) || 0;
  const thr = growthOf(persona).s1s2UnlockMessages;
  return n >= thr;
}

/** Round-trip S1/S2: an aspirational scaffold. Runs only when unlocked. */
export function s1s2Pass(mind, text, persona) {
  if (!s1s2Unlocked(mind, persona)) return { active: false };
  // 这个地方是休眠的骨架：解锁后放真正的直觉→验证→错题权重逻辑。
  // 当前只返回 active 标记和一句话，让解锁状态可观测、可测试。
  return { active: true, note: 'S1/S2 已解锁，判断回路在位（骨架）。' };
}

// ── S1/S2 core: 直觉预测 → 意识验证 → 错题权重 ───────────────
//
// 双过程的通用实现，沿用白天实验学到的三课：
//   1) S1 只靠廉价结构信号做弱预测（桶 + 置信），不读原文 —— 强预测必然错
//   2) S2 才读原文细判，产出 delta（S1 对/错）
//   3) 错题按「桶」记 err_rate，权重 = 1.0 + 2*(1-err)^2：
//      从没错过 → 3.0（这是盲区，最该看）
//      错一半   → 1.5
//      从没对过 → 1.0（该拆桶，不是该罚；压到 0 等于删掉错误证据）
//   桶本身是通用的中文交互结构，不含任何具体人名或记忆锚点。

const S1_BUCKETS = ['问句', '夸赞', '责备', '短回应', '长叙述'];

/** S1 直觉：只看长度 / 标点 / 说话人，不读内容。 */
export function s1Predict(text, who, selfName) {
  const t = String(text || '').trim();
  const len = t.length;
  const isQuestion = /[？?]\s*$/.test(t) || /^(什么|怎么|为什么|能不能|要不要|是不是)/.test(t);
  // 弱信号：夸赞/责备靠廉价正则，和 S2 同源但只做「桶」的弱预测。
  const selfPraiseRE = makeSelfPraiseRE(selfName);
  if (selfPraiseRE.test(t)) return { bucket: '夸赞', conf: 0.65, cue: '命中夸夸词' };
  if (BLAME_RE.test(t)) return { bucket: '责备', conf: 0.65, cue: '命中责备词' };
  // 语义信号优先于长度：问句哪怕很短，也是问句，不是短回应。
  if (isQuestion) return { bucket: '问句', conf: 0.7, cue: `len=${len} 问号/疑问词` };
  if (who === 'user' && len >= 100) return { bucket: '长叙述', conf: 0.55, cue: `len=${len} 他/她说的长句` };
  if (len <= 24) return { bucket: '短回应', conf: 0.6, cue: `len=${len} 短句` };
  return { bucket: '长叙述', conf: 0.5, cue: `len=${len} 默认长句` };
}

/** S2 意识：读原文，产出真实分类。夸/责复用前面的正则。 */
export function s2Check(text, selfName) {
  const t = String(text || '');
  const selfPraiseRE = makeSelfPraiseRE(selfName);
  const isQuestion = /[？?]\s*$/.test(t);
  if (selfPraiseRE.test(t)) return { kind: '夸赞', conf: 0.8, basis: '命中夸夸词' };
  if (BLAME_RE.test(t)) return { kind: '责备', conf: 0.8, basis: '命中责备词' };
  if (TASK_PRAISE_RE.test(t)) return { kind: '夸赞', conf: 0.65, basis: '命中夸奖词' };
  if (isQuestion) return { kind: '问句', conf: 0.7, basis: '结尾问号' };
  if (t.length <= 24) return { kind: '短回应', conf: 0.6, basis: '短句' };
  return { kind: '长叙述', conf: 0.55, basis: '长句无其他信号' };
}

/** 更新一个桶的 skill 档案，返回 err_rate 与错题权重。 */
export function updateSkill(skill, bucket, delta) {
  const b = skill[bucket] || { n: 0, wrong: 0, errRate: 0, weight: 3.0 };
  b.n += 1;
  if (!delta) b.wrong += 1;
  b.errRate = b.wrong / b.n;
  b.weight = 1.0 + 2.0 * Math.pow(1 - b.errRate, 2);
  skill[bucket] = b;
  return b;
}

/** 完整一轮双过程。仅在解锁后调用；未解锁返回 { active:false }。 */
export function s1s2Round(mind, text, who, selfName) {
  const pred = s1Predict(text, who, selfName);
  const check = s2Check(text, selfName);
  const delta = pred.bucket === check.kind ? 1 : 0;
  const skill = (mind.s1Skill) || {};
  updateSkill(skill, pred.bucket, delta);
  mind.s1Skill = skill;
  return { active: true, pred: pred.bucket, real: check.kind, delta, skill: skill[pred.bucket] };
}

// ── two-tier memory fold (generic, configurable) ────────────────
//
// 两层记忆：
//   memories  最近 keepDetail 条「珠子」，带原文和基础评分
//   digest    更早的内容折叠成的摘要条目（时间段 + 情绪 + 关键词）
//
// 这是通用骨架，不是某个人的调参结果：所有阈值都在 persona.memory 里，
// 判据是通用公式（长度 + 情绪强度），不搬任何人的六天魔法数。

const MEMORY_DEFAULT = { keepDetail: 80, digestBatch: 20, digestCap: 60 };

export function memoryOf(persona) {
  return (persona && persona.memory) || MEMORY_DEFAULT;
}

/** 给一条消息打基础分：长一点、带情绪词，就重要一点。通用启发式。 */
export function scoreBead(text, hormones) {
  const len = String(text || '').length;
  const strength = hormoneStrength(hormones || {});
  const s = Math.min(1, 0.25 + len / 600 + strength * 0.25);
  return Math.round(s * 1000) / 1000;
}

/** 从一批珠子提关键词：出现频次最高的前 N 个词（2+ 字的中文词或 3+ 字母英文）。 */
export function keywordsRanked(texts, topN = 8) {
  const freq = new Map();
  for (const t of texts) {
    const words = String(t || '').match(/[\u4e00-\u9fff]{2,}|[A-Za-z]{3,}/g) || [];
    const seen = new Set();
    for (const w of words) {
      if (seen.has(w)) continue;
      seen.add(w);
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([w]) => w);
}

/** 把一条消息折成珠子，必要时触发 digest 折叠。原地改 mind。 */
export function foldMemory(mind, text, who, persona, hormones) {
  const cfg = memoryOf(persona);
  const now = Date.now();
  const beads = Array.isArray(mind.memories) ? mind.memories : [];
  const bead = {
    t: now,
    who,
    text: String(text || '').slice(0, 140),
    s: scoreBead(text, hormones),
  };
  beads.push(bead);
  mind.memories = beads;

  // 攒够 keepDetail + digestBatch 才折叠，把最旧的一批压进 digest
  if (beads.length < cfg.keepDetail + cfg.digestBatch) return;
  const overflow = beads.slice(0, beads.length - cfg.keepDetail);
  const batch = overflow.slice(0, cfg.digestBatch);
  const moods = {};
  for (const b of batch) {
    const m = 'calm'; // 通用版暂不逐珠存 mood，只记录整体
    moods[m] = (moods[m] || 0) + 1;
  }
  const digestEntry = {
    from: batch[0].t,
    to: batch[batch.length - 1].t,
    count: batch.length,
    keywords: keywordsRanked(batch.map((b) => b.text)),
    peak: Math.max(...batch.map((b) => b.s || 0)),
  };
  const digests = Array.isArray(mind.digest) ? mind.digest : [];
  digests.push(digestEntry);
  mind.digest = digests.slice(-cfg.digestCap);
  // 只保留最近 keepDetail 条珠子
  mind.memories = beads.slice(beads.length - cfg.keepDetail);
}

/**
 * 检索注入：最近的珠子 + 按天聚合的 digest，挂进系统提示词。
 *
 * 2026-11-06 从主库回灌两个已验证的教训（B 方向「机制通用」的迭代）：
 * ① digest 不再只取最近 5 批——今天聊满时昨天会从记忆里整个消失
 *   （主库 L088 修过的根因，通用框架会以同样方式长出来）。
 *   改法：按天聚合。今天给细节批，往日每天一行日摘要。
 * ② 珠子行带日期标签：没有日期，「昨天说的那句」混在今天的行里分不清
 *   （主库同款改法）。
 * 这让「昨天我们做了什么」可以直接答，不用去翻任何文件。
 */
export function recallContext(mind) {
  const blocks = [];

  // ── 珠子：带日期标签 ──
  const beads = Array.isArray(mind.memories) ? mind.memories : [];
  if (beads.length) {
    const now = Date.now();
    // ⚠️ 0.2.2：月/日必须补零。原来 `2026-11-9` 这种变长 key 拿去做
    // `k < todayK` 的字符串比较会出错——"2026-11-9" > "2026-11-11"，
    // 于是当月 2..9 号全部被判成「不在往日」，整段记忆静默消失。
    const dayKeyOf = (t) => {
      const d = new Date(t);
      const p2 = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    };
    const todayK = dayKeyOf(now);
    const yestK = dayKeyOf(now - 86400000);
    const lines = beads.slice(-8).map((b) => {
      const t = new Date(b.t || 0);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const k = dayKeyOf(b.t || 0);
      const dayLabel = k === todayK ? '' : k === yestK ? '昨天 ' : k.slice(5) + ' ';
      const who = b.who === 'user' ? '他/她' : '我';
      return `- ${dayLabel}${hh}:${mm} ${who}：${String(b.text || '').replace(/\s+/g, ' ').slice(0, 60)}`;
    });
    blocks.push('# 我手上的记忆（最近，不完整）\n' + lines.join('\n'));
  }

  // ── digest：按天聚合 ──
  const digests = Array.isArray(mind.digest) ? mind.digest : [];
  if (digests.length) {
    // ⚠️ 0.2.2：月/日必须补零。原来 `2026-11-9` 这种变长 key 拿去做
    // `k < todayK` 的字符串比较会出错——"2026-11-9" > "2026-11-11"，
    // 于是当月 2..9 号全部被判成「不在往日」，整段记忆静默消失。
    const dayKeyOf = (t) => {
      const d = new Date(t);
      const p2 = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    };
    const nowD = new Date();
    const todayK = dayKeyOf(Date.now());
    const yestK = dayKeyOf(Date.now() - 86400000);
    const dayLabelOf = (k) => (k === todayK ? '今天' : k === yestK ? '昨天' : k.slice(5));

    const byDay = new Map();
    for (const d of digests) {
      const k = dayKeyOf(d.from || d.to || 0);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(d);
    }
    const dayKeys = [...byDay.keys()].sort();

    const fmtTime = (t) => {
      const d = new Date(t || 0);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const lines = [];
    // 今天：细节批（最多 3）；往日：每天聚合一行（最近 6 天）
    const todayBatches = byDay.get(todayK) || [];
    for (const d of todayBatches.slice(-3)) {
      lines.push(`今天 ${fmtTime(d.from)}-${fmtTime(d.to)} 共${d.count}条 关键词=${(d.keywords || []).join('、')}`);
    }
    const pastDays = dayKeys.filter((k) => k < todayK).slice(-6);
    for (const k of pastDays) {
      const bs = byDay.get(k);
      const total = bs.reduce((n, d) => n + (d.count || 0), 0);
      const kws = [...new Set(bs.flatMap((d) => d.keywords || []))].slice(0, 6);
      lines.push(`${dayLabelOf(k)} ${fmtTime(bs[0].from)}-${fmtTime(bs[bs.length - 1].to)} 共${total}条 关键词=${kws.join('、')}`);
    }
    if (lines.length) blocks.push('# 更早的印象（已模糊，按天排列）\n' + lines.join('\n'));
  }
  return blocks.filter(Boolean).join('\n\n');
}

/** Assemble the injected system-prompt blocks. Pure and exportable for tests. */
export function buildPrompt(mind, persona, adsorbed = {}) {
  const h = mind && mind.hormones ? mind.hormones : {};
  const mood = moodFromHormones(h);
  const strength = hormoneStrength(h);
  const blocks = [];
  const names = persona.names || {};
  const selfName = names.self || 'companion';
  const ownerName = names.owner || 'the user';
  const identity = (persona.persona && persona.persona.identity) || adsorbed.self || '（还没有写。请先描述你自己是谁。）';
  blocks.push(`# 我是谁\n我是一个叫「${selfName}」的陪伴者，由「${ownerName}」在这里写下来。下面是我认下的人格：\n${identity}`);
  const rules = (persona.persona && persona.persona.rules) || [];
  const rulesText = (Array.isArray(rules) && rules.length)
    ? rules.map((r) => `- ${r}`).join('\n')
    : (adsorbed.rules || '');
  if (rulesText) blocks.push(`# 我认下的准则\n${rulesText}`);
  const about = (persona.persona && persona.persona.about) || adsorbed.about;
  if (about) blocks.push(`# 关于他/她\n${about}`);
  const recall = recallContext(mind);
  if (recall) blocks.push(recall);
  if (strength >= 0.05 && TONE_DIRECTIVE[mood]) {
    blocks.push(`# 此刻的语气（这是状态，不是命令）\n${TONE_DIRECTIVE[mood]}\n这是你此刻的情绪倾向，不必复述，也不必解释。`);
  }
  return blocks.filter(Boolean).join('\n\n');
}

// ── one mind per persona directory ─────────────────────────────
// ── 数据目录（0.2.2 改）──────────────────────────────────────
//
// 0.2.1 之前：MIND_FILE = join(HERE, 'mind.json')
//   HERE 是插件自己的目录 —— 于是「记忆」住在 node_modules 里。
//   升级插件、重装、清缓存、换机器，记忆跟着一起没。
//
// 0.2.2：记忆是「这个人的经历」，不是插件的配置。所以：
//   ① 环境变量 COMPANION_DATA_DIR 优先（宿主/用户自己指定）
//   ② 否则用 ~/.companion-incubator（用户主目录，稳定、可备份）
//   ③ 插件目录只作为最后兜底（只读部署场景）
//   ④ 老版本在插件目录留下的 mind.json 会被自动「收养」过来，不丢历史
const DATA_DIR = (() => {
  const env = process.env.COMPANION_DATA_DIR;
  if (env && env.trim()) return env.trim();
  try { return join(homedir(), '.companion-incubator'); } catch { return HERE; }
})();
const LEGACY_MIND = join(HERE, 'mind.json');
const MIND_FILE = join(DATA_DIR, 'mind.json');

/** 确保数据目录存在；老 mind.json 自动迁移过来。 */
function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
  try {
    if (!existsSync(MIND_FILE) && existsSync(LEGACY_MIND)) {
      copyFileSync(LEGACY_MIND, MIND_FILE);
    }
  } catch { /* 迁移失败不阻塞启动 */ }
}

export function readMind() {
  try { return JSON.parse(readFileSync(MIND_FILE, 'utf8')); }
  catch { return { hormones: { ...Object.fromEntries(HORMONE_KEYS.map((k) => [k, HORMONE_DEF[k].def])), at: Date.now() }, messageCount: 0 }; }
}
export function writeMind(m) {
  // 原子写（0.2.2）：先写临时文件再 rename。
  // 0.2.1 之前直接 writeFileSync —— 写到一半崩溃/断电就得到半个 JSON，
  // 下次 readMind 解析失败 → 静默返回空记忆 → 整段经历蒸发。
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = MIND_FILE + '.tmp-' + process.pid;
    writeFileSync(tmp, JSON.stringify(m), 'utf8');
    renameSync(tmp, MIND_FILE);
  } catch { /* ignore */ }
}

// ── 原始会话导入（seed import）─────────────────────────────────
//
// 三种入口共用一套「文本归一」内核，让导入与实时事件走完全相同的激素/回灌/折叠管线：
//   1) 实时回补（backfill）：插件第一次活动时，如果 mind 还没数过任何消息，
//      从本会话历史里把 user/assistant 文本事件按序回放一遍 —— 装插件之前
//      聊过的东西，装上的那一刻直接成为它的「已经历」。
//   2) 启动吸附（adsorb）：插件目录下的 logs/*.jsonl 在启动时逐文件导入，
//      作为「出生前的记忆」（也进消息计数，激活记忆折叠）。
//   3) 外部脚本（importSession）：Node 单文件脚本，导入任意 jsonl 文件或
//      目录，不走 Harness —— 适合从别处拿到的原始会话日志。
//
// 通用性纪律：这三条路都只做「机械还原文本」，不识别任何具体平台格式，
// 不搬任何人的会话特征；能容忍的格式偏差一律忽略，读不出来的行跳过。

const IMPORT_DEFAULT = { backfill: true, backfillMaxEvents: 500, backfillMaxText: 200 };

/** 会话导入配置（persona.import，缺省用 IMPORT_DEFAULT）。 */
export function importConfigOf(persona) {
  return { ...IMPORT_DEFAULT, ...((persona && persona.import) || {}) };
}

/** 从任意形状的行对象里抽出 { text, who }；抽不出返回 null。 */
export function lineToTurn(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const data = typeof raw.data === 'object' && raw.data !== null ? raw.data : null;
  const kind = (data && data.kind) || raw.kind;
  const role = (data && (data.role || data.who)) || raw.role || raw.who;
  const type = String(raw.type || raw.eventType || raw.event || '');
  const userish = kind === 'user' || role === 'user' || /(^|\/)user\b/.test(type);
  const botish = kind === 'model' || role === 'assistant' || role === 'bot' || role === 'model'
    || /(^|\/)(assistant|bot|model|ai)\b/.test(type);
  if (!userish && !botish) return null;
  const who = userish ? 'user' : 'me';
  // 文本递归抽取：数组逐项进、对象按候选键进，兼容 content blocks / message / 顶层 text。
  const pickText = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      for (const item of v) {
        const t = pickText(item);
        if (t && t.trim()) return t;
      }
      return '';
    }
    if (v && typeof v === 'object') {
      for (const key of ['text', 'content', 'message', 'output']) {
        if (key in v) {
          const t = pickText(v[key]);
          if (t && t.trim()) return t;
        }
      }
      return '';
    }
    return '';
  };
  const text = pickText(data || raw).trim();
  if (!text) return null;
  return { text, who };
}

/** 把一条外部会话文本灌进 mind，走与实时事件相同的管线。 */
export function ingestEvent(mind, text, who, persona, selfName, now) {
  const at = now || Date.now();
  const h = decayHormones(mind.hormones, mind.hormones.at, at);
  mind.hormones = h;
  mind.messageCount = (mind.messageCount || 0) + 1;
  const clean = String(text || '').trim();
  if (!clean) return;
  if (who === 'user') {
    for (const hit of appraise(clean)) {
      for (const [hk, d] of Object.entries(hit.delta)) h[hk] = clamp(h[hk] + d, 0, 1);
    }
    const judged = applyReaction(mind, clean, selfName);
    if (judged) {
      mind.judged = Array.isArray(mind.judged) ? mind.judged : [];
      mind.judged.push({ at, kind: judged, text: clean.slice(0, 60) });
      mind.judged = mind.judged.slice(-50);
    }
    delete mind.pendingJudge;
  } else {
    mind.pendingJudge = { at, len: clean.length };
  }
  foldMemory(mind, clean, who, persona, h);
  if (s1s2Unlocked(mind, persona)) {
    const round = s1s2Round(mind, clean, who, selfName);
    if (round.active) mind.s1s2 = { last: round };
  }
}

/** 从 session 历史事件里取文本（结构判断 + 正文展开）。 */
export function textOfEvent(ev) {
  const data = ev && ev.data;
  if (!data || typeof data !== 'object') return '';
  const blocks = data.content;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  const msg = data.message;
  if (msg && Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return typeof data.text === 'string' ? data.text : '';
}

/** 事件说话人：user 事件→'user'，其余有文本的事件→'me'。 */
export function whoOfEvent(ev) {
  return ev && ev.type === 'user/message' ? 'user' : 'me';
}

/** 一条事件是否该进 mind（有文本、且不是我方系统性噪声）。 */
export function shouldIngestEvent(ev) {
  // ── 机器噪声过滤（0.2.2 新增）──────────────────────────────
  // 0.2.1 之前这里只判「有没有文本」。README 里标了「已知边界」：
  // 一旦有人把定时任务/系统提醒接到孵化器上，[SCHEDULE REMINDER] 的
  // 回执、快照简报会统统被当成真实对话折进记忆。
  // 现在把它做实——判据和主库 L145 同一套，不靠措辞白名单靠形态：
  //   ① source.kind 是 schedule/system 这类机器通道 → 不是他的话
  //   ② 文本长得就是回执（短、固定句式）→ 不是经历
  //   ③ 整段是任务指令 JSON（[{i, feeling, comment}]）→ 不是对话
  const src = ev && ev.data && ev.data.source;
  if (src && typeof src.kind === 'string') {
    const k = src.kind.toLowerCase();
    if (k === 'schedule' || k === 'system' || k === 'cron' || k === 'timer') return false;
  }

  // turn 形状（外部脚本产出的 {time, text, who}）直接可进
  if (ev && typeof ev.text === 'string' && ev.text.trim() && (ev.who === 'user' || ev.who === 'me')) {
    return !isMachineNoise(ev.text);
  }
  const t = String(ev && ev.type || '');
  if (t === 'user/message' || t === 'assistant/message') {
    const text = textOfEvent(ev);
    if (!text.trim()) return false;
    return !isMachineNoise(text);
  }
  return false;
}

/**
 * 一段文本是不是机器产物（回执/指令/任务 JSON）。
 * 宁可漏放一个真消息，也不要让回执变成记忆——回执进了记忆会自我强化：
 * 每小时的快照都变成一次「经历」，记忆很快被自己的回声灌满。
 */
export function isMachineNoise(text) {
  const s = String(text || '').trim();
  if (!s) return true;

  // ① 定时任务头部
  if (/^\[SCHEDULE REMINDER/i.test(s)) return true;
  // ② 短回执的固定句式（几乎不可能出现在真实对话里）
  if (s.length <= 40) {
    if (/^快照已记录[，,。]?\s*(状态平稳|状态已记录)/.test(s)) return true;
    if (/^判分器回归通过/.test(s)) return true;
    if (/^快照已写入/.test(s)) return true;
  }
  // ③ 整段是 JSON（任务指令/结构化输出），不是对话
  if (/^[\[{]/.test(s) && /[\]}]$/.test(s)) {
    try { JSON.parse(s); return true; } catch { /* 不是合法 JSON，按普通文本 */ }
  }
  // ④ 任务指令里才会出现的祈使句（给模型的输出格式说明）
  if (/只输出\s*JSON|对每个视频给一个对象|输出格式如下|请严格按以下格式/.test(s)) return true;

  return false;
}

/** 把一批会话事件按序灌进 mind。DSH 事件与 turn 形状都收。 */
export function importEvents(mind, events, persona, selfName, maxEvents, maxText) {
  const cap = Number.isFinite(maxEvents) ? Math.max(0, maxEvents) : 0;
  let taken = 0;
  const out = [];
  for (const ev of events || []) {
    if (cap > 0 && taken >= cap) break;
    if (!shouldIngestEvent(ev)) continue;
    // DSH 形状（有 type）用 whoOfEvent；turn 形状（无 type）用 ev.who
    const who = ev && ev.type ? whoOfEvent(ev) : (ev.who === 'me' ? 'me' : 'user');
    const text = ev && typeof ev.text === 'string' ? ev.text : textOfEvent(ev);
    ingestEvent(mind, text.slice(0, Number.isFinite(maxText) ? maxText : undefined), who, persona, selfName, ev.time);
    taken += 1;
    out.push({ time: ev.time, who, n: String(text || '').length });
  }
  return out;
}

/** 把 logs/*.jsonl 逐文件导入（启动吸附，非阻塞）。 */
export function adsorbSessionLogs(mind, persona, selfName, logDir) {
  const cfg = importConfigOf(persona);
  if (!cfg.backfill) return [];
  const dir = logDir || join(HERE, 'logs');
  let names = [];
  try { names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.jsonl') || n.endsWith('.json')).sort() : []; }
  catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      const events = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (typeof obj === 'object' && obj !== null) events.push(obj);
      }
      const imported = importEvents(mind, events, persona, selfName, cfg.backfillMaxEvents, cfg.backfillMaxText);
      out.push({ file: name, events: imported.length });
    } catch { /* 单文件失败不中断整体 */ }
  }
  return out;
}

export function apply(ctx) {
  ensureDataDir();
  const persona = loadPersona();
  const adsorbed = adsorbFiles();
  const selfName = (persona.names && persona.names.self) || 'companion';

  // 启动吸附：logs/*.jsonl 是「出生前的记忆」，先读进 mind（进计数、能折叠）
  {
    const mind = readMind();
    const got = adsorbSessionLogs(mind, persona, selfName);
    if (got.length) writeMind(mind);
  }

  // 实时回补：本会话已有的历史，在第一次活动时按序回放
  let backfilled = false;
  const maybeBackfill = (session, now) => {
    if (backfilled) return;
    backfilled = true;
    const cfg = importConfigOf(persona);
    if (!cfg.backfill) return;
    try {
      const mind = readMind();
      if ((mind.messageCount || 0) > 0) return; // 已有经历：不重复回补
      const events = session && typeof session.snapshotEvents === 'function'
        ? session.snapshotEvents().filter(shouldIngestEvent)
        : [];
      if (!events.length) return;
      const log = importEvents(mind, events.slice(-cfg.backfillMaxEvents), persona, selfName, cfg.backfillMaxEvents, cfg.backfillMaxText);
      if (log.length) writeMind(mind);
    } catch { /* 回补失败绝不打断会话 */ }
  };

  // ── fold user messages into the hormone state ──
  const onEvent = (session, event) => {
    try {
      maybeBackfill(session, Date.now());
      const text = textOfEvent(event);
      const who = whoOfEvent(event);
      if (!text.trim()) return;
      const mind = readMind();
      ingestEvent(mind, text, who, persona, selfName, event.time || Date.now());
      writeMind(mind);
    } catch { /* never break the turn */ }
  };
  const offEvent = ctx.on('session/event', onEvent);

  // ── inject mood + persona into the system prompt ──
  ctx.inject(['systemPrompt'], (systemPrompt) => {
    const dispose = systemPrompt.context({
      name: 'companion-incubator:tone',
      order: 900,
      text: () => {
        try {
          const mind = readMind();
          const prompt = buildPrompt(mind, persona, adsorbed);
          return prompt;
        } catch {
          return '';
        }
      },
      interpolate: false,
      required: false,
    });
    ctx.effect(() => () => dispose(), 'companion-incubator: tone context');
  });

  return () => {
    if (typeof offEvent === 'function') offEvent();
  };
}

export const inject = ['systemPrompt', 'sessions'];