# spotlight-md

Version: **0.6.2**

Dark-themed markdown viewer with live reload, LaTeX-style numbered sections, highlight annotations, live AI-suggested edits, whole-document AI messaging, and live "AI is working" indicators for AI-assisted document review.

## Install

`mdhtml` and `spotlight-md` are the same tool (symlinked). Put both on your PATH.

Requires [Node.js](https://nodejs.org/) 18+ and [pandoc](https://pandoc.org/).
Releases follow [Semantic Versioning](https://semver.org/); see [CHANGELOG.md](CHANGELOG.md).

## Quick start

```bash
# Optional: start the review service in the foreground and leave it running
spotlight-md serve

# Register a Markdown file with the persistent local review server
# (also starts the service automatically if it isn't already running)
spotlight-md --auto --json --theme dracula path/to/document.md

# Inspect or stop the server
spotlight-md status
spotlight-md stop

# Write a standalone static HTML file instead
spotlight-md -o output.html path/to/document.md
```

## Usage

```
spotlight-md file.md                Write file.html
spotlight-md serve [--port 4040]    Run the review service in the foreground
spotlight-md --auto file.md         Register, watch, and open in browser
spotlight-md -o out.html file.md    Specify output path
spotlight-md --port 4040 --auto file.md
spotlight-md --no-open --auto file.md   Don't auto-open browser
spotlight-md status [--port 4040]   Show server and registered documents
spotlight-md stop [--port 4040]     Stop the persistent server

spotlight-md list-highlights --session-id sp-… --json
spotlight-md get-new-comments --session-id sp-… --agent-id codex-… --wait [--timeout 290] --json
spotlight-md add-comment --session-id sp-… --highlight-id hl-… --agent-id codex-… --comment "Addressed it"
spotlight-md suggest-edit --session-id sp-… --highlight-id hl-… --anchor "old text" --replacement "new text" --comment "Rephrased"
spotlight-md list-suggestions --session-id sp-… --json
spotlight-md ai-agent-claim --session-id sp-… --highlight-id hl-… --agent-id codex-…
spotlight-md ai-agent-mark-as-completed --session-id sp-… --highlight-id hl-… --comment "Completed"
spotlight-md close-session --session-id sp-…
spotlight-md --version
```

## Options

| Option | Description |
|--------|-------------|
| `--auto`, `-a` | Launch/reuse the local server, register the document, and open its route |
| `--port`, `-p NUM` | Server port (default 7231) |
| `--output`, `-o PATH` | Static export path; cannot be combined with `--auto` |
| `--no-open` | Don't open browser automatically |
| `--theme`, `-t NAME` | Color scheme: `github-dark` (default) or `dracula` |
| `--new-session` | Start a fresh review session instead of resuming the document’s active session |
| `--json` | Emit stable machine-readable output |
| `prime` | Print instructions for AI agents on how to use this tool |

## Features

### Dark themes

Two built-in themes: **github-dark** (default) and **dracula**. Pass `--theme dracula` for the colorful dark palette.

### Sidebar TOC

A sticky left sidebar lists all headings (h1-h3) with scroll-spy highlighting that tracks your position in the document. Click any heading to jump to it. Sections are numbered LaTeX-style (each `##` is section N, each `###` is N.M) in both the document and the TOC, so you can refer to "section 2.1" — including in whole-document messages, where the agent receives the live numbered outline to resolve the reference.

On the shared `--auto` server, the sidebar also lists recently active registered documents. Each entry shows its filename and canonical path; selecting one opens its registered virtual route with that document's active review session and highlights. Registrations, document visits, source edits, and highlight activity move a document to the top of the list. Files that have not been registered with the running server are never included.

### Frontmatter card

If the document begins with a metadata block of `**Label:** value` lines after the H1, they are rendered as a clean label/value card at the top of the page.

### Live reload

In `--auto` mode, one persistent daemon watches every registered Markdown file. When you (or an AI agent) save a document, the page updates **in place** via that document's Server-Sent Events channel — no full reload — so your scroll position, zoom, text selection, and applied highlights all survive the update. The daemon also watches the highlight database, so comments and suggestions an AI agent makes via the CLI appear in the browser instantly.

### Persistent server and virtual routes

Run `spotlight-md serve` to start the daemon in the foreground and leave it running as a long-lived service (in a terminal, under `launchd`, etc.); it refuses to start a second copy on the same port, and `status`/`stop` manage it. You don't have to: `--auto` starts the daemon on `127.0.0.1:7231` when needed, reuses it on later invocations, registers the canonical document path, opens that document’s URL, and then exits. Starting the service yourself just means every `--auto` finds it already running and returns instantly. Each document gets an encoded virtual route such as `/spotlight/Users/example/project/review.html`; spaces, Unicode, `%`, `#`, and other special characters are safely percent-encoded. A registered document keeps its own review session, live-reload channel, and highlight/suggestion state.

Virtual routes are registry lookups, not filesystem path resolvers. A URL can read only a file previously registered by a local `--auto` invocation. Daemon registration and shutdown also require a random control token kept in the user-only configuration directory. Use `spotlight-md status` to see the daemon PID and registered documents, and `spotlight-md stop` to stop it cleanly. Pass the same `--port` to lifecycle commands when using a non-default port.

### Suggested edits

An AI agent can propose a change instead of editing the document directly:

```bash
spotlight-md suggest-edit --session-id sp-… --highlight-id hl-… \
  --anchor "the exact text to replace" \
  --replacement "the improved text" \
  --comment "Acknowledged — here is a simpler phrasing."
```

The suggestion appears live in the browser, Google-Docs style: the highlighted passage gains a dashed underline, and hovering it (or opening its panel card) reveals a before/after diff with **Approve** and **Dismiss** buttons. The hover preview floats over the text so nothing reflows. Approving splices the change into the markdown source and updates the page in place; dismissing leaves the document untouched. The conversation thread stays open the whole time, so the human and AI can keep talking about a passage while the AI proposes revisions.

### AI activity indicators

When an agent starts working on a highlight it "claims" it with `ai-agent-claim`, which pulses that exact passage **yellow** in the browser (and marks its panel card as *thinking*) so you can see, at a glance, what the AI is currently working on. The claim releases automatically when the agent replies, suggests an edit, or completes the highlight — and the passage briefly flashes **green** to signal a fresh response. This makes the back-and-forth legible: the AI loops through your highlights while you watch its progress in real time.

### Whole-document messages

A composer in the bottom-left (below the table of contents) lets you send the AI a message about the document as a whole — e.g. *"add a joke to the end of each section"* or *"add a paragraph about accessibility."* Unlike a highlight, it isn't tied to a passage: it flows to the agent as a document-scoped item, and the agent typically responds with one suggested edit per location, each of which you approve or dismiss independently.

### Persistent zoom

A small zoom control sits in the bottom-left corner. Zoom in or out with the buttons or with `Ctrl`/`Cmd` `+` / `-` / `0`. The level is remembered in `localStorage` and reapplied on every load, so a hard refresh keeps your zoom instead of snapping back to 100%.

### Highlights

Select any text in the browser to create a highlight. A `Highlight` popup appears above your selection — click it to save. Highlights, sessions, comments, and agent cursors are stored in the global WAL-mode database at `~/.config/spotlight-md/global-highlights-db.db`, never beside or inside the Markdown document.

- **Create**: Select text in the browser, type an optional note, then click the popup or press Enter.
- **Delete**: Click a highlighted passage in the document, then click Delete.
- **Notes**: Click a highlight card in the right panel to add or edit a note.
- **Browse**: The right panel shows all highlights with text preview, ID, section, and notes. Click a card to scroll to that highlight.

### AI agent review cycle

`spotlight-md prime` prints instructions for AI agents. The intended workflow:

1. The AI edits the markdown document.
2. The human reads it in their browser and highlights passages that need attention, optionally adding notes.
3. The human tells the AI to check highlights.
4. The AI blocks on `get-new-comments --wait`, fixes the issues in the markdown, replies, and marks its cursor read.
5. The browser auto-reloads so the human sees the changes.

Highlights include the exact passage text, the nearest section heading, and any note the human attached — giving the AI enough context to locate and fix each issue.

## Sessions and auditability

`--auto` resumes the active session for its canonical document path and prints its ID. Use `--new-session` to begin a new review round. `close-session` freezes the review and emits a Markdown audit summary with document changes and the full highlight/message trail. Use `reopen-session` only when you intentionally want to continue a closed review.

No highlight data or rendered HTML is written into the document’s repository in auto mode. Use `-o` without `--auto` when you want a standalone static HTML export.
