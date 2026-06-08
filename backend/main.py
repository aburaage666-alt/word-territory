import json
import random
import sqlite3
import uuid
from pathlib import Path
from spectator_seed import SHOWCASE_SEED, SHOWCASE_OPENING_IDX, SHOWCASE_SYNERGY

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi import Request

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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS async_games (
                game_id TEXT PRIMARY KEY,
                red_token TEXT NOT NULL,
                blue_token TEXT NOT NULL,
                state_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS async_moves (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                turn INTEGER NOT NULL,
                player TEXT NOT NULL,
                move_json TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

init_db()

from datetime import datetime, timezone
from daily import date_to_day_number, date_to_opening_idx, get_today_utc
from engine import (
    apply_bot_move,
    apply_demo_bot_move,
    apply_seed_move,
    apply_dazi_move,
    build_initial_state,
    find_candidate_words,
    find_almost_words,
    generate_letter_market,
    SYNERGY_CARDS,
    pick_synergy_options,
    apply_synergy_bonus,
    update_synergy_state,
    advance_market,
    get_market_stats,
    get_letter_preview_moves,
    get_threat_preview,
    pass_turn,
    rotate_block_state,
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
    DaziMoveRequest,
    PreviewMoveRequest,
    PreviewMoveResponse,
    SeedMoveRequest,
    SuggestionsResponse,
    WaitlistSubmission,
)

app = FastAPI(title="Word Territory API")

# CORSMiddleware replaced by ForceCORSMiddleware above (handles 500 errors too)

# ── Bulletproof CORS + error middleware ──────────────────────────────────────
# CORSMiddleware does NOT add headers to unhandled 500 errors in sync routes.
# This raw ASGI middleware fires unconditionally before everything else.

# Allow all browser origins. The frontend does not use credentials/cookies.
# This prevents backend 500s from being masked as a CORS-only error in the browser.
ALLOWED_ORIGINS = {"*"}

def _cors_headers_for_origin(origin: str):
    return [
        (b"access-control-allow-origin", origin.encode() if origin else b"*"),
        (b"access-control-allow-methods", b"*"),
        (b"access-control-allow-headers", b"*"),
    ]

class ForceCORSMiddleware:
    """Raw ASGI middleware: adds CORS headers to EVERY response, including 500s."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origin = ""
        for k, v in scope.get("headers", []):
            if k == b"origin":
                origin = v.decode()
                break

        cors_headers = _cors_headers_for_origin(origin)

        # Handle preflight
        if scope["type"] == "http" and scope.get("method") == "OPTIONS":
            await send({"type": "http.response.start", "status": 204,
                        "headers": cors_headers})
            await send({"type": "http.response.body", "body": b""})
            return

        started = []

        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                # Remove any existing CORS headers (avoid duplicates)
                headers = [(k, v) for k, v in headers
                           if not k.lower().startswith(b"access-control-")]
                headers.extend(cors_headers)
                message = {**message, "headers": headers}
                started.append(True)
            await send(message)

        try:
            await self.app(scope, receive, send_with_cors)
        except Exception as exc:
            import traceback as _tb
            print(f"[ASGI ERROR] {_tb.format_exc()}", flush=True)
            body = b'{"detail":"Internal server error"}' 
            hdrs = [(b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode())]
            hdrs.extend(cors_headers)
            if not started:
                await send({"type": "http.response.start", "status": 500,
                             "headers": hdrs})
                await send({"type": "http.response.body", "body": body})


app.add_middleware(ForceCORSMiddleware)
GAMES: dict[str, GameState] = {}

# In-memory daily leaderboard. Resets on server restart.
# Production upgrade path: replace with SQLite or Redis.
DAILY_SCORES: dict[str, list[dict]] = {}

def _model_payload(obj):
    """Pydantic v1/v2 compatible JSON-safe payload."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return json.loads(obj.json())

def _state_response(state: GameState, status_code: int = 200):
    return JSONResponse(content=_model_payload(state), status_code=status_code)

def _safe_turn_fallback(state: GameState):
    """Never let bot/demo endpoints return a raw 500 just because the engine had a bad turn."""
    try:
        return pass_turn(state)
    except Exception:
        return state


@app.post("/games", response_model=CreateGameResponse)
def create_game(payload: CreateGameRequest = CreateGameRequest()):
    game_id = str(uuid.uuid4())

    if payload.showcase or payload.spectatorSeed is not None:
        seed = payload.spectatorSeed if payload.spectatorSeed is not None else SHOWCASE_SEED
        old_rng = random.getstate()
        random.seed(seed)
        try:
            state = build_initial_state(
                bot_level=payload.botLevel,
                opening_idx=SHOWCASE_OPENING_IDX if payload.showcase else None,
            )
            if payload.showcase:
                state.synergyOptions = [SHOWCASE_SYNERGY, "FRONTLINE_TACTICIAN", "TRAP_SETTER"]
                state.selectedSynergy = SHOWCASE_SYNERGY
                state.synergyState = {}
                state.botStyle = "Showcase"
        finally:
            random.setstate(old_rng)
    else:
        state = build_initial_state(bot_level=payload.botLevel)

    GAMES[game_id] = state
    return CreateGameResponse(game_id=game_id, state=state)


@app.post("/games/{game_id}/move", response_model=GameState)
def make_move(game_id: str, payload: MoveRequest):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        next_state = validate_and_apply_move(state, payload.row, payload.col, payload.letter, payload.path, advance_market_flag=True, dazi=getattr(payload, "dazi", False))
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
        next_state = apply_seed_move(state, payload.row, payload.col, payload.letter, advance_market_flag=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    GAMES[game_id] = next_state
    return next_state




@app.post("/games/{game_id}/rotate-block", response_model=GameState)
def rotate_block(game_id: str, payload: dict):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.winner:
        return state
    if state.currentPlayer == state.botPlayer:
        raise HTTPException(status_code=400, detail="It is not your turn")
    try:
        next_state = rotate_block_state(state, int(payload.get("row", -1)), int(payload.get("col", -1)), state.currentPlayer)
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



@app.post("/games/{game_id}/dazi-move", response_model=GameState)
def dazi_move(game_id: str, payload: DaziMoveRequest):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        next_state = apply_dazi_move(state, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    GAMES[game_id] = next_state
    return next_state

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


@app.post("/games/{game_id}/bot-move")
def bot_move(game_id: str):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.currentPlayer != state.botPlayer:
        raise HTTPException(status_code=400, detail="It is not the bot's turn")

    import concurrent.futures, traceback as _tb

    def run_bot():
        return apply_bot_move(state)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(run_bot)
            next_state = future.result(timeout=4)
    except Exception as _e:
        print(f"[bot-move] safe fallback: {type(_e).__name__}: {_e}", flush=True)
        print(_tb.format_exc(), flush=True)
        next_state = _safe_turn_fallback(state)

    GAMES[game_id] = next_state
    return _state_response(next_state)


@app.post("/games/{game_id}/auto-move")
def auto_move(game_id: str, demo: bool = False):
    """Spectator / demo mode: let the current player be controlled by bot logic.

    Unlike /bot-move, this works for either RED or BLUE. It is designed for
    Bot-vs-Bot demo playback, trailer capture, and balance testing.
    """
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.winner:
        return _state_response(state)

    import concurrent.futures, random, traceback as _tb

    def run_bot():
        return apply_demo_bot_move(state) if demo else apply_bot_move(state)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(run_bot)
            next_state = future.result(timeout=4)
    except Exception as _e:
        print(f"[auto-move] safe fallback: {type(_e).__name__}: {_e}", flush=True)
        print(_tb.format_exc(), flush=True)
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
            try:
                row, col = random.choice(legal)
                import string
                letter = random.choice(string.ascii_uppercase)
                next_state = apply_seed_move(state, row, col, letter)
            except Exception:
                next_state = _safe_turn_fallback(state)
        else:
            next_state = _safe_turn_fallback(state)

    GAMES[game_id] = next_state
    return _state_response(next_state)


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


# ── Synergy Card endpoints ───────────────────────────────────────────────────

@app.get("/games/{game_id}/synergy-options")
def get_synergy_options(game_id: str):
    """Return the 3 synergy card options for this game."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    options = []
    for key in state.synergyOptions:
        card = SYNERGY_CARDS.get(key, {})
        options.append({"key": key, **card})
    return {
        "options": options,
        "selected": state.selectedSynergy,
    }


@app.post("/games/{game_id}/select-synergy")
def select_synergy(game_id: str, req: dict):
    """Player selects one synergy card."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.turn > 1:
        raise HTTPException(status_code=400, detail="Synergy must be selected before first move")
    card_key = req.get("card", "")
    if card_key not in state.synergyOptions:
        raise HTTPException(status_code=400, detail=f"Card {card_key} not in options")
    state.selectedSynergy = card_key
    state.synergyState = {}
    return {"selected": card_key, "card": SYNERGY_CARDS[card_key]}


# ── Letter Market endpoints ──────────────────────────────────────────────────

@app.get("/games/{game_id}/market")
def get_market(game_id: str):
    """Return current Letter Market with per-letter stats."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    # Stats are best-effort — never let them block the market from loading
    try:
        stats = get_market_stats(state)
    except Exception:
        stats = [{"letter": l, "wordCount": 0, "bestGain": 0, "bestWord": "", "roles": []}
                 for l in state.marketLetters]
    return {
        "active":  state.marketLetters,
        "preview": state.previewLetters,
        "stats":   stats,
        "freeLetterUsed": state.freeLetterUsed,
    }


@app.get("/games/{game_id}/letter-preview/{letter}")
def get_letter_preview(game_id: str, letter: str):
    """Return board-cell previews for the selected Letter Market tile."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        moves = get_letter_preview_moves(state, letter, limit=12)
    except Exception:
        moves = []
    return {"letter": (letter or "").upper()[:1], "moves": moves}


@app.post("/games/{game_id}/free-letter")
def use_free_letter(game_id: str, req: dict):
    """Use the Free Letter (Wild) once per game."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    if state.freeLetterUsed:
        raise HTTPException(status_code=400, detail="Free letter already used this game")
    letter = req.get("letter", "").upper()
    if not letter or len(letter) != 1 or not letter.isalpha():
        raise HTTPException(status_code=400, detail="Invalid letter")
    # Add letter to active market temporarily (replaces slot 0)
    state.freeLetterUsed = True
    if letter not in state.marketLetters:
        state.marketLetters = [letter] + state.marketLetters[:2]
    return {"active": state.marketLetters, "preview": state.previewLetters,
            "freeLetterUsed": True}


# ── Almost / Tenpai endpoint ─────────────────────────────────────────────────

@app.get("/games/{game_id}/almost")
def get_almost(game_id: str):
    """Return words that are 1 letter away from being playable (Tenpai UI)."""
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        almost = find_almost_words(state, limit=4)
        return {"almost": almost}
    except Exception:
        return {"almost": []}




# ── Async PvP MVP ────────────────────────────────────────────────────────────

def _state_to_json(state: GameState) -> str:
    if hasattr(state, "model_dump_json"):
        return state.model_dump_json()
    return state.json()


def _state_from_json(raw: str) -> GameState:
    if hasattr(GameState, "model_validate_json"):
        return GameState.model_validate_json(raw)
    return GameState.parse_raw(raw)


def _load_async_game(game_id: str, token: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM async_games WHERE game_id=?", (game_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Async game not found")
    if token == row["red_token"]:
        player = "RED"
    elif token == row["blue_token"]:
        player = "BLUE"
    else:
        raise HTTPException(status_code=403, detail="Invalid async match token")
    state = _state_from_json(row["state_json"])
    return row, state, player


def _save_async_state(game_id: str, state: GameState, move_payload: dict | None = None):
    with get_db() as conn:
        conn.execute(
            "UPDATE async_games SET state_json=?, status=?, updated_at=datetime('now') WHERE game_id=?",
            (_state_to_json(state), "finished" if state.winner else "active", game_id),
        )
        if move_payload:
            conn.execute(
                "INSERT INTO async_moves (game_id, turn, player, move_json) VALUES (?,?,?,?)",
                (game_id, int(move_payload.get("turn", state.turn)), move_payload.get("player", state.currentPlayer), json.dumps(move_payload)),
            )
        conn.commit()


@app.post("/async/games")
def create_async_game(payload: CreateGameRequest = CreateGameRequest()):
    """Create a link-share async PvP match. No WebSocket required."""
    game_id = str(uuid.uuid4())
    red_token = str(uuid.uuid4())[:12]
    blue_token = str(uuid.uuid4())[:12]
    state = build_initial_state(bot_level=payload.botLevel)
    state.vsBot = False
    state.botPlayer = "BLUE"
    state.botStyle = "Human Challenger"
    with get_db() as conn:
        conn.execute(
            "INSERT INTO async_games (game_id, red_token, blue_token, state_json) VALUES (?,?,?,?)",
            (game_id, red_token, blue_token, _state_to_json(state)),
        )
        conn.commit()
    return {
        "game_id": game_id,
        "redToken": red_token,
        "blueToken": blue_token,
        "redUrl": f"/?match={game_id}&token={red_token}",
        "blueUrl": f"/?match={game_id}&token={blue_token}",
        "state": state,
        "role": "RED",
    }


@app.get("/async/games/{game_id}")
def get_async_game(game_id: str, token: str):
    row, state, player = _load_async_game(game_id, token)
    return {"game_id": game_id, "role": player, "state": state, "status": row["status"]}


@app.post("/async/games/{game_id}/move")
def async_move(game_id: str, token: str, payload: MoveRequest):
    row, state, player = _load_async_game(game_id, token)
    if state.winner:
        return state
    if state.currentPlayer != player:
        raise HTTPException(status_code=400, detail="It is not your turn")
    try:
        next_state = validate_and_apply_move(state, payload.row, payload.col, payload.letter, payload.path, advance_market_flag=True, dazi=getattr(payload, "dazi", False))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_async_state(game_id, next_state, {"type": "WORD", "turn": state.turn, "player": player})
    return next_state




@app.post("/async/games/{game_id}/rotate-block")
def async_rotate_block(game_id: str, token: str, payload: dict):
    dbrow, state, player = _load_async_game(game_id, token)
    if state.winner:
        return state
    if state.currentPlayer != player:
        raise HTTPException(status_code=400, detail="It is not your turn")
    try:
        next_state = rotate_block_state(state, int(payload.get("row", -1)), int(payload.get("col", -1)), player)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_async_state(game_id, next_state, {"type": "ROTATE", "turn": state.turn, "player": player})
    return next_state


@app.post("/async/games/{game_id}/seed-move")
def async_seed_move(game_id: str, token: str, payload: SeedMoveRequest):
    row, state, player = _load_async_game(game_id, token)
    if state.winner:
        return state
    if state.currentPlayer != player:
        raise HTTPException(status_code=400, detail="It is not your turn")
    try:
        next_state = apply_seed_move(state, payload.row, payload.col, payload.letter, advance_market_flag=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_async_state(game_id, next_state, {"type": "SEED", "turn": state.turn, "player": player})
    return next_state



@app.post("/async/games/{game_id}/dazi-move")
def async_dazi_move(game_id: str, token: str, payload: DaziMoveRequest):
    row, state, player = _load_async_game(game_id, token)
    if state.winner:
        return state
    if state.currentPlayer != player:
        raise HTTPException(status_code=400, detail="It is not your turn")
    try:
        next_state = apply_dazi_move(state, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _save_async_state(game_id, next_state, {"type": "DAZI", "turn": state.turn, "player": player})
    return next_state

@app.post("/async/games/{game_id}/pass")
def async_pass(game_id: str, token: str):
    row, state, player = _load_async_game(game_id, token)
    if state.winner:
        return state
    if state.currentPlayer != player:
        raise HTTPException(status_code=400, detail="It is not your turn")
    next_state = pass_turn(state)
    _save_async_state(game_id, next_state, {"type": "PASS", "turn": state.turn, "player": player})
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
    try:
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) FROM waitlist").fetchone()[0]
        return {"count": count}
    except Exception:
        return {"count": 0}


@app.get("/games/{game_id}/threat")
def get_threat(game_id: str):
    state = GAMES.get(game_id)
    if not state:
        raise HTTPException(status_code=404, detail="Game not found")
    try:
        return {"threats": get_threat_preview(state, limit=8)}
    except Exception:
        return {"threats": []}
