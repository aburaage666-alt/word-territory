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


def summarize_match(state, match_id):
    red, blue = get_score(state)
    moves = list(getattr(state, "moveHistory", []) or [])

    captures = 0
    bridges = 0
    locks = 0
    synergies = 0
    wilds = 0
    seeds = 0
    passes = 0
    three_letter_words = 0
    word_moves = 0

    best_swing = -999
    best_word = ""
    best_labels = []

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
        synergies += 1 if any(x.startswith("SYNERGY") for x in labels) else 0
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

    return {
        "match_id": match_id,
        "winner": winner,
        "red_cells": red,
        "blue_cells": blue,
        "score_gap": abs(red - blue),
        "turns": getattr(state, "turn", 0),
        "moves": len(moves),
        "captures": captures,
        "bridges": bridges,
        "locks": locks,
        "synergies": synergies,
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


def run_match(match_id, mode="normal", bot_level="normal", max_turns=60, seed=None):
    if seed is not None:
        random.seed(seed)

    state = build_initial_state(bot_level=bot_level)

    safety = 0
    while not getattr(state, "winner", None) and safety < max_turns:
        state = safe_apply_bot(state, mode=mode)
        safety += 1

    return summarize_match(state, match_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--mode", choices=["demo", "normal"], default="normal")
    parser.add_argument("--bot-level", choices=["normal", "strong"], default="normal")
    parser.add_argument("--max-turns", type=int, default=60)
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument("--csv", default="bot_match_results.csv")
    parser.add_argument("--json", default="bot_match_results.json")
    args = parser.parse_args()

    rows = []
    for i in range(args.games):
        row = run_match(
            match_id=i + 1,
            mode=args.mode,
            bot_level=args.bot_level,
            max_turns=args.max_turns,
            seed=args.seed + i,
        )
        rows.append(row)
        print(
            f"Match {i+1}: {row['winner']} "
            f"RED {row['red_cells']} - BLUE {row['blue_cells']} "
            f"turns={row['turns']} best={row['best_word']} +{row['best_swing']}"
        )

    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    with open(args.json, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    winners = Counter(r["winner"] for r in rows)

    print("\n=== Summary ===")
    print("Winners:", dict(winners))
    print("Avg turns:", round(sum(r["turns"] for r in rows) / len(rows), 2))
    print("Avg score gap:", round(sum(r["score_gap"] for r in rows) / len(rows), 2))
    print("Avg captures:", round(sum(r["captures"] for r in rows) / len(rows), 2))
    print("Avg bridges:", round(sum(r["bridges"] for r in rows) / len(rows), 2))
    print("Avg locks:", round(sum(r["locks"] for r in rows) / len(rows), 2))
    print("Avg synergies:", round(sum(r["synergies"] for r in rows) / len(rows), 2))
    print("Avg wild uses:", round(sum(r["wild_uses"] for r in rows) / len(rows), 2))
    print("Avg 3-letter ratio:", round(sum(r["three_letter_ratio"] for r in rows) / len(rows), 3))
    print(f"\nSaved: {args.csv}")
    print(f"Saved: {args.json}")


if __name__ == "__main__":
    main()
