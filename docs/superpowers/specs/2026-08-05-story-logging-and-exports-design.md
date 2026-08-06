# Story Logging & Export Feature Design

**Date:** 2026-08-05  
**Feature:** Exportable logs of guided questions/answers + complete story view with editable content

---

## Overview

Three interconnected features for better story review and debugging:

1. **Automatic Passive Logging** — Every guided Q&A session is logged with full metadata (timestamps, model, generation time)
2. **Export Panel** — Four export methods: download debug log (JSON), copy debug log, download story Q&A (Markdown/plain text selectable), copy story Q&A
3. **Story View Panel** — Read-only side panel showing the complete story in reading order, with in-place editing capability

---

## Data Model & Storage

### Logging Structure

Logs are stored persistently in `~/Documents/HeroJourneyStories/logs/` alongside the story JSON. Each story gets its own log file named `story_[ISO_timestamp].json`.

**Log File Format:**
```json
{
  "story_title": "Untitled Story",
  "story_key": "story_2026-08-05T14-30-00Z",
  "created_at": "2026-08-05T14:30:00Z",
  "sessions": [
    {
      "stage_key": "ordinary_world",
      "stage_title": "1. Ordinary World",
      "session_id": "session_20260805_143000_001",
      "started_at": "2026-08-05T14:30:00Z",
      "completed_at": "2026-08-05T14:35:45Z",
      "model": "mimo-v2.5",
      "generation_times_ms": {
        "questions": 1200,
        "weave": 3400
      },
      "questions": [
        "Who is your hero before anything changes?",
        "What does their typical day look like?",
        "What are they missing?"
      ],
      "q_and_a": [
        {
          "question": "Who is your hero before anything changes?",
          "answer": "A cartographer named Elena...",
          "answered_at": "2026-08-05T14:32:10Z"
        },
        {
          "question": "What does their typical day look like?",
          "answer": "She wakes at dawn...",
          "answered_at": "2026-08-05T14:33:45Z"
        }
      ],
      "final_woven_content": "Elena is a cartographer who... [full woven narrative]"
    }
  ]
}
```

### In-Memory Log Tracking

During the session, the frontend maintains `window.storyLogs` object tracking all Q&A sessions. This is populated as users work through guided questions and allows exports without a round-trip to the server.

---

## Feature 1: Automatic Logging

**When it happens:**
- Every time a user completes a guided Q&A session for a stage (answers all questions + weaves final content)
- Logging is passive — zero UI overhead, just happens automatically

**What gets captured:**
- Timestamp (session start, each answer, completion)
- Model name used
- Generation times (questions generated, weave completed)
- All questions asked
- All Q&A pairs with timestamps
- Final woven narrative content

**Backend responsibility:**
- `/api/ai/questions/<key>` — return questions + session_id (generated server-side)
- `/api/ai/weave/<key>` — accept session_id + q_and_a, return woven content
- New: `/api/story/logs/<story_id>` — GET to fetch all logs for current story (if persistent storage is needed in the future)

**Frontend responsibility:**
- Create session_id when questions are generated
- Track timestamps for each answer
- Capture model name from the form
- Call weave endpoint with complete q_and_a list
- Store successful session in `window.storyLogs[stage_key]`

---

## Feature 2: Export Panel

**Trigger:**
- New "⤓ Export" button in top-right header (or in Story View, TBD placement)
- Opens a small export menu with four options

**Export Options:**

### Debug Log Export (JSON)
- **Format:** JSON (prettified, valid for import/re-import if needed)
- **Content:** Full session metadata as defined above
- **Buttons:** "Download" + "Copy to Clipboard"
- **Filename:** `story_[title]_debug_[YYYY-MM-DD_HH-MM-SS].json`

### Story Q&A Export (Markdown or Plain Text)
- **Format:** User selects Markdown or Plain Text on first click (radio buttons in menu)
- **Content per stage:**
  ```markdown
  ## 1. Ordinary World
  
  **Q:** Who is your hero before anything changes?  
  **A:** A cartographer named Elena who has mapped the known world...
  
  **Q:** What does their typical day look like?  
  **A:** She wakes at dawn and spends hours in her tower...
  ```
- **Buttons:** "Download" + "Copy to Clipboard"
- **Filename:** `story_[title]_q-and-a_[YYYY-MM-DD_HH-MM-SS].[md|txt]`

---

## Feature 3: Story View Panel

**Trigger:**
- New "📖 View Story" button in top-right header
- Slides in from the right as an overlay panel (dims the grid behind it)

**Content & Behavior:**

### Display
- All 12 stages shown in reading order (1 → 12)
- Stage title + final woven content for each
- Stages are scrollable within the panel

### Editing
- Content is editable in-place (like the existing grid, but in the side panel)
- Edits auto-save to story.json (same as grid editing)
- Escape key closes the panel (or explicit close button)

### UI Layout
- Panel width: ~50% of viewport (responsive, narrower on mobile)
- Dark overlay behind grid dims to ~0.3 opacity
- Close button (X) in top-right of panel
- Optional: "View Mode" toggle (read-only vs. edit) to prevent accidental changes

---

## Implementation Boundaries

**What's in scope:**
- Logging infrastructure (session tracking, timestamp capture, metadata collection)
- Export panel UI + download/copy-to-clipboard functionality
- Story View side panel with editable content
- Persistent log file storage (optional for MVP, but design supports it)

**What's NOT in scope:**
- Syncing logs across devices
- Deleting/archiving old logs
- Importing logs or replaying Q&A sessions
- Multi-story management (currently single story.json)

---

## Success Criteria

- ✅ Every Q&A session is logged with all metadata (no manual action required)
- ✅ User can export debug logs as JSON (download + copy)
- ✅ User can export story Q&A as Markdown or plain text (download + copy)
- ✅ User can view complete story in side panel and edit content
- ✅ Logs persist across browser sessions
- ✅ All exports are properly formatted and human-readable

---

## Dependencies & Integrations

**Frontend changes:**
- `app.js`: logging infrastructure, export panel, story view panel
- `style.css`: side panel layout, overlay, export menu styling

**Backend changes:**
- `app.py`: optional new `/api/story/logs/` endpoint for future persistence
- No changes to existing `/api/ai/` endpoints (backward compatible)

**Browser APIs:**
- `localStorage` for session persistence (or in-memory if sufficient)
- Clipboard API for "copy to clipboard"
- Blob/File API for downloads

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Logs grow large over many sessions | Compress old logs, document file size expectations |
| User accidentally edits story in side panel | Optional read-only toggle, undo via browser back |
| Export format changes break existing workflows | Version the export format, document schema |
| Performance: tracking logs on every Q&A | Keep logs in-memory during session, persist asynchronously |

---

## Questions for Implementation

1. Should logs persist to the server/file system immediately, or only on explicit export/save?
2. Is localStorage sufficient for log storage, or should we write to `~/Documents/HeroJourneyStories/logs/`?
3. Should the Story View panel be read-only with a separate edit toggle, or editable by default?
4. Where exactly in the header should the "View Story" and "Export" buttons go?
