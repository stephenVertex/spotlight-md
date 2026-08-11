# Changelog

All notable changes to spotlight-md follow [Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-08-11

- Replaced per-document foreground servers with one reusable local daemon on port 7231.
- Added registered-only, safely encoded virtual document routes with isolated live reload and highlight APIs.
- Added `status` and `stop` lifecycle commands.
- Stopped writing neighboring HTML files in auto mode; `-o` remains available for static exports.

## 0.1.1 — 2026-08-10

- Added global SQLite-backed review sessions, agent read cursors, waitable updates, and close-session audit summaries.
- Added `spotlight-md prime` guidance for collaborative human/AI document review.
- Fixed Enter submission for a highlight's optional note.
