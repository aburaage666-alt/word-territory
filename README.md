# Word Territory

**Word Territory** is a territory-control word strategy game inspired by Go, crossword construction, and tactical board games.

Players create valid words on a growing letter board to claim territory, capture surrounded regions, lock stable cells, and swing the score through spatial strategy.

> Original game concept and rule system by **Keni Koyama**.
> LinkedIn: https://www.linkedin.com/in/kuni-koyama-6566b7105/

---

## Core idea

Word Territory is **not** only a vocabulary game. It is a spatial strategy game where words are used to:

- expand territory
- capture regions
- lock stable cells
- create threats
- trigger combo moves
- control board shape

---

## Features

- Human vs Bot (Normal / Strong)
- Daily Challenge — same board worldwide each day, with shareable result card
- Daily Leaderboard — post your score, see today's rankings
- 7-letter randomised safe opening with named variants (STONE OPENING, RIVER OPENING, …)
- Placed letter can appear anywhere in the word path (beginning, middle, or end)
- Seed Move rescue rule
- Real-time Move Preview
- Move History with combo labels
- Capture / lock / territory animations
- Mobile-responsive layout
- PWA-ready (Add to Home Screen)
- Premium waitlist

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 |
| Backend | FastAPI (Python 3.11+) |
| Word list | wordfreq + pyenchant (CC BY-SA 4.0 — see LICENSE) |

---

## Local setup

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API available at `http://localhost:8000`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

### Environment variable (required for hosted deployment)

The frontend uses:

```
NEXT_PUBLIC_API_BASE=http://localhost:8000   ← default (local dev only)
```

**For any hosted / production deployment you MUST set this** to your backend URL, otherwise the game UI will appear but all API calls (game creation, bot moves, Daily Challenge) will fail.

How to set it:

| Platform | How |
|---|---|
| Render | Dashboard → Environment → Add environment variable |
| Vercel | Settings → Environment Variables |
| Local `.env.local` | Create `frontend/.env.local` with `NEXT_PUBLIC_API_BASE=https://your-api-url` |

---

## Deployment on Render

### Backend (Web Service)

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |

Note the URL Render assigns (e.g. `https://word-territory-api.onrender.com`).

### Frontend (Web Service)

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Runtime | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Environment Variable | `NEXT_PUBLIC_API_BASE` = backend URL from above |

### Free plan note

Render's free plan sleeps after 15 minutes of inactivity. The **Daily Leaderboard stores scores in memory**, so a server restart clears today's scores. To prevent this:

- Option A: Upgrade to Render Starter ($7/month) — no sleep, persistent process
- Option B: Add SQLite persistence to `backend/main.py` (DAILY_SCORES stored to disk)

---

## Word list

`backend/words.txt` contains **11,161 curated English words** (3–6 letters).

Generated via `backend/generate_words.py` using:
- **wordfreq** (Robyn Speer et al.) for frequency filtering
- **pyenchant / en_US** for dictionary validation
- Manual BLACKLIST to remove profanity, slurs, and inappropriate content

See `LICENSE` for the full third-party data notice. `words.txt` is licensed under **CC BY-SA 4.0**, not MIT.

To regenerate the word list:

```bash
cd backend
pip install wordfreq pyenchant   # build-time only, not needed at runtime
python generate_words.py
```

---

## License

The **source code** is MIT Licensed. See `LICENSE`.

The **word list** (`backend/words.txt`) is CC BY-SA 4.0 due to its derivation from wordfreq.
See the THIRD-PARTY DATA NOTICE section in `LICENSE` for details.

```
Original game concept and rule system by Keni Koyama.
LinkedIn: https://www.linkedin.com/in/kuni-koyama-6566b7105/
```
