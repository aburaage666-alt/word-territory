import argparse
import csv
import json
import random
from collections import Counter

from engine import (
    build_initial_state,
    apply_demo_bot_move,
    apply_bot_move,
    pass_turn,
)


# Labels that should be counted as "synergy-like" even if the engine did not
# prefix them with "SYNERGY:" in comboLabels.
SYNERGY_LABEL_HINTS = (
    "SYNERGY",
    "COMEBACK",
    "BRIDGE MASTER",
    "FORTIFIER",
    "FRONTLINE",
    "ENCIRCLER",
    "BORDER",
    "TRAP",
    "SHORT TACTICIAN",
    "SEED TACTICIAN",
    "CHAIN",
    "VOWEL",
    "LONG GAME",
)


def safe_apply_bot(state, mode="normal"):
    """Apply one bot move safely. Falls back to pass_turn if the engine errors."""
    try:
        if mode == "demo":
            next_state = apply_demo_bot_move(state)
        else:
            next_state = apply_bot_move(state)

        if next_state is None:
            return pass_turn(state)
        return next_state
    except Exception as e:
        print(f"[fallback] bot move failed: {type(e).__name__}: {e}")
        try:
            return pass_turn(state)
        except Exception:
            return state


def get_score(state):
    red = getattr(state.scores, "redTerritory", 0)
    blue = getattr(state.scores, "blueTerritory", 0)
    return red, blue


def labels_of(move):
    return [str(x) for x in (getattr(move, "comboLabels", None) or [])]


def label_is_synergy(label):
    up = str(label).upper()
    return any(key in up for key in SYNERGY_LABEL_HINTS)


def force_match_synergy(state, match_id, force_synergy="cycle"):
    """Set selectedSynergy for Bot-vs-Bot testing.

    force_synergy:
      - "none": do not alter the state
      - "random": choose randomly from state.synergyOptions
      - "cycle": rotate through state.synergyOptions match by match
      - any card id, e.g. "BRIDGE_MASTER" or "SHORT_TACTICIAN"
    """
    if force_synergy == "none":
        return state, getattr(state, "selectedSynergy", "") or ""

    options = list(getattr(state, "synergyOptions", []) or [])

    # Reasonable fallback list if engine does not expose state.synergyOptions.
    fallback = [
        "BRIDGE_MASTER",
        "FRONTLINE_TACTICIAN",
        "ENCIRCLER",
        "BORDER_LORD",
        "TRAP_SETTER",
        "FORTIFIER",
        "COMEBACK_SPARK",
        "SHORT_TACTICIAN",
    ]
    if not options:
        options = fallback

    if force_synergy == "random":
        chosen = random.choice(options)
    elif force_synergy == "cycle":
        chosen = options[(match_id - 1) % len(options)]
    else:
        chosen = force_synergy

    # Do not fail if chosen is not in options. This lets you test a new card id
    # after adding it to engine.py, even if the options list is stale.
    state.selectedSynergy = chosen
    if hasattr(state, "synergyState"):
        state.synergyState = {}

    return state, chosen


def summarize_match(state, match_id, selected_synergy=""):
    red, blue = get_score(state)
    moves = list(getattr(state, "moveHistory", []) or [])

    captures = 0
    bridges = 0
    locks = 0
    synergies = 0
    synergy_label_hits = 0
    wilds = 0
    seeds = 0
    passes = 0
    three_letter_words = 0
    word_moves = 0

    best_swing = -999
    best_word = ""
    best_labels = []
    synergy_labels = []

    for m in moves:
        word = str(getattr(m, "word", "") or "")
        move_type = str(getattr(m, "moveType", "") or "")
        territory = int(getattr(m, "territoryGained", 0) or 0)
        cap = int(getattr(m, "captureCount", 0) or 0)
        lock = int(getattr(m, "fortifiedCellsGained", 0) or 0)
        labels = labels_of(m)

        captures += cap
        locks += lock
        bridges += 1 if any("BRIDGE" in x for x in labels) else 0

        # Strict synergy count: engine-added SYNERGY labels.
        strict_hit = any(str(x).startswith("SYNERGY") for x in labels)
        # Broad synergy count: COMEBACK, SHORT TACTICIAN, etc.
        broad_hits = [x for x in labels if label_is_synergy(x)]

        if strict_hit:
            synergies += 1
        if broad_hits:
            synergy_label_hits += 1
            synergy_labels.extend(broad_hits)

        wilds += 1 if any("WILD" in x for x in labels) else 0
        seeds += 1 if move_type == "SEED" or word in ("SEED", "LAST STAND") else 0
        passes += 1 if move_type == "PASS" else 0

        if word and word not in ("SEED", "LAST STAND", "PASS"):
            word_moves += 1
            if len(word) == 3:
                three_letter_words += 1

        if territory > best_swing:
            best_swing = territory
            best_word = word
            best_labels = labels

    winner = getattr(state, "winner", "") or "DRAW"
    if not winner:
        winner = "RED" if red > blue else "BLUE" if blue > red else "DRAW"

    unique_synergy_labels = sorted(set(synergy_labels))

    return {
        "match_id": match_id,
        "selected_synergy": selected_synergy,
        "winner": winner,
        "red_cells": red,
        "blue_cells": blue,
        "score_gap": abs(red - blue),
        "turns": getattr(state, "turn", 0),
        "moves": len(moves),
        "captures": captures,
        "bridges": bridges,
        "locks": locks,
        # Strict SYNERGY: labels only.
        "synergies": synergies,
        # Broad label hits: includes COMEBACK, SHORT TACTICIAN, etc.
        "synergy_label_hits": synergy_label_hits,
        "synergy_labels": " / ".join(unique_synergy_labels),
        "wild_uses": wilds,
        "seed_uses": seeds,
        "pass_uses": passes,
        "word_moves": word_moves,
        "three_letter_words": three_letter_words,
        "three_letter_ratio": round(three_letter_words / word_moves, 3) if word_moves else 0,
        "best_swing": best_swing if best_swing != -999 else 0,
        "best_word": best_word,
        "best_labels": " / ".join(best_labels),
        "opening": getattr(state, "openingName", ""),
        "bot_style": getattr(state, "botStyle", ""),
    }


def run_match(match_id, mode="normal", bot_level="normal", max_turns=60, seed=None, force_synergy="cycle"):
    if seed is not None:
        random.seed(seed)

    state = build_initial_state(bot_level=bot_level)
    state, selected_synergy = force_match_synergy(state, match_id, force_synergy=force_synergy)

    safety = 0
    while not getattr(state, "winner", None) and safety < max_turns:
        state = safe_apply_bot(state, mode=mode)
        safety += 1

    return summarize_match(state, match_id, selected_synergy=selected_synergy)


def print_summary(rows):
    winners = Counter(r["winner"] for r in rows)
    selected = Counter(r["selected_synergy"] for r in rows)
    synergy_labels = Counter()
    for r in rows:
        for label in str(r.get("synergy_labels", "")).split(" / "):
            label = label.strip()
            if label:
                synergy_labels[label] += 1

    print("\n=== Summary ===")
    print("Winners:", dict(winners))
    print("Selected synergies:", dict(selected))
    print("Synergy labels:", dict(synergy_labels))
    print("Avg turns:", round(sum(r["turns"] for r in rows) / len(rows), 2))
    print("Avg score gap:", round(sum(r["score_gap"] for r in rows) / len(rows), 2))
    print("Avg captures:", round(sum(r["captures"] for r in rows) / len(rows), 2))
    print("Avg bridges:", round(sum(r["bridges"] for r in rows) / len(rows), 2))
    print("Avg locks:", round(sum(r["locks"] for r in rows) / len(rows), 2))
    print("Avg strict synergies:", round(sum(r["synergies"] for r in rows) / len(rows), 2))
    print("Avg broad synergy label hits:", round(sum(r["synergy_label_hits"] for r in rows) / len(rows), 2))
    print("Avg wild uses:", round(sum(r["wild_uses"] for r in rows) / len(rows), 2))
    print("Avg 3-letter ratio:", round(sum(r["three_letter_ratio"] for r in rows) / len(rows), 3))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--mode", choices=["demo", "normal"], default="normal")
    parser.add_argument("--bot-level", choices=["normal", "strong"], default="normal")
    parser.add_argument("--max-turns", type=int, default=60)
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument(
        "--force-synergy",
        default="cycle",
        help='none, random, cycle, or a card id such as BRIDGE_MASTER / SHORT_TACTICIAN',
    )
    parser.add_argument("--csv", default="bot_match_results_synergy.csv")
    parser.add_argument("--json", default="bot_match_results_synergy.json")
    args = parser.parse_args()

    rows = []
    for i in range(args.games):
        row = run_match(
            match_id=i + 1,
            mode=args.mode,
            bot_level=args.bot_level,
            max_turns=args.max_turns,
            seed=args.seed + i,
            force_synergy=args.force_synergy,
        )
        rows.append(row)
        print(
            f"Match {i+1}: {row['winner']} "
            f"RED {row['red_cells']} - BLUE {row['blue_cells']} "
            f"turns={row['turns']} synergy={row['selected_synergy']} "
            f"strictSyn={row['synergies']} broadSyn={row['synergy_label_hits']} "
            f"best={row['best_word']} +{row['best_swing']}"
        )

    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print_summary(rows)
    print(f"\nSaved: {args.csv}")
    print(f"Saved: {args.json}")


if __name__ == "__main__":
    main()
