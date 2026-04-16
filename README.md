# CodeScope

A desktop app that reviews your code using different AI providers. You paste code (or load a whole project folder), pick a provider, and get back a list of findings: bugs, security issues, performance problems, style suggestions. Each finding has a severity, a category, and a concrete suggestion for how to fix it.

![CI](https://github.com/riftzen-bit/codescope/actions/workflows/ci.yml/badge.svg)

## What it does

- **Code review** — Paste code or drag a file into the editor. Select an AI provider and hit Review. Findings appear on the right, color-coded by severity (critical, error, warning, info).
- **Project review** — Point it at a project folder. CodeScope reads the files recursively, skipping `node_modules` and other junk. You can review individual files or the whole project. A file watcher picks up changes automatically.
- **Multiple providers** — Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local models, no API key), and Claude Code CLI.
- **Encrypted key storage** — API keys are stored with Electron's safeStorage, backed by the OS keychain. Keys live outside the app directory so they survive uninstalls.
- **Review history** — Past reviews are saved locally (up to 50). You can revisit them or export as Markdown.
- **Score** — Each review gets a 0-100 score summarizing overall code quality.

## Supported platforms

| Platform | Format | Architecture |
|----------|--------|--------------|
| Windows  | NSIS installer | x64 |
| macOS    | DMG | x64, Apple Silicon |
| Linux    | AppImage | x64 |

## Requirements

- Node.js 20 or later
- pnpm 9 or later

## Getting started

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Package for your current OS
cd apps/desktop
pnpm package
```

The packaged output lands in `apps/desktop/release/`.

## Project structure

This is a monorepo managed with pnpm workspaces and Turborepo.

```
apps/desktop/          Electron app (main + renderer)
  electron/main/       Main process: IPC handlers, providers, settings, key storage
  src/                 React renderer: review UI, project browser, settings
  resources/           App icons (SVG source + generated PNGs)
packages/core/         Shared logic: review engine, prompt builder, response parser
scripts/               Icon generation script
```

## Configuration

Settings are stored outside the app directory so they persist across updates:

- **Windows:** `%APPDATA%\CodeScope\settings.json`
- **macOS:** `~/Library/Application Support/CodeScope/settings.json`
- **Linux:** `~/.config/codescope/settings.json`

API keys are in `secure-keys.json` in the same directory, encrypted at rest.

## Providers

| Provider | Requires |
|----------|----------|
| Anthropic | API key |
| OpenAI | API key |
| Google Gemini | API key |
| Ollama | Ollama running locally (no key) |
| Claude Code | Claude Code CLI installed |

Add keys through the Config tab in the app.

## Regenerating icons

The app icon is defined as an SVG at `apps/desktop/resources/icon.svg`. To regenerate the PNGs after editing it:

```bash
pnpm generate-icons
```

This produces `icon.png` (1024x1024) and `icon-256.png` (256x256) using pure Node.js — no image libraries needed. electron-builder converts the 1024x1024 PNG into `.ico` and `.icns` during packaging.

## License

MIT
