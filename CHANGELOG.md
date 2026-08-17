# Changelog

All notable changes to spotlight-md follow [Semantic Versioning](https://semver.org/).

## 0.6.1 — 2026-08-17

- Merged the two development lines into one build: the persistent multi-document daemon (virtual routes, `status`/`stop`, recent-documents sidebar, first-run guide) now serves the full review toolkit (suggested edits, whole-document composer, AI-working pulses, zoom, LaTeX section numbering, `currentToc`). Each registered document gets its own review session, live-reload channel, and highlight/suggestion state.
- The daemon watches the highlight database, so CLI-driven changes appear live in every open document; file changes patch the page in place (no full reload).

## 0.5.0 — 2026-08-17

- Added LaTeX-style section numbering (display only) to headings and the table of contents: each `##` is section N, each `###` is N.M, so passages are easy to refer to (e.g. "section 2.1").
- Whole-document directives now carry a live `currentToc` field (the numbered outline) in the agent payload, so an agent can resolve "section 2.1" references without counting headings.
- The "AI is working" state now pulses: a claimed highlight's panel card pulses, and a claimed whole-document message pulses the composer (with a "· working…" label), since it has no in-text passage to highlight.
- Clicking a panel card scrolls to its passage and flashes it. Side columns now scroll independently under zoom.

## 0.4.0 — 2026-08-17

- Added a whole-document composer in the bottom-left (below the TOC): type a message to the AI about the document as a whole (e.g. "add a joke to the end of each section"). It becomes a document-scoped item that flows through the same agent loop; the agent typically responds with one suggestion per location, each independently approvable inline. New `POST /__directives__` endpoint and `dm-`-prefixed document-scoped highlights.
- Fixed selection/suggestion popups landing far from the passage under app zoom (fixed-position elements are scaled by the root `zoom`); popups now divide viewport coordinates by the zoom factor.
- Serialized the browser's annotation renders so a burst of updates can't interleave and drop marks.
- `prime` now documents whole-document directives and corrects the anchor guidance (matching is whitespace/wrap-tolerant; the highlight's own text is the best anchor). Removed a dead second prime block describing a long-removed workflow.

## 0.3.0 — 2026-08-16

- Added a persistent zoom control: zoom in/out (buttons or Ctrl/Cmd +/−/0) is remembered in `localStorage` and reapplied on every load, so a hard refresh keeps your zoom.
- Added live "AI is working" indicators. An agent claims a highlight with `ai-agent-claim` while it works, pulsing that exact passage yellow (and marking its panel card). The claim releases automatically when the agent replies, suggests an edit, or completes it, flashing the passage green. Release manually with `--release`.
- Fixed the note popup clearing the selected passage: the selection is now held with a temporary marker until the highlight is saved or dismissed.
- Fixed suggestion anchors failing to apply when the markdown source was hard-wrapped across lines; failed approvals now surface a message instead of silently doing nothing.

## 0.2.0 — 2026-08-16

- Added live suggested edits: an AI agent can propose a change with `suggest-edit --anchor --replacement`, and the reviewer approves or dismisses it in the browser (Google-Docs style). Approving splices the change into the markdown source; dismissing leaves it untouched. Suggestions appear inline on hover (no reflow) and as a diff card in the panel.
- Live updates now patch the page in place over SSE instead of doing a full reload, so scroll position, zoom, text selection, and applied highlights all survive a document change.
- The server now watches the highlight database, so annotations made out-of-process (an AI agent running the CLI) appear in the browser instantly without needing a document edit.
- Added `list-suggestions` for inspecting pending/resolved suggestions.

## 0.2.0-daemon — 2026-08-11 (parallel line, merged in 0.6.1)

- Replaced per-document foreground servers with one reusable local daemon on port 7231.
- Added registered-only, safely encoded virtual document routes with isolated live reload and highlight APIs.
- Added `status` and `stop` lifecycle commands.
- Stopped writing neighboring HTML files in auto mode; `-o` remains available for static exports.

## 0.1.1 — 2026-08-10

- Added global SQLite-backed review sessions, agent read cursors, waitable updates, and close-session audit summaries.
- Added `spotlight-md prime` guidance for collaborative human/AI document review.
- Fixed Enter submission for a highlight's optional note.
