import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  botMove, createGame, createDailyGame, getDailyInfo, getDailyLeaderboard, getAlmost,
  getMarket, getSuggestions, joinWaitlist, passTurn, previewMove, seedMove,
  submitDailyScore, submitMove, useFreeLetter,
} from "../lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────
const asKey = (r, c) => `${r}-${c}`;
const adj    = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
// 案4: territory count is primary victory condition (Othello-style)
const tScore = (st, p) => !st ? 0 : p === "RED"
  ? st.scores.redTerritory
  : st.scores.blueTerritory;
const tScoreWord = (st, p) => !st ? 0 : p === "RED"
  ? st.scores.redWord : st.scores.blueWord;
const wScore = w => ({ 3:1,4:2,5:3,6:5 }[w?.length] || 0);

const LS_DAILY  = "wt_daily_";
const LS_PREM   = "wt_premium";  // ③⑤ premium flag
const LS_STREAK = "wt_streak";

const loadResult  = ds => { try { return JSON.parse(localStorage.getItem(LS_DAILY + ds) || "null"); } catch { return null; } };
const saveResult  = (ds, r) => { try { localStorage.setItem(LS_DAILY + ds, JSON.stringify(r)); } catch {} };
const isPremium   = () => { try { return localStorage.getItem(LS_PREM) === "true"; } catch { return false; } };

// ── Rank system ─────────────────────────────────────────────────────────────
function getRank(capturePct) {
  if (capturePct >= 80) return "Territory Master";
  if (capturePct >= 70) return "Commander";
  if (capturePct >= 60) return "Strategist";
  if (capturePct >= 50) return "Tactician";
  if (capturePct >= 40) return "Defender";
  return "Recruit";
}

function getRankEmoji(capturePct) {
  if (capturePct >= 80) return "👑";
  if (capturePct >= 70) return "⭐";
  if (capturePct >= 60) return "🎯";
  if (capturePct >= 50) return "🛡️";
  if (capturePct >= 40) return "⚔️";
  return "🔰";
}

// Wordle-style emoji board from final board state
function buildEmojiBoard(board) {
  if (!board) return "";
  return board.map(row =>
    row.map(cell => {
      if (!cell.letter) return "⬜";
      if (cell.owner === "RED") return "🟥";
      if (cell.owner === "BLUE") return "🟦";
      return "⬜";
    }).join("")
  ).join("\n");
}

function buildShare(num, ds, r) {
  const totalCells = 49; // 7x7
  const capturePct = Math.round((r.redScore / totalCells) * 100);
  const rank = getRank(capturePct);
  const rankEmoji = getRankEmoji(capturePct);
  const result = r.winner === "RED" ? "WIN 🎉" : r.winner === null ? "DRAW 🤝" : "LOSS 😤";
  const emojiBoard = r.emojiBoard || "";

  return [
    `Word Territory Daily #${num}`,
    `${rankEmoji} ${rank} — ${capturePct}% captured`,
    ``,
    result + `  ·  ${r.turns} turns`,
    r.bestMove ? `Best word: ${r.bestMove}` : null,
    ``,
    emojiBoard,
    `word-territory1.onrender.com`,
  ].filter(l => l !== null).join("\n");
}

function normalizeMarket(raw = {}) {
  const active = raw.active || raw.marketLetters || [];
  const preview = raw.preview || raw.previewLetters || [];
  const statsFromApi = raw.stats || [];
  const roleOrder = ["SAFE", "POWER", "SETUP"];
  const stats = active.map((letter, i) => {
    const s = statsFromApi.find(x => x.letter === letter) || statsFromApi[i] || {};
    return {
      letter,
      wordCount: Number(s.wordCount || 0),
      bestGain: Number(s.bestGain || 0),
      bestWord: s.bestWord || "",
      roles: s.roles || [],
      kind: s.kind || roleOrder[i] || "TACTIC",
      hint: s.hint || (s.bestWord ? `Best ${s.bestWord}` : "Setup"),
      setupWord: s.setupWord || "",
    };
  });
  return {
    active,
    preview,
    stats,
    freeLetterUsed: !!raw.freeLetterUsed,
  };
}

const marketLabel = (s, i) => s.kind || ["SAFE", "POWER", "SETUP"][i] || "TACTIC";

// ── Hand generator ───────────────────────────────────────────────────────────
// Frequencies loosely based on English letter frequency.
// Always guarantees ≥2 vowels in a 5-card hand.
const VOWELS     = "AAAEEEIIOOUU".split("");
const CONSONANTS = "BBCCDDFFGGHHHJKLLMMNNPPQRRRSSSTTTVVWWXYZ".split("");

function randomLetter(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dealHand(size = 5) {
  const tiles = [];
  // Guarantee 2 vowels
  tiles.push(randomLetter(VOWELS));
  tiles.push(randomLetter(VOWELS));
  // Fill rest with mix (may be vowel or consonant)
  for (let i = 2; i < size; i++) {
    tiles.push(Math.random() < 0.38 ? randomLetter(VOWELS) : randomLetter(CONSONANTS));
  }
  // Shuffle
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

function replaceCard(hand, usedLetter) {
  // Replace the first matching tile with a new random one
  const idx = hand.findIndex(c => c === usedLetter);
  if (idx === -1) return [...hand.slice(1), Math.random() < 0.38 ? randomLetter(VOWELS) : randomLetter(CONSONANTS)];
  const next = [...hand];
  // Ensure replacement keeps vowel balance
  const vowelCount = next.filter((c,i) => i !== idx && "AEIOU".includes(c)).length;
  next[idx] = vowelCount < 2 ? randomLetter(VOWELS) : (Math.random() < 0.38 ? randomLetter(VOWELS) : randomLetter(CONSONANTS));
  return next;
}

// ── StreakTracker (③) ─────────────────────────────────────────────────────────
function getStreak() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_STREAK) || "{}");
    return { count: raw.count || 0, lastDate: raw.lastDate || "" };
  } catch { return { count: 0, lastDate: "" }; }
}
function updateStreak(dateStr) {
  const prev = getStreak();
  const yesterday = new Date(dateStr);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  const count = prev.lastDate === yStr ? prev.count + 1 : prev.lastDate === dateStr ? prev.count : 1;
  try { localStorage.setItem(LS_STREAK, JSON.stringify({ count, lastDate: dateStr })); } catch {}
  return count;
}

// ── Cell ──────────────────────────────────────────────────────────────────────
function Cell({ cell, sel, placed, legal, changed, captured, lockedNow, disabled, gen, attack, inPath, onClick }) {
  const cls = ["cell",
    cell.owner === "RED" ? "cr" : cell.owner === "BLUE" ? "cb" : "",
    cell.fortified ? "ft" : "", sel ? "sl" : "", placed ? "pl" : "",
    legal ? "lg" : "", disabled && !sel ? "dm" : "",
    attack ? "atk" : "",   // opponent cell that can be attacked
    inPath ? "inpath" : "", // opponent cell currently in selected path (will be captured)
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled}
      data-chg={changed ? gen : null}
      data-cap={captured ? gen : null}
      data-lk={lockedNow ? gen : null}>
      {cell.letter || ""}
      {attack && !inPath && <span className="atk-dot"/>}
    </button>
  );
}

// ── HistItem ──────────────────────────────────────────────────────────────────
function HistItem({ m }) {
  return (
    <div className="hi">
      <div className="hi-head"><strong>T{m.turn} {m.player}</strong><span className="hiw">{m.word}</span></div>
      {m.moveType === "WORD" && (
        <div className="hi-stats">+{m.territoryGained}T +{m.wordScoreGained}W 🔒{m.fortifiedCellsGained}{m.captureCount > 0 ? ` ✦${m.captureCount}cap` : ""}</div>
      )}
      {m.comboLabels?.length > 0 && <div className="chips">{m.comboLabels.map(x => <span key={x} className="chip combo">{x}</span>)}</div>}
    </div>
  );
}

// ── LeaderboardModal ③④ ───────────────────────────────────────────────────────
function LeaderboardModal({ onClose, dailyInfo, myRank }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getDailyLeaderboard().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>🏆 Daily Leaderboard</h2>
        {dailyInfo && <p className="muted">Day #{dailyInfo.dayNumber} · {dailyInfo.dateStr}</p>}
        {loading && <p className="muted">Loading…</p>}
        {!loading && !data && <p className="muted">Could not load leaderboard.</p>}
        {data && (
          <>
            <p className="muted">{data.totalPlayers} player{data.totalPlayers !== 1 ? "s" : ""} today</p>
            {myRank && <div className="my-rank">Your rank: <strong>#{myRank}</strong> of {data.totalPlayers}</div>}
            <table className="lb-table">
              <thead><tr><th>#</th><th>Name</th><th>Score</th><th>Result</th><th>Turns</th></tr></thead>
              <tbody>
                {data.entries.map(e => (
                  <tr key={e.rank} className={myRank === e.rank ? "lb-you" : ""}>
                    <td>{e.rank}</td>
                    <td>{e.nickname}</td>
                    <td><strong>{e.score}</strong></td>
                    <td>{e.won ? "✅" : "❌"}</td>
                    <td>{e.turns}</td>
                  </tr>
                ))}
                {data.entries.length === 0 && <tr><td colSpan={5} className="muted">No scores yet today</td></tr>}
              </tbody>
            </table>
          </>
        )}
        <div className="modal-btns"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ── PremiumModal ⑤ ─ Waitlist-first (demand validation before payment impl) ──
const LS_WAITLIST = "wt_waitlist";
function PremiumModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(() => {
    try { return !!localStorage.getItem(LS_WAITLIST); } catch { return false; }
  });
  const [err, setErr] = useState("");

  function handleJoin() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) { setErr("Please enter a valid email."); return; }
    try { localStorage.setItem(LS_WAITLIST, trimmed); } catch {}
    // POST to backend — fire-and-forget (localStorage is source of truth for UX)
    joinWaitlist(trimmed).catch(() => {});
    setJoined(true);
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="prem-header">
          <span className="prem-crown">♟</span>
          <h2>Word Territory Premium</h2>
          <p className="muted">Support the game · Unlock everything</p>
        </div>
        <div className="prem-compare">
          <div className="prem-col">
            <div className="prem-tier free">Free</div>
            <ul>
              <li>✓ Daily Challenge (1/day)</li>
              <li>✓ Normal Bot unlimited</li>
              <li>✓ Daily Leaderboard</li>
              <li>✓ Move Preview</li>
              <li className="locked-feat">✗ Strong Bot unlimited</li>
              <li className="locked-feat">✗ Daily Streak stats</li>
              <li className="locked-feat">✗ Puzzle Mode (coming)</li>
              <li className="locked-feat">✗ Board themes</li>
              <li className="locked-feat">✗ Replay mode (coming)</li>
            </ul>
          </div>
          <div className="prem-col prem-highlight">
            <div className="prem-tier premium">Premium</div>
            <ul>
              <li>✓ Daily Challenge (1/day)</li>
              <li>✓ Normal Bot unlimited</li>
              <li>✓ Daily Leaderboard</li>
              <li>✓ Move Preview</li>
              <li>✓ <strong>Strong Bot unlimited</strong></li>
              <li>✓ <strong>Daily Streak + stats</strong></li>
              <li>✓ <strong>Puzzle Mode</strong></li>
              <li>✓ <strong>Board themes</strong></li>
              <li>✓ <strong>Replay mode</strong></li>
            </ul>
            <div className="prem-price">$3.99 <span>/month</span></div>
            <div className="prem-price-annual">or $29.99/year (save 37%)</div>

            {/* ⑤ Waitlist — collect demand before building payment */}
            {!joined ? (
              <div className="waitlist-box">
                <div className="waitlist-label">🚧 Payment coming soon</div>
                <div className="waitlist-sub">Join the waitlist to be notified first:</div>
                <div className="waitlist-row">
                  <input
                    className="waitlist-input" type="email" placeholder="your@email.com"
                    value={email} onChange={e => { setEmail(e.target.value); setErr(""); }}
                    onKeyDown={e => e.key === "Enter" && handleJoin()}
                  />
                  <button className="btn-prem-cta" onClick={handleJoin}>Join</button>
                </div>
                {err && <div className="waitlist-err">{err}</div>}
              </div>
            ) : (
              <div className="waitlist-ok">
                ✅ You&apos;re on the list! We&apos;ll email you when Premium launches.
              </div>
            )}
          </div>
        </div>
        <p className="prem-note">No ads, ever. No pay-to-win, ever.<br/>Premium is cosmetic + convenience only.</p>
        <div className="modal-btns"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [gameId, setGameId]     = useState("");
  const [state,  setState]      = useState(null);
  const [path,   setPath]       = useState([]);
  const [placed, setPlaced]     = useState(null);
  const [letter, setLetter]     = useState("");
  const [error,  setError]      = useState("");
  const [suggestions, setSugg]  = useState([]);
  const [mode,   setMode]       = useState("normal");
  const [thinking, setThinking] = useState(false);
  const [preview, setPreview]   = useState(null);
  const [showSummary, setSum]   = useState(false);
  const [copied, setCopied]     = useState(false);

  // UI panels
  const [showRules,   setRules]   = useState(false);
  const [showHistory, setHistory] = useState(true);
  const [showSuggest, setSuggest] = useState(true);
  const [showPremium, setPremium] = useState(false);
  const [showLB,      setShowLB]  = useState(false);  // ④

  // Combo banner persistence
  const [comboBanner, setCombo]   = useState([]);
  const comboTimer = useRef(null);
  const [animGen,  setAnimGen]    = useState(0);

  // Daily ③④
  const [dailyMode,   setDailyMode]   = useState(false);
  const [bootMsg, setBootMsg]       = useState("Preparing your board…");
  const [dailyInfo,   setDailyInfo]   = useState(null);
  const [dailyResult, setDailyResult] = useState(null);
  const [shareText,   setShareText]   = useState("");
  const [nickname,    setNickname]    = useState("");
  const [myRank,      setMyRank]      = useState(null);
  const [submitted,   setSubmitted]   = useState(false);
  const [almost,      setAlmost]      = useState([]);
  const [market,      setMarket]      = useState({ active:[], preview:[], stats:[], freeLetterUsed:false });
  const [freeLetter,  setFreeLetter]  = useState('');
  const [showFreeInput, setShowFreeInput] = useState(false);
  // Tutorial UX: track how many turns have been played
  const tutTurns = (state?.moveHistory?.length || 0);
  const isTutorial = tutTurns < 3;  // first 3 turns = beginner mode
  const [streak,      setStreak]      = useState(0);

  const summaryFired = useRef(false);
  const letterRef   = useRef(null);
  const histRef      = useRef(null);

  // ── mount ────────────────────────────────────────────────────────────────
  useEffect(() => {
    getDailyInfo().then(info => {
      setDailyInfo(info);
      const prev = loadResult(info.dateStr);
      if (prev) { setDailyResult(prev); setShareText(buildShare(info.dayNumber, info.dateStr, prev)); }
    }).catch(() => {});
    setStreak(getStreak().count);
  }, []);

  // ── boot helpers ─────────────────────────────────────────────────────────
  function resetMarket() {
    setMarket({ active:[], preview:[], stats:[], freeLetterUsed:false });
    setFreeLetter('');
    setShowFreeInput(false);
  }
  function reset() {
    setPath([]); setPlaced(null); setLetter(""); setError(""); setPreview(null);
    setSum(false); setCopied(false); setShareText(""); setNickname(""); setMyRank(null);
    setSubmitted(false); summaryFired.current = false;
  }
  async function refreshMarket(id = gameId) {
    if (!id) return;
    try {
      const mk = await getMarket(id);
      setMarket(normalizeMarket(mk));
    } catch (_) {
      // Keep the current board and current market. Never recreate the game here.
    }
  }
  async function boot(m = mode) {
    let lastErr;
    for (let attempt = 1; attempt <= 9; attempt++) {
      try {
        const d = await createGame({ botLevel: m });
        setGameId(d.game_id); setState(d.state); setDailyMode(false);
        reset(); setAnimGen(0); setBootMsg("");
        if (d.state?.marketLetters?.length > 0) {
          setMarket(normalizeMarket({
            active: d.state.marketLetters,
            preview: d.state.previewLetters || [],
            freeLetterUsed: !!d.state.freeLetterUsed,
          }));
          setLetter('');   // Clear selected letter — market controls it
          await refreshMarket(d.game_id);
        }
        getSuggestions(d.game_id).then(setSugg).catch(() => setSugg([]));
        getAlmost(d.game_id).then(setAlmost).catch(() => setAlmost([]));
        return;
      } catch(e) {
        lastErr = e;
        if (attempt < 6) {
          setBootMsg(`Almost ready… (${attempt * 10}s)`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
    setBootMsg("Could not connect. Please refresh.");
  }
  async function bootDaily() {
    if (!dailyInfo) return;
    const d = await createDailyGame();
    setGameId(d.game_id); setState(d.state); setDailyMode(true);
    reset(); setAnimGen(0);
    if (d.state?.marketLetters?.length > 0) {
      setMarket(normalizeMarket({
        active: d.state.marketLetters,
        preview: d.state.previewLetters || [],
        freeLetterUsed: !!d.state.freeLetterUsed,
      }));
      setLetter('');
      await refreshMarket(d.game_id);
    }
    getSuggestions(d.game_id).then(setSugg).catch(() => setSugg([]));
    getAlmost(d.game_id).then(setAlmost).catch(() => setAlmost([]));
  }
  useEffect(() => { boot().catch(e => setError(String(e))); }, []);

  // ── state tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    setAnimGen(g => g + 1);
    const c = state.lastComboLabels || [];
    if (c.length > 0) {
      setCombo(c);
      if (comboTimer.current) clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo([]), 3500);
    }
  }, [state?.turn]);

  // ── bot auto-move ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || !gameId) return;
    if (state.winner) return;
    if (state.currentPlayer !== state.botPlayer) return;
    let cancelled = false;
    const run = async () => {
      setThinking(true);
      try {
        await new Promise(r => setTimeout(r, 350));
        const next = await botMove(gameId);
        if (cancelled) return;
        setState(next);
        // Bot does not consume the player's market, but the board changed,
        // so recompute market stats against the new board.
        reset();
        await refreshMarket(gameId);
        try { setSugg(await getSuggestions(gameId)); } catch(_) {}
        try { setAlmost(await getAlmost(gameId)); } catch(_) {}
      } catch(e) {
        if (!cancelled) setError(e.message || "Bot failed");
      }
      if (!cancelled) setThinking(false);
    };
    run();
    return () => { cancelled = true; setThinking(false); };
  }, [state?.turn, state?.currentPlayer]);

  // ── game over ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    if (state.winner === null || state.winner === undefined) return;
    if (summaryFired.current) return;
    summaryFired.current = true;
    setSum(true);

    if (dailyMode && dailyInfo) {
      const wm = state.moveHistory.filter(m => m.moveType === "WORD");
      const best = [...wm].sort((a, b) =>
        (b.territoryGained*2 + b.wordScoreGained*1.5 + b.fortifiedCellsGained*2 + (b.captureCount?5:0)) -
        (a.territoryGained*2 + a.wordScoreGained*1.5 + a.fortifiedCellsGained*2 + (a.captureCount?5:0))
      )[0];
      const totalCells = 7 * 7;
      const redCells = tScore(state, "RED");
      const capturePct = Math.round((redCells / totalCells) * 100);
      const r = {
        redScore: redCells, blueScore: tScore(state, "BLUE"),
        winner: state.winner, turns: state.turn - 1,
        bestMove: best ? `${best.word} (+${best.territoryGained}T)` : null,
        openingName: state.openingName,
        capturePct,
        emojiBoard: buildEmojiBoard(state.board),
      };
      saveResult(dailyInfo.dateStr, r);
      setDailyResult(r);
      setShareText(buildShare(dailyInfo.dayNumber, dailyInfo.dateStr, r));
      const s = updateStreak(dailyInfo.dateStr); setStreak(s);

      // ④ Auto-submit score anonymously; player can re-submit with nickname from modal
      submitDailyScore({
        nickname: "Anonymous",
        redScore: r.redScore,
        blueScore: r.blueScore,
        won: r.winner === "RED",
        turns: r.turns,
      }).then(res => {
        setMyRank(res.rank);
      }).catch(() => {});
    }
  }, [state?.winner]);

  useEffect(() => { if (histRef.current) histRef.current.scrollTop = histRef.current.scrollHeight; }, [state?.moveHistory?.length]);

  // ── preview ──────────────────────────────────────────────────────────────
  const currentWord = useMemo(() => {
    if (!state) return "";
    return path.map(p => {
      if (placed && placed.row === p.row && placed.col === p.col) return letter || "";
      return state.board[p.row][p.col].letter || "";
    }).join("");
  }, [state, path, placed, letter]);

  useEffect(() => {
    if (!gameId || !placed || !letter || path.length === 0) { setPreview(null); return; }
    const h = setTimeout(async () => {
      try { setPreview(await previewMove(gameId, { row: placed.row, col: placed.col, letter, path })); }
      catch { setPreview(null); }
    }, 180);
    return () => clearTimeout(h);
  }, [gameId, placed, letter, JSON.stringify(path)]);

  // Auto-focus letter input when cell is placed
  useEffect(() => {
    if (placed && letterRef.current) letterRef.current.focus();
  }, [placed]);

  // ── board helpers ────────────────────────────────────────────────────────
  const human = () => state && !thinking && !state.winner && state.currentPlayer !== state.botPlayer;
  const isSel = (r,c) => path.some(p => p.row===r && p.col===c);

  // Opponent cells adjacent to any placeable empty cell = attackable
  const opponent = state?.currentPlayer === "RED" ? "BLUE" : "RED";
  const attackableSet = useMemo(() => {
    if (!state || !human()) return new Set();
    const s = new Set();
    const BS = state.board.length;
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const cell = state.board[r][c];
        if (cell.letter && cell.owner === opponent && !cell.fortified) {
          for (const [nr, nc] of [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]) {
            if (nr>=0&&nr<BS&&nc>=0&&nc<BS&&!state.board[nr][nc].letter) {
              s.add(asKey(r,c));
              break;
            }
          }
        }
      }
    }
    return s;
  }, [state?.turn, state?.currentPlayer]);

  // Opponent cells currently in the selected path (will be captured if submitted)
  const inPathOpponentSet = useMemo(() => {
    if (!path.length) return new Set();
    const s = new Set();
    path.forEach(p => {
      const cell = state?.board[p.row][p.col];
      if (cell?.owner === opponent) s.add(asKey(p.row, p.col));
    });
    return s;
  }, [path, state?.turn]);
  const hasNbr = (r,c) => {
    const b = state.board;
    const BS = b.length - 1;  // dynamic board size (6 for 7x7)
    return (r>0&&b[r-1][c].letter)||(r<BS&&b[r+1][c].letter)||(c>0&&b[r][c-1].letter)||(c<BS&&b[r][c+1].letter);
  };
  const isLegal = (r,c) => state && !state.board[r][c].letter && hasNbr(r,c);
  const isDim = (r,c) => {
    if (!state || !human()) return true;
    const cell = state.board[r][c];
    // Already selected cells are not dim but not clickable again
    if (isSel(r,c)) return false;
    // Phase 0: nothing selected yet
    if (path.length === 0) {
      // Can start from a green cell (will become placed) OR existing letter
      return !isLegal(r,c) && !cell.letter;
    }
    // Must be adjacent to last cell in path
    const last = path[path.length - 1];
    if (!adj(last, {row:r, col:c})) return true;
    // Can select: existing letter OR the green placed cell
    if (cell.letter) return false;
    if (isLegal(r,c) && !placed) return false; // green cell not yet set as placed
    if (placed && placed.row===r && placed.col===c) return false;
    return true;
  };

  function clickCell(r,c) {
    if (!state || !human()) return;
    const cell = state.board[r][c];

    // Deselect last cell if tapping it again (undo last step)
    if (path.length > 0 && path[path.length-1].row===r && path[path.length-1].col===c) {
      const newPath = path.slice(0, -1);
      setPath(newPath);
      // If we removed the placed cell from path, unset placed
      if (placed && placed.row===r && placed.col===c) {
        setPlaced(null);
      }
      return;
    }

    if (isSel(r,c)) return; // already in path (not last cell)

    // Phase 0: start path
    if (path.length === 0) {
      if (isLegal(r,c)) {
        // Green cell → becomes placed cell
        setPlaced({row:r, col:c});
        setPath([{row:r, col:c}]);
        setError("");
      } else if (cell.letter) {
        // Existing letter → start of path (placed cell comes later)
        setPath([{row:r, col:c}]);
        setError("");
      }
      return;
    }

    // Must be adjacent to last
    const last = path[path.length - 1];
    if (!adj(last, {row:r, col:c})) return;

    // Adding green cell (placed cell not yet set)
    if (isLegal(r,c) && !placed) {
      setPlaced({row:r, col:c});
      setPath(prev => [...prev, {row:r, col:c}]);
      setError("");
      return;
    }

    // Adding existing letter
    if (cell.letter) {
      setPath(prev => [...prev, {row:r, col:c}]);
      return;
    }

    // Adding the already-set placed cell
    if (placed && placed.row===r && placed.col===c) {
      setPath(prev => [...prev, {row:r, col:c}]);
    }
  }

  // ── move actions ─────────────────────────────────────────────────────────
  const refresh = async (id=gameId) => { try { setSugg(await getSuggestions(id)); } catch { setSugg([]); } };
  async function submit() {
    if (!placed) { setError("Tap a green square first."); return; }
    if (!letter) {
      setError("Choose a green square on the board first.");
      return;
    }

    try {
      const next = await submitMove({game_id:gameId,row:placed.row,col:placed.col,letter,path});
      setState(next);
      // Update market from state immediately, then refresh stats from backend.
      if (next.marketLetters?.length > 0) setMarket(normalizeMarket({
        active: next.marketLetters,
        preview: next.previewLetters || [],
        freeLetterUsed: next.freeLetterUsed || false,
      }));

      reset(); await refresh(); await refreshMarket(gameId);
      getAlmost(gameId).then(setAlmost).catch(()=>{});
    } catch(e) { setError(e.message||"Move failed"); }
  }
  async function seed() {
    if (!placed) { setError("Tap a green square first."); return; }
    if (!letter) { setError("Type one letter in the input box."); return; }
    try {
      const next = await seedMove(gameId,{row:placed.row,col:placed.col,letter});
      setState(next);
      if (next.marketLetters?.length > 0) setMarket(normalizeMarket({
        active: next.marketLetters,
        preview: next.previewLetters || [],
        freeLetterUsed: next.freeLetterUsed || false,
      }));

      reset(); await refresh(); await refreshMarket(gameId);
      getAlmost(gameId).then(setAlmost).catch(()=>{});
    } catch(e) { setError(e.message||"Seed failed"); }
  }
  async function pass() {
    try { const next = await passTurn(gameId); setState(next); reset(); await refresh(); }
    catch(e) { setError(e.message||"Pass failed"); }
  }

  // ④ Submit daily score to leaderboard
  async function submitScore() {
    if (!dailyInfo || !dailyResult || submitted) return;
    try {
      const nick = nickname.trim() || "Anonymous";
      const res = await submitDailyScore({
        nickname: nick,
        redScore: dailyResult.redScore,
        blueScore: dailyResult.blueScore,
        won: dailyResult.winner === "RED",
        turns: dailyResult.turns,
      });
      setMyRank(res.rank);
      setSubmitted(true);
    } catch { setError("Could not submit score"); }
  }

  // ── derived ──────────────────────────────────────────────────────────────
  const changedS  = new Set((state?.lastChangedCells||[]).map(c=>asKey(c.row,c.col)));
  const capturedS = new Set((state?.lastCapturedCells||[]).map(c=>asKey(c.row,c.col)));
  const lockedS   = new Set((state?.lastFortifiedCells  ||[]).map(c=>asKey(c.row,c.col)));
  const redT = tScore(state,"RED"), blueT = tScore(state,"BLUE");
  const pct  = Math.round((redT / Math.max(redT+blueT,1)) * 100);
  const incPlaced = placed && path.some(p=>p.row===placed.row&&p.col===placed.col);
  const ok = preview?.isInDictionary && preview?.includesPlacedCell;
  const topMoves = [...(state?.moveHistory||[])].filter(m=>m.moveType==="WORD")
    .sort((a,b)=>(b.territoryGained*2+b.wordScoreGained*1.5+b.fortifiedCellsGained*2+(b.captureCount?5:0))
                -(a.territoryGained*2+a.wordScoreGained*1.5+a.fortifiedCellsGained*2+(a.captureCount?5:0)))
    .slice(0,3);

  if (!state) return (
    <main className="loading">
      <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:18,padding:"40px 48px",textAlign:"center",maxWidth:380,width:"90%",boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        <div style={{fontFamily:"\"Arial Black\",Arial",fontWeight:900,fontSize:24,letterSpacing:3,marginBottom:20}}>WORD TERRITORY</div>
        <div style={{fontSize:15,fontWeight:700,color:"#333",marginBottom:8,minHeight:24}}>{bootMsg}</div>
        <div style={{fontSize:12,color:"#999",marginBottom:20,lineHeight:1.6}}>The first game of the day may take a moment.</div>
        <div style={{height:6,background:"#eee",borderRadius:999,overflow:"hidden"}}>
          <div style={{height:"100%",background:"#111",borderRadius:999,animation:"loadpulse 1.8s ease-in-out infinite"}}/>
        </div>
      </div>
      <style>{`@keyframes loadpulse{0%{width:10%}50%{width:75%}100%{width:10%}}`}</style>
    </main>
  );

  // ── render ────────────────────────────────────────────────────────────────
  return <>
    <Head>
      {/* ③ SEO + social meta tags */}
      <title>Word Territory{dailyMode&&dailyInfo?` · Daily #${dailyInfo.dayNumber}`:""}</title>
      <meta name="description" content="Word Territory is a spatial strategy game where you use words to capture territory, lock cells, and outmaneuver your opponent. Play the Daily Challenge!" />
      <meta property="og:title" content="Word Territory" />
      <meta property="og:description" content="A spatial strategy word game. Daily Challenge · Combo moves · Territory control." />
      <meta property="og:url" content="https://wordterritory.com" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Word Territory" />
      <meta name="twitter:description" content="Strategy meets vocabulary. Play the Daily Challenge!" />
      <meta name="theme-color" content="#111111" />
      <link rel="manifest" href="/manifest.json" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </Head>

    <main className="page">
      {/* ── header ── */}
      <div className="hdr">
        <div className="hdr-l">
          <h1>WORD TERRITORY{dailyMode&&dailyInfo&&<span className="dpill">Daily #{dailyInfo.dayNumber}</span>}</h1>
          <p className="sub">Opening: {state.openingName} · {thinking?"Bot thinking…":state.currentPlayer===state.botPlayer?"Bot's turn":`Your turn (${state.currentPlayer})`} · Round {state.turn}</p>
        </div>
        <div className="hdr-r">
          {!dailyMode&&(
            <div className="mode-box">
              <label>Bot</label>
              <select value={mode} onChange={e=>setMode(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="strong">Strong</option>
              </select>
            </div>
          )}
          {dailyInfo&&!dailyMode&&(
            <div className="dcard">
              <span className="dnum">Day #{dailyInfo.dayNumber}</span>
              <span className="dsub">{streak>1?`🔥 ${streak} day streak`:(dailyResult?"Completed ✓":dailyInfo.openingName)}</span>
              <div className="dcard-btns">
                <button className="btn-daily" onClick={dailyResult?()=>{setSum(true);setDailyMode(true);}:bootDaily}>
                  {dailyResult?"View":"Play"}
                </button>
                <button className="btn-daily-lb" onClick={()=>setShowLB(true)} title="Leaderboard">🏆</button>
              </div>
            </div>
          )}
          <button className="bsm" onClick={()=>setRules(v=>!v)}>{showRules?"✕ Rules":"? Rules"}</button>
          <Link href="/about" className="bsm" style={{textDecoration:"none",color:"#111"}}>About</Link>
          {!isTutorial && <button className="bsm prem-btn" onClick={()=>setPremium(true)}>✦ Premium</button>}
          {dailyMode
            ?<button className="bprim" onClick={()=>boot(mode)}>← Free Play</button>
            :<button className="bprim" onClick={()=>boot(mode)}>New Game</button>
          }
        </div>
      </div>

      {/* ── First-move guide ── */}
      {tutTurns === 0 && human() && (
        <div className="firstmove-banner">
          <strong>How to play:</strong>{" "}
          Choose a <strong>Letter Market</strong> tile → tap a <span className="fm-green">green square</span> → connect letters to make a word → press <strong>Capture Word</strong>
        </div>
      )}
      {/* ── score bar ── */}
      <div className="sbar">
        <div className="srow">
          <span className="stxt red-t">🔴 {redT} cells</span>
          <span className="smid">
            {isTutorial
              ? "Goal: more red cells than blue"
              : redT===blueT ? "Tied" : `${redT>blueT?"🔴 RED":"🔵 BLUE"} +${Math.abs(redT-blueT)}`}
          </span>
          <span className="stxt blue-t">{blueT} cells 🔵</span>
        </div>
        <div className="bar"><div className="br" style={{width:`${pct}%`}}/><div className="bb" style={{width:`${100-pct}%`}}/></div>
      </div>

      {/* ── rules ── */}
      {showRules&&(
        <div className="rules">
          <strong>Build words from a shared draft. Place letters. Capture territory.</strong>
          <ol>
            <li>Choose one tile from the <strong>Letter Market</strong> → tap a <em>green square</em> → connect letters to make a 3–6 letter word → press <strong>Capture Word ⚔</strong>.</li>
            <li>Example: board has D–S–T, place U → select D→U→S→T → DUST! Your letter can go anywhere in the path.</li>
            <li>Enclose opponent cells to <strong>capture</strong> them. Surrounded own cells become 🏰 <strong>Fortified</strong>.</li>
            <li><strong>Role Bonuses</strong> — earn extra territory: BRIDGE +3T · CUT +2T · CROSS WORD +2T · POWER WORD +1T</li>
            <li><strong>Seed</strong> — place a letter without capturing when stuck. Good for setting up future words.</li>
            <li><strong>Goal:</strong> More red cells than blue wins. Territory beats vocabulary.</li>
            <li><strong>Daily Challenge</strong> — same board worldwide each day. One attempt. Strong bot.</li>
          </ol>
        </div>
      )}

      {/* ── banners ── */}
      {dailyMode&&<div className="dbanner">🗓️ Daily #{dailyInfo?.dayNumber} · {dailyInfo?.dateStr} · Strong Bot{streak>1?` · 🔥 ${streak} day streak`:""}</div>}
      {thinking&&<div className="bnr thinking">Bot is thinking…</div>}
      {comboBanner.length>0&&<div className="bnr combo">{comboBanner.join(" · ")}</div>}
      {error&&<div className="bnr err">{error}<button className="bx" onClick={()=>setError("")}>✕</button></div>}

      {/* ── layout ── */}
      <div className="layout">
        <div className="bcol">
          {/* board */}
          <div className="bwrap">
            <div className="board-wrap"><div className="board">
              {state.board.map(row=>row.map(cell=>{
                const k=asKey(cell.row,cell.col);
                return <Cell key={k} cell={cell}
                  sel={isSel(cell.row,cell.col)} placed={placed?.row===cell.row&&placed?.col===cell.col}
                  legal={!placed&&isLegal(cell.row,cell.col)}
                  changed={changedS.has(k)} captured={capturedS.has(k)} lockedNow={lockedS.has(k)}
                  disabled={isDim(cell.row,cell.col)} gen={animGen}
                  attack={attackableSet.has(k) && !isSel(cell.row,cell.col)}
                  inPath={inPathOpponentSet.has(k)}
                  onClick={()=>clickCell(cell.row,cell.col)}/>;
              }))}
            </div>
          </div>
          </div>

          {/* ── Letter Market ── */}
          {market.active.length > 0 && !state.winner && (
            <div className="lm-panel">
              <div className="lm-header">
                <span className="lm-title">🎴 Letter Market</span>
                <span className="lm-preview">
                  Next: {market.preview.map((l,i) => {
                    const hit = almost.some(a => a.needs === l);
                    return <span key={i} className={`lm-prev-chip ${hit ? 'lm-next-hit' : ''}`} title={hit ? 'Completes an Almost word' : 'Upcoming letter'}>{l}</span>;
                  })}
                </span>
              </div>
              <div className="lm-active">
                {market.stats.map((s,i) => {
                  const kind = marketLabel(s, i);
                  const isSetup = kind === 'SETUP';
                  const title = s.bestWord
                    ? `${kind}: ${s.bestWord} +${s.bestGain}T`
                    : (s.setupWord ? `${kind}: completes ${s.setupWord}` : `${kind}: setup letter`);
                  return (
                    <button key={i}
                      className={`lm-tile lm-${kind.toLowerCase()} ${letter===s.letter ? 'lm-selected' : ''}`}
                      onClick={() => { setLetter(s.letter); setPath([]); setPlaced(null); setError(''); setPreview(null); }}
                      disabled={!human()}
                      title={title}
                    >
                      <span className="lm-kind">{kind}</span>
                      <span className="lm-letter">{s.letter}</span>
                      <span className="lm-stats">
                        {s.bestGain > 0 && <span className="lm-gain">+{s.bestGain}T</span>}
                        {s.wordCount > 0 && <span className="lm-count">{s.wordCount}w</span>}
                        {s.roles?.length > 0 && <span className="lm-role">{s.roles[0].substring(0,3)}</span>}
                        {s.wordCount === 0 && <span className="lm-zero">{isSetup ? 'setup' : 'no word'}</span>}
                      </span>
                      {(s.bestWord || s.setupWord) && <span className="lm-best">{s.bestWord || `→ ${s.setupWord}`}</span>}
                    </button>
                  );
                })}
                {/* Free Letter (Wild) */}
                {!market.freeLetterUsed ? (
                  <button className={`lm-tile lm-free ${showFreeInput ? 'lm-selected' : ''}`}
                    onClick={() => setShowFreeInput(v => !v)}
                    disabled={!human()}
                    title="Use once per game — choose any letter"
                  >
                    <span className="lm-letter">⭐</span>
                    <span className="lm-stats"><span className="lm-freeLabel">FREE</span></span>
                  </button>
                ) : (
                  <div className="lm-tile lm-free lm-used" title="Free letter already used">
                    <span className="lm-letter" style={{opacity:0.3}}>⭐</span>
                    <span className="lm-stats"><span className="lm-zero">USED</span></span>
                  </div>
                )}
              </div>
              {showFreeInput && (
                <div className="lm-free-row">
                  <input className="lm-free-input" maxLength={1}
                    placeholder="Type any letter"
                    value={freeLetter}
                    onChange={e => setFreeLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g,''))}
                    onKeyDown={e => {
                      if(e.key==='Enter' && freeLetter) {
                        useFreeLetter(gameId, freeLetter).then(r => {
                          setMarket(m => normalizeMarket({...m, ...r}));
                          setLetter(freeLetter);
                          setShowFreeInput(false);
                          setPath([]); setPlaced(null);
                        }).catch(e => setError(e.message));
                      }
                    }}
                  />
                  <button className="lm-free-confirm"
                    onClick={() => {
                      if(!freeLetter) return;
                      useFreeLetter(gameId, freeLetter).then(r => {
                        setMarket(m => normalizeMarket({...m, ...r}));
                        setLetter(freeLetter);
                        setShowFreeInput(false);
                        setPath([]); setPlaced(null);
                      }).catch(e => setError(e.message));
                    }}
                  >Use ⭐</button>
                </div>
              )}
            </div>
          )}

          {/* move controls */}
          <div className="mpanel">
            <div className="mrow">
              <label className="mlbl">{market.active.length > 0 ? "Selected" : "Letter"}</label>
              <input ref={letterRef}
                className={`minput${market.active.length > 0 && !letter ? ' minput-empty' : ''}`}
                value={letter} maxLength={1}
                disabled={!human()}
                readOnly={market.active.length > 0}
                onChange={e=>{ if(market.active.length===0) setLetter(e.target.value.toUpperCase().slice(0,1)); }}
                placeholder={market.active.length > 0 ? "—" : "A"}
                style={market.active.length > 0 && !letter ? {color:'#ccc'} : {}}
              />
              <div className={`pvbox ${ok?"pvok":""}`}>
                <div className="pvword">{currentWord||"—"}</div>
                {preview?(
                  preview.errorMessage
                    ?<div className="pverr">{preview.errorMessage}</div>
                    :<>
                      <div className="pvstats">
                        {preview.isInDictionary?"✓ Valid":"Not in dictionary"}
                        {" · "}+{preview.wordScore}pts · +{preview.territoryGain}T
                        {preview.lockGain>0&&` · 🔒${preview.lockGain}`}
                        {preview.captureHappened&&<span className="pvcap"> ⚔ CAPTURE +{preview.captureCount||1}</span>}
                      </div>
                      {preview.comboLabels?.length>0&&<div className="chips">{preview.comboLabels.map(x=><span key={x} className="chip combo">{x}</span>)}</div>}
                    </>
                ):(
                  <div className="pvhint">
                    {!placed
                      ? (market.active.length > 0 ? "Choose a Letter Market tile above, then tap a green square." : "Tap a green square to place a letter.")
                      : !letter
                      ? "Type one letter."
                      : path.length < 2
                      ? "Now tap connected letters to make a word."
                      : !incPlaced
                      ? "Path must include your placed letter."
                      : "Keep connecting — need 3–6 letters total."}
                  </div>
                )}
              </div>
            </div>
            {letter && market.stats.length > 0 && (
              <div className="selected-insight">
                {(() => {
                  const s = market.stats.find(x => x.letter === letter);
                  if (!s) return null;
                  return (
                    <>
                      <strong>{letter}</strong>
                      {s.bestWord
                        ? <> — {marketLabel(s, market.stats.indexOf(s))}: best <strong>{s.bestWord}</strong> (+{s.bestGain}T, {s.wordCount} words)</>
                        : <> — setup letter{s.setupWord ? <>: aims for <strong>{s.setupWord}</strong></> : <>. Use it to prepare a future word.</>}</>}
                    </>
                  );
                })()}
              </div>
            )}
            <div className="brow">
              <button className="ba bsubmit" onClick={submit} disabled={!human()}>{ok ? "Capture Word ⚔" : "Submit"}</button>
              {!isTutorial && <button className="ba bseed" onClick={seed} disabled={!human()}>Seed</button>}
              <button className="ba" onClick={()=>{ setPath([]); setPlaced(null); setError(''); setPreview(null); }} disabled={!human()}>Clear</button>
              {!isTutorial && <button className="ba" onClick={pass} disabled={!human()}>Pass</button>}
            </div>
          </div>
        </div>

        {/* side panel */}
        <div className="scol">
          {almost.length > 0 && (
            <div className="almost-box">
              <div className="almost-title">🀄 Almost — place one letter to make:</div>
              <div className="almost-list">
                {almost.map((a,i) => {
                  const inNext = market.preview.includes(a.needs);
                  return (
                    <span key={i} className={`almost-chip ${inNext ? 'almost-next' : ''}`} title={inNext ? 'This letter is visible in Next' : 'One-letter-away word'}>
                      +<strong>{a.needs}</strong> → {a.word}{inNext ? <em> next</em> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="panel">
            <div className="ph" onClick={()=>setSuggest(v=>!v)}>
              <span>💡 Suggested</span><span className="ci">{showSuggest?"▲":"▼"}</span>
            </div>
            {showSuggest&&(
              <div className="chips sc">
                {[...new Set(suggestions)].length ? [...new Set(suggestions)].slice(0, 15).map(w => <span key={w} className="chip">{w}</span>) : <div className="no-word-hint">No clean word found yet.<br/>Use <strong>Seed</strong> as a setup move, not a penalty.</div>}
              </div>
            )}
          </div>
          <div className="panel">
            <div className="ph" onClick={()=>setHistory(v=>!v)}>
              <span>📋 History</span><span className="ci">{showHistory?"▲":"▼"}</span>
            </div>
            {showHistory&&(
              <div className="hist" ref={histRef}>
                {!state.moveHistory.length&&<div className="muted">No moves yet</div>}
                {state.moveHistory.map((m,i)=><HistItem key={i} m={m}/>)}
              </div>
            )}
          </div>

          {/* ③ Streak widget */}
          {streak>0&&(
            <div className="streak-widget">
              <span className="streak-fire">🔥</span>
              <div>
                <div className="streak-num">{streak}</div>
                <div className="streak-lbl">day streak</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── summary modal ── */}
      {showSummary&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setSum(false)}>
          <div className="modal">
            {dailyMode&&dailyInfo?(
              <>
                <h2>Daily #{dailyInfo.dayNumber} {streak>1?`🔥 ${streak}`:""}
                </h2>
                <p className="muted">{dailyInfo.dateStr} · {dailyInfo.openingName}</p>
                <div className="scard">
                  <div className="scrow"><span>🔴 YOU</span><strong>{redT} cells</strong></div>
                  <div className="scrow"><span>🔵 BOT</span><strong>{blueT} cells</strong></div>
                  <div className="scres">{(dailyResult?.winner??state.winner)==="RED"?"✅ WIN":(dailyResult?.winner??state.winner)===null?"🤝 DRAW":"❌ LOSS"}</div>
                  <div className="muted tac">{(dailyResult?.turns??state.turn-1)} turns · Territory ×1.5 + Words</div>
                </div>
                {topMoves.length>0&&<><h3>Top Moves</h3>{topMoves.map((m,i)=><HistItem key={i} m={m}/>)}</>}

                {/* Share card */}
                {shareText&&(
                  <div className="swrap">
                    <pre className="spre">{shareText}</pre>
                    <button className="bcopy" onClick={async()=>{try{await navigator.clipboard.writeText(shareText);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{}}}>
                      {copied?"✓ Copied!":"Copy & Share"}
                    </button>
                  </div>
                )}

                {/* ④ Leaderboard submission */}
                <div className="lb-submit">
                  <h3>🏆 Post your score to the leaderboard</h3>
                  {!submitted?(
                    <div className="lb-form">
                      <input className="nick-input" value={nickname} maxLength={20} placeholder="Your name (optional)"
                        onChange={e=>setNickname(e.target.value)}/>
                      <button className="bprim" onClick={submitScore}>Post Score</button>
                    </div>
                  ):(
                    <div className="lb-ok">
                      Score posted! You are <strong>#{myRank}</strong> today.
                      <button className="bsm" style={{marginLeft:8}} onClick={()=>setShowLB(true)}>View Leaderboard</button>
                    </div>
                  )}
                </div>

                <div className="modal-btns">
                  <button className="bprim" onClick={()=>{setSum(false);boot(mode);}}>Free Play</button>
                  <button onClick={()=>setShowLB(true)}>🏆 Leaderboard</button>
                  <button onClick={()=>setSum(false)}>Close</button>
                </div>
              </>
            ):(
              <>
                <h2>Game Over</h2>
                <p>Winner: <strong>{state.winner||"Draw"}</strong></p>
                <div className="scard">
                  <div className="scrow"><span>🔴 RED</span><strong>{redT} cells</strong></div>
                  <div className="scrow"><span>🔵 BLUE</span><strong>{blueT} cells</strong></div>
                </div>
                {topMoves.length>0&&<><h3>Top Moves</h3>{topMoves.map((m,i)=><HistItem key={i} m={m}/>)}</>}
                <div className="modal-btns">
                  <button className="bprim" onClick={()=>boot(mode)}>New Game</button>
                  {dailyInfo&&!dailyResult&&<button onClick={()=>{setSum(false);bootDaily();}}>Daily Challenge</button>}
                  <button onClick={()=>setPremium(true)}>✦ Premium</button>
                  <button onClick={()=>setSum(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showLB&&<LeaderboardModal onClose={()=>setShowLB(false)} dailyInfo={dailyInfo} myRank={myRank}/>}
      {showPremium&&<PremiumModal onClose={()=>setPremium(false)}/>}
    </main>

    <style jsx global>{`
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#f0f2f5;color:#111;font-size:15px}
      .loading{padding:30px;text-align:center}
      .page{padding:14px;max-width:1400px;margin:0 auto}

      /* header */
      .hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}
      .hdr-l h1{font-size:22px;letter-spacing:2px;font-weight:900}
      .sub{font-size:12px;color:#666;margin-top:2px}
      .dpill{display:inline-block;background:#111;color:#fff;font-size:11px;border-radius:999px;padding:2px 9px;margin-left:8px;font-weight:700;vertical-align:middle}
      .hdr-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .mode-box{background:#fff;border:1px solid #ddd;border-radius:10px;padding:6px 10px;display:flex;flex-direction:column;gap:2px}
      .mode-box label{font-size:11px;color:#888}
      .mode-box select{border:none;outline:none;font-size:14px;font-weight:600;background:transparent;cursor:pointer}
      .dcard{background:#111;color:#fff;border-radius:12px;padding:8px 12px;display:flex;flex-direction:column;gap:3px;min-width:140px}
      .dnum{font-weight:800;font-size:14px}
      .dsub{font-size:11px;opacity:.65}
      .dcard-btns{display:flex;gap:5px;margin-top:4px}
      .btn-daily{background:#fff;color:#111;border:none;border-radius:7px;padding:5px 10px;font-weight:700;cursor:pointer;font-size:12px}
      .btn-daily:hover{background:#fffde7}
      .btn-daily-lb{background:transparent;border:1px solid rgba(255,255,255,.3);border-radius:7px;padding:4px 8px;cursor:pointer;font-size:14px}
      .btn-daily-lb:hover{background:rgba(255,255,255,.15)}
      .bsm{padding:8px 12px;border-radius:10px;border:1px solid #ccc;background:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
      .bsm:hover{background:#f5f5f5}
      .prem-btn{border-color:#d4af37;color:#b8860b;font-weight:700}
      .bprim{padding:9px 16px;border-radius:10px;border:none;background:#111;color:#fff;cursor:pointer;font-size:14px;font-weight:700;white-space:nowrap}
      .bprim:hover{background:#333}

      /* score bar */
      .sbar{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:12px 16px;margin-bottom:10px}
      .srow{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .stxt{font-weight:800;font-size:16px}
      .smid{font-size:13px;color:#555}
      .red-t{color:#c0392b}.blue-t{color:#2271b3}
      .bar{height:12px;display:flex;border-radius:999px;overflow:hidden;background:#e0e0e0}
      .br{background:rgba(192,57,43,.6);transition:width .4s ease}.bb{background:rgba(34,113,179,.6);transition:width .4s ease}

      /* rules */
      .rules{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:14px 18px;margin-bottom:10px;line-height:1.7}
      .rules ol{padding-left:18px}.rules li{margin-bottom:3px}

      /* banners */
      .dbanner{background:#111;color:#fff;border-radius:10px;padding:10px 14px;margin-bottom:10px;font-weight:700;font-size:13px}
      .bnr{padding:10px 14px;border-radius:10px;margin-bottom:10px;font-size:14px}
      .thinking{background:#eef3ff;color:#1a47a0}
      .combo{background:#fff9c4;font-weight:800;text-align:center;font-size:16px;border:2px solid #f5d000}
      .err{background:#ffeaea;color:#8b1a1a;display:flex;justify-content:space-between;align-items:center}
      .bx{background:none;border:none;cursor:pointer;font-size:16px;color:#8b1a1a}

      /* layout */
      .layout{display:grid;grid-template-columns:1fr 290px;gap:12px;align-items:start}
      .bcol{display:flex;flex-direction:column;gap:10px}

      /* board */
      .bwrap{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:14px;overflow-x:auto}
      .board-wrap{width:100%;overflow-x:auto;display:flex;justify-content:center;-webkit-overflow-scrolling:touch}
      .board{display:grid;grid-template-columns:repeat(7,58px);gap:5px;justify-content:center;min-width:max-content}
      .cell{width:44px;height:44px;border:1.5px solid #c8c8c8;border-radius:9px;background:#fafafa;font-size:17px;font-weight:800;cursor:pointer;transition:background .12s}
      .cell.cr{background:rgba(192,57,43,.15);border-color:rgba(192,57,43,.3)}
      .cell.cb{background:rgba(34,113,179,.15);border-color:rgba(34,113,179,.3)}
      .cell.ft{border-width:3px;border-color:#111}
      .cell.sl{outline:3px solid #f0a500;outline-offset:-2px}
      .cell.pl{box-shadow:inset 0 0 0 3px #111}
      .cell.lg{background:#e8fce8;border-color:#5cb85c}
      .cell.lg:hover{background:#d0f7d0}
      .cell.dm{opacity:.35;cursor:not-allowed}
      .cell[data-chg]{animation:aclaim 500ms ease forwards}
      .cell[data-cap]{animation:acap 800ms ease forwards}
      .cell[data-lk]{animation:alk 600ms ease forwards}
      /* ── Letter Market ─────────────────────────────────────────────────── */
      .lm-panel{background:#fff;border:1.5px solid #e0e0e0;border-radius:14px;padding:10px 14px;margin-bottom:10px}
      .lm-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .lm-title{font-size:13px;font-weight:800;color:#333;letter-spacing:.3px}
      .lm-preview{display:flex;align-items:center;gap:4px;font-size:12px;color:#999}
      .lm-prev-chip{background:#f0f0f0;border-radius:6px;padding:1px 7px;font-weight:700;color:#666;font-size:13px}
      .lm-active{display:flex;gap:8px;flex-wrap:wrap}
      .lm-tile{background:#f8f9fa;border:2px solid #e0e0e0;border-radius:12px;padding:8px 10px;
               min-width:60px;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;
               align-items:center;gap:2px;font-family:inherit}
      .lm-tile:hover:not(:disabled){background:#eef2ff;border-color:#6366f1;transform:translateY(-1px)}
      .lm-tile:disabled{opacity:.5;cursor:default}
      .lm-selected{background:#eef2ff!important;border-color:#6366f1!important;box-shadow:0 0 0 2px #a5b4fc}
      .lm-letter{font-size:22px;font-weight:900;color:#111;line-height:1}

      .lm-kind{font-size:9px;font-weight:900;letter-spacing:.4px;color:#777;line-height:1}
      .lm-best{font-size:10px;color:#555;max-width:68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lm-safe{border-color:#93c5fd}
      .lm-power{border-color:#fbbf24;background:#fffdf2}
      .lm-setup{border-color:#c4b5fd;background:#faf5ff}
      .lm-tactic{border-color:#bae6fd}
      .lm-next-hit{background:#fff4cc!important;border:1px solid #e0b100;color:#8a5a00}
      .almost-chip.almost-next{background:#fff4cc;border-color:#e0b100;font-weight:700}
      .almost-chip em{font-style:normal;color:#9a6700;font-size:10px;margin-left:3px}
      .selected-insight{background:#f7f9fc;border:1px dashed #cbd5e1;border-radius:10px;padding:7px 10px;margin:0 0 10px 60px;font-size:12px;color:#475569}
      .selected-insight strong{color:#111}
      .lm-stats{display:flex;gap:3px;align-items:center;flex-wrap:wrap;justify-content:center}
      .lm-gain{background:#dcfce7;color:#166534;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:700}
      .lm-count{background:#e0f2fe;color:#075985;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:600}
      .lm-role{background:#fef9c3;color:#713f12;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700}
      .lm-zero{color:#aaa;font-size:11px}
      .lm-free{background:#fffbeb;border-color:#fbbf24}
      .lm-free:hover:not(:disabled){background:#fef3c7!important;border-color:#d97706!important}
      .lm-freeLabel{background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:800}
      .lm-used{opacity:.4;cursor:default!important}
      .lm-free-row{display:flex;gap:8px;margin-top:8px;align-items:center}
      .lm-free-input{border:2px solid #fbbf24;border-radius:8px;padding:6px 10px;font-size:18px;
                     font-weight:900;width:80px;text-align:center;text-transform:uppercase;outline:none}
      .lm-free-confirm{background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:6px 14px;
                       font-weight:800;cursor:pointer;font-size:13px}
      .lm-free-confirm:hover{background:#d97706}

      /* Tenpai / Almost UI */
      .almost-box{background:#fffdf0;border:1.5px solid #f0c040;border-radius:12px;padding:8px 12px;margin-bottom:8px}
      .almost-title{font-size:11px;font-weight:800;color:#b08000;margin-bottom:6px;letter-spacing:.3px}
      .almost-list{display:flex;flex-wrap:wrap;gap:5px}
      .almost-chip{background:#fff9e0;border:1px solid #e0c030;border-radius:20px;padding:2px 9px;font-size:12px;white-space:nowrap}
      .almost-chip strong{color:#c06000;font-size:13px;font-weight:900}

      /* rank / capture display */
      .rank-display{text-align:center;font-size:20px;font-weight:900;padding:10px 0 2px}
      .rank-title{color:#111}
      .capture-pct{text-align:center;font-size:30px;font-weight:900;color:#c0392b;margin-bottom:6px}
      .streak-display{text-align:center;font-size:13px;font-weight:700;color:#e65c00;margin-top:6px;padding:5px;background:#fff9f0;border-radius:8px}

      /* first-move banner */
      .firstmove-banner{background:#fffde7;border:2px solid #f5d000;border-radius:12px;padding:10px 16px;margin-bottom:10px;font-size:13px;line-height:1.6}
      .fm-green{background:#d4edda;color:#155724;padding:1px 5px;border-radius:4px;font-weight:700}
      /* valid word hint */
      .pvok-hint{color:#1a7a3c;font-weight:700;font-size:13px;margin-bottom:4px}

      /* attack highlighting */
      .cell{position:relative}
      .cell.atk{box-shadow:inset 0 0 0 2px rgba(255,140,0,.8);background:rgba(255,140,0,.06)}
      .cell.inpath{box-shadow:inset 0 0 0 3px #e65c00 !important;background:rgba(255,100,0,.25) !important;animation:ainpath .5s ease infinite alternate}
      .atk-dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:rgba(255,140,0,.9);pointer-events:none}
      .pvcap{color:#e65c00;font-weight:800;font-size:13px}
      @keyframes ainpath{0%{box-shadow:inset 0 0 0 3px #e65c00}100%{box-shadow:inset 0 0 0 3px #ff8c00}}
      @keyframes aclaim{0%{transform:scale(1.12)}100%{transform:scale(1)}}
      @keyframes acap{0%,30%{background:#ffe040}100%{}}
      @keyframes alk{0%{box-shadow:0 0 0 6px #111 inset}50%{box-shadow:0 0 0 2px #111 inset}100%{}}

      /* move panel */
      .mpanel{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:14px}
      .mrow{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}
      .mlbl{font-size:12px;color:#888;white-space:nowrap;padding-top:14px}
      /* ── Draft tiles ── */
      .draft-hint{font-size:10px;color:#999;font-weight:400}
      .hand-tiles{display:flex;gap:6px;flex-wrap:nowrap}
      .htile{
        width:46px;height:52px;border:2px solid #ccc;border-radius:11px;
        background:#fff;font-size:20px;font-weight:900;cursor:pointer;
        letter-spacing:0;font-family:"Arial Black",Arial;
        transition:transform .1s,background .1s,border-color .1s;
        flex-shrink:0;
      }
      .htile:hover:not(.htile-dim){background:#f0f7ff;border-color:#5b8dee;transform:translateY(-3px)}
      .htile-sel{
        background:#111 !important;color:#fff !important;
        border-color:#111 !important;transform:translateY(-4px) !important;
        box-shadow:0 4px 12px rgba(0,0,0,.25);
      }
      .htile-dim{opacity:.35;cursor:not-allowed}
      .hand-hidden-input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
      /* legacy input fallback */
      .minput-empty::placeholder{color:#bbb}
      .minput{width:50px;height:48px;border:2px solid #ccc;border-radius:10px;font-size:22px;font-weight:800;text-align:center;outline:none;text-transform:uppercase;flex-shrink:0}
      .minput:focus{border-color:#111}.minput:disabled{background:#f4f4f4}
      .pvbox{flex:1;background:#f7f9fc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;min-height:60px}
      .pvbox.pvok{border-color:#5cb85c;background:#f0fdf4}
      .pvword{font-size:20px;font-weight:900;letter-spacing:2px;min-height:26px}
      .pvstats{font-size:12px;color:#444;margin-top:3px}
      .pverr{font-size:12px;color:#c0392b}
      .pvhint{font-size:12px;color:#999;font-style:italic}
      .btns{display:flex;gap:7px;flex-wrap:wrap}
      .ba{flex:1;min-width:60px;padding:11px 6px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:14px;font-weight:600}
      .ba:hover:not(:disabled){background:#f5f5f5}
      .ba:disabled{opacity:.4;cursor:not-allowed}
      .bsubmit{background:#111!important;color:#fff;border-color:#111!important}
      .bsubmit:hover:not(:disabled){background:#333!important}
      .bseed{background:#fffff0;border-color:#d4c000}
      .no-word-hint{font-size:12px;color:#666;line-height:1.7;padding:4px 2px}

      /* side panel */
      .scol{display:flex;flex-direction:column;gap:10px}
      .panel{background:#fff;border:1px solid #e0e0e0;border-radius:14px;overflow:hidden}
      .ph{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer;font-weight:700;font-size:14px;user-select:none}
      .ph:hover{background:#fafafa}.ci{color:#999;font-size:11px}
      .chips{display:flex;flex-wrap:wrap;gap:5px;padding:6px 14px 12px}
      .sc{padding:6px 14px 12px}
      .chip{font-size:12px;border:1px solid #ddd;background:#f8f8f8;border-radius:999px;padding:3px 8px}
      .chip.combo{background:#fff9c4;border-color:#f0d000;font-weight:700}
      .muted{color:#999;font-size:12px;padding:4px 0}
      .hist{max-height:360px;overflow-y:auto}
      .hi{padding:8px 14px;border-bottom:1px solid #f0f0f0}
      .hi-head{display:flex;gap:8px;align-items:baseline}
      .hiw{font-weight:700;letter-spacing:.5px}
      .hi-stats{font-size:11px;color:#777;margin-top:2px}

      /* ③ streak */
      .streak-widget{background:#fff;border:1px solid #e0e0e0;border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:12px}
      .streak-fire{font-size:28px}
      .streak-num{font-size:28px;font-weight:900;line-height:1}
      .streak-lbl{font-size:12px;color:#888}

      /* modal base */
      .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}
      .modal{background:#fff;border-radius:18px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,.3)}
      .modal h2{font-size:22px;margin-bottom:6px}
      .modal h3{font-size:15px;margin:14px 0 8px}
      .modal-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
      .modal-btns button{flex:1;padding:11px 14px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:14px}
      .modal-btns button:first-child{background:#111;color:#fff;border-color:#111}

      /* summary */
      .scard{background:#f7f9fc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:12px 0}
      .scrow{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:17px}
      .scrow strong{font-size:24px}
      .scres{text-align:center;font-size:28px;font-weight:900;padding:8px 0 4px}
      .tac{text-align:center}
      .swrap{margin:14px 0}
      .spre{background:#f4f4f4;border:1px solid #ddd;border-radius:10px;padding:14px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:monospace}
      .bcopy{display:block;width:100%;background:#111;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;font-size:15px;margin-top:8px}
      .bcopy:hover{background:#333}

      /* ④ leaderboard */
      .lb-submit{background:#f7f9fc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:14px 0}
      .lb-form{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
      .nick-input{flex:1;min-width:140px;padding:9px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px;outline:none}
      .nick-input:focus{border-color:#111}
      .lb-ok{font-size:14px;margin-top:8px;color:#1a7a1a}
      .my-rank{background:#fffde7;border:1px solid #f0d000;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-weight:700}
      .lb-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
      .lb-table th{background:#f4f4f4;padding:8px 6px;text-align:left;border-bottom:2px solid #eee}
      .lb-table td{padding:7px 6px;border-bottom:1px solid #f0f0f0}
      .lb-you{background:#fffde7;font-weight:700}

      /* ⑤ waitlist */
      .waitlist-box{margin-top:12px}
      .waitlist-label{font-weight:800;font-size:13px;color:#b8860b;margin-bottom:4px}
      .waitlist-sub{font-size:12px;color:#666;margin-bottom:8px}
      .waitlist-row{display:flex;gap:6px}
      .waitlist-input{flex:1;padding:9px 10px;border:1.5px solid #d4af37;border-radius:8px;font-size:13px;outline:none;min-width:0}
      .waitlist-input:focus{border-color:#b8860b}
      .waitlist-err{font-size:12px;color:#c0392b;margin-top:5px}
      .waitlist-ok{background:#f0fdf4;border:1px solid #5cb85c;border-radius:10px;padding:12px;font-size:13px;color:#1a7a1a;margin-top:12px;font-weight:600}

      /* ⑤ premium */
      .prem-header{text-align:center;margin-bottom:16px}
      .prem-crown{font-size:32px;display:block;margin-bottom:4px}
      .prem-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
      .prem-col{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:12px;padding:14px}
      .prem-col.prem-highlight{background:#fffef0;border-color:#d4af37;box-shadow:0 2px 8px rgba(212,175,55,.2)}
      .prem-tier{font-weight:800;font-size:13px;border-radius:999px;padding:3px 10px;display:inline-block;margin-bottom:10px}
      .prem-tier.free{background:#e0e0e0;color:#555}
      .prem-tier.premium{background:#d4af37;color:#111}
      .prem-col ul{list-style:none;padding:0}
      .prem-col li{font-size:13px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05)}
      .fortified-feat{color:#aaa;text-decoration:line-through}
      .prem-price{font-size:24px;font-weight:900;margin-top:12px;color:#111}
      .prem-price span{font-size:14px;font-weight:400;color:#666}
      .prem-price-annual{font-size:12px;color:#888;margin-bottom:10px}
      .btn-prem-cta{width:100%;background:#d4af37;color:#111;border:none;border-radius:10px;padding:12px;font-weight:800;font-size:15px;cursor:pointer;margin-top:4px}
      .btn-prem-cta:hover{background:#c9a227}
      .prem-note{text-align:center;font-size:12px;color:#888;line-height:1.5;margin-top:12px}

      /* ── Responsive: PC (901px+) ─────────────────────────────────────── */
      @media(min-width:901px){
        .scol{position:sticky;top:10px}
      }

      /* ── Responsive: Tablet (601–900px) ──────────────────────────────── */
      @media(max-width:900px){
        .layout{grid-template-columns:1fr}
        .board{grid-template-columns:repeat(7,44px);gap:4px}
        .cell{width:44px;height:44px;font-size:15px;border-radius:7px}
        .bwrap{padding:10px}
        .hdr-l h1{font-size:18px}
        .hdr-r{width:100%;justify-content:flex-end;flex-wrap:wrap;gap:6px}
        .minput{width:46px;height:44px;font-size:20px}
        .ba{padding:12px 8px;font-size:14px}
        .scol{order:3}
        .hist{max-height:200px}
        .prem-compare{grid-template-columns:1fr}
        .almost-box{margin-bottom:6px}
      }

      /* ── Responsive: Smartphone (≤600px) ─────────────────────────────── */
      @media(max-width:600px){
        .page{padding:6px 4px}
        .hdr{flex-wrap:wrap;padding:8px 10px;gap:6px}
        .hdr-l h1{font-size:16px;letter-spacing:1px}
        .hdr-l .sub{font-size:10px}
        .hdr-r{gap:4px}
        .bsm{padding:5px 8px;font-size:12px}
        .prem-btn{padding:5px 8px;font-size:12px}
        .bprim{padding:7px 12px;font-size:13px}
        .mode-box{display:none}

        /* Board: fill screen width */
        .board-wrap{padding:6px 2px}
        .board{
          grid-template-columns:repeat(7,calc((100vw - 32px) / 7));
          gap:3px;
          min-width:unset;
          width:100%;
        }
        .cell{
          width:calc((100vw - 32px) / 7);
          height:calc((100vw - 32px) / 7);
          font-size:clamp(11px,3vw,16px);
          border-radius:6px;
        }

        /* Score bar */
        .sbar{padding:6px 8px}
        .stxt{font-size:13px}
        .smid{font-size:11px}

        /* Move controls: stack vertically, larger touch targets */
        .mpanel{padding:10px 8px}
        .mrow{flex-wrap:wrap;gap:6px}
        .mlbl{font-size:12px}
        .minput{width:52px;height:52px;font-size:22px;flex-shrink:0}
        .pvbox{flex:1;min-width:120px}

        /* Buttons: 2×2 grid on small screens */
        .brow{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:8px;
          padding:8px;
        }
        .ba{
          padding:14px 8px;
          font-size:14px;
          min-height:48px;
          border-radius:10px;
        }
        .bsubmit{grid-column:1 / -1}

        /* Side panel below board */
        .scol{order:3;margin-top:8px}
        .panel{margin-bottom:8px}
        .almost-box{font-size:12px}
        .almost-chip{font-size:11px;padding:2px 7px}

        /* History compact */
        .hist{max-height:160px}
        .hi{padding:6px 8px}
        .hw{font-size:13px}

        /* First-move banner */
        .firstmove-banner{font-size:12px;padding:8px 10px}

        /* Tutorial: hide less critical elements */
        .rules-box{font-size:13px}
      }

      /* ── Responsive: Very small (≤360px) ─────────────────────────────── */
      @media(max-width:360px){
        .board{grid-template-columns:repeat(7,calc((100vw - 20px) / 7));gap:2px}
        .cell{
          width:calc((100vw - 20px) / 7);
          height:calc((100vw - 20px) / 7);
          font-size:10px;
          border-radius:5px;
        }
        .ba{font-size:13px;padding:12px 6px}
      }
    `}</style>
  </>;
}
