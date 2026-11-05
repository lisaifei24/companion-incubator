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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** 检索注入：最近的珠子 + 更早的 digest，挂进系统提示词。 */
export function recallContext(mind) {
  const blocks = [];
  const beads = Array.isArray(mind.memories) ? mind.memories.slice(-6) : [];
  if (beads.length) {
    const lines = beads.map((b) => {
      const t = new Date(b.t || 0);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const who = b.who === 'user' ? '他/她' : '我';
      return `- ${hh}:${mm} ${who}：${String(b.text || '').replace(/\s+/g, ' ').slice(0, 60)}`;
    });
    blocks.push('# 我手上的记忆（最近，不完整）\n' + lines.join('\n'));
  }
  const digests = Array.isArray(mind.digest) ? mind.digest.slice(-5) : [];
  if (digests.length) {
    const lines = digests.map((d) => {
      const f = new Date(d.from || 0);
      const t = new Date(d.to || 0);
      const span = `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `${span} 共${d.count}条 关键词=${(d.keywords || []).join('、')}`;
    });
    blocks.push('# 更早的印象（已模糊）\n' + lines.join('\n'));
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
const MIND_FILE = join(HERE, 'mind.json');
function readMind() {
  try { return JSON.parse(readFileSync(MIND_FILE, 'utf8')); }
  catch { return { hormones: { ...Object.fromEntries(HORMONE_KEYS.map((k) => [k, HORMONE_DEF[k].def])), at: Date.now() }, messageCount: 0 }; }
}
function writeMind(m) {
  try { writeFileSync(MIND_FILE, JSON.stringify(m), 'utf8'); } catch { /* ignore */ }
}

export function apply(ctx) {
  const persona = loadPersona();
  const adsorbed = adsorbFiles();
  const selfName = (persona.names && persona.names.self) || 'companion';

  // ── fold user messages into the hormone state ──
  const onEvent = (session, event) => {
    try {
      let text = '';
      let who = 'me';
      if (event.type === 'user/message') {
        const content = (event.data && event.data.content) || [];
        text = content.map((b) => (b && b.text) || '').join('');
        who = 'user';
      } else if (event.type === 'assistant/message') {
        const msg = (event.data && event.data.message) || {};
        const content = msg.content || [];
        text = content.map((b) => (b && b.text) || '').join('');
        who = 'me';
      }
      if (!text || !text.trim()) return;
      const now = Date.now();
      const mind = readMind();
      const h = decayHormones(mind.hormones, mind.hormones.at, now);
      mind.hormones = h;
      mind.messageCount = (mind.messageCount || 0) + 1;

      if (who === 'user') {
        // 先落 appraise 的情绪词 → 激素
        for (const hit of appraise(text)) {
          for (const [hk, d] of Object.entries(hit.delta)) h[hk] = clamp(h[hk] + d, 0, 1);
        }
        // 再落闭环回灌：他对上一条我的回复的反应
        const judged = applyReaction(mind, text, selfName);
        if (judged) {
          mind.judged = Array.isArray(mind.judged) ? mind.judged : [];
          mind.judged.push({ at: now, kind: judged, text: String(text).slice(0, 60) });
          mind.judged = mind.judged.slice(-50);
        }
        delete mind.pendingJudge;
      } else {
        // 我这条说完了：记下长度，等他的下一条判断「投入落差」
        mind.pendingJudge = { at: now, len: String(text || '').length };
      }

      // 记忆折叠：这条消息折成珠子，攒够就压进 digest（两层记忆）
      foldMemory(mind, text, who, persona, h);

      // S1/S2 骨架：解锁后每轮跑一次（当前是休眠骨架，只标记状态）
      const s1s2 = s1s2Pass(mind, text, persona);
      if (s1s2.active) {
        mind.s1s2 = { unlockedAt: now };
      }

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