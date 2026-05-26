# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Canvas-Spreadsheet-WeOn is a collaborative spreadsheet application with real-time editing via WebSocket. It's a monorepo with frontend (React + Vite + TypeScript) and backend (Express + ws) in a single repository.

## Common Commands

Run from **repository root** (not in subdirectories):

```bash
pnpm install        # Install all dependencies
pnpm dev            # Start both frontend and backend concurrently
pnpm dev:fe         # Start only frontend
pnpm dev:be         # Start only backend
pnpm build          # Build frontend
pnpm lint           # Run ESLint on frontend
pnpm preview        # Preview built frontend
```

## Environment Requirements

- Node.js: 22.12.0 (see `.nvmrc`)
- pnpm: ≥10

## Services

| Service | Address | Notes |
|---------|---------|-------|
| Frontend | http://localhost:5173 | React + Vite dev server |
| Backend API | http://localhost:3000 | Express server |

Frontend uses Vite proxy to forward `/health`, `/docs`, `/ws` to backend—no CORS handling needed in dev.

## Architecture

### Repository Structure

```
frontend/              # React + Vite + TypeScript + Tailwind CSS + Redux Toolkit
  src/
    components/        # UI components (Menubar, Toolbar, FormulaBar, etc.)
    pages/             # Page components (SpreadsheetPage, SpreadsheetGrid)
    spreadsheet/model/ # Spreadsheet data types

backend-js/            # Express + WebSocket
  routes/              # HTTP routes (health.js, docs.js)
  ws/                  # WebSocket handling
    handlers/          # Message handlers (join, setCell, importSheet, presence)
    dispatcher.js      # Routes WebSocket messages to handlers
  store/               # In-memory state management
    memory/            # Memory stores for docs, room users, room sockets

docs/                  # Requirements and API specs (Chinese)
```

### Backend WebSocket Events

Four event types handled (defined in `docs/一期后端技术细节.md`):
- `join` - Join a document room, receive snapshot
- `set_cell` - Cell text modification
- `import_sheet` - Full sheet import/replace
- `presence` - Online user sync

Backend uses centralized room model with sequential `seq` for conflict resolution (last-write-wins by server order).

### Frontend Path Alias

`@` maps to `frontend/src`:
```ts
import { Menubar } from '@/components/Menubar/Menubar'
```

Configured in `frontend/vite.config.ts` and `frontend/tsconfig.app.json`.

## Code Style

- EditorConfig: UTF-8, LF, 2-space indent
- Prettier: no semicolons, single quotes, ES5 trailing commas, 100 char width
- ESLint: TypeScript + React Hooks + React Refresh rules
- Pre-commit hook runs lint-staged (Prettier + ESLint fix on frontend files)

## Important Notes

- Do NOT run `npm install` in subdirectories—use `pnpm install` from root
- Copy `.env.example` to `.env` in both `frontend/` and `backend-js/` before dev
- API changes must update `docs/一期后端技术细节.md` first (per `docs/开发指南.md`)
- Backend stores data in memory only (no database in phase 1)