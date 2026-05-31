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
        openingName=opening_name,
        lastChangedCells=[],
        lastCapturedCells=[],
        lastFortifiedCells=[],
        lastComboLabels=[],
    )
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


# Words to exclude from Suggested / Almost UI.
# Keep the underlying dictionary permissive, but do not surface obscure,
# abbreviation-like, or player-confusing entries in beginner-facing hint panels.
_SUGGESTED_EXCLUDE = frozenset({
    'HRS','HES','MAS','EST','SIM','IDES','ODES','PHI','PSI','ETA',
    'TAO','OCA','EFT','OFT','ERE','EKE','GOB','POI','KOI','ZIT',
    'JUT','OOH','AAH','HMM','DOIT','NARC','OTIC','ALEC',
    # UI-filter additions from playtest feedback
    'TOSH','LENO','VAR','FARO','TARO','GEN','OAR','MAR','PAR',
    'ELKS',  # valid but awkward as a first visible Almost hint
})

# Common words get priority in Suggested / Almost panels. This is not a full
# dictionary; it is a presentation bias so players see natural words first.
_COMMON_UI_WORDS = frozenset({
    'ARE','ARM','ART','ATE','BAR','BAT','BEAR','BARN','BEND','BENT','BET',
    'CAN','CAR','CARE','CART','CAT','DEN','EAR','EARN','EAT','FAR','FARM',
    'HAT','HEN','HER','KIN','MAN','MEAN','MEAT','NEAR','NET','NOTE','ONE',
    'RAN','RAT','RATE','ROAD','ROSE','SEA','SEAT','SIN','SON','STAR','STONE',
    'STORE','TAR','TEA','TEN','TONE','TON','TUSK','WAR','WATER',
})

def _is_ui_word(word: str) -> bool:
    """Return whether a word should be shown in player-facing hints.

    The game validator may allow more dictionary words, but the UI should prefer
    words that feel recognizable. This reduces 'is that a word?' friction.
    """
    if not word:
        return False
    w = word.upper()
    if w in _SUGGESTED_EXCLUDE:
        return False
    if not (3 <= len(w) <= 6):
        return False
    # Avoid obvious abbreviation/odd-vowel patterns unless whitelisted.
    if len(w) == 3 and w not in _COMMON_UI_WORDS:
        # Let simple vowel-rich words through, but hide many Scrabble-only items.
        if sum(1 for ch in w if ch in 'AEIOU') == 0:
            return False
    return True


# ── Letter Market ─────────────────────────────────────────────────────────────

# English letter frequency (rough weights)
_LETTER_WEIGHTS = {
    'E':12,'T':9,'A':8,'O':8,'I':7,'N':7,'S':6,'H':6,'R':6,'D':4,'L':4,
    'C':3,'U':3,'M':2,'W':2,'F':2,'G':2,'Y':2,'P':2,'B':2,'V':1,'K':1,
    'J':1,'X':1,'Q':1,'Z':1,
}
_ALL_LETTERS = list(_LETTER_WEIGHTS.keys())
_WEIGHTS     = [_LETTER_WEIGHTS[l] for l in _ALL_LETTERS]


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
    """Return UI-facing stats for one active market letter.

    The legal dictionary can remain broad, but the displayed best word and count
    are filtered so the market does not advertise obscure entries as the main
    path forward.
    """
    excluded = set(state.usedWords)
    raw_moves = _fast_bot_moves_for_letter(state, letter, max_results=16, excluded=excluded)
    moves = [m for m in raw_moves if _is_ui_word(m.get("word", ""))]

    if not moves:
        return {
            "wordCount": 0,
            "bestGain": 0,
            "bestWord": "",
            "roles": [],
            "kind": "SETUP",
            "hint": "setup",
        }

    best = max(moves, key=lambda m: (m.get("territory_gain", 0), len(m.get("word", ""))))
    roles = []
    for m in moves[:5]:
        w = m.get("word", "")
        if len(w) >= 5 and "POWER WORD" not in roles:
            roles.append("POWER WORD")

    best_gain = best.get("territory_gain", 0)
    word_count = len(moves)
    kind = "SAFE"
    if best_gain >= 5 or roles:
        kind = "POWER"
    elif word_count <= 1:
        kind = "TACTIC"

    return {
        "wordCount": word_count,
        "bestGain":  best_gain,
        "bestWord":  best.get("word", ""),
        "roles":     roles[:2],
        "kind":      kind,
        "hint":      f"Best {best.get('word', '')}" if best.get("word") else "",
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
                if w and w in words and w not in excluded:
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
        raw_moves = _fast_bot_moves_for_letter(state, letter, max_results=10, excluded=excluded)
        moves = [m for m in raw_moves if _is_ui_word(m.get("word", ""))]
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

    # Slot 2: SETUP — Almost-guided (future value)
    try:
        almost = find_almost_words(state, limit=10)
        setup_candidates = [a["needs"] for a in almost
                            if a["needs"] not in board_letters and a["needs"] not in used]
        if setup_candidates:
            setup = setup_candidates[0]
            active.append(setup); used.add(setup)
    except Exception:
        pass

    # Fill any remaining slots
    while len(active) < 3:
        l = weighted_pick(used)
        active.append(l); used.add(l)

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
    Remove used_letter from active market, pull 1 from preview,
    replenish with an Almost-guided letter when possible.
    Returns (new_active, new_preview).
    """
    import random as _r
    RARE = {'Q','X','Z','J'}
    board_letters = board_letters_set(state)

    active = [l for l in state.marketLetters if l != used_letter]
    if len(active) < 3 and state.previewLetters:
        active.append(state.previewLetters[0])

    preview = state.previewLetters[1:] if len(state.previewLetters) > 1 else []

    # Refill preview — try to add an Almost-guided letter
    if len(preview) < 3:
        try:
            almost = find_almost_words(state, limit=6)
            good = [a["needs"] for a in almost
                    if a["needs"] not in board_letters
                    and a["needs"] not in active
                    and a["needs"] not in preview]
            _r.shuffle(good)
        except Exception:
            good = []

        existing = set(active) | set(preview)
        for l in good:
            if len(preview) >= 3: break
            preview.append(l)
        while len(preview) < 3:
            pool = [l for l in _ALL_LETTERS
                    if l not in RARE and l not in existing]
            if not pool:
                pool = [l for l in _ALL_LETTERS if l not in RARE]
            l = _r.choices(pool, weights=[_LETTER_WEIGHTS[l] for l in pool])[0]
            preview.append(l)
            existing.add(l)

    return active[:3], preview[:3]


def get_market_stats(state: GameState) -> list[dict]:
    """Return enriched stats for each active market letter.

    The first three cards should not look identical. We label them according to
    their tactical role: reliable play, high value/power, or setup/future value.
    """
    stats = []
    almost_by_letter = {}
    try:
        for a in find_almost_words(state, limit=8):
            almost_by_letter.setdefault(a["needs"], a["word"])
    except Exception:
        almost_by_letter = {}

    role_order = ["SAFE", "POWER", "SETUP"]
    for i, letter in enumerate(state.marketLetters):
        s = _letter_best_stats(state, letter)
        s["letter"] = letter

        # Market generation intentionally orders active cards as Safe / Power / Setup.
        # Keep that visible, while allowing genuinely powerful cards to advertise POWER.
        ordered_kind = role_order[i] if i < len(role_order) else s.get("kind", "TACTIC")
        if s.get("kind") == "POWER":
            ordered_kind = "POWER"
        if s.get("wordCount", 0) == 0:
            ordered_kind = "SETUP"
        s["kind"] = ordered_kind

        setup_word = almost_by_letter.get(letter)
        if setup_word:
            s["setupWord"] = setup_word
            if not s.get("hint"):
                s["hint"] = f"Completes {setup_word}"
        elif s.get("bestWord"):
            s["hint"] = f"Best {s['bestWord']}"
        else:
            s["hint"] = "Seed setup"
        stats.append(s)
    return stats


def find_candidate_words(state: GameState, limit: int = 15) -> list[str]:
    """Return UI-friendly playable words for Suggested."""
    excluded = set(state.usedWords)
    moves = _fast_bot_moves(state, max_len=4, max_results=limit * 4, excluded=excluded)
    seen = set()
    result = []
    # Prefer common/natural words first, then higher territory estimate.
    moves = sorted(
        moves,
        key=lambda m: (
            0 if m["word"] in _COMMON_UI_WORDS else 1,
            -len(m["word"]),
            m["word"],
        )
    )
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
        labels.append("POWER WORD")
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
    if "POWER WORD" in combos:    bonus += 1
    if "MEGA TERRITORY" in combos:bonus += 1
    # Cross Word (もじぴったん的連鎖)
    if "CROSS WORD" in combos:    bonus += 2
    # Early Yaku (序盤でも出る役)
    if "FIRST CAPTURE" in combos: bonus += 1
    if "EDGE REACH" in combos:    bonus += 1
    if "COMEBACK" in combos:      bonus += 2

    # ── Anti-snowball: cap bonus when player is already winning by 10+ cells ──
    if bonus > 0 and temp.scores:
        my_t   = temp.scores.redTerritory if player == "RED" else temp.scores.blueTerritory
        opp_t  = temp.scores.blueTerritory if player == "RED" else temp.scores.redTerritory
        lead   = my_t - opp_t
        if lead >= 15:
            bonus = min(bonus, 1)   # hard cap at 1 when crushing
        elif lead >= 10:
            bonus = min(bonus, 2)   # soft cap at 2 when comfortably ahead
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
    temp.currentPlayer = other_player(player)
    temp.turn += 1
    temp.consecutivePasses = 0

    if is_game_over(temp):
        temp.winner = decide_winner(temp)

    # Advance Letter Market only for the human/player market action.
    # Bot simulations and bot turns should not consume the player's market.
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
    # Advance market only when explicitly requested.
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


def is_game_over(state: GameState) -> bool:
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
    return None


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
                        if word and word in words and word not in excluded:
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
            elif label in ("POWER WORD", "CAPTURE"):  combo_value += 3
            elif label in ("EDGE REACH", "FIRST CAPTURE"): combo_value += 2
            else:                                     combo_value += 1
        value = my_value + word_score(move["word"]) * 1.4 + combo_value
        if value > best_value:
            best_value = value
            best_move = move
    return best_move


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
