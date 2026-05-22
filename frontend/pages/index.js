import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  botMove, createGame, createDailyGame, getDailyInfo, getDailyLeaderboard,
  getSuggestions, joinWaitlist, passTurn, previewMove, seedMove,
  submitDailyScore, submitMove,
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

function buildShare(num, ds, r) {
  return [
    `Word Territory Daily #${num}`,
    `${ds}  ·  ${r.openingName}`,
    ``,
    `YOU (RED):  ${r.redScore} cells`,
    `BOT (BLUE): ${r.blueScore} cells`,
    ``,
    `${r.winner === "RED" ? "WIN" : r.winner === null ? "DRAW" : "LOSS"}  ·  ${r.turns} turns`,
    r.bestMove ? `Best move: ${r.bestMove}` : null,
    ``, `wordterritory.com`,
  ].filter(l => l !== null).join("\n");
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
    cell.locked ? "lk" : "", sel ? "sl" : "", placed ? "pl" : "",
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
        <div className="hi-stats">+{m.territoryGained}T +{m.wordScoreGained}W 🔒{m.lockedCellsGained}{m.captureCount > 0 ? ` ✦${m.captureCount}cap` : ""}</div>
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
  const [bootMsg, setBootMsg]       = useState("Connecting to server…");
  const [dailyInfo,   setDailyInfo]   = useState(null);
  const [dailyResult, setDailyResult] = useState(null);
  const [shareText,   setShareText]   = useState("");
  const [nickname,    setNickname]    = useState("");
  const [myRank,      setMyRank]      = useState(null);
  const [submitted,   setSubmitted]   = useState(false);
  const [streak,      setStreak]      = useState(0);

  const summaryFired = useRef(false);
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
  function reset() {
    setPath([]); setPlaced(null); setLetter(""); setError(""); setPreview(null);
    setSum(false); setCopied(false); setShareText(""); setNickname(""); setMyRank(null);
    setSubmitted(false); summaryFired.current = false;
  }
  async function boot(m = mode) {
    let lastErr;
    for (let attempt = 1; attempt <= 9; attempt++) {
      try {
        const d = await createGame({ botLevel: m });
        setGameId(d.game_id); setState(d.state); setDailyMode(false);
        reset(); setSugg(await getSuggestions(d.game_id)); setAnimGen(0);
        setBootMsg("");
        return;
      } catch(e) {
        lastErr = e;
        if (attempt < 6) {
          setBootMsg(`Server is waking up… (${attempt * 10}s / 90s)`);
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
    reset(); setSugg(await getSuggestions(d.game_id)); setAnimGen(0);
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
        reset();
        try { setSugg(await getSuggestions(gameId)); } catch(_) {}
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
        (b.territoryGained*2 + b.wordScoreGained*1.5 + b.lockedCellsGained*2 + (b.captureCount?5:0)) -
        (a.territoryGained*2 + a.wordScoreGained*1.5 + a.lockedCellsGained*2 + (a.captureCount?5:0))
      )[0];
      const r = {
        redScore: tScore(state, "RED"), blueScore: tScore(state, "BLUE"),
        winner: state.winner, turns: state.turn - 1,
        bestMove: best ? `${best.word} (+${best.territoryGained}T)` : null,
        openingName: state.openingName,
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
        if (cell.letter && cell.owner === opponent && !cell.locked) {
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
    return (r>0&&b[r-1][c].letter)||(r<10&&b[r+1][c].letter)||(c>0&&b[r][c-1].letter)||(c<10&&b[r][c+1].letter);
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
    if (!placed||!letter) { setError("Choose a cell and type a letter"); return; }
    try {
      const next = await submitMove({game_id:gameId,row:placed.row,col:placed.col,letter,path});
      setState(next); reset(); await refresh();
    } catch(e) { setError(e.message||"Move failed"); }
  }
  async function seed() {
    if (!placed||!letter) { setError("Choose a cell and type a letter"); return; }
    try {
      const next = await seedMove(gameId,{row:placed.row,col:placed.col,letter});
      setState(next); reset(); await refresh();
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
  const lockedS   = new Set((state?.lastLockedCells  ||[]).map(c=>asKey(c.row,c.col)));
  const redT = tScore(state,"RED"), blueT = tScore(state,"BLUE");
  const pct  = Math.round((redT / Math.max(redT+blueT,1)) * 100);
  const incPlaced = placed && path.some(p=>p.row===placed.row&&p.col===placed.col);
  const ok = preview?.isInDictionary && preview?.includesPlacedCell;
  const topMoves = [...(state?.moveHistory||[])].filter(m=>m.moveType==="WORD")
    .sort((a,b)=>(b.territoryGained*2+b.wordScoreGained*1.5+b.lockedCellsGained*2+(b.captureCount?5:0))
                -(a.territoryGained*2+a.wordScoreGained*1.5+a.lockedCellsGained*2+(a.captureCount?5:0)))
    .slice(0,3);

  if (!state) return (
    <main className="loading">
      <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:18,padding:"40px 48px",textAlign:"center",maxWidth:380,width:"90%",boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        <div style={{fontFamily:"\"Arial Black\",Arial",fontWeight:900,fontSize:24,letterSpacing:3,marginBottom:20}}>WORD TERRITORY</div>
        <div style={{fontSize:15,fontWeight:700,color:"#333",marginBottom:8,minHeight:24}}>{bootMsg}</div>
        <div style={{fontSize:12,color:"#999",marginBottom:20,lineHeight:1.6}}>Free server may take up to 60 seconds on first visit.</div>
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
          <p className="sub">Opening: {state.openingName} · T{state.currentPlayer} · Round {state.turn}</p>
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
          <button className="bsm prem-btn" onClick={()=>setPremium(true)}>✦ Premium</button>
          {dailyMode
            ?<button className="bprim" onClick={()=>boot(mode)}>← Free Play</button>
            :<button className="bprim" onClick={()=>boot(mode)}>New Game</button>
          }
        </div>
      </div>

      {/* ── score bar ── */}
      <div className="sbar">
        <div className="srow">
          <span className="stxt red-t">🔴 {redT} cells</span>
          <span className="smid">{redT===blueT?"Tied":`${redT>blueT?"🔴 RED":"🔵 BLUE"} +${Math.abs(redT-blueT)}`}</span>
          <span className="stxt blue-t">{blueT} cells 🔵</span>
        </div>
        <div className="bar"><div className="br" style={{width:`${pct}%`}}/><div className="bb" style={{width:`${100-pct}%`}}/></div>
      </div>

      {/* ── rules ── */}
      {showRules&&(
        <div className="rules">
          <strong>Word Territory is a spatial strategy game — not just a word game.</strong>
          <ol>
            <li>Tap a <em>green cell</em> next to existing letters, type one letter to place it.</li>
            <li>Select a connected path of letters. <strong>Your placed letter can be anywhere in the path</strong> — beginning, middle, or end.</li>
            <li>Example: board has D–S–T, you place U next to D → select D→U→S→T to form DUST.</li>
            <li>Submit a valid 3–6 letter word → claim the entire path as territory.</li>
            <li>Enclosed regions are <strong>captured</strong>. Fully-surrounded groups become <strong>locked</strong> (bold border).</li>
            <li><strong>Seed Move</strong> — place a letter without scoring if stuck.</li>
            <li>Score = Territory × 1.5 + Word Points. Shape the board, not just the words.</li>
            <li><strong>Daily Challenge</strong> — same board for everyone each day. One attempt. Strong bot only.</li>
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
            <div className="board">
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

          {/* move controls */}
          <div className="mpanel">
            <div className="mrow">
              <label className="mlbl">Letter</label>
              <input className="minput" value={letter} maxLength={1} disabled={!human()}
                onChange={e=>setLetter(e.target.value.toUpperCase().slice(0,1))} placeholder="A"/>
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
                    {!placed?"① Type letter  ② Tap any cell in word  ③ Select path  ④ Submit":!letter?"Type a letter":!incPlaced?"Path needs your letter":"Select path"}
                  </div>
                )}
              </div>
            </div>
            <div className="btns">
              <button className="ba bsubmit" onClick={submit} disabled={!human()}>Submit</button>
              <button className="ba bseed"   onClick={seed}   disabled={!human()}>Seed</button>
              <button className="ba"          onClick={()=>{ setPath([]); setPlaced(null); setError(''); setPreview(null); }} disabled={!human()}>Clear</button>
              <button className="ba"          onClick={pass}   disabled={!human()}>Pass</button>
            </div>
          </div>
        </div>

        {/* side panel */}
        <div className="scol">
          <div className="panel">
            <div className="ph" onClick={()=>setSuggest(v=>!v)}>
              <span>💡 Suggested</span><span className="ci">{showSuggest?"▲":"▼"}</span>
            </div>
            {showSuggest&&(
              <div className="chips sc">
                {suggestions.length?suggestions.map(w=><span key={w} className="chip">{w}</span>):<span className="muted">—</span>}
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
      .board{display:grid;grid-template-columns:repeat(7,58px);gap:5px;justify-content:center;min-width:max-content}
      .cell{width:44px;height:44px;border:1.5px solid #c8c8c8;border-radius:9px;background:#fafafa;font-size:17px;font-weight:800;cursor:pointer;transition:background .12s}
      .cell.cr{background:rgba(192,57,43,.15);border-color:rgba(192,57,43,.3)}
      .cell.cb{background:rgba(34,113,179,.15);border-color:rgba(34,113,179,.3)}
      .cell.lk{border-width:3px;border-color:#111}
      .cell.sl{outline:3px solid #f0a500;outline-offset:-2px}
      .cell.pl{box-shadow:inset 0 0 0 3px #111}
      .cell.lg{background:#e8fce8;border-color:#5cb85c}
      .cell.lg:hover{background:#d0f7d0}
      .cell.dm{opacity:.35;cursor:not-allowed}
      .cell[data-chg]{animation:aclaim 500ms ease forwards}
      .cell[data-cap]{animation:acap 800ms ease forwards}
      .cell[data-lk]{animation:alk 600ms ease forwards}
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
      .locked-feat{color:#aaa;text-decoration:line-through}
      .prem-price{font-size:24px;font-weight:900;margin-top:12px;color:#111}
      .prem-price span{font-size:14px;font-weight:400;color:#666}
      .prem-price-annual{font-size:12px;color:#888;margin-bottom:10px}
      .btn-prem-cta{width:100%;background:#d4af37;color:#111;border:none;border-radius:10px;padding:12px;font-weight:800;font-size:15px;cursor:pointer;margin-top:4px}
      .btn-prem-cta:hover{background:#c9a227}
      .prem-note{text-align:center;font-size:12px;color:#888;line-height:1.5;margin-top:12px}

      @media(min-width:901px){.scol{position:sticky;top:10px}}
      @media(max-width:900px){
        .layout{grid-template-columns:1fr}
        .board{grid-template-columns:repeat(7,42px);gap:3px}
        .cell{width:42px;height:42px;font-size:15px;border-radius:6px}
        .bwrap{padding:10px}
        .hdr-l h1{font-size:18px}
        .hdr-r{width:100%;justify-content:flex-end}
        .minput{width:46px;height:44px;font-size:20px}
        .ba{padding:12px 6px;font-size:14px}
        .scol{order:3}
        .hist{max-height:200px}
        .prem-compare{grid-template-columns:1fr}
      }
      @media(max-width:480px){
        .page{padding:8px}
        .board{grid-template-columns:repeat(7,38px);gap:3px}
        .cell{width:38px;height:38px;font-size:14px}
        .hdr-l h1{font-size:16px}
        .mode-box{display:none}
      }
    `}</style>
  </>;
}
