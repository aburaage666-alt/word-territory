# Bot Design

## Normal

- prioritizes fast 3–4 letter moves
- intended for quick testing and beginner play
- uses Seed Move if stuck

## Strong

Strong tries to behave more like a spatial strategy player:

- searches 5–6 letter words when available
- uses capped one-ply lookahead
- values territory swing
- values capture
- values locked cells
- values combo potential

The bot is intentionally capped for hosted environments such as Replit.
