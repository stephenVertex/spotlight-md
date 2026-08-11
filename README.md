# spotlight-md

Dark-themed markdown viewer with live reload, sidebar TOC, and highlight annotations for AI-assisted document review.

## Install

`mdhtml` and `spotlight-md` are the same tool (symlinked). Put both on your PATH.

Requires [Node.js](https://nodejs.org/) 18+ and [pandoc](https://pandoc.org/).

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
spotlight-md ai-agent-mark-as-completed --session-id sp-… --highlight-id hl-… --comment "Completed"
spotlight-md close-session --session-id sp-…
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

In `--auto` mode, the server watches the markdown file. When you (or an AI agent) save changes, the browser reloads automatically via Server-Sent Events.

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
