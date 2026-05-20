import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";

// ── Animated demo board (static snapshot, no backend needed) ─────────────────
const DEMO_BOARD = [
  [null, null, null, null, null],
  [null, "R",  null, "B",  null],
  [null, "R",  "R",  "B",  null],
  [null, null, "R",  "B",  null],
  [null, null, null, null, null],
];
const DEMO_LABELS = [
  { r: 1, c: 1, letter: "S", owner: "RED" },
  { r: 2, c: 1, letter: "T", owner: "RED" },
  { r: 2, c: 2, letter: "O", owner: "RED" },
  { r: 1, c: 3, letter: "N", owner: "BLUE" },
  { r: 2, c: 3, letter: "E", owner: "BLUE" },
  { r: 3, c: 2, letter: "A", owner: "RED" },
  { r: 3, c: 3, letter: "R", owner: "BLUE" },
];

function DemoCell({ owner, letter, highlight, placed }) {
  const bg = owner === "RED" ? "rgba(192,57,43,.18)"
           : owner === "BLUE" ? "rgba(34,113,179,.18)"
           : highlight ? "#e8fce8" : "#f8f8f8";
  const border = highlight ? "2px solid #5cb85c"
               : placed ? "3px solid #111"
               : "1.5px solid #ccc";
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 10, background: bg, border,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Arial Black, Arial", fontWeight: 900, fontSize: 18, color: "#111",
      boxShadow: placed ? "inset 0 0 0 3px #111" : "none",
      transition: "all .2s",
    }}>
      {letter || ""}
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16,
      padding: "20px 22px", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 32 }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
      <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ── FAQ item ──────────────────────────────────────────────────────────────────
function FAQ({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 12 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer", textAlign: "left",
          font: "700 15px/1.5 Arial, sans-serif", width: "100%",
          display: "flex", justifyContent: "space-between", padding: 0,
        }}
      >
        {q} <span style={{ color: "#999", fontSize: 18 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginTop: 8 }}>{a}</div>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function About() {
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith("wt_daily_"));
      setPlayed(keys.length > 0);
    } catch {}
  }, []);

  return (
    <>
      <Head>
        <title>Word Territory — A Spatial Strategy Word Game</title>
        <meta name="description"
          content="Word Territory is a spatial strategy game where you use words to capture territory, lock cells, and outmaneuver your opponent. Free Daily Challenge, no account needed." />
        <meta property="og:title" content="Word Territory — Strategy meets vocabulary" />
        <meta property="og:description"
          content="Use words to capture territory. Surround regions to lock them. Play the free Daily Challenge — same board for everyone, every day." />
        <meta property="og:url" content="https://wordterritory.com/about" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ background: "#f0f2f5", minHeight: "100vh", fontFamily: "Arial, sans-serif" }}>

        {/* ── Nav ── */}
        <nav style={{
          background: "#111", color: "#fff", padding: "12px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: "Arial Black, Arial", fontWeight: 900, fontSize: 18, letterSpacing: 2 }}>
            WORD TERRITORY
          </span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {played && <span style={{ fontSize: 12, color: "#aaa" }}>🔥 You&apos;ve played before</span>}
            <Link href="/" style={{
              background: "#fff", color: "#111", border: "none", borderRadius: 10,
              padding: "8px 16px", fontWeight: 800, cursor: "pointer", textDecoration: "none",
              fontSize: 14,
            }}>
              Play Now
            </Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section style={{
          background: "linear-gradient(135deg, #111 0%, #1a1a2e 100%)",
          color: "#fff", padding: "64px 24px", textAlign: "center",
        }}>
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <div style={{ fontSize: 13, letterSpacing: 3, color: "#888", marginBottom: 16, fontWeight: 700 }}>
              FREE DAILY CHALLENGE
            </div>
            <h1 style={{
              fontFamily: "Arial Black, Arial", fontWeight: 900,
              fontSize: "clamp(36px, 8vw, 72px)", letterSpacing: 4, marginBottom: 16, lineHeight: 1.1,
            }}>
              WORD<br />TERRITORY
            </h1>
            <p style={{ fontSize: "clamp(16px, 3vw, 20px)", color: "#aaa", lineHeight: 1.7, marginBottom: 32 }}>
              Not just a word game. A spatial strategy game.<br />
              Use words to <strong style={{ color: "#fff" }}>capture territory</strong>,{" "}
              <strong style={{ color: "#fff" }}>lock cells</strong>, and{" "}
              <strong style={{ color: "#fff" }}>outmaneuver</strong> your opponent.
            </p>

            {/* Demo mini-board */}
            <div style={{
              display: "inline-grid",
              gridTemplateColumns: "repeat(5, 48px)",
              gap: 6, marginBottom: 32, background: "rgba(255,255,255,.05)",
              padding: 16, borderRadius: 16,
            }}>
              {Array.from({ length: 5 }, (_, r) =>
                Array.from({ length: 5 }, (_, c) => {
                  const cell = DEMO_LABELS.find(d => d.r === r && d.c === c);
                  return (
                    <DemoCell
                      key={`${r}-${c}`}
                      owner={cell?.owner}
                      letter={cell?.letter}
                      highlight={!cell && ((r === 4 && c === 2) || (r === 0 && c === 2))}
                    />
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/" style={{
                background: "#fff", color: "#111", borderRadius: 12, padding: "14px 32px",
                fontWeight: 900, fontSize: 18, textDecoration: "none", letterSpacing: 1,
              }}>
                Play Today&apos;s Daily →
              </Link>
              <Link href="/" style={{
                background: "transparent", color: "#fff", border: "2px solid rgba(255,255,255,.3)",
                borderRadius: 12, padding: "14px 24px", fontWeight: 700, fontSize: 16,
                textDecoration: "none",
              }}>
                Free Play (vs Bot)
              </Link>
            </div>
            <p style={{ fontSize: 12, color: "#555", marginTop: 16 }}>
              No account. No app download. Play in your browser.
            </p>
          </div>
        </section>

        {/* ── What makes it different ── */}
        <section style={{ padding: "48px 24px", maxWidth: 900, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: 28, fontWeight: 900, marginBottom: 8 }}>
            Why Word Territory is different
          </h2>
          <p style={{ textAlign: "center", color: "#666", marginBottom: 32, fontSize: 15 }}>
            Most word games test vocabulary. This one tests strategy.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            <FeatureCard
              icon="🗺️"
              title="Territory, not just points"
              desc="Every word you play claims cells on the board. Surround your opponent's territory to capture it — like Go, but with words."
            />
            <FeatureCard
              icon="🔒"
              title="Lock and capture"
              desc="Fully surround a group of same-color cells to lock them permanently. Locked cells can't be captured — protect your territory wisely."
            />
            <FeatureCard
              icon="⚡"
              title="Combo moves"
              desc="Score SWING MOVE when you take the lead, MEGA TERRITORY for big gains, LOCK CHAIN for locking multiple cells at once."
            />
            <FeatureCard
              icon="🗓️"
              title="Daily Challenge"
              desc="Every day, everyone plays the same randomly-named opening. Share your score with a Wordle-style result card."
            />
            <FeatureCard
              icon="🏆"
              title="Daily Leaderboard"
              desc="See where you rank among all players who played today. Post your score and compare strategies."
            />
            <FeatureCard
              icon="🤖"
              title="Normal & Strong bot"
              desc="Normal bot for learning the game. Strong bot for a real challenge — it plays 5–6 letter words and thinks two moves ahead."
            />
          </div>
        </section>

        {/* ── How to play ── */}
        <section style={{ background: "#fff", padding: "48px 24px" }}>
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 24 }}>How to play</h2>
            {[
              ["1. Place a letter", "Tap any green-highlighted empty cell next to existing letters on the board. Type one letter to place it there."],
              ["2. Build a word path", "Select an orthogonally adjacent path across the board. Your placed letter can be anywhere in the path — beginning, middle, or end."],
              ["3. Claim territory", "Submit a valid 3–6 letter word. Every cell in your path becomes your territory (colored red or blue)."],
              ["4. Capture regions", "If you surround your opponent's cells on all sides, the enclosed region is captured and becomes yours."],
              ["5. Lock your territory", "Stable groups of your own cells that are fully surrounded by your territory become locked — shown with a bold border. Locked cells can't be taken."],
              ["6. Win by score", "Final score = Territory × 1.5 + Word Points. Territory matters more than vocabulary."],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{
                  minWidth: 36, height: 36, background: "#111", color: "#fff", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 900, fontSize: 13, flexShrink: 0,
                }}>
                  {title.split(".")[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{title.split(". ")[1]}</div>
                  <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Share example ── */}
        <section style={{ padding: "48px 24px", maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Share your result</h2>
          <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>After each Daily Challenge, copy and share your result card.</p>
          <div style={{
            background: "#f4f4f4", border: "1px solid #ddd", borderRadius: 14,
            padding: 24, display: "inline-block", textAlign: "left", maxWidth: 340,
          }}>
            <pre style={{ fontFamily: "monospace", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0 }}>
{`Word Territory Daily #139
2026-05-19  ·  RIVER OPENING

YOU (RED):  412.5 pts
BOT (BLUE): 389.0 pts

WIN  ·  47 turns
Best move: CASTLE (+9T)

wordterritory.com`}
            </pre>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section style={{ background: "#fff", padding: "48px 24px" }}>
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>FAQ</h2>
            <FAQ q="Is it free?" a="Yes. Daily Challenge, Normal bot, and Leaderboard are all free, forever. A Premium tier is in development for players who want to support the game." />
            <FAQ q="Do I need an account?" a="No. No account, no email, no signup. Play directly in your browser." />
            <FAQ q="What's the difference between Normal and Strong bot?" a="Normal bot prefers short 3–4 letter words and plays fast. Strong bot searches for longer words and evaluates captures and locks one move ahead. Strong bot is a real challenge." />
            <FAQ q="Can I play on mobile?" a="Yes. The game is mobile-optimised. You can also add it to your home screen as a PWA from your browser menu (Add to Home Screen)." />
            <FAQ q="What does 'RIVER OPENING' mean?" a="Each daily board starts with 7 letters placed in a fixed shape. The opening name is deterministically chosen from the date — everyone in the world plays the same opening that day." />
            <FAQ q="How is the score calculated?" a="Score = Territory × 1.5 + Word Points. Territory is the number of cells you own. Word points are 1/2/3/5 for 3/4/5/6-letter words. Territory weight is higher to reward spatial play." />
            <FAQ q="What is a Seed Move?" a="When you can't form a valid word, you can place one letter without claiming territory. This opens up new word paths for future turns. Bots also use Seed Moves when stuck." />
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section style={{
          background: "linear-gradient(135deg, #111 0%, #1a1a2e 100%)",
          color: "#fff", padding: "64px 24px", textAlign: "center",
        }}>
          <h2 style={{ fontFamily: "Arial Black", fontWeight: 900, fontSize: 36, letterSpacing: 2, marginBottom: 12 }}>
            PLAY TODAY
          </h2>
          <p style={{ color: "#888", marginBottom: 32, fontSize: 16 }}>
            Every day, a new board. Same opening for everyone worldwide.
          </p>
          <Link href="/" style={{
            background: "#fff", color: "#111", borderRadius: 12, padding: "16px 40px",
            fontWeight: 900, fontSize: 20, textDecoration: "none", letterSpacing: 1,
            display: "inline-block",
          }}>
            Play Daily Challenge →
          </Link>
          <p style={{ fontSize: 12, color: "#444", marginTop: 20 }}>
            No account. No download. Just strategy.
          </p>
        </section>

        {/* ── Footer ── */}
        <footer style={{
          background: "#0a0a0a", color: "#444", padding: "24px",
          textAlign: "center", fontSize: 13,
        }}>
          <p>
            Word Territory — built with FastAPI + Next.js ·{" "}
            <a href="https://github.com" style={{ color: "#555" }}>GitHub</a> ·{" "}
            <Link href="/" style={{ color: "#555" }}>Play</Link>
          </p>
          <p style={{ marginTop: 8 }}>
            Word data: <a href="https://github.com/rspeer/wordfreq" style={{ color: "#555" }}>wordfreq</a> (CC BY-SA 4.0) ·
            Game concept &amp; code © 2026 Word Territory
          </p>
        </footer>
      </div>
    </>
  );
}
