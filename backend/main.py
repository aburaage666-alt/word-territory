import json
import sqlite3
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── SQLite persistence ────────────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "data.db"

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS daily_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date_str TEXT NOT NULL,
                nickname TEXT NOT NULL,
                score REAL NOT NULL,
                won INTEGER NOT NULL,
                turns INTEGER NOT NULL,
                submitted_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS waitlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                submitted_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

init_db()

from datetime import datetime, timezone
from daily import date_to_day_number, date_to_opening_idx, get_today_utc
from engine import (
    apply_bot_move,
    apply_seed_move,
    apply_skip_draft,
    build_initial_state,
    find_candidate_words,
    pass_turn,
    preview_move,
    validate_and_apply_move,
)
from models import (
    CreateGameRequest,
    CreateGameResponse,
    DailyInfo,
    DailyLeaderboardResponse,
    DailyScoreSubmission,
    GameState,
    LeaderboardEntry,
    MoveRequest,
    PreviewMoveRequest,
    PreviewMoveResponse,
    SeedMoveRequest,
    SuggestionsResponse,
    WaitlistSubmission,
)

app = FastAPI(title="Word Territory API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://word-territory1.onrender.com",
        "http://localhost:3000",   # local dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GAMES: dict[str, GameState] = {}

# In-memory daily leaderboard. Resets on server restart.
# Production upgrade path: replace with SQLite or Redis.
DAILY_SCORES: dict[str, list[dict]] = {}


@app.post("/games", response_model=CreateGameResponse)
def create_game(payload: CreateGameRequest = CreateGameRequest()):
    game_id = str(uuid.uuid4())
    state = build_initial_state(bot_level=payload.botLevel)
    GAMES[game_id] = state
    return CreateGameResponse(game_id=game_id, state=state)


@app.post("/games/{game_id}/move", response_model=GameState)
def make_move(game_id: str, payload: MoveRequest):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        next_state = validate_and_apply_move(state, payload.row, payload.col, payload.letter, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    GAMES[game_id] = next_state
    return next_state


@app.post("/games/{game_id}/seed-move", response_model=GameState)
def seed_move(game_id: str, payload: SeedMoveRequest):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        next_state = apply_seed_move(state, payload.row, payload.col, payload.letter)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    GAMES[game_id] = next_state
    return next_state


@app.post("/games/{game_id}/preview-move", response_model=PreviewMoveResponse)
def preview(game_id: str, payload: PreviewMoveRequest):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    return preview_move(state, payload.row, payload.col, payload.letter, payload.path)


@app.post("/games/{game_id}/pass", response_model=GameState)
def do_pass(game_id: str):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    next_state = pass_turn(state)
    GAMES[game_id] = next_state
    return next_state


@app.get("/games/{game_id}/suggestions", response_model=SuggestionsResponse)
def get_suggestions(game_id: str):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    return SuggestionsResponse(suggestions=find_candidate_words(state))


@app.post("/games/{game_id}/bot-move", response_model=GameState)
def bot_move(game_id: str):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.currentPlayer != state.botPlayer:
        raise HTTPException(status_code=400, detail="It is not the bot's turn")

    # Run bot move in a thread with a hard 4-second timeout.
    # If the bot cannot decide in time, apply_seed_move is used as fallback
    # so the game never hangs on "Bot is thinking..."
    import concurrent.futures, random

    def run_bot():
        return apply_bot_move(state)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(run_bot)
            next_state = future.result(timeout=4)
    except concurrent.futures.TimeoutError:
        # Fallback: place a random letter on a legal cell (instant)
        board = state.board
        legal = [
            (r, c)
            for r in range(len(board))
            for c in range(len(board[r]))
            if not board[r][c].letter and any(
                board[r2][c2].letter
                for r2, c2 in [(r-1,c),(r+1,c),(r,c-1),(r,c+1)]
                if 0 <= r2 < len(board) and 0 <= c2 < len(board[r2])
            )
        ]
        if legal:
            row, col = random.choice(legal)
            import string
            letter = random.choice(string.ascii_uppercase)
            next_state = apply_seed_move(state, row, col, letter)
        else:
            next_state = pass_turn(state)

    GAMES[game_id] = next_state
    return next_state


# ── Health check (for UptimeRobot / monitoring — accepts GET and HEAD) ────────

@app.get("/health")
@app.head("/health")
def health():
    """Lightweight health check. Returns 200 OK for both GET and HEAD requests."""
    return {"status": "ok"}


# ── Daily Challenge ──────────────────────────────────────────────────────────

@app.get("/daily/today", response_model=DailyInfo)
def get_daily_info():
    """
    Return today's daily challenge metadata.
    Frontend uses this to display the day number and opening name
    before the player starts, and to block replaying if localStorage
    already has a result for this date.
    """
    date_str = get_today_utc()
    idx = date_to_opening_idx(date_str)
    # Build a throwaway state just to resolve the opening name
    probe = build_initial_state(bot_level="strong", opening_idx=idx)
    return DailyInfo(
        dateStr=date_str,
        dayNumber=date_to_day_number(date_str),
        openingName=probe.openingName,
    )


@app.post("/daily/games", response_model=CreateGameResponse)
def create_daily_game():
    """
    Create a new daily challenge game.
    Always uses Strong bot and today's deterministic opening.
    The client is responsible for enforcing one-play-per-day via localStorage.
    """
    date_str = get_today_utc()
    idx = date_to_opening_idx(date_str)
    game_id = str(uuid.uuid4())
    state = build_initial_state(bot_level="strong", opening_idx=idx)
    GAMES[game_id] = state
    return CreateGameResponse(game_id=game_id, state=state)


# ── Daily Leaderboard ────────────────────────────────────────────────────────

@app.post("/daily/scores")
def submit_daily_score(payload: DailyScoreSubmission):
    """
    Submit a player's daily score.
    Called once after the daily game ends.
    No auth — client enforces one-submission-per-day via localStorage.
    Production TODO: add IP-based rate limiting and persistence.
    """
    date_str = get_today_utc()
    raw = payload.nickname.strip()
    nickname = "".join(c for c in raw if c.isprintable() and c not in set("<>&\'\""))[:20] or "Anonymous"
    score = round(payload.redScore, 1)

    with get_db() as conn:
        conn.execute(
            "INSERT INTO daily_scores (date_str, nickname, score, won, turns) VALUES (?,?,?,?,?)",
            (date_str, nickname, score, int(payload.won), int(payload.turns))
        )
        conn.commit()
        rows = conn.execute(
            "SELECT score FROM daily_scores WHERE date_str=? ORDER BY score DESC",
            (date_str,)
        ).fetchall()

    total = len(rows)
    rank = next((i + 1 for i, r in enumerate(rows) if r["score"] <= score), total)
    return {"success": True, "rank": rank, "totalPlayers": total}


@app.get("/daily/leaderboard", response_model=DailyLeaderboardResponse)
def get_daily_leaderboard():
    """Return today's top-50 scores sorted by RED player score descending."""
    date_str = get_today_utc()
    idx = date_to_opening_idx(date_str)
    probe = build_initial_state(bot_level="strong", opening_idx=idx)

    with get_db() as conn:
        rows = conn.execute(
            "SELECT nickname, score, won, turns FROM daily_scores WHERE date_str=? ORDER BY score DESC LIMIT 50",
            (date_str,)
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) FROM daily_scores WHERE date_str=?", (date_str,)
        ).fetchone()[0]

    entries = [
        LeaderboardEntry(rank=i+1, nickname=r["nickname"], score=r["score"], won=bool(r["won"]), turns=r["turns"])
        for i, r in enumerate(rows)
    ]

    return DailyLeaderboardResponse(
        dateStr=date_str,
        dayNumber=date_to_day_number(date_str),
        openingName=probe.openingName,
        totalPlayers=total,
        entries=entries,
    )


# ── Skip Draft endpoint ─────────────────────────────────────────────────────

@app.post("/games/{game_id}/skip-draft", response_model=GameState)
def skip_draft(game_id: str):
    """Reroll the shared draft tiles. Costs -1 territory on next Capture."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    next_state = apply_skip_draft(state)
    GAMES[game_id] = next_state
    return next_state


# ── Premium Waitlist ③⑤ ──────────────────────────────────────────────────────

# In-memory waitlist. In production: write to a database or send to Mailchimp/ConvertKit.
# Waitlist stored in SQLite — see init_db() above


@app.post("/waitlist")
def join_waitlist(payload: WaitlistSubmission):
    """
    Collect email addresses for the Premium waitlist.

    Production TODO:
      1. Validate email with a proper library (email-validator).
      2. Persist to a database (SQLite → Postgres when scaling).
      3. Send confirmation email via Mailchimp / SendGrid / Resend.
      4. Add IP-based rate limiting (one submission per IP per day).
    """
    raw = payload.email.strip().lower()
    # Basic sanity check
    if "@" not in raw or len(raw) < 5 or len(raw) > 254:
        return {"success": False, "error": "Invalid email"}

    # Deduplicate in-memory
    try:
        with get_db() as conn:
            conn.execute("INSERT OR IGNORE INTO waitlist (email) VALUES (?)", (raw,))
            conn.commit()
            pos = conn.execute("SELECT COUNT(*) FROM waitlist WHERE email <= ?", (raw,)).fetchone()[0]
    except Exception:
        pos = 1

    return {"success": True, "position": pos}


@app.get("/waitlist/count")
def waitlist_count():
    """Return the number of waitlist signups (public, for social proof)."""
    return {"count": len(WAITLIST)}
