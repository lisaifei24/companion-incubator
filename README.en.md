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
- Keeps everything generic. There is no pre-written identity, no memory of any
  real person, no network calls.

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
  }
}
```

### B. Drop loose files next to the plugin

- `self.md` — the identity text
- `rules.md` / `rules.txt` — the rules text
- `about.md` / `about.txt` — what you know about the other person

The plugin absorbs these automatically at startup.

## Notes

- `mind.json` is created beside the plugin on first run. Delete it to reset
  the hormone state; the persona is untouched.
- This is an incubator skeleton, not a finished person. The engine is
  universal; the person comes from what you write.
