# site/

The Daily-Daily-Game website: today's game, archive, and a global leaderboard. No dependencies; Node 22+.

```
node site/server.mjs
```

Then open http://localhost:3000. Set `TODAY=2026-10-28` to pretend it's another day, and `PORT` to change the port.

## How it fits together

| File | What it is |
|---|---|
| `server.mjs` | Static files plus the API: `GET /api/days`, `GET /api/game/<date>.js`, `GET /api/leaderboard/<date>?player=<id>`, `POST /api/submit`. |
| `lib/replay.mjs` | Server-side replay. Re-runs the game in a `vm` sandbox from seed + input log and computes the score itself. |
| `lib/store.mjs` | Leaderboard storage, one JSON file per day in `site/data/` (gitignored). Best run per player. Swap for a real DB to deploy. |
| `games/index.json` | The schedule: date, file, title, type, theme, mechanic, model. A game only appears once its date (UTC) has arrived. |
| `games/*.js` | One game per day, same contract as `bakeoff/engine/engine-api.md`. |
| `public/engine.js` | Copy of `bakeoff/engine/engine.js`. Keep them identical; replay depends on it. |
| `public/seed.js` | Date to seed, and the 1-byte-per-frame input packing. Shared by browser and server. |
| `public/app.js`, `index.html`, `style.css` | The front end. Hash routes: `#/`, `#/play/<date>`, `#/leaderboard/<date>`, `#/archive`, `#/how`. |

## Leaderboard flow

1. Everyone gets the same seed for a given day (`seedFromDate`).
2. The game runs in a sandboxed iframe (no network) and records one byte of button state per frame.
3. On `finish()`, the page posts the input log. The server replays it and stores the server's result, never the client's.
4. Runs must reach `finish()` to count. Players are an anonymous id in localStorage plus a name (A-Z, 0-9, up to 10 chars).
