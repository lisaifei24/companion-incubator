/**
 * Companion Incubator — dsh 宿主适配器（薄皮）
 *
 * 全部内容：把引擎挂到 dsh 的三个钩子上——
 *   session/event  → 把对话折进激素与记忆
 *   systemPrompt   → 注入语气 + 记忆
 * 以及启动时的数据目录准备、会话日志吸附、历史回补。
 *
 * 这一层不该有机制。任何「怎么算情绪/怎么折记忆」的逻辑都归 engine.mjs。
 * 想接别的宿主（QQ / App / CLI），照着这个文件的形状再写一个即可。
 */
import { adsorbFiles, adsorbSessionLogs, buildPrompt, ensureDataDir, importConfigOf, importEvents, ingestEvent, loadPersona, readMind, shouldIngestEvent, textOfEvent, whoOfEvent, writeMind } from './engine.mjs';

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
