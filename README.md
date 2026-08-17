# spotlight-md

Version: **0.4.0**

Dark-themed markdown viewer with live reload, sidebar TOC, highlight annotations, live AI-suggested edits, whole-document AI messaging, and live "AI is working" indicators for AI-assisted document review.

## Install

`mdhtml` and `spotlight-md` are the same tool (symlinked). Put both on your PATH.

Requires [Node.js](https://nodejs.org/) 18+ and [pandoc](https://pandoc.org/).
Releases follow [Semantic Versioning](https://semver.org/); see [CHANGELOG.md](CHANGELOG.md).

## Quick start

```bash
# Serve a markdown file with live reload in your browser
spotlight-md --auto --json --theme dracula path/to/document.md

# Or write a static HTML file
spotlight-md -o output.html path/to/document.md
```

## Usage

```
spotlight-md file.md                Write file.html
spotlight-md --auto file.md         Serve, watch, and live-reload in browser
spotlight-md -o out.html file.md    Specify output path
spotlight-md --port 4040 --auto file.md
spotlight-md --no-open --auto file.md   Don't auto-open browser

spotlight-md list-highlights --session-id sp-… --json
spotlight-md get-new-comments --session-id sp-… --agent-id codex-… --wait --json
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
| `--auto`, `-a` | Start local server + watch for live reload |
| `--port`, `-p NUM` | Server port (default 7231) |
| `--output`, `-o PATH` | Output file path (default: `<input>.html`) |
| `--no-open` | Don't open browser automatically |
| `--theme`, `-t NAME` | Color scheme: `github-dark` (default) or `dracula` |
| `--new-session` | Start a fresh review session instead of resuming the document’s active session |
| `--json` | Emit stable machine-readable output |
| `prime` | Print instructions for AI agents on how to use this tool |

## Features

### Dark themes

Two built-in themes: **github-dark** (default) and **dracula**. Pass `--theme dracula` for the colorful dark palette.

### Sidebar TOC

A sticky left sidebar lists all headings (h1-h3) with scroll-spy highlighting that tracks your position in the document. Click any heading to jump to it.

### Frontmatter card

If the document begins with a metadata block of `**Label:** value` lines after the H1, they are rendered as a clean label/value card at the top of the page.

### Live reload

In `--auto` mode, the server watches the markdown file. When you (or an AI agent) save changes, the page updates **in place** via Server-Sent Events — no full reload — so your scroll position, zoom, text selection, and applied highlights all survive the update. The server also watches the highlight database, so comments and suggestions an AI agent makes via the CLI appear in the browser instantly.

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

No highlight data is written into the document’s repository. A static HTML render is still written next to the document when serving.
