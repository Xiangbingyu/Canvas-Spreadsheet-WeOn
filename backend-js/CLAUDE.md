# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start (in-memory, no .env loaded)
npm start

# Dev with file watching (no .env)
npm run dev

# Start with MySQL + Redis via .env
node --env-file=.env server.js

# Dev with .env
node --env-file=.env --watch server.js

# Tests (no .env — memory drivers)
npm test
npm run test:ws

# Tests requiring Redis/MySQL (.env loaded)
npm run test:cache-redis
npm run test:multi-instance

# DB scripts (require .env)
npm run db:seed
npm run db:reset

# Black-box API validation (PowerShell)
powershell -ExecutionPolicy Bypass -File .\scripts\check-docs-api.ps1 -BaseUrl http://127.0.0.1:3000
powershell -ExecutionPolicy Bypass -File .\scripts\check-ws-api.ps1 -BaseUrl http://127.0.0.1:3000 -WsUrl ws://127.0.0.1:3000
```

Node 22.12.0 required. No build step — plain JavaScript.

## Architecture

Collaborative spreadsheet backend. Express 4 for HTTP, `ws` for WebSocket real-time collaboration, MySQL2 for persistence, Redis for caching/pub-sub/distributed state.

**Critical rule**: `.env` is **never auto-loaded**. It only takes effect when the process is started with `--env-file=.env`. Without it, all drivers default to in-memory.

### Pluggable infrastructure drivers

Every infrastructure layer selects its implementation via env vars:

| Env var | Options | Default |
|---|---|---|
| `STORE_DRIVER` | `memory` / `mysql` | `memory` |
| `CACHE_DRIVER` | `memory` / `redis` | `memory` |
| `RUNTIME_STATE_DRIVER` | `memory` / `redis` | `memory` |
| `COLLAB_BROADCAST_DRIVER` | `memory` / `redis` | `memory` |
| `IDEMPOTENCY_DRIVER` | `memory` / `redis` | `memory` |
| `DOC_LOCK_DRIVER` | `memory` / `redis` | `memory` |

Each layer has parallel implementations under `store/memory/`, `store/mysql/`, `store/redis/`, `cache/`, `infra/redis/`, `idempotency/`.

### Request flow

```
HTTP: app.js → routes/ → service/ → store/ + cache/
WS:   ws/index.js → ws/dispatcher.js → ws/handlers/<type>.js → service/ → store/
```

### Key layers

- **`service/`** — business logic: `cellService`, `cellOtService` (OT conflict resolution), `undoRedoService`, `roomService`, `joinService`, `importService`, `collabBroadcastService`
- **`store/`** — persistence abstractions: `docStore`, `historyStore`, `roomSocketStore`, `roomUserStore`, `userOpStateStore`, `auditLogStore`
- **`domain/entities/`** — `doc`, `history`, `roomSocket`, `roomUser`, `userOpState`, `auditLog`
- **`protocol/`** — `messageTypes.js`, `errorCodes.js`, `responseSchema.js`, `validators.js` — single source of truth for WS message contracts
- **`security/`** — `httpGuard.js`, `wsGuard.js`, `rateLimit.js`, `messageWhitelist.js`

### Multi-instance

Multiple server instances share state via Redis pub/sub (`infra/redis/pubsub.js`) and Redis-backed stores. Each instance needs a unique `PORT` and `SERVER_ID`.
