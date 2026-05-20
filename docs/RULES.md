# Word Territory Rules

Original game concept and rule system by Keni Koyama.
LinkedIn:
https://www.linkedin.com/in/kuni-koyama-6566b7105/

# Word Territory Rules

## Objective

Win by having the higher total score when the game ends.

```text
total = territory × 1.5 + word points
```

## Turn structure

On a normal move:

1. Place one letter in an empty cell adjacent to existing letters.
2. Select an orthogonally connected word path.
3. The path must include the newly placed letter.
4. The newly placed letter may appear at the beginning, middle, or end.
5. Submit a valid 3–6 letter word.
6. Cells in the path become your territory.
7. Surrounded regions may be captured.
8. Stable cells may become locked.

## Seed Move

A rescue move for deadlocks.

- Place one letter next to existing letters.
- No word is formed.
- No territory is claimed.
- No word score is gained.
- Turn passes.

## Capture

A region that no longer connects to the board edge and is enclosed by a player's territory can be captured.

## LOCK

A cell can become locked when it is supported by same-color neighbors. Locked cells are harder to reclaim.

## Combo labels

- POWER WORD: 5–6 letter word
- MEGA TERRITORY: territory gain >= 8
- LOCK CHAIN: newly locked cells >= 3
- CAPTURE: at least one captured cell
- DOUBLE CAPTURE: capture count >= 2
- SWING MOVE: score leader changes

## Game identity

Word Territory is not simply about knowing many words. It is about using words to create board shape, pressure, expansion, capture, and territory swings.
