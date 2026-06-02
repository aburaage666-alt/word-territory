import random
from collections import deque
from copy import deepcopy

from dictionary import get_words, is_valid_word
from models import Cell, Coord, GameState, MoveHistoryItem, PreviewMoveResponse, Scores

BOARD_SIZE = 7
MAX_TURNS = 35

OPENINGS = [
    ("STONE OPENING", ["T", "A", "O", "E", "R", "N", "S"]),
    ("RIVER OPENING", ["R", "A", "E", "T", "L", "N", "S"]),
    ("BRIDGE OPENING", ["B", "R", "I", "D", "G", "E", "S"]),
    ("LIGHT OPENING", ["L", "I", "G", "H", "T", "E", "R"]),
    ("WATER OPENING", ["W", "A", "T", "E", "R", "S", "N"]),
    ("PLANT OPENING", ["P", "L", "A", "N", "T", "E", "R"]),
    ("GARDEN OPENING", ["S", "E", "A", "T", "R", "N", "L"]),
    ("FOREST OPENING", ["M", "E", "A", "T", "R", "S", "N"]),
    ("MARKET OPENING", ["C", "A", "R", "E", "T", "N", "S"]),
    ("CIRCLE OPENING", ["S", "T", "O", "N", "E", "R", "A"]),
]

# 7x7 center=(3,3): shape top(1,3), row2(2,2-5), col(3-4,3)
OPENING_COORDS = [(1, 3), (2, 2), (2, 3), (2, 4), (2, 5), (3, 3), (4, 3)]




def in_bounds(r: int, c: int) -> bool:
    return 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE


def get_neighbors(r: int, c: int):
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if in_bounds(nr, nc):
            yield nr, nc


def other_player(player: str) -> str:
    return "BLUE" if player == "RED" else "RED"


def are_adjacent(a, b) -> bool:
    return abs(a.row - b.row) + abs(a.col - b.col) == 1


def word_score(word: str) -> int:
    n = len(word)
    if n == 3:
        return 1
    if n == 4:
        return 2
    if n == 5:
        return 3
    if n == 6:
        return 5
    return 0


def clone_state(state: GameState) -> GameState:
    return deepcopy(state)


def total_score(state: GameState, player: str) -> float:
    if player == "RED":
        return state.scores.redTerritory * 1.5 + state.scores.redWord
    return state.scores.blueTerritory * 1.5 + state.scores.blueWord


def count_territory(state: GameState, player: str) -> int:
    return sum(1 for row in state.board for cell in row if cell.owner == player)


def count_locked_cells(state: GameState, player: str) -> int:
    return sum(1 for row in state.board for cell in row if cell.owner == player and cell.fortified)


def choose_opening():
    candidates = OPENINGS[:]
    random.shuffle(candidates)
    best = candidates[0]
    best_score = -1
    words = get_words()
    for name, seed in candidates:
        available = set(seed)
        score = sum(1 for w in words if 3 <= len(w) <= 4 and all(ch in available for ch in w))
        if score >= 3:
            return name, seed
        if score > best_score:
            best_score = score
            best = (name, seed)
    return best


BOT_STYLES = ["Builder", "Raider", "Cutter", "Expander", "Defender"]

def choose_bot_style(bot_level: str = "normal") -> str:
    """Pick a visible bot personality for the match.

    This is primarily a UX/positioning layer: it makes the opponent feel like
    a territory strategist rather than a generic word AI. The current move
    engine remains conservative; future versions can weight decisions by style.
    """
    if bot_level == "strong":
        return random.choice(["Raider", "Cutter", "Builder"])
    return random.choice(BOT_STYLES)


def build_initial_state(bot_level: str = "normal", opening_idx: int | None = None) -> GameState:
    board = [[Cell(row=r, col=c) for c in range(BOARD_SIZE)] for r in range(BOARD_SIZE)]
    if opening_idx is not None:
        opening_name, seed = OPENINGS[opening_idx % len(OPENINGS)]
    else:
        opening_name, seed = choose_opening()
    for (r, c), ch in zip(OPENING_COORDS, seed):
        board[r][c].letter = ch
    state = GameState(
        boardSize=BOARD_SIZE,
        board=board,
        currentPlayer="RED",
        turn=1,
        usedWords=[],
        recentMoves=[],
        moveHistory=[],
        scores=Scores(),
        winner=None,
        consecutivePasses=0,
        vsBot=True,
        botPlayer="BLUE",
        botLevel=bot_level,
        botStyle=choose_bot_style(bot_level),
        openingName=opening_name,
        lastChangedCells=[],
        lastCapturedCells=[],
        lastFortifiedCells=[],
        lastComboLabels=[],
    )
    # Initialize Synergy Card options (3 random cards to choose from)
    state.synergyOptions = pick_synergy_options()
    state.selectedSynergy = ""
    state.synergyState = {}
    # Initialize Letter Market
    active, preview = generate_letter_market(state)
    state.marketLetters  = active
    state.previewLetters = preview
    return state


def board_letters_set(state: GameState) -> set[str]:
    return {cell.letter.upper() for row in state.board for cell in row if cell.letter}


def can_spell_from_board(word: str, available_letters: set[str]) -> bool:
    return all(ch in available_letters for ch in word)


def find_almost_words(state: GameState, limit: int = 5) -> list[dict]:
    """
    Tenpai / Almost UI: find words that are playable if ONE specific letter
    were available — i.e., words reachable from current board + any single new tile.

    Returns list of {"word": str, "needs": str, "length": int}
    sorted by length desc (longer = more exciting).
    """
    words = get_words()
    excluded = set(state.usedWords)
    board_letters = board_letters_set(state)
    placeable = get_placeable_empty_cells(state)

    results = []
    seen_words = set()

    # For each placeable cell, try every letter A-Z
    import string
    for (er, ec) in placeable[:8]:  # limit cells for speed
        for needed_letter in string.ascii_uppercase:
            # Skip if this letter is already on the board (not "almost")
            if needed_letter in board_letters:
                continue
            # Try paths from this cell with this letter
            starts = [(er, ec)]
            for nr, nc in get_neighbors(er, ec):
                if state.board[nr][nc].letter:
                    starts.append((nr, nc))

            for start in starts[:3]:
                stack = [([start], frozenset([start]))]
                while stack:
                    path, visited = stack.pop()
                    plen = len(path)
                    if plen >= 3 and (er, ec) in set(path):
                        word = letters_from_path(state, path, (er, ec), needed_letter)
                        if (word and word in words and word not in excluded
                                and word not in seen_words and _is_ui_word(word)):
                            seen_words.add(word)
                            results.append({
                                "word": word,
                                "needs": needed_letter,
                                "length": len(word),
                            })
                            if len(results) >= limit * 3:
                                # Sort and return early
                                results.sort(key=lambda x: -x["length"])
                                return results[:limit]
                    if plen >= 4:
                        continue
                    r, c = path[-1]
                    for nr, nc in get_neighbors(r, c):
                        if (nr, nc) in visited:
                            continue
                        if (nr, nc) != (er, ec) and not state.board[nr][nc].letter:
                            continue
                        stack.append((path + [(nr, nc)], visited | {(nr, nc)}))

    results.sort(key=lambda x: -x["length"])
    return results[:limit]


# Words to exclude from player-facing hints and bot preference.
# Important: these are NOT removed from the dictionary/validator.
# A player can still manually play them, but Suggested / Almost / Bot / Preview
# avoid surfacing abbreviations, proper-looking forms, archaic/obscure entries,
# or words that make the demo feel like a dictionary exploit.
_SUGGESTED_EXCLUDE = frozenset({
    # abbreviations / units / acronyms
    'MPH','ETC','LIB','TBSP','TSP','HRS','HR','MIN','SEC','USD','GBP','EUR',
    'DNA','RNA','CPU','GPU','USB','URL','HTML','HTTP','CEO','CFO','MBA','PHD',
    # Greek letters / particles / crosswordese
    'PHI','PSI','ETA','TAO','OCA','EFT','OFT','ERE','EKE','KOI','POI',
    # interjections / odd short entries
    'OOH','AAH','HMM','UGH','PST','SHH',
    # obscure / proper-looking / weak demo words observed in tests
    'HES','MAS','EST','SIM','IDES','ODES','JUT','ZIT','GOB','DOIT','NARC','OTIC','ALEC',
    'VAR','FARO','TARO','GEN','TOSH','LENO','BIFF','GLIB',
    # very technical / weak bot choices
    'ION','IONA','ERG','OHM','EMU','OVA','AXE',
    # UI/preview/bot filter: abbreviations, dictionary noise, obscure variants
    'MPH','ETC','LIB','GLIB','BIFF','VAR','FARO','TARO','GEN','TOSH','LENO',
    'CPU','GPU','USB','PDF','PNG','JPG','GIF','API','CSS','HTML','HTTP','URL',
    'CEO','CFO','COO','LLC','LTD','INC','MBA','PHD','DNA','RNA','ATM','FAQ',
    'TBSP','TSP','OZ','LBS','KG','KM','CM','MM','MPG','BTW','FYI','DIY','VPN',
    'SQL','XML','JSON','YAML','SDK','CLI','GUI','UX','UI','AI','ML','NLP',

})


def _is_ui_word(word: str) -> bool:
    """Return True for words suitable for UI hints / bot-first choices.

    The full dictionary remains valid for manual play, but Suggested, Almost,
    Bot priority and Territory Preview should not push abbreviations or obscure
    dictionary debris. This keeps the game feeling like territory strategy,
    not dictionary trivia.
    """
    w = word.upper().strip()
    if w in _SUGGESTED_EXCLUDE:
        return False
    if len(w) < 3 or len(w) > 6:
        return False
    vowels = sum(1 for ch in w if ch in 'AEIOU')
    if vowels == 0:
        return False
    # 3-letter all-caps technical/measurement-looking strings are usually bad hints.
    if len(w) == 3 and vowels <= 1 and (w.endswith('H') or w.endswith('C') or w.endswith('B')):
        return False
    # Avoid pluralized abbreviation/dictionary-noise patterns in hints.
    if len(w) <= 4 and w.endswith('S') and w[:-1] in _SUGGESTED_EXCLUDE:
        return False
    # Prefer ordinary-looking words in public hints; keep rare Q/X/Z/J words playable manually.
    if len(w) <= 4 and any(ch in w for ch in 'QXZJ') and w not in {'JAM','JAR','JAW','JOG','JOY','JOKE','JUMP','QUIZ','ZERO','ZOO','AXE','FOX'}:
        return False
    return True


# Demo Dictionary: stricter than UI hints.
# These words are preferred/allowed for Watch Demo and trailer-style bot play.
# The goal is not to make the strongest dictionary player; it is to make the
# map-changing moment readable to a first-time viewer.
_DEMO_WORD_PROMOTE = frozenset({
    'STONE','WATER','BRIDGE','GARDEN','PLANT','MARKET','CIRCLE','LIGHT','RIVER',
    'TRAIN','TRAIL','ROPE','HOPE','FIND','FINE','LINE','LINK','LAND','ROAD','PATH',
    'STAR','ROSE','TREE','ROOT','LEAF','FIELD','HOUSE','HOME','WALL','GATE',
    'CART','CARE','RATE','TEAR','NEAR','EARN','EAST','WEST','NORTH','SOUTH',
    'CONE','NOTE','TONE','BONE','RING','WING','KING','SING','HAND','HARD',
})
_DEMO_WORD_EXCLUDE = frozenset({
    # keep demo/trailer away from dictionary trivia and abbreviations
    'IRE','DISC','WREN','WRET','THUS','CHUB','HULK','HULL','GLIB','BIFF',
    'MPH','ETC','LIB','TBSP','TSP','VAR','FARO','TARO','GEN','TOSH','LENO',
})

def _is_demo_word(word: str) -> bool:
    w = word.upper().strip()
    if w in _DEMO_WORD_EXCLUDE:
        return False
    if not _is_ui_word(w):
        return False
    # Demo should mostly show obvious, readable words.
    # Allow a promoted set and ordinary-looking 4–6 letter words with enough vowels.
    if w in _DEMO_WORD_PROMOTE:
        return True
    vowels = sum(1 for ch in w if ch in 'AEIOU')
    if len(w) == 3:
        return False
    if len(w) >= 4 and vowels >= 2:
        return True
    return False


# ── Letter Market ─────────────────────────────────────────────────────────────

# English letter frequency (rough weights)
_LETTER_WEIGHTS = {
    'E':12,'T':9,'A':8,'O':8,'I':7,'N':7,'S':6,'H':6,'R':6,'D':4,'L':4,
    'C':3,'U':3,'M':2,'W':2,'F':2,'G':2,'Y':2,'P':2,'B':2,'V':1,'K':1,
    'J':1,'X':1,'Q':1,'Z':1,
}
_ALL_LETTERS = list(_LETTER_WEIGHTS.keys())
_WEIGHTS     = [_LETTER_WEIGHTS[l] for l in _ALL_LETTERS]


# ── Synergy Card Definitions ──────────────────────────────────────────────────

SYNERGY_CARDS = {
    "BRIDGE_MASTER": {
        "name": "Bridge Master",
        "icon": "🌉",
        "difficulty": "Medium",
        "effect": "Connecting separated zones grants extra Territory Swing.",
        "tip": "Look for paths that join your regions.",
        "flavor": "Unite what was divided.",
    },
    "FORTIFIER": {
        "name": "Fortifier",
        "icon": "🏰",
        "difficulty": "Easy",
        "effect": "First lock is powerful; later locks still add Swing.",
        "tip": "Secure surrounded ground before expanding.",
        "flavor": "Walls that hold, win.",
    },
    "CUT_SPECIALIST": {
        "name": "Cut Specialist",
        "icon": "✂️",
        "difficulty": "Medium",
        "effect": "Splitting enemy territory adds Swing and primes capture pressure.",
        "tip": "Cut enemy regions apart, then collapse them.",
        "flavor": "A clean cut changes the map.",
    },
    "FRONTLINE_TACTICIAN": {
        "name": "Frontline Tactician",
        "icon": "🗡️",
        "difficulty": "Easy",
        "effect": "Words drawn along the enemy frontline gain +2T.",
        "tip": "Push where red and blue touch.",
        "flavor": "Win the border, win the board.",
    },
    "ENCIRCLER": {
        "name": "Encircler",
        "icon": "🕸️",
        "difficulty": "Hard",
        "effect": "Moves that tighten a capture net gain +3T.",
        "tip": "Close space around enemy cells.",
        "flavor": "Territory is a trap before it is a capture.",
    },
    "BORDER_LORD": {
        "name": "Border Lord",
        "icon": "🏴",
        "difficulty": "Easy",
        "effect": "Words inside the central 6×6 battle zone gain +1T.",
        "tip": "Control the middle; force the opponent outward.",
        "flavor": "The center decides the frontier.",
    },
    "TRAP_SETTER": {
        "name": "Trap Setter",
        "icon": "⏳",
        "difficulty": "Hard",
        "effect": "After creating a capture threat, your next word gains +2T.",
        "tip": "Build the threat one turn before the capture.",
        "flavor": "The best capture is already visible.",
    },
    "COMEBACK_SPARK": {
        "name": "Comeback Spark",
        "icon": "🔥",
        "difficulty": "Medium",
        "effect": "When behind by 6+ cells, role bonuses gain extra Swing.",
        "tip": "Use it to convert pressure into a reversal.",
        "flavor": "Pressure creates territory.",
    },
}


def pick_synergy_options() -> list[str]:
    """Pick 3 random synergy card keys for the player to choose from."""
    import random as _r
    return _r.sample(list(SYNERGY_CARDS.keys()), 3)


def _coord_tuple(p):
    """Safely normalize Coord / dict / tuple into (row, col).

    Important: do not use getattr(..., p.get(...)) because Python evaluates
    the default argument before calling getattr. That crashes for Coord objects
    with: 'Coord' object has no attribute 'get'.
    """
    if isinstance(p, tuple):
        return p
    if hasattr(p, 'row') and hasattr(p, 'col'):
        return (p.row, p.col)
    if isinstance(p, dict):
        return (p.get('row'), p.get('col'))
    # Fallback for other mapping-like objects
    try:
        return (p['row'], p['col'])
    except Exception:
        raise ValueError(f"Invalid coordinate object: {p!r}")


def _path_touches_enemy(state: GameState, path, player: str) -> bool:
    opponent = other_player(player)
    if not path:
        return False
    for p in path:
        r, c = _coord_tuple(p)
        for nr, nc in get_neighbors(r, c):
            if state.board[nr][nc].owner == opponent:
                return True
    return False


def _path_in_center_zone(path) -> bool:
    if not path:
        return False
    for p in path:
        r, c = _coord_tuple(p)
        # central 6x6 on a 7x7 board: avoid only the far outer corner pressure
        if 0 <= r <= 5 and 0 <= c <= 5:
            return True
    return False


def _capture_net_pressure(state: GameState, row: int | None, col: int | None, player: str) -> bool:
    """Cheap proxy for 'created a capture threat': placed near ≥2 enemy cells or closes a small pocket."""
    if row is None or col is None:
        return False
    opponent = other_player(player)
    adj_enemy = 0
    adj_empty = 0
    for nr, nc in get_neighbors(row, col):
        if state.board[nr][nc].owner == opponent:
            adj_enemy += 1
        if state.board[nr][nc].letter is None:
            adj_empty += 1
    return adj_enemy >= 2 or (adj_enemy >= 1 and adj_empty <= 1)


def _synergy_preview_text(state: GameState, combos: list[str], player: str,
                          word: str, letter: str, path=None, row: int | None = None,
                          col: int | None = None) -> str:
    card = state.selectedSynergy
    if not card:
        return ""
    name = SYNERGY_CARDS.get(card, {}).get('name', 'Synergy')
    if card == "BRIDGE_MASTER" and "BRIDGE" in combos:
        return f"★ {name} ready"
    if card == "FORTIFIER" and "FORTIFY CHAIN" in combos:
        return f"★ {name} ready"
    if card in ("CUT_SPECIALIST", "CUT_HUNTER") and ("CUT" in combos or state.synergyState.get("cutPending")):
        return f"★ {name} ready"
    if card == "FRONTLINE_TACTICIAN" and _path_touches_enemy(state, path, player):
        return f"★ {name} ready"
    if card == "ENCIRCLER" and _capture_net_pressure(state, row, col, player):
        return f"★ {name} ready"
    if card == "BORDER_LORD" and _path_in_center_zone(path):
        return f"★ {name} ready"
    if card == "TRAP_SETTER" and (state.synergyState.get("trapPending") or _capture_net_pressure(state, row, col, player)):
        return f"★ {name} ready"
    if card == "COMEBACK_SPARK":
        opp = other_player(player)
        my_t = count_territory(state, player)
        opp_t = count_territory(state, opp)
        if (opp_t - my_t) >= 6:
            return f"★ {name} ready"
    # Legacy cards preserved for old saved games
    if card == "PATH_SEEKER" and "LONG PATH" in combos:
        return f"★ {name} ready"
    if card == "LONG_WORD" and len(word) >= 5:
        return f"★ {name} ready"
    if card == "VOWEL_ENGINE" and letter.upper() in "AEIOU":
        return f"★ {name} ready"
    if card == "SEED_TACTICIAN" and state.synergyState.get("seedPending"):
        return f"★ {name} ready"
    return ""


def apply_synergy_bonus(state: GameState, combos: list[str], player: str,
                        word: str, letter: str, path=None,
                        row: int | None = None, col: int | None = None) -> int:
    """Return extra territory from the active terrain-shaped synergy card."""
    card = state.selectedSynergy
    if not card:
        return 0
    bonus = 0
    opp = other_player(player)
    my_t  = count_territory(state, player)
    opp_t = count_territory(state, opp)

    if card == "BRIDGE_MASTER" and "BRIDGE" in combos:
        bonus += 2
    elif card == "FORTIFIER" and "FORTIFY CHAIN" in combos:
        bonus += 6 if not state.synergyState.get("firstLockDone") else 1
    elif card in ("CUT_SPECIALIST", "CUT_HUNTER"):
        if "CUT" in combos:
            bonus += 2
        elif "CAPTURE" in combos and state.synergyState.get("cutPending"):
            bonus += 2
    elif card == "FRONTLINE_TACTICIAN" and _path_touches_enemy(state, path, player):
        bonus += 2
    elif card == "ENCIRCLER" and _capture_net_pressure(state, row, col, player):
        bonus += 3
    elif card == "BORDER_LORD" and _path_in_center_zone(path):
        bonus += 1
    elif card == "TRAP_SETTER" and state.synergyState.get("trapPending"):
        bonus += 2
    elif card == "COMEBACK_SPARK" and (opp_t - my_t) >= 6:
        bonus += max(1, len([c for c in combos if not str(c).startswith('SYNERGY')]))
    # legacy cards for saved games
    elif card == "LONG_WORD":
        bonus += 3 if len(word) == 5 else 5 if len(word) >= 6 else 0
    elif card == "VOWEL_ENGINE" and letter.upper() in "AEIOU":
        bonus += 1
    elif card == "SEED_TACTICIAN" and state.synergyState.get("seedPending"):
        bonus += 3
    elif card == "PATH_SEEKER" and "LONG PATH" in combos:
        bonus += 2
    return bonus



def synergy_activation_text(state: GameState, combos: list[str], player: str,
                            word: str, letter: str, bonus: int) -> str:
    """Human-readable terrain-style synergy activation message."""
    if bonus <= 0 or not state.selectedSynergy:
        return ""
    card = state.selectedSynergy
    name = SYNERGY_CARDS.get(card, {}).get('name', 'Synergy')
    if card == 'BRIDGE_MASTER':
        return f"{name}: connected zones +{bonus}T"
    if card == 'FORTIFIER':
        return f"{name}: locked ground +{bonus}T"
    if card in ('CUT_SPECIALIST', 'CUT_HUNTER'):
        return f"{name}: enemy line split +{bonus}T"
    if card == 'FRONTLINE_TACTICIAN':
        return f"{name}: frontline push +{bonus}T"
    if card == 'ENCIRCLER':
        return f"{name}: capture net tightened +{bonus}T"
    if card == 'BORDER_LORD':
        return f"{name}: center held +{bonus}T"
    if card == 'TRAP_SETTER':
        return f"{name}: trap sprung +{bonus}T"
    if card == 'COMEBACK_SPARK':
        return f"{name}: comeback pressure +{bonus}T"
    return f"{name} activated! +{bonus}T"

def update_synergy_state(state: GameState, combos: list[str],
                         is_seed: bool = False) -> dict:
    """Update terrain-synergy state machine after a move."""
    ss = dict(state.synergyState)
    card = state.selectedSynergy
    if not card:
        return ss

    if card == "FORTIFIER" and "FORTIFY CHAIN" in combos:
        ss["firstLockDone"] = True
    elif card in ("CUT_SPECIALIST", "CUT_HUNTER"):
        if "CUT" in combos:
            ss["cutPending"] = True
        elif "CAPTURE" in combos and ss.get("cutPending"):
            ss["cutPending"] = False
    elif card == "TRAP_SETTER":
        # A cut/bridge/capture-looking move creates a tactical follow-up.
        if "CUT" in combos or "BRIDGE" in combos or "CAPTURE" in combos:
            ss["trapPending"] = True
        elif not is_seed:
            ss["trapPending"] = False
    elif card == "SEED_TACTICIAN":
        if is_seed:
            ss["seedPending"] = True
        else:
            ss["seedPending"] = False
    return ss



def _letter_enables_word(state: GameState, letter: str, max_check: int = 8) -> bool:
    """Quick check: does placing this letter anywhere create ≥1 valid word?"""
    words = get_words()
    placeable = get_placeable_empty_cells(state)
    import random as _r
    sample = placeable[:max_check]
    for (er, ec) in sample:
        # Try a fast path from each cell
        stack = [([p], frozenset([p])) for p in [(er,ec)] +
                 [(r,c) for r,c in get_neighbors(er,ec) if state.board[r][c].letter]]
        while stack:
            path, vis = stack.pop()
            if len(path) >= 3 and (er,ec) in set(path):
                w = letters_from_path(state, path, (er,ec), letter)
                if w and w in words:
                    return True
            if len(path) >= 4:
                continue
            r, c = path[-1]
            for nr, nc in get_neighbors(r, c):
                if (nr,nc) in vis: continue
                if (nr,nc) != (er,ec) and not state.board[nr][nc].letter: continue
                stack.append((path+[(nr,nc)], vis|{(nr,nc)}))
    return False


def _letter_best_stats(state: GameState, letter: str) -> dict:
    """Return {word_count, best_gain, best_word, roles} for one letter.
    Lightweight — no simulate_move, uses path-length estimate for gain.
    """
    excluded = set(state.usedWords)
    moves = _fast_bot_moves_for_letter(state, letter, max_results=8, excluded=excluded)
    if not moves:
        return {"wordCount": len(moves), "bestGain": 0, "bestWord": "", "roles": []}
    best = max(moves, key=lambda m: m.get("territory_gain", 0))
    # Quick role detection without simulate_move
    roles = []
    for m in moves[:3]:
        w = m.get("word", "")
        if len(w) >= 5 and "LONG PATH" not in roles:
            roles.append("LONG PATH")
    return {
        "wordCount": len(moves),
        "bestGain":  best.get("territory_gain", 0),
        "bestWord":  best.get("word", ""),
        "roles":     roles[:2],
    }


def _fast_bot_moves_for_letter(state: GameState, letter: str,
                                max_results: int = 8,
                                excluded: set | None = None) -> list[dict]:
    """Like _fast_bot_moves but constrained to a specific letter."""
    excluded = excluded or set()
    words = get_words()
    player = state.currentPlayer
    placeable = get_placeable_empty_cells(state)
    results = []

    for (er, ec) in placeable[:6]:
        stack = [([p], frozenset([p])) for p in [(er,ec)] +
                 [(r,c) for r,c in get_neighbors(er,ec) if state.board[r][c].letter]]
        while stack:
            path, vis = stack.pop()
            if len(path) >= 3 and (er,ec) in set(path):
                w = letters_from_path(state, path, (er,ec), letter)
                if w and w in words and w not in excluded and _is_ui_word(w):
                    # Quick territory estimate: path length
                    gain = len(path)
                    results.append({"row": er, "col": ec, "letter": letter,
                                    "path": [Coord(row=r, col=c) for r,c in path],
                                    "word": w, "territory_gain": gain})
                    excluded.add(w)
                    if len(results) >= max_results:
                        return results
            if len(path) >= 5: continue
            r, c = path[-1]
            for nr, nc in get_neighbors(r, c):
                if (nr,nc) in vis: continue
                if (nr,nc) != (er,ec) and not state.board[nr][nc].letter: continue
                stack.append((path+[(nr,nc)], vis|{(nr,nc)}))
    return results


def _score_all_letters(state: GameState) -> dict:
    """
    Score candidate letters for the current board state.
    Only checks Almost-guided letters + top-weighted commons (not all 26).
    Fast: ~5-10ms per call.
    """
    import heapq as _hq
    excluded = set(state.usedWords)
    board_letters = board_letters_set(state)
    VOWELS = set("AEIOU")

    # Candidate set: Almost letters + top 12 by frequency, minus board letters
    try:
        almost_letters = {a["needs"] for a in find_almost_words(state, limit=8)}
    except Exception:
        almost_letters = set()

    top_freq = sorted(
        [l for l in _ALL_LETTERS if l not in board_letters],
        key=lambda l: -_LETTER_WEIGHTS[l]
    )[:12]

    candidates = list((almost_letters | set(top_freq)) - board_letters)
    # Always include common vowels if not on board
    for v in "AEIOU":
        if v not in board_letters and v not in candidates:
            candidates.append(v)

    scores = {}
    for letter in candidates:
        moves = _fast_bot_moves_for_letter(state, letter, max_results=6, excluded=excluded)
        best_gain = max((m.get("territory_gain", 0) for m in moves), default=0)
        best_word = max(moves, key=lambda m: m.get("territory_gain", 0),
                        default={}).get("word", "") if moves else ""
        power = any(len(m.get("word","")) >= 5 for m in moves)
        scores[letter] = {
            "words":     len(moves),
            "gain":      best_gain,
            "best_word": best_word,
            "power":     power,
            "is_vowel":  letter in VOWELS,
        }
    return scores


def generate_letter_market(state: GameState) -> tuple[list[str], list[str]]:
    """
    3-slot Letter Market:
    - Slot 0 SAFE:  highest wordCount (reliable play)
    - Slot 1 POWER: highest territory gain / role potential
    - Slot 2 SETUP: Almost-guided or frequency-weighted

    Guarantees: ≥2 of 3 active letters have playable words.
    Preview: no duplicates, ≥1 vowel, no repeat from active.
    """
    import random as _r

    RARE  = {'Q','X','Z','J'}
    VOWELS = set("AEIOU")
    board_letters = board_letters_set(state)

    scores = _score_all_letters(state)
    playable = {l: s for l, s in scores.items() if s["words"] > 0}

    # Comeback bias: losing by 6+ → Almost-completing letters boosted
    try:
        gap = get_score_gap(state, state.currentPlayer)
        if gap >= 6:
            almost_cb = find_almost_words(state, limit=8)
            for a in almost_cb:
                l = a["needs"]
                if l not in board_letters and l not in playable:
                    playable[l] = {"words": 1, "gain": 3, "best_word": "", "power": False, "is_vowel": l in VOWELS}
                elif l in playable:
                    playable[l] = dict(playable[l])
                    playable[l]["gain"] = max(playable[l]["gain"], 4)
    except Exception:
        pass

    def pick(pool_dict, key_fn, exclude):
        candidates = [(l, s) for l, s in pool_dict.items() if l not in exclude]
        if not candidates:
            return None
        return max(candidates, key=lambda x: key_fn(x[1]))[0]

    def weighted_pick(exclude):
        pool = [l for l in _ALL_LETTERS
                if l not in board_letters and l not in RARE and l not in exclude]
        if not pool:
            pool = [l for l in _ALL_LETTERS if l not in exclude] or _ALL_LETTERS
        weights = [_LETTER_WEIGHTS[l] for l in pool]
        return _r.choices(pool, weights=weights)[0]

    used = set()
    active = []

    # Slot 0: SAFE — most playable words
    safe = pick(playable, lambda s: s["words"] * 2 + s["gain"], used)
    if safe:
        active.append(safe); used.add(safe)

    # Slot 1: POWER — highest gain, prefer Power Word / different from safe
    power = pick(playable, lambda s: s["gain"] * 3 + (4 if s["power"] else 0) + s["words"], used)
    if power:
        active.append(power); used.add(power)
    elif playable:
        # second-best playable
        p2 = pick(playable, lambda s: s["gain"] + s["words"], used)
        if p2:
            active.append(p2); used.add(p2)

    # Slot 2: SETUP — try 3rd playable first, then Almost-guided
    third_playable = pick(playable, lambda s: s["words"] + s["gain"], used)
    if third_playable:
        active.append(third_playable); used.add(third_playable)
    else:
        try:
            almost = find_almost_words(state, limit=10)
            setup_candidates = [a["needs"] for a in almost
                                if a["needs"] not in board_letters and a["needs"] not in used]
            if setup_candidates:
                active.append(setup_candidates[0]); used.add(setup_candidates[0])
            else:
                active.append(weighted_pick(used)); used.add(active[-1])
        except Exception:
            active.append(weighted_pick(used)); used.add(active[-1])

    # Fill any remaining slots
    while len(active) < 3:
        l = weighted_pick(used)
        active.append(l); used.add(l)

    # Late-game fallback: if board is dense (>70% filled) and no playable letters,
    # fill with best Almost-completing letters
    board_total = BOARD_SIZE * BOARD_SIZE
    filled = sum(1 for r in range(BOARD_SIZE) for c in range(BOARD_SIZE) if state.board[r][c].letter)
    if filled / board_total > 0.70 and all(l not in playable for l in active):
        try:
            almost_fb = find_almost_words(state, limit=12)
            for a in almost_fb:
                l = a["needs"]
                if l not in board_letters and l not in set(active):
                    active[-1] = l  # replace last slot
                    break
        except Exception:
            pass

    # Ensure at least 1 vowel in active 3
    if not any(l in VOWELS for l in active):
        # replace the weakest (last slot) with a vowel
        vowels_avail = [l for l in VOWELS if l not in board_letters and l not in used]
        if vowels_avail:
            active[-1] = _r.choice(vowels_avail)
            used = set(active)

    # Preview: no duplicates, no same as active, ≥1 vowel
    preview = []
    prev_seen = set(active)
    # Add 1 Almost letter for preview
    try:
        almost = find_almost_words(state, limit=6)
        for a in almost:
            l = a["needs"]
            if l not in board_letters and l not in prev_seen:
                preview.append(l); prev_seen.add(l); break
    except Exception:
        pass
    while len(preview) < 3:
        l = weighted_pick(prev_seen)
        preview.append(l); prev_seen.add(l)
    # Ensure ≥1 vowel in preview
    if not any(l in VOWELS for l in preview):
        vowels_avail = [l for l in VOWELS if l not in board_letters and l not in prev_seen - set(preview)]
        if vowels_avail:
            preview[-1] = _r.choice(vowels_avail)

    return active[:3], preview[:3]


def advance_market(state: GameState, used_letter: str) -> tuple[list[str], list[str]]:
    """
    Remove used_letter from active, pull from preview, replenish.
    Always returns 3 active + 3 preview letters.
    """
    import random as _r
    RARE = {"Q","X","Z","J"}
    board_letters = board_letters_set(state)

    # Step 1: Remove used letter from active
    active = [l for l in state.marketLetters if l != used_letter]

    # Step 2: Pull from preview to fill active to 3
    preview = list(state.previewLetters) if state.previewLetters else []
    while len(active) < 3 and preview:
        active.append(preview.pop(0))

    # Step 3: If still short, use scored letters
    existing = set(active) | set(preview)
    if len(active) < 3:
        try:
            scores = _score_all_letters(state)
            ranked = sorted(
                [(l, s) for l, s in scores.items()
                 if s["words"] > 0 and l not in existing],
                key=lambda x: -(x[1]["gain"] + x[1]["words"])
            )
            for l, _ in ranked:
                if len(active) >= 3: break
                active.append(l); existing.add(l)
        except Exception:
            pass
        while len(active) < 3:
            pool = [l for l in _ALL_LETTERS if l not in RARE and l not in existing]
            if not pool: pool = [l for l in _ALL_LETTERS if l not in existing] or list(_ALL_LETTERS)
            l = _r.choices(pool, weights=[_LETTER_WEIGHTS[l] for l in pool])[0]
            active.append(l); existing.add(l)

    # Step 4: Refill preview to 3 using Almost guidance
    try:
        almost = find_almost_words(state, limit=6)
        good = [a["needs"] for a in almost
                if a["needs"] not in board_letters and a["needs"] not in existing]
        _r.shuffle(good)
    except Exception:
        good = []
    for l in good:
        if len(preview) >= 3: break
        preview.append(l); existing.add(l)
    while len(preview) < 3:
        pool = [l for l in _ALL_LETTERS if l not in RARE and l not in existing]
        if not pool: pool = [l for l in _ALL_LETTERS if l not in RARE]
        l = _r.choices(pool, weights=[_LETTER_WEIGHTS[l] for l in pool])[0]
        preview.append(l); existing.add(l)

    return active[:3], preview[:3]




def get_letter_preview_moves(state: GameState, letter: str, limit: int = 12) -> list[dict]:
    """Return best board placements for a selected Letter Market tile.

    This powers the Balatro-like expectation preview:
    selected letter -> highlighted cells -> predicted word / territory / combo.
    It is intentionally best-effort and never mutates the live state.
    """
    letter = (letter or "").upper()[:1]
    if not letter or not letter.isalpha():
        return []

    excluded = set(state.usedWords)
    player = state.currentPlayer
    try:
        raw_moves = _fast_bot_moves_for_letter(state, letter, max_results=limit * 4, excluded=excluded)
    except Exception:
        raw_moves = []

    by_cell: dict[tuple[int, int], dict] = {}
    for m in raw_moves:
        try:
            after = validate_and_apply_move(
                clone_state(state),
                m["row"], m["col"], m["letter"], m["path"],
                advance_market_flag=False,
            )
            last = after.moveHistory[-1]
            if not _is_ui_word(last.word):
                continue
            combos = list(last.comboLabels or [])
            value = (
                last.territoryGained * 2
                + last.wordScoreGained
                + last.fortifiedCellsGained * 2
                + last.captureCount * 5
                + (4 if "BRIDGE" in combos else 0)
                + (4 if "CUT" in combos else 0)
                + (3 if "LONG PATH" in combos else 0)
                + (3 if any(str(c).startswith("SYNERGY") for c in combos) else 0)
            )
            kind = "SAFE"
            if last.captureCount > 0 or "BRIDGE" in combos or "CUT" in combos or any(str(c).startswith("SYNERGY") for c in combos):
                kind = "POWER"
            elif len(last.word) >= 5 or "LONG PATH" in combos:
                kind = "LONG"
            elif last.territoryGained <= 2:
                kind = "SETUP"

            syn_hint = _synergy_preview_text(state, combos, player, last.word, letter,
                                             path=last.path, row=m["row"], col=m["col"])
            roles = [c for c in combos if not str(c).startswith("SYNERGY")]
            if syn_hint:
                roles.append(syn_hint)
            tier = "safe"
            if last.captureCount > 0 or "BRIDGE" in combos or any(str(c).startswith("SYNERGY") for c in combos) or syn_hint:
                tier = "strong"
            elif last.territoryGained >= 5 or "CUT" in combos:
                tier = "frontline"
            elif "LONG PATH" in combos or len(last.word) >= 5:
                tier = "path"
            item = {
                "row": m["row"],
                "col": m["col"],
                "letter": letter,
                "word": last.word,
                "territoryGain": last.territoryGained,
                "gain": last.territoryGained,
                "wordScore": last.wordScoreGained,
                "lockGain": last.fortifiedCellsGained,
                "captureCount": last.captureCount,
                "comboLabels": combos,
                "roles": roles,
                "synergyPreview": syn_hint,
                "kind": kind,
                "tier": tier,
                "value": value,
                "path": [{"row": p.row, "col": p.col} for p in last.path],
            }
            key = (item["row"], item["col"])
            if key not in by_cell or item["value"] > by_cell[key]["value"]:
                by_cell[key] = item
        except Exception:
            continue

    moves = sorted(by_cell.values(), key=lambda x: (-x["value"], -x["territoryGain"], x["word"]))
    return moves[:limit]



def get_threat_preview(state: GameState, limit: int = 8) -> list[dict]:
    """Return opponent capture threats against the current player.

    This is intentionally lightweight: it simulates a small set of opponent moves
    and returns cells/regions that may swing next turn. It powers the UI warning
    layer without making the bot omniscient.
    """
    if state.winner:
        return []
    defender = state.currentPlayer
    attacker = other_player(defender)
    probe = clone_state(state)
    probe.currentPlayer = attacker
    try:
        moves = _fast_bot_moves(probe, max_len=4, max_results=limit * 4, excluded=set(state.usedWords))
    except Exception:
        moves = []
    threats = []
    seen = set()
    for m in moves:
        try:
            after = validate_and_apply_move(clone_state(probe), m["row"], m["col"], m["letter"], m["path"], advance_market_flag=False)
            last = after.moveHistory[-1]
            if last.captureCount <= 0 and "CUT" not in (last.comboLabels or []):
                continue
            endangered = []
            for c in (after.lastCapturedCells or []):
                # Captured by attacker: warn defender that this cell/area is vulnerable.
                key = (c.row, c.col)
                if key not in seen:
                    seen.add(key)
                    endangered.append({"row": c.row, "col": c.col})
            if not endangered and last.captureCount <= 0:
                continue
            threats.append({
                "row": m["row"],
                "col": m["col"],
                "word": last.word,
                "territorySwing": last.territoryGained,
                "captureCount": last.captureCount,
                "comboLabels": last.comboLabels or [],
                "cells": endangered,
                "reason": f"{attacker} may swing +{last.territoryGained} with {last.word}",
                "level": "high" if last.captureCount >= 2 or "BRIDGE" in (last.comboLabels or []) else "medium",
            })
            if len(threats) >= limit:
                break
        except Exception:
            continue
    return threats

def get_market_stats(state: GameState) -> list[dict]:
    """Return stats for each active market letter."""
    stats = []
    for letter in state.marketLetters:
        s = _letter_best_stats(state, letter)
        s["letter"] = letter
        stats.append(s)
    return stats


def find_candidate_words(state: GameState, limit: int = 15) -> list[str]:
    """Return PLAYABLE words for Suggested — filtered for common words."""
    excluded = set(state.usedWords)
    moves = _fast_bot_moves(state, max_len=4, max_results=limit * 2, excluded=excluded)
    seen = set()
    result = []
    for m in moves:
        w = m["word"]
        if w in seen or not _is_ui_word(w):
            continue
        seen.add(w)
        result.append(w)
        if len(result) >= limit:
            break
    return result

def snapshot(state: GameState):
    owners = {(cell.row, cell.col): cell.owner for row in state.board for cell in row}
    locked = {(cell.row, cell.col): cell.fortified for row in state.board for cell in row}
    red_total = total_score(state, "RED")
    blue_total = total_score(state, "BLUE")
    leader = "RED" if red_total > blue_total else "BLUE" if blue_total > red_total else "TIE"
    return owners, locked, red_total, blue_total, leader


def diff_cells(before_state: GameState, after_state: GameState, player: str):
    before_owner, before_locked, before_red, before_blue, before_leader = snapshot(before_state)
    after_owner, after_locked, after_red, after_blue, after_leader = snapshot(after_state)

    changed = []
    captured = []
    newly_locked = []
    territory_gain = 0
    capture_count = 0

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            before = before_owner[(r, c)]
            after = after_owner[(r, c)]
            if before != after:
                changed.append(Coord(row=r, col=c))
            if before != player and after == player:
                territory_gain += 1
                if before is not None and before != player:
                    captured.append(Coord(row=r, col=c))
                    capture_count += 1
            if not before_locked[(r, c)] and after_locked[(r, c)] and after == player:
                newly_locked.append(Coord(row=r, col=c))

    return {
        "changed": changed,
        "captured": captured,
        "newly_locked": newly_locked,
        "territory_gain": territory_gain,
        "capture_count": capture_count,
        "leader_changed": before_leader != after_leader and before_leader != "TIE" and after_leader != "TIE",
        "red_total": after_red,
        "blue_total": after_blue,
    }


def _count_connected_regions(state, player: str) -> int:
    """Count how many disconnected regions player owns (for BRIDGE/CUT detection)."""
    visited = set()
    regions = 0
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if state.board[r][c].owner == player and (r, c) not in visited:
                regions += 1
                stack = [(r, c)]
                while stack:
                    cr, cc = stack.pop()
                    if (cr, cc) in visited:
                        continue
                    visited.add((cr, cc))
                    for nr, nc in get_neighbors(cr, cc):
                        if state.board[nr][nc].owner == player and (nr, nc) not in visited:
                            stack.append((nr, nc))
    return regions


def find_cross_words(state, row: int, col: int, letter: str) -> list[str]:
    """Find all valid words formed by placing letter at (row,col) in any direction."""
    found = []
    words = get_words()
    # Check all 4 directions: right, down, left, up
    for dr, dc in [(0,1),(1,0),(0,-1),(-1,0)]:
        # Walk to start of potential word in opposite direction
        r, c = row - dr, col - dc
        while in_bounds(r,c) and state.board[r][c].letter:
            r -= dr; c -= dc
        r += dr; c += dc
        # Read the word in this direction
        chars = []
        rr, cc = r, c
        while in_bounds(rr, cc) and (state.board[rr][cc].letter or (rr==row and cc==col)):
            chars.append(letter if (rr==row and cc==col) else state.board[rr][cc].letter)
            rr += dr; cc += dc
        word_str = "".join(chars).upper()
        if len(word_str) >= 3 and word_str in words and word_str not in found:
            found.append(word_str)
    return found


def combo_labels(word: str, territory_gain: int, lock_gain: int,
                 capture_count: int, leader_changed: bool,
                 before_state=None, after_state=None, player: str = "RED",
                 cross_words: list | None = None,
                 row: int = -1, col: int = -1) -> list[str]:
    labels = []

    # ── Power moves ───────────────────────────────────────────────────────────
    if len(word) >= 5:
        labels.append("LONG PATH")
    if territory_gain >= 6:
        labels.append("MEGA TERRITORY")
    if lock_gain >= 3:
        labels.append("FORTIFY CHAIN")
    if capture_count >= 1:
        labels.append("CAPTURE")
    if capture_count >= 2:
        labels.append("DOUBLE CAPTURE")
    if leader_changed:
        labels.append("SWING MOVE")

    # ── Cross Word Bonus (もじぴったん的連鎖) ─────────────────────────────────
    if cross_words and len(cross_words) >= 2:
        labels.append("CROSS WORD")    # 1手で2語以上 +2T

    # ── Early Yaku (序盤でも出る役) ──────────────────────────────────────────
    if before_state and after_state:
        opponent = "BLUE" if player == "RED" else "RED"
        before_my_t  = sum(1 for r in before_state.board for c in r if c.owner == player)
        after_my_t   = sum(1 for r in after_state.board  for c in r if c.owner == player)
        before_opp_t = sum(1 for r in before_state.board for c in r if c.owner == opponent)
        after_opp_t  = sum(1 for r in after_state.board  for c in r if c.owner == opponent)

        # FIRST CAPTURE — first time taking opponent's cell this game
        before_hist = [m for m in before_state.moveHistory if "CAPTURE" in (m.comboLabels or [])]
        if capture_count >= 1 and not before_hist:
            labels.append("FIRST CAPTURE")

        # EDGE REACH — player reaches the board edge for the first time
        edge_before = any(
            before_state.board[r][c].owner == player
            for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
            if r in (0, BOARD_SIZE-1) or c in (0, BOARD_SIZE-1)
        )
        edge_after = any(
            after_state.board[r][c].owner == player
            for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
            if r in (0, BOARD_SIZE-1) or c in (0, BOARD_SIZE-1)
        )
        if not edge_before and edge_after:
            labels.append("EDGE REACH")

        # LINK only fires if BRIDGE didn't (BRIDGE is the stronger version)
        # Both are checked via region counting — skip standalone LINK to reduce spam

        # COMEBACK — player was behind, now leads or closes gap significantly
        before_leader = "RED" if before_state.scores.redTerritory > before_state.scores.blueTerritory else "BLUE"
        if before_leader != player and leader_changed:
            labels.append("COMEBACK")

        # BRIDGE and CUT
        before_regions = _count_connected_regions(before_state, player)
        after_regions  = _count_connected_regions(after_state, player)
        if before_regions > 1 and after_regions < before_regions:
            labels.append("BRIDGE")
        before_opp_r = _count_connected_regions(before_state, opponent)
        after_opp_r  = _count_connected_regions(after_state, opponent)
        if after_opp_r > before_opp_r:
            labels.append("CUT")

    return labels


def apply_locks(state: GameState):
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            cell = state.board[r][c]
            if cell.owner is None:
                cell.fortified = False
                continue
            owner = cell.owner
            all_same = True
            for nr, nc in get_neighbors(r, c):
                if state.board[nr][nc].owner != owner:
                    all_same = False
                    break
            if r in (0, BOARD_SIZE - 1) or c in (0, BOARD_SIZE - 1):
                all_same = False
            cell.fortified = all_same


def apply_captures(state: GameState, player: str):
    visited = set()
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if (r, c) in visited or state.board[r][c].owner == player:
                continue
            region = []
            queue = deque([(r, c)])
            touches_edge = False
            while queue:
                cr, cc = queue.popleft()
                if (cr, cc) in visited:
                    continue
                visited.add((cr, cc))
                current = state.board[cr][cc]
                if current.owner == player:
                    continue
                region.append((cr, cc))
                if cr in (0, BOARD_SIZE - 1) or cc in (0, BOARD_SIZE - 1):
                    touches_edge = True
                for nr, nc in get_neighbors(cr, cc):
                    if (nr, nc) not in visited and state.board[nr][nc].owner != player:
                        queue.append((nr, nc))
            if not touches_edge:
                for rr, cc in region:
                    target = state.board[rr][cc]
                    # 案4: locked cells can be captured when surrounded
                    target.owner = player


def recalc_scores(state: GameState, current_player_for_word_score: str | None = None, last_word: str | None = None):
    state.scores.redTerritory = count_territory(state, "RED")
    state.scores.blueTerritory = count_territory(state, "BLUE")
    if last_word and current_player_for_word_score:
        score = word_score(last_word)
        if current_player_for_word_score == "RED":
            state.scores.redWord += score
        else:
            state.scores.blueWord += score


def path_contains(path, row: int, col: int) -> bool:
    return any(p.row == row and p.col == col for p in path)


def validate_path_and_word(state: GameState, row: int, col: int, letter: str, path):
    if not path_contains(path, row, col):
        raise ValueError("Your placed letter must be part of the word path.")
    seen = set()
    chars = []
    for i, p in enumerate(path):
        if not in_bounds(p.row, p.col):
            raise ValueError("Path out of bounds")
        key = (p.row, p.col)
        if key in seen:
            raise ValueError("You cannot use the same cell twice in a path.")
        seen.add(key)
        if i > 0 and not are_adjacent(path[i - 1], p):
            raise ValueError("Cells must be directly connected — no diagonals.")
        cell = state.board[p.row][p.col]
        if p.row == row and p.col == col:
            chars.append(letter.upper())
        elif cell.letter is not None:
            chars.append(cell.letter.upper())
        else:
            raise ValueError("All non-placed path cells must contain letters")
    return "".join(chars).upper()


def recent_duplicate_blocked(state: GameState, word: str) -> bool:
    """Block any word already used in this game (not just the last few moves).
    Previous behaviour only blocked the last 3 moves, allowing the same word
    to cycle back every 4 turns. usedWords tracks the full game history.
    """
    return word.upper() in {w.upper() for w in state.usedWords}


def validate_and_apply_move(state: GameState, row: int, col: int, letter: str, path, advance_market_flag: bool = False):
    if state.winner:
        raise ValueError("Game already finished")
    if not in_bounds(row, col):
        raise ValueError("Out of bounds")
    if state.board[row][col].letter is not None:
        raise ValueError("Cell already occupied")
    if not letter or not letter.isalpha() or len(letter) != 1:
        raise ValueError("Letter must be one alphabet character")
    if not any(state.board[nr][nc].letter for nr, nc in get_neighbors(row, col)):
        raise ValueError("Place your letter next to an existing letter on the board.")

    word = validate_path_and_word(state, row, col, letter, path)
    if len(word) < 3 or len(word) > 6:
        raise ValueError(f"Need 3–6 letters. '{word}' has {len(word)}.")
    if recent_duplicate_blocked(state, word):
        raise ValueError(f"You already played {word} this game. Try another word.")
    if not is_valid_word(word):
        raise ValueError(f"'{word}' is not in the dictionary. Try a common English word.")
    player = state.currentPlayer

    before = clone_state(state)
    temp = deepcopy(state)
    temp.board[row][col].letter = letter.upper()
    # 3-letter words: cap territory to 2 cells to prevent short-word spam
    max_cells = 2 if len(word) == 3 else len(path)
    cells_claimed = 0
    for p in path:
        cell = temp.board[p.row][p.col]
        if cell.owner != player:
            if cells_claimed >= max_cells:
                continue
            cells_claimed += 1
        cell.owner = player
    apply_captures(temp, player)
    apply_locks(temp)
    recalc_scores(temp, current_player_for_word_score=player, last_word=word)

    delta = diff_cells(before, temp, player)

    # Detect cross words formed by this placement
    cross_words_formed = find_cross_words(before, row, col, letter)
    combos = combo_labels(
        word, delta["territory_gain"], len(delta["newly_locked"]),
        delta["capture_count"], delta["leader_changed"],
        before_state=before, after_state=temp, player=player,
        cross_words=cross_words_formed, row=row, col=col,
    )


    # ── Role bonus: award extra territory for strategic combos ───────────────
    bonus = 0
    # Power moves (中盤〜終盤)
    if "BRIDGE" in combos:        bonus += 3
    if "CUT" in combos:           bonus += 2
    if "FORTIFY CHAIN" in combos: bonus += 2
    if "DOUBLE CAPTURE" in combos:bonus += 1
    if "LONG PATH" in combos:    bonus += 1
    if "MEGA TERRITORY" in combos:bonus += 1
    # Cross Word (もじぴったん的連鎖)
    if "CROSS WORD" in combos:    bonus += 2
    # Early Yaku (序盤でも出る役)
    if "FIRST CAPTURE" in combos: bonus += 1
    if "EDGE REACH" in combos:    bonus += 1
    if "COMEBACK" in combos:      bonus += 2

    # Synergy Card bonus (Balatro-like build direction)
    base_bonus = bonus
    synergy_bonus = apply_synergy_bonus(temp, combos, player, word, letter, path=path, row=row, col=col)
    bonus_uncapped = base_bonus + synergy_bonus

    # ── Anti-snowball: cap bonus when player is already winning by 10+ cells ──
    bonus = bonus_uncapped
    if bonus > 0 and temp.scores:
        my_t   = temp.scores.redTerritory if player == "RED" else temp.scores.blueTerritory
        opp_t  = temp.scores.blueTerritory if player == "RED" else temp.scores.redTerritory
        lead   = my_t - opp_t
        if lead >= 15:
            bonus = min(bonus, 1)   # hard cap at 1 when crushing
        elif lead >= 10:
            bonus = min(bonus, 2)   # soft cap at 2 when comfortably ahead

    # Show the actual synergy contribution after any anti-snowball cap.
    actual_base_bonus = min(base_bonus, bonus)
    actual_synergy_bonus = max(0, bonus - actual_base_bonus)
    if actual_synergy_bonus > 0:
        syn_text = synergy_activation_text(temp, combos, player, word, letter, actual_synergy_bonus)
        if syn_text:
            combos.append(f"SYNERGY:{syn_text}")
    if bonus > 0:
        # Convert nearest unfortified non-player cells to player (bonus territory)
        import random as _r
        candidates = [
            (r, c) for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
            if temp.board[r][c].letter and temp.board[r][c].owner != player
            and not temp.board[r][c].fortified
        ]
        _r.shuffle(candidates)
        for r, c in candidates[:bonus]:
            temp.board[r][c].owner = player
        if candidates[:bonus]:
            apply_locks(temp)
            recalc_scores(temp)
            delta["territory_gain"] += min(bonus, len(candidates))

    item = MoveHistoryItem(
        turn=state.turn,
        player=player,
        word=word,
        moveType="WORD",
        placedRow=row,
        placedCol=col,
        placedLetter=letter.upper(),
        path=[Coord(row=p.row, col=p.col) for p in path],
        wordScoreGained=word_score(word),
        territoryGained=delta["territory_gain"],
        fortifiedCellsGained=len(delta["newly_locked"]),
        captureCount=delta["capture_count"],
        comboLabels=combos,
        redTotalAfter=delta["red_total"],
        blueTotalAfter=delta["blue_total"],
    )


    temp.usedWords.append(word)
    temp.moveHistory.append(item)
    combo_suffix = f" [{' | '.join(combos)}]" if combos else ""
    temp.recentMoves = [f"{player}: {word}{combo_suffix}"] + temp.recentMoves[:4]
    temp.lastChangedCells = delta["changed"]
    temp.lastCapturedCells = delta["captured"]
    temp.lastFortifiedCells = delta["newly_locked"]
    temp.lastComboLabels = combos
    temp.synergyState = update_synergy_state(temp, combos, is_seed=False)
    temp.currentPlayer = other_player(player)
    temp.turn += 1
    temp.consecutivePasses = 0

    if is_game_over(temp):
        temp.winner = decide_winner(temp)

    # Advance Letter Market — only for human player moves (flag=True)
    if advance_market_flag and temp.marketLetters:
        new_active, new_preview = advance_market(temp, letter)
        temp.marketLetters  = new_active
        temp.previewLetters = new_preview
    return temp


def apply_seed_move(state: GameState, row: int, col: int, letter: str, advance_market_flag: bool = False):
    if state.winner:
        raise ValueError("Game already finished")
    if not in_bounds(row, col) or state.board[row][col].letter is not None:
        raise ValueError("Seed move requires an empty cell")
    if not letter or not letter.isalpha() or len(letter) != 1:
        raise ValueError("Letter must be one alphabet character")
    if not any(state.board[nr][nc].letter for nr, nc in get_neighbors(row, col)):
        raise ValueError("Seed move must be next to existing letters")

    temp = deepcopy(state)
    player = state.currentPlayer
    temp.board[row][col].letter = letter.upper()
    temp.currentPlayer = other_player(player)
    temp.turn += 1
    temp.consecutivePasses = 0
    temp.lastChangedCells = [Coord(row=row, col=col)]
    temp.lastCapturedCells = []
    temp.lastFortifiedCells = []
    temp.lastComboLabels = []
    temp.synergyState = update_synergy_state(temp, [], is_seed=True)
    # Seed cost: opponent +1T (unless SEED_TACTICIAN or player has ≤2 cells)
    my_cells = sum(1 for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
                   if temp.board[r][c].owner == player)
    if state.selectedSynergy != "SEED_TACTICIAN" and my_cells > 2:
        import random as _r
        opp = other_player(player)
        give_cells = [(r, c) for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
                      if temp.board[r][c].letter and temp.board[r][c].owner == player
                      and not temp.board[r][c].fortified]
        if give_cells:
            _r.shuffle(give_cells)
            temp.board[give_cells[0][0]][give_cells[0][1]].owner = opp
    item = MoveHistoryItem(
        turn=state.turn,
        player=player,
        word="SEED",
        moveType="SEED",
        placedRow=row,
        placedCol=col,
        placedLetter=letter.upper(),
        path=[Coord(row=row, col=col)],
        redTotalAfter=total_score(temp, "RED"),
        blueTotalAfter=total_score(temp, "BLUE"),
    )
    temp.moveHistory.append(item)
    temp.recentMoves = [f"{player}: SEED ({letter.upper()})"] + temp.recentMoves[:4]
    if is_game_over(temp):
        temp.winner = decide_winner(temp)
    # Advance market — only for human player moves (flag=True)
    if advance_market_flag and temp.marketLetters:
        new_active, new_preview = advance_market(temp, letter.upper())
        temp.marketLetters  = new_active
        temp.previewLetters = new_preview
    return temp


def pass_turn(state: GameState):
    if state.winner:
        return state
    temp = deepcopy(state)
    current = temp.currentPlayer
    temp.currentPlayer = other_player(temp.currentPlayer)
    temp.turn += 1
    temp.consecutivePasses += 1
    temp.recentMoves = [f"{current}: PASS"] + temp.recentMoves[:4]
    temp.lastChangedCells = []
    temp.lastCapturedCells = []
    temp.lastFortifiedCells = []
    temp.lastComboLabels = []
    if is_game_over(temp):
        temp.winner = decide_winner(temp)
    return temp


def preview_move(state: GameState, row: int, col: int, letter: str, path) -> PreviewMoveResponse:
    try:
        word = validate_path_and_word(state, row, col, letter, path) if path else ""
        includes = path_contains(path, row, col) if path else False
        valid_len = 3 <= len(word) <= 6
        in_dict = is_valid_word(word) if valid_len else False
        response = PreviewMoveResponse(
            word=word,
            isValidLength=valid_len,
            includesPlacedCell=includes,
            isInDictionary=in_dict,
            wordScore=word_score(word) if in_dict else 0,
        )
        if in_dict and not recent_duplicate_blocked(state, word):
            after = validate_and_apply_move(clone_state(state), row, col, letter, path)
            last = after.moveHistory[-1]
            response.territoryGain = last.territoryGained
            response.lockGain = last.fortifiedCellsGained
            response.captureHappened = last.captureCount > 0
            response.captureCount = last.captureCount
            response.comboLabels = last.comboLabels
        return response
    except Exception as exc:
        return PreviewMoveResponse(errorMessage=str(exc))


def get_score_gap(state: GameState, player: str) -> int:
    """Return how many cells player is behind (positive = losing)."""
    opp = "BLUE" if player == "RED" else "RED"
    my_t  = sum(1 for r in state.board for c in r if c.owner == player)
    opp_t = sum(1 for r in state.board for c in r if c.owner == opp)
    return opp_t - my_t


def is_game_over(state: GameState) -> bool:
    if state.winner:
        return True
    if state.turn > MAX_TURNS or state.consecutivePasses >= 2:
        return True
    return all(cell.letter is not None for row in state.board for cell in row)


def decide_winner(state: GameState):
    # 案4: territory count is primary (Othello-style)
    red_t = count_territory(state, "RED")
    blue_t = count_territory(state, "BLUE")
    if red_t != blue_t:
        return "RED" if red_t > blue_t else "BLUE"
    # Tiebreak: word score
    if state.scores.redWord != state.scores.blueWord:
        return "RED" if state.scores.redWord > state.scores.blueWord else "BLUE"
    return "DRAW"


# BOT

def get_placeable_empty_cells(state: GameState):
    return [(r, c) for r in range(BOARD_SIZE) for c in range(BOARD_SIZE) if state.board[r][c].letter is None and any(state.board[nr][nc].letter for nr, nc in get_neighbors(r, c))]


def generate_paths_from_cell(state: GameState, placed, target_len: int):
    results = []
    seen = set()

    def dfs(path):
        if len(path) == target_len:
            if placed in path:
                key = tuple(path)
                if key not in seen:
                    seen.add(key)
                    results.append(path[:])
            return
        r, c = path[-1]
        for nr, nc in get_neighbors(r, c):
            if (nr, nc) in path:
                continue
            if (nr, nc) != placed and state.board[nr][nc].letter is None:
                continue
            path.append((nr, nc))
            dfs(path)
            path.pop()

    # Start from placed cell or existing cells near it; this supports placed letter in middle/end.
    starts = [placed]
    for nr, nc in get_neighbors(placed[0], placed[1]):
        if state.board[nr][nc].letter:
            starts.append((nr, nc))
    for start in starts:
        dfs([start])
    return results


def letters_from_path(state: GameState, path, placed, placed_letter):
    chars = []
    for r, c in path:
        if (r, c) == placed:
            chars.append(placed_letter)
        else:
            cell = state.board[r][c]
            if not cell.letter:
                return None
            chars.append(cell.letter)
    return "".join(chars).upper()


def find_word_path_for_target(state: GameState, target_word: str):
    target_word = target_word.upper()
    for er, ec in get_placeable_empty_cells(state):
        for idx, ch in enumerate(target_word):
            # placed letter must supply the matching letter at some path position.
            for path in generate_paths_from_cell(state, (er, ec), len(target_word)):
                if (er, ec) not in path:
                    continue
                if path.index((er, ec)) != idx:
                    continue
                if letters_from_path(state, path, (er, ec), ch) == target_word:
                    return {
                        "row": er,
                        "col": ec,
                        "letter": ch,
                        "path": [Coord(row=r, col=c) for r, c in path],
                        "word": target_word,
                    }
    return None


def generate_moves_for_lengths(
    state: GameState,
    lengths: set[int],
    limit_words: int,
    max_results: int,
    excluded: set[str] | None = None,
) -> list[dict]:
    """Find legal moves for the given word lengths.

    excluded: words to skip entirely (for bot: pass state.usedWords to prevent
              any repetition; for suggestions: pass recent few words).
              Defaults to the last-3-moves window used by the validator.
    """
    available = board_letters_set(state)
    if excluded is None:
        excluded = {m.word for m in state.moveHistory[-3:] if m.moveType == "WORD"}
    # All letters available because bot/player places exactly one new letter
    all_letters = available | set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

    def board_overlap(w: str) -> int:
        """Count letters in w that already exist on board — higher = more likely to have a valid path."""
        return sum(1 for c in w if c in available)

    words = sorted(
        (w for w in get_words() if len(w) in lengths and w not in excluded and can_spell_from_board(w, all_letters)),
        # Prefer words that use more existing board letters (faster to find a path),
        # tie-break: longer words first (stronger moves), then alphabetical
        key=lambda w: (-board_overlap(w), -len(w), w),
    )
    results = []
    for word in words[:limit_words]:
        move = find_word_path_for_target(state, word)
        if move:
            results.append(move)
            if len(results) >= max_results:
                break
    return results


def simulate_move(state: GameState, move):
    return validate_and_apply_move(clone_state(state), move["row"], move["col"], move["letter"], move["path"])


def evaluate_state_for_player(state: GameState, player: str) -> float:
    opponent = other_player(player)
    return (
        (total_score(state, player) - total_score(state, opponent)) * 5.0
        + (count_territory(state, player) - count_territory(state, opponent)) * 2.2
        + (count_locked_cells(state, player) - count_locked_cells(state, opponent)) * 4.0
    )


def _fast_bot_moves(state: GameState, max_len: int, max_results: int, excluded: set) -> list[dict]:
    """
    Ultra-fast bot move finder for Render free tier.

    Hard limits to guarantee sub-1s response:
    - Max 4 placeable cells checked (random sample)
    - Max path length 4 (even for strong bot)
    - Stop immediately when max_results found
    """
    import string, random
    words = get_words()
    results = []
    LETTERS = string.ascii_uppercase

    placeable = get_placeable_empty_cells(state)
    # Hard cap: check at most 4 cells, chosen randomly for variety
    if len(placeable) > 4:
        placeable = random.sample(placeable, 4)

    # Hard cap path length to 4 regardless of what caller requests
    effective_len = min(max_len, 4)

    for (er, ec) in placeable:
        starts = [(er, ec)]
        for nr, nc in get_neighbors(er, ec):
            if state.board[nr][nc].letter:
                starts.append((nr, nc))
        # Max 3 starts per cell
        starts = starts[:3]

        for start in starts:
            stack = [([start], frozenset([start]))]
            while stack:
                path, visited = stack.pop()
                plen = len(path)

                if plen >= 3 and (er, ec) in set(path):
                    for placed_letter in LETTERS:
                        word = letters_from_path(state, path, (er, ec), placed_letter)
                        if word and word in words and word not in excluded and _is_ui_word(word):
                            results.append({
                                "row": er, "col": ec,
                                "letter": placed_letter,
                                "path": [Coord(row=r, col=c) for r, c in path],
                                "word": word,
                            })
                            if len(results) >= max_results:
                                return results

                if plen >= effective_len:
                    continue

                r, c = path[-1]
                for nr, nc in get_neighbors(r, c):
                    if (nr, nc) in visited:
                        continue
                    if (nr, nc) != (er, ec) and not state.board[nr][nc].letter:
                        continue
                    stack.append((path + [(nr, nc)], visited | {(nr, nc)}))

    return results


def generate_normal_moves(state: GameState) -> list[dict]:
    used = set(state.usedWords)
    return _fast_bot_moves(state, max_len=4, max_results=5, excluded=used)


def generate_strong_moves(state: GameState) -> list[dict]:
    used = set(state.usedWords)
    return _fast_bot_moves(state, max_len=4, max_results=8, excluded=used)


def choose_bot_move(state: GameState):
    if state.botLevel == "normal":
        moves = generate_normal_moves(state)
        if not moves:
            return None
        player = state.currentPlayer
        def quick_score(m):
            try:
                ns = simulate_move(state, m)
                base = evaluate_state_for_player(ns, player)
                last = ns.moveHistory[-1]
                bonus = sum(3 if l in ("BRIDGE","CUT") else
                            2 if l in ("CAPTURE","CROSS WORD") else 1
                            for l in (last.comboLabels or []))
                return base + bonus
            except Exception:
                return word_score(m["word"])
        return max(moves, key=quick_score)

    # Strong bot: score all candidates, pick best
    legal_moves = generate_strong_moves(state)
    if not legal_moves:
        return None
    player = state.currentPlayer
    best_move = None
    best_value = -10**9
    for move in legal_moves:
        try:
            next_state = simulate_move(state, move)
        except Exception:
            continue
        my_value = evaluate_state_for_player(next_state, player)
        last = next_state.moveHistory[-1]
        # Role bonus weighting — prefer moves that earn strategic combos
        combo_value = 0
        for label in (last.comboLabels or []):
            if label in ("BRIDGE", "CUT"):           combo_value += 8
            elif label in ("CROSS WORD", "FORTIFY CHAIN"): combo_value += 5
            elif label in ("DOUBLE CAPTURE", "COMEBACK"): combo_value += 4
            elif label in ("LONG PATH", "CAPTURE"):  combo_value += 3
            elif label in ("EDGE REACH", "FIRST CAPTURE"): combo_value += 2
            else:                                     combo_value += 1
        value = my_value + word_score(move["word"]) * 1.4 + combo_value
        if value > best_value:
            best_value = value
            best_move = move
    return best_move



def choose_demo_bot_move(state: GameState):
    """Trailer / Watch Demo move picker.

    This deliberately favors readable, map-changing turns over raw win rate.
    It makes Spectator Mode useful as a 30-second explanation tool.
    """
    legal_moves = _fast_bot_moves(state, max_len=5, max_results=28, excluded=set(state.usedWords))
    if not legal_moves:
        return choose_bot_move(state)

    player = state.currentPlayer
    best_move = None
    best_value = -10**9

    for move in legal_moves:
        try:
            ns = simulate_move(state, move)
            last = ns.moveHistory[-1]
        except Exception:
            continue

        word = (last.word or "").upper()
        combos = last.comboLabels or []
        is_demo = _is_demo_word(word)

        value = 0
        value += last.territoryGained * 2.2
        value += last.captureCount * 10
        value += last.fortifiedCellsGained * 4
        value += word_score(word) * 1.2
        value += 9 if "BRIDGE" in combos else 0
        value += 7 if "CUT" in combos else 0
        value += 6 if "FORTIFY CHAIN" in combos else 0
        value += 5 if "DOUBLE CAPTURE" in combos else 0
        value += 3 if "LONG PATH" in combos else 0
        value += 10 if any(str(c).startswith("SYNERGY") for c in combos) else 0

        # demo readability
        if word in _DEMO_WORD_PROMOTE:
            value += 7
        if not is_demo:
            value -= 12
        if len(word) == 3 and last.captureCount == 0 and "BRIDGE" not in combos:
            value -= 4

        # prefer visible map changes over tiny score nudges
        if last.territoryGained < 3 and not combos:
            value -= 5

        # Don't make the same kind of tiny move again and again.
        if state.moveHistory:
            prev = state.moveHistory[-1]
            if prev.moveType == "WORD" and prev.word and len(prev.word) == len(word) == 3:
                value -= 3

        if value > best_value:
            best_value = value
            best_move = move

    return best_move or choose_bot_move(state)


def apply_demo_bot_move(state: GameState):
    if state.winner:
        return state
    move = choose_demo_bot_move(state)
    if move:
        try:
            return validate_and_apply_move(
                state, move["row"], move["col"], move["letter"], move["path"]
            )
        except Exception:
            pass
    return apply_bot_move(state)


def choose_seed_move(state: GameState):
    letters = list("ETAONRISL")
    cells = get_placeable_empty_cells(state)
    if not cells:
        return None
    r, c = random.choice(cells)
    return r, c, random.choice(letters)


def apply_bot_move(state: GameState):
    if state.winner:
        return state
    # Try word move
    move = choose_bot_move(state)
    if move:
        try:
            return validate_and_apply_move(
                state, move["row"], move["col"], move["letter"], move["path"]
            )
        except Exception:
            pass  # Fall through to seed move
    # Fallback: seed move
    seed = choose_seed_move(state)
    if seed:
        try:
            return apply_seed_move(state, *seed)
        except Exception:
            pass
    # Last resort: pass
    return pass_turn(state)
