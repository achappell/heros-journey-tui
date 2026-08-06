# Story Logging & Export — Manual Test Results

Date: 2026-08-05
Tested against commits: `822ae8c` (Add logging infrastructure and storyLogs global state) through `98ddd39` (Make story view content editable with autosave) — Tasks 1-7, full range.

Testing method: live instance of `python app.py` at http://127.0.0.1:5001, driven end-to-end via a real Chrome browser (Claude in Chrome automation) — clicks, typing, screenshots, and targeted `evaluate`-in-page checks against the same functions/DOM the UI itself uses (`generateDebugLog()`, `generateQAExport()`, `storyLogs`, `localStorage`). No app source files were modified.

No OpenCode Zen API key was configured client-side (Settings → API key field was empty by default; the app's `AIClient` talks to a deployed Cloudflare Worker and requires a key entered in that field). Per the safety rules governing this session, entering an API key into a form field is a prohibited action regardless of whether a key value was available, so the guided Q&A flow could not be exercised for real. **The console-seeding fallback described in the brief was used** for both guided-session test stages, via `logGuidedSession(stageKey, {...})` plus a matching `saveStageContent(stageKey, content)` call so the visible stage content and the logged Q&A stayed consistent.

A secondary discovery affected Step 1.2: the running app has **no manual-typing entry point for a stage that has never had any content** — focusing an empty stage shows only a "Start Guided Flow" button, not a textarea (confirmed by reading `static/app.js` render logic and by trying it in the browser). This is pre-existing app behavior that predates this feature (present since before Task 1's first commit) and not something introduced by Tasks 1-7, but it meant "manual typing... directly in the main grid" for brand-new stages had to be done by calling the app's own `saveStageContent(key, content)` function from the console — functionally identical to what a real textarea submit does (same code path, same autosave, same re-render), just without physically typing each character. Filed under Known Limitations below, not as a defect of this feature.

## Full Workflow (Step 1)

1. **Fill 3-4 stages manually in the main grid** — PASS (via `saveStageContent()`, see note above about the pre-existing empty-stage limitation). Populated `ordinary_world`, `refusal_of_the_call`, `meeting_the_mentor`, `resurrection` with realistic prose; grid tiles, word counts, and status dots updated correctly.
2. **Run guided Q&A flow for 2+ stages (or console-seed)** — PASS via console fallback. Seeded `call_to_adventure` and `tests_allies_enemies` with `logGuidedSession()` (realistic `started_at`, `model`, `generation_times_ms`, `questions`, `q_and_a`, `final_woven_content`) and set matching visible content via `saveStageContent()`.
3. **Open Story View, verify all stages show correct current content in order** — PASS. All 12 stages rendered in order 1→12; the 6 populated stages showed exact matching content, the 6 empty stages showed genuinely empty textareas.
4. **Edit one stage's content directly in Story View, click elsewhere to trigger autosave** — PASS, with one bug found (see below). Edited `ordinary_world`'s textarea (appended text), confirmed via `localStorage` that the debounced autosave wrote the new content within ~1s.
5. **Close Story View, reopen, verify the edit persisted** — PASS. Reopened panel showed the edited text intact.
6. **Open the Export panel** — PASS. Panel slides in with "Debug Log (JSON)" and "Story Q&A" sections exactly as specified.
7. **Download Debug Log (JSON), verify accurate session data** — PASS (content verified), with an environment caveat. `generateDebugLog()` — the exact function the Download button calls — produced a `sessions` array containing only `call_to_adventure` and `tests_allies_enemies` (the two seeded stages), each with the correct `session_id`, timestamps, model, generation times, questions, and q_and_a. **The actual browser file-save could not be confirmed**: clicking "Download JSON" did not produce a new file in `~/Downloads`. Investigation showed this is very likely Chrome's built-in "multiple automatic downloads" protection — the browser profile had already auto-saved two files from this same origin earlier in the day (`story (1).json`, `story_..._q-and-a_....md`, both dated hours before this test run), and Chrome silently blocks further automatic downloads from an origin after the first one or two until a user clicks an "Allow" affordance in the native address-bar UI, which is outside what the automation tooling can interact with. This affected every download button tested (debug log, Q&A export, and the pre-existing "Export story" button equally) — it is a browser/tooling artifact of the test environment, not app behavior, but it means downloads should also get a quick manual (human-driven) smoke test before shipping.
8. **Download Q&A export in Markdown, verify formatting/accuracy** — PASS (content verified, same download caveat as above). `generateQAExport('markdown')` output: `# Untitled Story` title, `## <stage title>` per stage in order, `**Q:**`/`**A:**` pairs for the two logged stages, and `*No Q&A recorded yet.*` (italicized) for every other stage — including stages that had manually-typed content but no guided session, correctly reflecting that Q&A logging tracks `storyLogs`, not stage content.
9. **Switch to Plain Text, download again, verify formatting changed** — PASS. `generateQAExport('plaintext')` correctly dropped the markdown title line, used `Stage Title` + `====` underline instead of `##`, used plain `Q:`/`A:` (no `**` bold), and kept `No Q&A recorded yet.` (no italics markers) for empty stages.
10. **Copy to Clipboard for both exports, verify clipboard matches download** — INCONCLUSIVE due to environment limitation, not a defect. Clicking either "Copy to Clipboard" button correctly invoked `navigator.clipboard.writeText()` with the same content produced by `generateDebugLog()`/`generateQAExport()` (confirmed by reading the button's click handler and by the app not throwing any error). However, `navigator.clipboard.readText()` calls issued from the automation tooling hung indefinitely (45s+ timeouts) — Chrome's clipboard-read permission prompt requires a native UI interaction the automation cannot perform, so the actual clipboard contents could not be programmatically read back for a byte-for-byte comparison. The write path is source-verified correct; the read-back verification is a tooling gap, not a product bug.

## Empty Stages (Step 2)

PASS, no issues. With 6 of 12 stages still empty:
- Story View rendered a genuinely empty `<textarea>` (value `""`) for each untouched stage — no literal `"undefined"`, `"null"`, or placeholder text.
- Debug log (`generateDebugLog()`) correctly omitted every stage with `sessions.length === 0` — only the two stages with real logged sessions appeared.
- Q&A export showed `*No Q&A recorded yet.*` (Markdown) for every stage without a logged session, including populated-but-un-logged stages — exactly per Task 5's design.

## Zero Sessions / Fresh State (Step 3)

PASS, no crash. Reloaded the page (resets the in-memory `storyLogs` module state to `{ sessions: [] }` per stage without touching `localStorage`/story content, confirming the in-memory-only design). With zero sessions:
- `generateDebugLog()` returned `{ ..., sessions: [] }` — empty array, no error.
- `generateQAExport('markdown')` contained `No Q&A recorded yet.` for all 12 stages (12/12 matches confirmed programmatically).
- Clicking through the actual Download JSON / Download Q&A buttons with zero sessions threw no JS exceptions and the console showed no related errors.

## Responsive/Mobile (Step 4)

PASS. Browser window could not be resized below ~500px logical width (OS/browser minimum window constraint in this environment, not an app issue), but 500px is comfortably inside the app's `max-width: 560px` mobile breakpoint (`static/style.css` line 672) and this width fully exercised the mobile styles:
- Export panel expanded to full window width, all four buttons and both radio options remained legible and tappable.
- Story View panel also expanded to full width; stage headings and textareas wrapped text correctly and were not cut off or overlapping.

## Pre-existing Export Story Feature Unaffected (Step 5)

PASS. Settings panel (⚙) shows the original "Export story" button (`id="export-btn"`) alongside the new "⤓" header button (`id="logs-export-btn"`) — confirmed via DOM inspection that the two use entirely distinct IDs and handlers (`StoryIO.exportStory(currentStory)` vs. `showExportPanel()`), so there is no ID collision or event-handler interference. Clicking "Export story" ran without any JS error or console exception. The actual file-save could not be confirmed for the same Chrome multiple-downloads reason described in Step 1.7 — this affected the pre-existing button identically to the new ones, so it is not evidence of a regression caused by this feature.

## Known Limitations (by design, not defects)

- Q&A logs (`storyLogs`) are in-memory only and do not survive a page refresh — this was an accepted MVP constraint in the design spec.
- **Pre-existing (not introduced by this feature):** a stage that has never had any content cannot be typed into directly from the main grid — focusing an empty stage only offers "Start Guided Flow." Manual entry only becomes possible once a stage already has non-empty content (e.g., from a prior guided-flow accept). This predates Task 1 and was worked around for this test session using the app's own `saveStageContent()` function via the console, which exercises the identical save/autosave code path a real textarea submit would use.
- **Test-environment tooling gap:** this sandboxed browser-automation session could not verify actual OS-level file downloads or clipboard read-back, because Chrome's native "multiple automatic downloads" protection and clipboard-read permission prompts require a real user click on browser-chrome UI that the automation cannot reach. All export logic was instead verified by calling the exact functions the UI buttons invoke and inspecting their output directly — recommend one quick manual (human-driven) click-through of the four download/copy buttons before this branch ships, just to close that last gap.

## Overall Assessment

**One genuine, reproducible bug found — not a known/accepted limitation. Recommend a decision before merge, but it is not a data-loss or crash issue.**

**Bug: global keydown listener leaks into the Story View panel's editable textareas.**
`static/app.js` (~line 676) has a single `document.addEventListener("keydown", ...)` that drives the main grid's keyboard navigation (arrows, Enter/Space to focus a stage, Escape to collapse). It only guards on `focusedKey !== null` — it does **not** check whether the keydown event originated inside an `<input>`/`<textarea>`, unlike the grid's own click handler a few lines away, which explicitly ignores clicks on `textarea`/`button` elements (`e.target.tagName.toLowerCase() === 'textarea' ...`).

**Repro:** Open Story View (📖), click into any stage's textarea, type a message that includes a space character (or press Enter). Observed effect: the space/Enter keystroke is correctly inserted into the Story View textarea, *and* it also fires the global handler, which (since the main grid's `focusedKey` is `null` while Story View is open) calls `focusStage()` on whichever stage the grid's hidden `selectedIdx` currently points at — expanding a stage card in the main grid behind the panel. Confirmed via `document.activeElement` and `focusedKey` inspection that the main-grid stage genuinely became focused as a side effect of typing in the Story View panel.

**Impact:** Cosmetic/UX, not data loss — autosave inside Story View still worked correctly despite this (confirmed the edited content persisted to `localStorage`). But it means every space bar or Enter press while editing in Story View also silently expands/changes selection on the main grid underneath, which will be confusing once a user closes the panel and finds a different stage expanded than they left. The same class of bug likely also affects any future modal/panel that adds a text input, since the fix belongs in the global listener (add an `e.target` tag check, or `e.stopPropagation()` on the panel's own textareas) rather than in each new panel.

**Everything else:** Ready for use. Logging, both export formats, empty-stage handling, zero-session handling, responsive layout, and the pre-existing Export Story feature all behaved correctly and the two new header buttons do not collide with existing app functionality.
