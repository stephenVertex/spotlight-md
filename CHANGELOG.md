# Changelog

All notable changes to spotlight-md follow [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-08-16

- Added live suggested edits: an AI agent can propose a change with `suggest-edit --anchor --replacement`, and the reviewer approves or dismisses it in the browser (Google-Docs style). Approving splices the change into the markdown source; dismissing leaves it untouched. Suggestions appear inline on hover (no reflow) and as a diff card in the panel.
- Live updates now patch the page in place over SSE instead of doing a full reload, so scroll position, zoom, text selection, and applied highlights all survive a document change.
- The server now watches the highlight database, so annotations made out-of-process (an AI agent running the CLI) appear in the browser instantly without needing a document edit.
- Added `list-suggestions` for inspecting pending/resolved suggestions.

## 0.1.1 — 2026-08-10

- Added global SQLite-backed review sessions, agent read cursors, waitable updates, and close-session audit summaries.
- Added `spotlight-md prime` guidance for collaborative human/AI document review.
- Fixed Enter submission for a highlight's optional note.

