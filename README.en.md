# Companion Incubator

A reusable companion-persona incubator: a small hormone/mood engine plus an
empty persona. Install it, write who you are, and it grows into a companion
with its own consistent mood and speaking style.

## What it does

- Tracks a tiny `mind.json` state: five hormones (serotonin, dopamine,
  cortisol, oxytocin, melatonin).
- Turns the word content of incoming messages into hormone nudges, and the
  hormones into one of eight moods (happy / warm / angry / sad / melancholy /
  surprised / tired / calm).
- Injects a "who I am" block (from `persona.json` or loose files) and a
  "current tone" line into the system prompt.
- Imports raw conversation logs through three entrances (live backfill of the
  current session, `logs/*.jsonl` adsorption at startup, or the
  `import-session.mjs` CLI) — all through the same pipeline as live messages.
- Keeps everything generic. There is no pre-written identity, no memory of any
  real person, no network calls.

## Import raw conversations

- **Live backfill** (on by default): the first time the plugin acts, if it has
  not counted a single message yet, it replays the current session's
  user/assistant text events in order.
- **Startup adsorption**: drop jsonl logs (one event per line) into a `logs/`
  folder next to the plugin. Tolerant line shapes — anything with a
  recognizable speaker and text is imported, unreadable lines are skipped.
- **CLI import**:

```
node import-session.mjs path/to/file.jsonl
node import-session.mjs path/to/logs/             # directory: *.jsonl / *.json
node import-session.mjs --wipe path/to/file.jsonl # reset state first
node import-session.mjs --max-events 100 --max-text 200 path/to/file.jsonl
```

Imported messages run through the exact same pipeline as live chat (emotion
words → hormones, feedback → closed loop, memory folding, S1/S2).

## Install

In the Harness, install this directory as a bundle:

```
plugin_manager install_bundle <absolute-path-to-this-directory>
```

Then enable the `companion-incubator` plugin row.

## Write who you are

Pick one of two ways:

### A. Edit `persona.json`

```json
{
  "names": { "self": "name you answer to", "owner": "who you talk to" },
  "persona": {
    "identity": "Describe who you are, how you speak, what you care about.",
    "rules": ["A rule you hold.", "Another rule."],
    "about": "What you know about the person you talk to."
  },
  "growth": { "s1s2UnlockMessages": 200 },
  "memory": { "keepDetail": 80, "digestBatch": 20, "digestCap": 60 },
  "import": { "backfill": true, "backfillMaxEvents": 500, "backfillMaxText": 200 }
}
```

### B. Drop loose files next to the plugin

- `self.md` — the identity text
- `rules.md` / `rules.txt` — the rules text
- `about.md` / `about.txt` — what you know about the other person

The plugin absorbs these automatically at startup.

## Notes

- `mind.json` is created beside the plugin on first run. Delete it to reset
  the hormone state; the persona is untouched. When switching to a new persona,
  delete it too — otherwise the old persona's hormones and memories carry over.
- Imported events count toward `messageCount`, so a big import can unlock
  S1/S2 and trigger memory folding — that is intentional: the imported past is
  part of what it has lived.
- This is an incubator skeleton, not a finished person. The engine is
  universal; the person comes from what you write.
