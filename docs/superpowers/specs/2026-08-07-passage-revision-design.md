# Passage revision — Design

## Goal

Stop the guided flow from destroying a session when the generated passage
isn't right. Today `Reject` sets `guidedState = null`, discarding every
question, every answer the user typed, and the passage itself, with no log
entry (only `Accept` calls `logGuidedSession`). The user's answers are the
expensive part of the session and there is currently no way to keep them.

Replace rejection-as-deletion with two recoverable paths — revise with
feedback, or edit by hand — and make in-flight session state survive a
refresh.

## Scope

Client-side only, static build: `static/app.js`, `static/js/ai-client.js`,
`static/js/story-store.js`, and the preview styles in `static/`. No
provider, Worker, or Flask changes.

## UX

The preview replaces `Accept` / `Reject` with three actions plus a version
stepper:

```
┌─ Passage ──────────────────────┐
│ She stepped through the door... │
└────────────────────────────────┘
        ‹ v2 of 3 ›
 [Accept] [Revise…] [Edit myself]
```

- **Accept** — accepts the version currently displayed (not necessarily the
  newest) and writes it to the stage, as today.
- **Revise…** — opens a feedback textarea ("What should change?") with a
  Regenerate button. Produces a new version.
- **Edit myself** — turns the passage into an editable textarea with
  Save / Cancel. Saving stores a new version, so hand-edits are undoable
  too.
- **Version stepper** — only rendered when more than one version exists.
  Steps between attempts.

**There is no discard button.** Abandoning the session is closing the tile
(Escape), which already clears `guidedState`. A button whose only function
is deleting the user's work is what this design removes.

## State

`guidedState` gains:

```js
versions: [{ text, source, feedback }]   // source: "generated" | "revised" | "manual"
versionIdx: 0
```

`guidedState.suggestion` becomes derived — `versions[versionIdx]?.text` —
so the existing render branch (`else if (guidedState.suggestion)`) and the
Accept handler keep working with minimal change. The first weave pushes
`{text, source: "generated", feedback: null}`; each revision or manual save
appends and moves `versionIdx` to the new entry.

## The revise call

New `AIClient.reviseAnswers(stagePrompt, storySoFar, qAndA, previousText, feedback)`
in `ai-client.js`, alongside `weaveAnswers` and calling the same `callChat`.
It therefore inherits provider dispatch, the Anthropic thinking-block
handling, and error normalization with no additional work — and needs no
Worker change.

System prompt is the existing weave prompt plus a revision clause: the
model previously wrote this passage, the user wants specific changes, apply
the feedback while preserving what works, output only the revised narrative
with no commentary. Age guidance prepends as it does for the other two
calls.

Returns prose, not JSON, so it does not touch the question-list parsing
path.

Failures surface the same way `doWeave` already handles them
(`guidedState.error` + Retry) and leave the existing versions intact — a
failed revision must never cost the user a good draft.

## Persistence

In-flight guided state currently lives only in memory, so a refresh or
crash mid-session loses the answers regardless of what the buttons do.

- Checkpoint `guidedState` to `localStorage` under a new `hj_guided_state`
  key (joining the existing `hj_story`, `hj_story_logs`, `hj_settings`, and
  `hj_theme`) whenever answers or versions change; restore on load and
  resume the stage in progress.
- Checkpointing is best-effort: a write failure (quota, private mode) must
  be caught and ignored rather than breaking the flow.

## Logging

`logGuidedSession` already fires on Accept. It gains a `versions` array —
each entry with its `source` and `feedback` — so the exported Q&A log shows
how a passage evolved, not only the final text. The accepted version is
identified explicitly rather than assumed to be the last one, since Accept
can take an earlier version.

## Testing

No JS test runner in this repo, consistent with prior work here. Verify
manually against a local static server:

- Revise with feedback produces a changed passage and a `‹ v2 of 2 ›`
  stepper; the original remains reachable.
- Stepping back to v1 and hitting Accept writes v1's text to the stage.
- Edit myself → Save creates a version; Cancel leaves versions untouched.
- A failed revision (invalid key) shows an error and preserves existing
  versions.
- Refresh mid-session restores answers and versions.
- Exported log contains the version history and marks which was accepted.

Exercise at least one revise round-trip on a real provider — the
multi-provider work shipped with four bugs that only a live call caught.

## Out of scope

- Editing Q&A answers after they're submitted (passage-level revision only).
- Regenerating from scratch instead of revising (revision always sees the
  previous passage).
- Any change to providers, the Worker, or the Flask app.
- Per-version diffing or side-by-side comparison.
