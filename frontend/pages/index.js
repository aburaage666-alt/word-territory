import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  botMove, autoMove, createGame, createDailyGame, getDailyInfo, getDailyLeaderboard,
  getAlmost, getLetterPreview, getMarket, getSuggestions, getSynergyOptions, selectSynergy, getThreat, createAsyncMatch, getAsyncMatch, submitAsyncMove, seedAsyncMove, rotateAsyncBlock, passAsyncTurn,
  joinWaitlist, passTurn, previewMove, rotateBlock, seedMove, submitDailyScore, submitMove, daziMove, daziAsyncMove,
  useFreeLetter,
} from "../lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────
const asKey = (r, c) => `${r}-${c}`;
const adj    = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
// 案4: territory count is primary victory condition (Othello-style)
const tScore = (st, p) => {
  if (!st || !st.scores) return 0;
  return p === "RED" ? (st.scores.redTerritory || 0) : (st.scores.blueTerritory || 0);
};
const tScoreWord = (st, p) => {
  if (!st || !st.scores) return 0;
  return p === "RED" ? (st.scores.redWord || 0) : (st.scores.blueWord || 0);
};
const wScore = w => ({ 3:1,4:2,5:3,6:5 }[w?.length] || 0);

const OPENING_NOTES = {
  "CIRCLE OPENING": "Encircle and Capture — surround to win.",
  "BRIDGE OPENING": "Connect and Divide — control the center bridge.",
  "GARDEN OPENING": "Expand and Lock — fortify before they do.",
  "STONE OPENING": "Hold the center — build safe locked ground.",
  "RIVER OPENING": "Flow outward — connect lanes before they split.",
  "LIGHT OPENING": "Fast expansion — claim open paths quickly.",
  "WATER OPENING": "Flexible paths — shift between attack and defense.",
  "PLANT OPENING": "Grow from roots — expand and secure territory.",
  "FOREST OPENING": "Branching paths — create multiple threats.",
  "MARKET OPENING": "Frontline trading — every tile can flip momentum."
};

const TERRAIN_LABELS = {
  "CAPTURE": "Capture",
  "DOUBLE CAPTURE": "Double Capture",
  "BRIDGE": "Bridge",
  "CUT": "Cut",
  "FORTIFY CHAIN": "Fortify Chain",
  "LONG PATH": "Long Path",
  "MEGA TERRITORY": "Mega Territory Swing",
  "CROSS WORD": "Cross Path",
  "FIRST CAPTURE": "First Capture",
  "EDGE REACH": "Edge Reach",
  "COMEBACK": "Comeback Swing",
  "SWING MOVE": "Territory Swing",
  "BEACHHEAD": "Beachhead",
  "FRONTLINE PUSH": "Frontline Push",
  "DAZI": "Disarm",
  "ROTATION RAID": "Rotation Raid",
};

function terrainComboLabel(label, move = null) {
  const raw = String(label || "");
  if (raw.startsWith("SYNERGY:")) return raw.replace("SYNERGY:", "").trim();
  if (raw === "CAPTURE" && move?.captureCount) return `Captured ${move.captureCount} cell${move.captureCount === 1 ? "" : "s"}`;
  if (raw === "DOUBLE CAPTURE" && move?.captureCount) return `Double Capture (+${move.captureCount} cells)`;
  if (raw === "BRIDGE") return "Bridge — connected zones";
  if (raw === "CUT") return "Cut — split enemy territory";
  if (raw === "FORTIFY CHAIN") return "Fortify Chain — locked ground";
  if (raw === "LONG PATH") return "Long Path bonus";
  if (raw === "BEACHHEAD") return "Beachhead — enemy territory breach";
  if (raw === "FRONTLINE PUSH") return "Frontline Push — border advanced";
  if (raw === "ROTATION RAID") return "Rotation Raid — letters rotated";
  if (raw === "DAZI" || raw === "奪字") return "Disarm — neutralized locked enemy letter";
  return TERRAIN_LABELS[raw] || raw;
}

function terrainMoveLabel(m) {
  if (!m) return "";
  const labels = (m.comboLabels || []).map(x => terrainComboLabel(x, m));
  return `${m.word} — Territory Swing +${m.territoryGained}${labels.length ? " · " + labels.join(" · ") : ""}`;
}

function moveInsightLines(m) {
  if (!m) return [];
  const lines = [];
  if (m.moveType === "SEED") return [`${m.player} seeded ${m.placedLetter || "a letter"} to build future territory.`];
  if (m.word) lines.push(`${m.player} played ${m.word}.`);
  if ((m.territoryGained || 0) > 0) lines.push(`Territory Swing +${m.territoryGained}.`);
  if ((m.captureCount || 0) > 0) lines.push(`Captured ${m.captureCount} cell${m.captureCount === 1 ? "" : "s"}.`);
  if ((m.fortifiedCellsGained || 0) > 0) lines.push(`Locked ${m.fortifiedCellsGained} cell${m.fortifiedCellsGained === 1 ? "" : "s"}.`);
  const labels = (m.comboLabels || []).map(x => terrainComboLabel(x, m));
  const terrainLabels = labels.filter(Boolean);
  if (terrainLabels.length) lines.push(terrainLabels.join(" · "));
  return lines;
}

function compactMoveTitle(m) {
  if (!m) return "";
  if (m.moveType === "SEED") return `${m.player} seeded ${m.placedLetter || ""}`.trim();
  return `${m.player} reshaped the map with ${m.word}`;
}


const LS_DAILY  = "wt_daily_";
const LS_STREAK = "wt_streak";
const LS_INTRO  = "wt_intro_seen";
const LS_TUTOR  = "wt_tutorial_done";
const LS_ASYNC  = "wt_async_session";

const loadResult  = ds => { try { return JSON.parse(localStorage.getItem(LS_DAILY + ds) || "null"); } catch { return null; } };
const saveResult  = (ds, r) => { try { localStorage.setItem(LS_DAILY + ds, JSON.stringify(r)); } catch {} };

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
  const winner = r.winner || "DRAW";
  const score = `🔴 ${r.redScore} – ${r.blueScore} 🔵`;
  const best = r.bestMove ? `Best Swing: ${r.bestMove}` : null;
  const opening = r.openingName ? `Opening: ${r.openingName.replace(" OPENING","")}` : null;
  const board = r.emojiBoard || "";
  return [
    `Word Territory #${num}`,
    `${winner} · ${score}`,
    opening,
    best,
    board,
    `word-territory1.onrender.com`,
  ].filter(Boolean).join("\n");
}

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
function Cell({ cell, sel, placed, legal, changed, captured, lockedNow, bridgePath, lockNeighbor, tutorialPlace, tutorialPath, disabled, gen, attack, inPath, threat, threatMove, rotateTarget, captureOrder, lockOrder, onClick }) {
  const cls = ["cell",
    cell.owner === "RED" ? "cr" : cell.owner === "BLUE" ? "cb" : "",
    cell.fortified ? "ft" : "", sel ? "sl" : "", placed ? "pl" : "",
    legal ? "lg" : "", disabled && !sel ? "dm" : "",
    attack ? "atk" : "",   // opponent cell that can be attacked
    threat ? "threat" : "", threatMove ? "threatMove" : "", rotateTarget ? "rotate-target" : "",
    bridgePath ? "bridge-path" : "", lockNeighbor ? "lock-neighbor" : "",
    tutorialPlace ? "tut-pulse tut-cell" : "", tutorialPath ? "tut-arrow-cell" : "",
    inPath ? "inpath" : "", // opponent cell currently in selected path (will be captured)
  ].filter(Boolean).join(" ");
  const animStyle = {
    "--cap-order": captureOrder != null ? captureOrder : 0,
    "--cap-delay": captureOrder != null ? `${captureOrder * 80}ms` : "0ms",
    "--my-color": cell.owner === "RED" ? "rgba(220,38,38,.42)" : cell.owner === "BLUE" ? "rgba(37,99,235,.42)" : "#fafafa",
    "--opp-color": cell.owner === "RED" ? "rgba(37,99,235,.36)" : cell.owner === "BLUE" ? "rgba(220,38,38,.36)" : "#fafafa",
    "--lock-delay": lockOrder != null ? `${lockOrder * 70}ms` : "0ms",
  };
  return (
    <button className={cls} onClick={onClick} style={animStyle} disabled={disabled}
      data-chg={changed ? gen : null}
      data-cap={captured ? gen : null}
      data-lk={lockedNow ? gen : null}>
      {cell.letter || ""}
      {cell.fortified && <span className="lock-shield" title="Fortified ground">🛡</span>}
      {attack && !inPath && <span className="atk-dot"/>}
      {threat && !inPath && <span className="threat-dot" title="Capture threat"/>}
    </button>
  );
}

// ── HistItem ──────────────────────────────────────────────────────────────────
function HistItem({ m }) {
  return (
    <div className="hi">
      <div className="hi-head"><strong>T{m.turn} {m.player}</strong><span className="hiw">{m.word}</span></div>
      {m.moveType === "WORD" && (
        <div className="hi-stats">Territory Swing +{m.territoryGained} · +{m.wordScoreGained}W{m.fortifiedCellsGained>0 ? ` · Locked ${m.fortifiedCellsGained}` : ""}{m.captureCount > 0 ? ` · Captured ${m.captureCount}` : ""}</div>
      )}
      {m.comboLabels?.length > 0 && <div className="chips">
              {m.comboLabels.map((x,xi) => {
                const label = terrainComboLabel(x, m);
                if (String(x).startsWith('SYNERGY:')) {
                  return <span key={xi} className="chip combo synergy-chip" title={label}>✦ {label}</span>;
                }
                return <span key={xi} className="chip combo">{label}</span>;
              })}
            </div>}
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

// WT_MODERN_SHARE_REPLAY_CLEAN_V8
function wtModernBoardEmoji(board) {
  if (!Array.isArray(board)) return "";
  return board.map(row => (Array.isArray(row) ? row : []).map(cell => {
    if (!cell || !cell.letter) return "⬜";
    if (cell.owner === "RED") return "🟥";
    if (cell.owner === "BLUE") return "🟦";
    return "⬜";
  }).join("")).join("\n");
}

function wtModernMoveText(m, moveLabel) {
  if (!m) return "—";
  try { if (typeof moveLabel === "function") return moveLabel(m); } catch {}
  const word = m.word || m.text || "—";
  const gain = Number(m.territoryGained || 0) + Number(m.captureCount || 0) * 2;
  return gain ? `${word} +${gain}` : String(word);
}

function wtModernBestSwing(moveHistory) {
  const arr = Array.isArray(moveHistory) ? moveHistory : [];
  if (!arr.length) return null;
  return arr.slice().sort((a, b) => {
    const av = Number(a.territoryGained || 0) + Number(a.captureCount || 0) * 2;
    const bv = Number(b.territoryGained || 0) + Number(b.captureCount || 0) * 2;
    return bv - av;
  })[0] || null;
}

function wtModernShareText({ state, redT, blueT, bestMove, moveLabel, dailyInfo, url, title="Word Territory" }) {
  const winner = state?.winner || "";
  const day = dailyInfo?.dayNumber ? ` #${dailyInfo.dayNumber}` : "";
  const best = bestMove || wtModernBestSwing(state?.moveHistory);
  const bestText = wtModernMoveText(best, moveLabel);
  const board = wtModernBoardEmoji(state?.board);
  const result = winner === "DRAW" ? "DRAW" : winner ? `${winner} WIN` : "RESULT";
  return [
    `${title}${day}`,
    `${result} · RED ${redT}–${blueT} BLUE`,
    best ? `Best Swing: ${bestText}` : null,
    state?.openingName ? `Opening: ${String(state.openingName).replace(" OPENING", "")}` : null,
    board,
    url || (typeof location !== "undefined" ? location.origin : ""),
  ].filter(Boolean).join("\n");
}

function wtModernDownloadShareCard({ state, redT, blueT, bestMove, moveLabel, dailyInfo, title="Word Territory" }) {
  if (typeof document === "undefined") return;
  const best = bestMove || wtModernBestSwing(state?.moveHistory);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const red = "#ef4444";
  const blue = "#3b82f6";
  const dark = "#111827";
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(title, 70, 110);
  ctx.font = "34px system-ui, sans-serif";
  const day = dailyInfo?.dayNumber ? `Daily #${dailyInfo.dayNumber}` : "Free Play";
  ctx.fillText(day, 72, 165);
  ctx.font = "bold 58px system-ui, sans-serif";
  ctx.fillStyle = red;
  ctx.fillText(`RED ${redT}`, 72, 250);
  ctx.fillStyle = blue;
  ctx.fillText(`BLUE ${blueT}`, 720, 250);
  ctx.fillStyle = dark;
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillText(`Best Swing: ${wtModernMoveText(best, moveLabel)}`, 72, 315);
  const board = Array.isArray(state?.board) ? state.board : [];
  const rows = board.length || 7;
  const cols = Math.max(...board.map(r => Array.isArray(r) ? r.length : 0), 7);
  const size = Math.floor(Math.min(900 / cols, 820 / rows));
  const startX = Math.floor((1080 - cols * size) / 2);
  const startY = 390;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board?.[r]?.[c] || {};
      ctx.fillStyle = !cell.letter ? "#e5e7eb" : cell.owner === "RED" ? red : cell.owner === "BLUE" ? blue : "#94a3b8";
      ctx.fillRect(startX + c * size + 4, startY + r * size + 4, size - 8, size - 8);
      if (cell.letter) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.max(20, Math.floor(size * 0.42))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.letter), startX + c * size + size / 2, startY + r * size + size / 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
    }
  }
  ctx.fillStyle = dark;
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillText(typeof location !== "undefined" ? location.origin : "word-territory", 72, 1280);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `word-territory-${Date.now()}.png`;
  a.click();
  try { navigator.vibrate?.([40, 30, 70]); } catch {}
}

function wtModernReplayBestSwing({ state, bestMove, moveLabel, setBoardBannerText }) {
  const best = bestMove || wtModernBestSwing(state?.moveHistory);
  const text = `最大スイング：${wtModernMoveText(best, moveLabel)}`;
  try { navigator.vibrate?.([70, 40, 100]); } catch {}
  try {
    if (typeof setBoardBannerText === "function") {
      setBoardBannerText(text);
      setTimeout(() => setBoardBannerText(""), 5200);
      return;
    }
  } catch {}
  if (typeof alert !== "undefined") alert(text);
}

function wtModernSharePanel({ state, redT, blueT, bestMove, moveLabel, dailyInfo, setBoardBannerText, setCopied }) {
  if (!state?.winner) return null;
  const shareText = wtModernShareText({ state, redT, blueT, bestMove, moveLabel, dailyInfo });
  return (
    <div className="modern-share-panel">
      <button className="bcopy" onClick={async()=>{
        try {
          await navigator.clipboard.writeText(shareText);
          setCopied?.(true);
          setTimeout(()=>setCopied?.(false), 2000);
          navigator.vibrate?.(30);
        } catch {}
      }}>結果コピー</button>
      <button className="bcopy" onClick={()=>wtModernDownloadShareCard({ state, redT, blueT, bestMove, moveLabel, dailyInfo })}>共有画像を保存</button>
      <button className="bcopy" onClick={()=>wtModernReplayBestSwing({ state, bestMove, moveLabel, setBoardBannerText })}>最大スイング再生</button>
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
  const [daziMode, setDaziMode] = useState(false);
  const [error,  setError]      = useState("");
  const [suggestions, setSugg]  = useState([]);
  const [mode,   setMode]       = useState("normal");
  const [boardMode, setBoardMode] = useState("standard"); // WT_QUICK5_UI_V2
const [thinking, setThinking] = useState(false);
  const [preview, setPreview]   = useState(null);
  const [rotateMode, setRotateMode] = useState(false);
  const [rotateTarget, setRotateTarget] = useState(null);
  const [showSummary, setSum]   = useState(false);
  const [copied, setCopied]     = useState(false);

  // UI panels
  const [showRules,   setRules]   = useState(false);
  const [showHistory, setHistory] = useState(true);
  const [showSuggest, setSuggest] = useState(false);
  const [showAlmost,  setAlmostOpen] = useState(true);
  const [showThreatPanel, setThreatPanel] = useState(false);
  const [mobileTab, setMobileTab] = useState("hints"); // hints | history | threat
  const [showLB,      setShowLB]  = useState(false);  // ④

  // Combo banner persistence
  const [comboBanner, setCombo]   = useState([]);
  const [synergyFlash, setSynergyFlash] = useState("");
  const [bridgeFlash,  setBridgeFlash]  = useState(false);
  const [showSynergy, setShowSynergy] = useState(false);
  const [synergyOpts, setSynergyOpts] = useState([]);
  const [synergy,     setSynergy]     = useState("");
  const [valuePrev,   setValuePrev]   = useState([]); // Territory Preview candidates
  const [daziMode,   setDaziMode]   = useState(false); // Disarm / 奪字: next word can neutralize one enemy LOCK
  const [threats,     setThreats]     = useState([]); // opponent capture threats
  const [asyncMode,   setAsyncMode]   = useState(false);
  const [asyncToken,  setAsyncToken]  = useState("");
  const [asyncRole,   setAsyncRole]   = useState("");
  const [inviteUrl,   setInviteUrl]   = useState("");
  const [spectatorMode, setSpectatorMode] = useState(false);
  const [spectatorSteps, setSpectatorSteps] = useState(0);
  const [spectatorNote, setSpectatorNote] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const comboTimer = useRef(null);
  const soundTurnRef = useRef(null);
  const captureSoundRef = useRef(null);
  const bridgeSoundRef = useRef(null);
  const lockSoundRef = useRef(null);
  const battleSoundRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [animGen,  setAnimGen]    = useState(0);

  function playSfx(type = "click", delayMs = 0) {
    if (!soundOn || typeof window === "undefined") return;
    const run = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = audioCtxRef.current || new Ctx();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") ctx.resume().catch(()=>{});
        const now = ctx.currentTime;

        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.connect(ctx.destination);

        const env = (peak = 0.04, attack = 0.01, release = 0.18) => {
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(0.0001, now);
          master.gain.exponentialRampToValueAtTime(peak, now + attack);
          master.gain.exponentialRampToValueAtTime(0.0001, now + release);
        };

        const tone = (freq, start = 0, dur = 0.16, wave = "sine", endFreq = null, gainNode = master) => {
          const o = ctx.createOscillator();
          o.type = wave;
          o.frequency.setValueAtTime(freq, now + start);
          if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, now + start + dur);
          o.connect(gainNode);
          o.start(now + start);
          o.stop(now + start + dur + 0.02);
          return o;
        };

        if (type === "click") {
          env(0.028, 0.006, 0.08);
          tone(520, 0, 0.055, "triangle", 620);
          return;
        }

        if (type === "capture") {
          // Conquest thump: low, descending, tactile.
          env(0.065, 0.012, 0.28);
          tone(190, 0, 0.22, "square", 86);
          tone(95, 0.025, 0.18, "sawtooth", 62);
          return;
        }

        if (type === "bridge") {
          // Bridge: clear upward two-note connection.
          env(0.045, 0.015, 0.34);
          tone(392, 0, 0.13, "sine", 494);
          tone(587, 0.13, 0.16, "sine", 784);
          return;
        }

        if (type === "lock") {
          // Lock: short metallic clamp.
          env(0.05, 0.004, 0.16);
          tone(740, 0, 0.045, "square", 640);
          tone(260, 0.035, 0.09, "triangle", 180);
          return;
        }

        if (type === "synergy") {
          // Synergy: small arpeggio / sparkle.
          env(0.045, 0.018, 0.42);
          tone(660, 0, 0.11, "sine", 880);
          tone(990, 0.08, 0.12, "triangle", 1320);
          tone(1320, 0.17, 0.14, "sine", 1760);
          return;
        }

        if (type === "battle") {
          // Battle Report: resolving chord.
          env(0.05, 0.02, 0.58);
          tone(330, 0, 0.42, "sine");
          tone(415, 0.03, 0.40, "sine");
          tone(494, 0.06, 0.38, "sine");
          tone(660, 0.12, 0.26, "triangle");
          return;
        }
      } catch {}
    };
    if (delayMs > 0) window.setTimeout(run, delayMs);
    else run();
  }

  function finishTutorial() {
    try { localStorage.setItem(LS_TUTOR, "1"); } catch {}
    setShowTutorial(false);
    setTutorialStep(0);
  }

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
    // Link-share async PvP MVP: ?match=<id>&token=<token>
    try {
      const qs = new URLSearchParams(window.location.search);
      const mid = qs.get("match");
      const tok = qs.get("token");
      if (mid && tok) {
        setBootMsg("Loading async match…");
        getAsyncMatch(mid, tok).then(d => {
          setAsyncMode(true); setAsyncToken(tok); setAsyncRole(d.role || "");
          try { localStorage.setItem(LS_ASYNC, JSON.stringify({ match: mid, token: tok })); } catch {}
          setGameId(mid); setState(d.state); setDailyMode(false); setBootMsg("");
          if (d.state?.marketLetters?.length > 0) setMarket({ active:d.state.marketLetters, preview:d.state.previewLetters||[], stats:[], freeLetterUsed:!!d.state.freeLetterUsed });
          getSuggestions(mid).then(setSugg).catch(()=>setSugg([]));
          getThreat(mid).then(setThreats).catch(()=>setThreats([]));
        }).catch(e => setError(e.message || "Could not load async match"));
      } else if (typeof window !== "undefined" && localStorage.getItem(LS_INTRO) !== "1") {
        setShowIntro(true);
      }
      // Restore the last async match after reload if no explicit match URL was provided.
      if (!window.location.search.includes("match=")) {
        const saved = JSON.parse(localStorage.getItem(LS_ASYNC) || "null");
        if (saved?.match && saved?.token) {
          setBootMsg("Restoring async match…");
          getAsyncMatch(saved.match, saved.token).then(d => {
            setAsyncMode(true); setAsyncToken(saved.token); setAsyncRole(d.role || "");
            setGameId(saved.match); setState(d.state); setDailyMode(false); setBootMsg("");
            if (d.state?.marketLetters?.length > 0) setMarket({ active:d.state.marketLetters, preview:d.state.previewLetters||[], stats:[], freeLetterUsed:!!d.state.freeLetterUsed });
            getSuggestions(saved.match).then(setSugg).catch(()=>setSugg([]));
            getThreat(saved.match).then(setThreats).catch(()=>setThreats([]));
          }).catch(()=>{ try { localStorage.removeItem(LS_ASYNC); } catch {} });
        }
      }
    } catch {}
  }, []);

  // ── boot helpers ─────────────────────────────────────────────────────────
  function resetMarket() {
    setMarket({ active:[], preview:[], stats:[], freeLetterUsed:false });
    setFreeLetter('');
    setShowFreeInput(false);
  }
  function resetValuePrev() { setValuePrev([]); }
  function reset() {
    setPath([]); setPlaced(null); setLetter(""); setError(""); setPreview(null); setValuePrev([]); setDaziMode(false); setDaziMode(false);
    setSum(false); setCopied(false); setShareText(""); setNickname(""); setMyRank(null);
    setSubmitted(false); summaryFired.current = false;
  }
  async function boot(m = mode) {
    let lastErr;
    for (let attempt = 1; attempt <= 9; attempt++) {
      try {
        const d = await createGame({ botLevel: m, boardMode });
        setGameId(d.game_id); setState(d.state); setDailyMode(false);
        setSpectatorMode(false); setSpectatorSteps(0); setSpectatorNote("");
        reset(); setAnimGen(0); setBootMsg("");
        if (d.state?.marketLetters?.length > 0) {
          setMarket({ active: d.state.marketLetters, preview: d.state.previewLetters||[],
            stats: d.state.marketLetters.map(l=>({letter:l,wordCount:0,bestGain:0,bestWord:'',roles:[]})),
            freeLetterUsed: !!d.state.freeLetterUsed });
          setLetter('');
          // Fetch stats non-blocking — failure must NOT trigger game retry
          try { const mk = await getMarket(d.game_id); setMarket(mk); } catch(_) {}
        }
        getSuggestions(d.game_id).then(setSugg).catch(() => setSugg([]));
        getThreat(d.game_id).then(setThreats).catch(() => setThreats([]));
        // Show synergy card selection
        getSynergyOptions(d.game_id).then(r => {
          setSynergyOpts(r.options||[]);
          setSynergy(r.selected||"");
          if (!r.selected && r.options?.length > 0) setShowSynergy(true);
        }).catch(() => {});
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
    setSpectatorMode(false); setSpectatorSteps(0); setSpectatorNote("");
    reset(); setAnimGen(0);
    if (d.state?.marketLetters?.length > 0) {
      setMarket({ active: d.state.marketLetters, preview: d.state.previewLetters||[],
        stats: d.state.marketLetters.map(l=>({letter:l,wordCount:0,bestGain:0,bestWord:'',roles:[]})),
        freeLetterUsed: !!d.state.freeLetterUsed });
      setLetter('');
      try { const mk = await getMarket(d.game_id); setMarket(mk); } catch(_) {}
    }
      // Show synergy card selection for daily
      getSynergyOptions(d.game_id).then(r => {
        setSynergyOpts(r.options||[]);
        setSynergy(r.selected||"");
        if (!r.selected && r.options?.length > 0) setShowSynergy(true);
      }).catch(() => {});
    getSuggestions(d.game_id).then(setSugg).catch(() => setSugg([]));
  }

  async function startSpectatorDemo() {
    try {
      setError("");
      setBootMsg("Preparing spectator demo…");
      const d = await createGame({ botLevel: "strong", showcase: true, spectatorSeed: 42 });
      setGameId(d.game_id);
      setState(d.state);
      setDailyMode(false);
      setAsyncMode(false);
      setInviteUrl("");
      setSpectatorMode(true);
      setSpectatorSteps(0);
      setSpectatorNote("Watch how words reshape the map.");
      reset();
      setAnimGen(0);
      setBootMsg("");
      if (d.state?.marketLetters?.length > 0) {
        setMarket({
          active: d.state.marketLetters,
          preview: d.state.previewLetters || [],
          stats: d.state.marketLetters.map(l => ({letter:l,wordCount:0,bestGain:0,bestWord:'',roles:[]})),
          freeLetterUsed: !!d.state.freeLetterUsed,
        });
        try { const mk = await getMarket(d.game_id); setMarket(mk); } catch(_) {}
      }
      try { setSugg(await getSuggestions(d.game_id)); } catch { setSugg([]); }
      try { setThreats(await getThreat(d.game_id)); } catch { setThreats([]); }
      getSynergyOptions(d.game_id).then(r => {
        const options = r.options || [];
        setSynergyOpts(options);
        if (options[0]?.key) {
          selectSynergy(d.game_id, options[0].key).then(sel => {
            setSynergy(sel.selected || options[0].key);
            setShowSynergy(false);
          }).catch(() => {
            setSynergy(r.selected || options[0].key || "");
            setShowSynergy(false);
          });
        } else {
          setSynergy(r.selected || "");
          setShowSynergy(false);
        }
      }).catch(() => {});
    } catch(e) {
      setSpectatorMode(false);
      setBootMsg("");
      setError(e.message || "Could not start spectator demo");
    }
  }


  function dismissIntro(watch = false) {
    try { localStorage.setItem(LS_INTRO, "1"); } catch {}
    setShowIntro(false);
    if (watch) startSpectatorDemo();
  }

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("match") && qs.get("token")) return;
      const saved = JSON.parse(localStorage.getItem(LS_ASYNC) || "null");
      if (saved?.match && saved?.token) return;
    } catch {}
    boot().catch(e => setError(String(e)));
  }, []);

  // ── first-turn tutorial ──────────────────────────────────────────────────
  useEffect(() => {
    if (!state || showIntro || spectatorMode || asyncMode || state.winner) return;
    try {
      if (localStorage.getItem(LS_TUTOR) === "1") return;
    } catch {}
    setShowTutorial(true);
  }, [!!state, showIntro, spectatorMode, asyncMode, state?.winner]);

  useEffect(() => {
    if (!showTutorial) return;
    if (tutorialStep === 0 && letter) setTutorialStep(1);
    else if (tutorialStep === 1 && placed) setTutorialStep(2);
    else if (tutorialStep === 2 && path.length >= 3) setTutorialStep(3);
    else if (tutorialStep === 3 && (state?.moveHistory?.length || 0) > 0) finishTutorial();
  }, [showTutorial, tutorialStep, letter, placed?.row, placed?.col, path.length, state?.moveHistory?.length]);


  // ── state tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    setAnimGen(g => g + 1);
    const c = state.lastComboLabels || [];
    const synMsg = c.find(l => l && l.startsWith("SYNERGY:"));
    if (synMsg) setSynergyFlash(synMsg.replace("SYNERGY:", ""));
    else setSynergyFlash("");
    if (c.length > 0) {
      setCombo(c);
      if (comboTimer.current) clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo([]), 3500);
      if (c.some(l => l === "BRIDGE" || (typeof l === "string" && l.includes("BRIDGE")))) {
        setBridgeFlash(true); setTimeout(() => setBridgeFlash(false), 950);
      }
    }
  }, [state?.turn]);

  // ── bot auto-move ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || !gameId) return;
    if (asyncMode || spectatorMode) return;
    if (state.winner && state.winner !== "") return;  // stops on RED/BLUE/DRAW
    if (state.currentPlayer !== state.botPlayer) return;
    let cancelled = false;
    const run = async () => {
      setThinking(true);
      try {
        await new Promise(r => setTimeout(r, 350));
        const next = await botMove(gameId);
        if (cancelled) return;
        setState(next);
        // Market stable during bot turns (bot not market-constrained)
        reset();
        try { setSugg(await getSuggestions(gameId)); } catch(_) {}
      } catch(e) {
        if (!cancelled) setError(e.message || "Bot failed");
      }
      if (!cancelled) setThinking(false);
    };
    run();
    return () => { cancelled = true; setThinking(false); };
  }, [state?.turn, state?.currentPlayer, spectatorMode]);

  // ── spectator demo auto-play ─────────────────────────────────────────────
  useEffect(() => {
    if (!spectatorMode || !state || !gameId) return;
    if (asyncMode) return;
    if (state.winner && state.winner !== "") {
      setSpectatorNote("Battle Report ready — this is how words became territory.");
      return;
    }
    let cancelled = false;
    const combos = state.lastComboLabels || [];
    const hasHighlight = combos.some(x => String(x).includes("CAPTURE") || String(x).includes("BRIDGE") || String(x).includes("LOCK") || String(x).includes("SYNERGY"));
    const delay = hasHighlight ? 1700 : 850;
    const run = async () => {
      setThinking(true);
      try {
        await new Promise(r => setTimeout(r, delay));
        if (cancelled) return;
        const next = await autoMove(gameId, true);
        if (cancelled) return;
        setState(next);
        setSpectatorSteps(n => n + 1);
        reset();
        try { setSugg(await getSuggestions(gameId)); } catch { setSugg([]); }
        try { setThreats(await getThreat(gameId)); } catch { setThreats([]); }
        const last = next.moveHistory?.[next.moveHistory.length - 1];
        if (last?.comboLabels?.length) {
          setSpectatorNote(`${last.player} reshaped the map: ${terrainMoveLabel(last)}`);
        } else if (last?.word && last.word !== "SEED") {
          setSpectatorNote(`${last.player} claimed ground with ${last.word}.`);
        } else {
          setSpectatorNote("Bots are probing the frontier…");
        }
      } catch(e) {
        if (!cancelled) setError(e.message || "Spectator demo failed");
      }
      if (!cancelled) setThinking(false);
    };
    run();
    return () => { cancelled = true; setThinking(false); };
  }, [spectatorMode, state?.turn, state?.currentPlayer, gameId]);

  // ── game over ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    if (!state.winner || state.winner === "") return;  // not yet set
    // Game over: remove tactical preview and disable any pending input state.
    setValuePrev([]);
    setPath([]);
    setPlaced(null);
    setPreview(null);
    setLetter("");
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
        bestMove: best ? `${best.word} (Territory Swing +${best.territoryGained})` : null,
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
      return state?.board?.[p.row]?.[p.col]?.letter || "";
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
  const human = () => state && !spectatorMode && !thinking && !state.winner && (asyncMode ? state.currentPlayer === asyncRole : state.currentPlayer !== state.botPlayer);
  const isSel = (r,c) => path.some(p => p.row===r && p.col===c);

  // Opponent cells adjacent to any placeable empty cell = attackable
  const opponent = state?.currentPlayer === "RED" ? "BLUE" : "RED";
  const attackableSet = useMemo(() => {
    if (!state || !human()) return new Set();
    const s = new Set();
    const BS = state.board.length;
    for (let r = 0; r < BS; r++) {
      for (let c = 0; c < BS; c++) {
        const cell = state?.board?.[r]?.[c];
    if (!cell) return;
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
      const cell = state?.board?.[p.row]?.[p.col];
      if (cell?.owner === opponent) s.add(asKey(p.row, p.col));
    });
    return s;
  }, [path, state?.turn]);
  const hasNbr = (r,c) => {
    const b = state?.board;
    if (!Array.isArray(b) || !b[r] || !b[r][c]) return false;
    const BS = b.length - 1;  // dynamic board size (6 for 7x7)
    return (r>0&&b[r-1]?.[c]?.letter)||(r<BS&&b[r+1]?.[c]?.letter)||(c>0&&b[r]?.[c-1]?.letter)||(c<BS&&b[r]?.[c+1]?.letter);
  };
  const isLegal = (r,c) => !!(state?.board?.[r]?.[c]) && !state.board[r][c].letter && hasNbr(r,c);
  const isDim = (r,c) => {
    if (!state) return true;
    // In Spectator Mode and Battle Report, the board is display-first.
    // Do not dim it just because the user cannot click.
    if (spectatorMode || state.winner) return false;
    if (!human()) return true;
    const cell = state?.board?.[r]?.[c];
    if (!cell) return true;
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


  async function performRotateRaid(target = rotateTarget) {
    if (!target) { setError("Choose the top-left cell of a 2x2 block. Locked cells cannot rotate."); return; }
    try {
      const payload = { row: target.row, col: target.col };
      const next = asyncMode ? await rotateAsyncBlock(gameId, asyncToken, payload) : await rotateBlock(gameId, payload);
      setState(next);
      setRotateMode(false);
      setRotateTarget(null);
      setPath([]); setPlaced(null); setPreview(null); setValuePrev([]);
      setCombo(["Rotation Raid", "Build a word to breach enemy territory"]);
      try { navigator.vibrate && navigator.vibrate([20, 25, 35]); } catch {}
      await refresh(gameId);
    } catch(e) { setError(e.message || "Rotation Raid failed"); }
  }

  function handleRotateCell(r, c) {
    const size = state?.boardSize || state?.board?.length || 7;
    if (r + 1 >= size || c + 1 >= size) { setError("Choose the top-left cell of a 2x2 block."); return; }
    setRotateTarget({ row:r, col:c });
    setError("Press Confirm Rotation to rotate letters only. Ownership will not move.");
  }

  function clickCell(r,c) {
    if (!state || !human()) return;
    if (rotateMode) { handleRotateCell(r,c); return; }
    playSfx("click");
    const cell = state.board[r][c];

    // WT_DAZI_V2_CLICKCELL_BRANCH
    if (daziMode) {
      if (!cell?.letter) return;
      if (path.length > 0 && path[path.length - 1].row === r && path[path.length - 1].col === c) {
        setPath(path.slice(0, -1));
        return;
      }
      if (isSel(r, c)) return;
      if (path.length === 0) {
        setPlaced(null);
        setLetter("");
        setPreview(null);
        setPath([{row:r, col:c}]);
        setError("");
        return;
      }
      const last = path[path.length - 1];
      if (!adj(last, {row:r, col:c})) return;
      setPath(prev => [...prev, {row:r, col:c}]);
      setError("");
      return;
    }

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
  async function syncThreats(id=gameId) {
    try { setThreats(await getThreat(id)); } catch { setThreats([]); }
  }
  const refresh = async (id=gameId) => {
    try { setSugg(await getSuggestions(id)); } catch { setSugg([]); }
    await syncThreats(id);
  };
  async function submit() {
    if (!placed) { setError("Tap a green square first."); return; }
    if (!letter) {
      setError("Choose a green square on the board first.");
      return;
    }

    try {
      const payload = {game_id:gameId,row:placed.row,col:placed.col,letter,path,dazi:daziMode};
      const next = asyncMode ? await submitAsyncMove(gameId, asyncToken, payload) : await submitMove(payload);
      setState(next);
      // Update market from state immediately
      if (next.marketLetters?.length > 0) setMarket(m => ({...m, active:next.marketLetters, preview:next.previewLetters||[], freeLetterUsed:next.freeLetterUsed||false}));

      reset(); await refresh();
      getAlmost(gameId).then(setAlmost).catch(()=>{});
    } catch(e) { setError(e.message||"Move failed"); }
  }
  async function daziV2() {
    if (!daziMode) return;
    if (!path || path.length < 2) {
      setError("奪字する単語の文字を2文字以上つないでください。");
      return;
    }
    try {
      const payload = { path };
      const next = asyncMode ? await daziAsyncMove(gameId, asyncToken, payload) : await daziMove(gameId, payload);
      setState(next);
      reset(); await refresh();
      getAlmost(gameId).then(setAlmost).catch(()=>{});
    } catch(e) {
      setError(e.message || "奪字に失敗しました");
    }
  }

  async function seed() {
    if (!placed) { setError("Tap a green square first."); return; }
    if (!letter) { setError("Type one letter in the input box."); return; }
    try {
      const payload = {row:placed.row,col:placed.col,letter};
      const next = asyncMode ? await seedAsyncMove(gameId, asyncToken, payload) : await seedMove(gameId,payload);
      setState(next);
      if (next.marketLetters?.length > 0) setMarket(m => ({...m, active:next.marketLetters, preview:next.previewLetters||[], freeLetterUsed:next.freeLetterUsed||false}));

      reset(); await refresh();
      getAlmost(gameId).then(setAlmost).catch(()=>{});
    } catch(e) { setError(e.message||"Seed failed"); }
  }
  async function pass() {
    try { const next = asyncMode ? await passAsyncTurn(gameId, asyncToken) : await passTurn(gameId); setState(next); reset(); await refresh(); }
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
  const capturedOrderMap = new Map((state?.lastCapturedCells||[]).map((c,i)=>[asKey(c.row,c.col), i]));
  const lockedS   = new Set((state?.lastFortifiedCells  ||[]).map(c=>asKey(c.row,c.col)));
  const lockedOrderMap = new Map((state?.lastFortifiedCells||[]).map((c,i)=>[asKey(c.row,c.col), i]));
  const redT = tScore(state,"RED"), blueT = tScore(state,"BLUE");
  const comebackChance = state && !state.winner && state.currentPlayer && state.currentPlayer !== state.botPlayer
    ? (() => { const p=state.currentPlayer; const opp=p==="RED"?"BLUE":"RED";
               const my=tScore(state,p), op=tScore(state,opp); return op-my>=6; })()
    : false;
  const pct  = Math.round((redT / Math.max(redT+blueT,1)) * 100);
  const incPlaced = placed && path.some(p=>p.row===placed.row&&p.col===placed.col);
  const ok = preview?.isInDictionary && preview?.includesPlacedCell;
  const daziUsed = Number((state?.daziUses || {})[state?.currentPlayer] || 0);
  const daziRemaining = Math.max(0, 2 - daziUsed);
  const daziLabel = daziMode ? "奪字ON" : "奪字";
  const topMoves = [...(state?.moveHistory||[])].filter(m=>m.moveType==="WORD")
    .sort((a,b)=>(b.territoryGained*2+b.wordScoreGained*1.5+b.fortifiedCellsGained*2+(b.captureCount?5:0)+(b.comboLabels?.length||0)*1.5)
                -(a.territoryGained*2+a.wordScoreGained*1.5+a.fortifiedCellsGained*2+(a.captureCount?5:0)+(a.comboLabels?.length||0)*1.5))
    .slice(0,3);
  const bestMove = topMoves[0] || null;
  const moveLabel = terrainMoveLabel;
  const threatCellSet = useMemo(() => {
    const s = new Set();
    (threats||[]).forEach(t => (t.cells||[]).forEach(c => s.add(asKey(c.row,c.col))));
    return s;
  }, [JSON.stringify(threats||[])]);
  const threatMoveSet = useMemo(() => new Set((threats||[]).map(t => asKey(t.row,t.col))), [JSON.stringify(threats||[])]);
  const rotateTargetSet = useMemo(() => {
    if (!rotateTarget) return new Set();
    const r = rotateTarget.row, c = rotateTarget.col;
    return new Set([asKey(r,c), asKey(r,c+1), asKey(r+1,c), asKey(r+1,c+1)]);
  }, [rotateTarget?.row, rotateTarget?.col]);
  const rotateRaidUsed = !!state?.synergyState?.rotationRaidUsed;
  const lastMove = (state?.moveHistory || [])[Math.max((state?.moveHistory?.length || 0) - 1, 0)] || null;
  const lastMoveInsights = moveInsightLines(lastMove);
  const lastMoveIsSwing = !!lastMove && (
    (lastMove.captureCount || 0) > 0 ||
    (lastMove.fortifiedCellsGained || 0) > 0 ||
    (lastMove.territoryGained || 0) >= 5 ||
    (lastMove.comboLabels || []).some(x => String(x).includes("BRIDGE") || String(x).includes("SYNERGY") || String(x).includes("CAPTURE") || String(x).includes("DAZI") || String(x).includes("奪字"))
  );

  const boardOpeningClass = `opening-${String(state?.openingName || "plain").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-opening$/,"").replace(/^-|-$/g,"") || "plain"}`;
  const boardBannerText = lastMoveIsSwing && lastMove ? [
    (lastMove.captureCount||0)>0 ? `Captured ${lastMove.captureCount} cell${lastMove.captureCount===1?"":"s"}` : null,
    (lastMove.comboLabels||[]).some(x=>String(x).includes("BRIDGE")) ? "Bridge connected zones" : null,
    (lastMove.fortifiedCellsGained||0)>0 ? `Locked ${lastMove.fortifiedCellsGained} cell${lastMove.fortifiedCellsGained===1?"":"s"}` : null,
    (lastMove.comboLabels||[]).some(x=>String(x).startsWith("SYNERGY:")) ? "Synergy activated" : null,
    (lastMove.territoryGained||0)>=5 ? `Territory Swing +${lastMove.territoryGained}` : null,
  ].filter(Boolean).join(" · ") : "";

  const lastMoveHasBridge = !!lastMove && (lastMove.comboLabels || []).some(x => String(x).includes("BRIDGE"));
  const bridgePathSet = useMemo(() => {
    const s = new Set();
    if (lastMoveHasBridge) (lastMove.path || []).forEach(p => s.add(asKey(p.row, p.col)));
    return s;
  }, [lastMove?.turn, lastMove?.word, lastMoveHasBridge]);
  const bridgeSvgPoints = useMemo(() => {
    if (!lastMoveHasBridge || !(lastMove?.path || []).length) return "";
    return (lastMove.path || []).map(p => `${(p.col || 0) + 0.5},${(p.row || 0) + 0.5}`).join(" ");
  }, [lastMove?.turn, lastMove?.word, lastMoveHasBridge]);
  const lockNeighborSet = useMemo(() => {
    const s = new Set();
    (state?.lastFortifiedCells || []).forEach(c => {
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => {
        const r = c.row + dr, col = c.col + dc;
        if (r >= 0 && r < 7 && col >= 0 && col < 7) s.add(asKey(r,col));
      });
    });
    return s;
  }, [JSON.stringify(state?.lastFortifiedCells || [])]);

  const tutorialPlaceKey = useMemo(() => {
    if (!showTutorial || tutorialStep !== 1 || !state?.board) return "";
    for (let r = 0; r < state.board.length; r++) {
      for (let c = 0; c < state.board[r].length; c++) {
        const cell = state.board[r][c];
        if (cell?.letter) continue;
        const neighbors = [[r+1,c],[r-1,c],[r,c+1],[r,c-1]];
        if (neighbors.some(([nr,nc]) => nr>=0 && nr<state.board.length && nc>=0 && nc<state.board[nr].length && state.board[nr][nc]?.letter)) {
          return asKey(r,c);
        }
      }
    }
    return "";
  }, [showTutorial, tutorialStep, state?.turn, state?.boardSize, JSON.stringify(state?.board || [])]);
  const tutorialPathKey = useMemo(() => {
    if (!showTutorial || tutorialStep !== 2 || !placed) return "";
    const last = (path && path.length > 0 ? path[path.length - 1] : placed);
    const candidates = [
      [last.row+1,last.col],[last.row-1,last.col],[last.row,last.col+1],[last.row,last.col-1],
      [placed.row+1,placed.col],[placed.row-1,placed.col],[placed.row,placed.col+1],[placed.row,placed.col-1]
    ];
    for (const [r,c] of candidates) {
      if (r>=0 && r<7 && c>=0 && c<7 && state?.board?.[r]?.[c]?.letter) return asKey(r,c);
    }
    return "";
  }, [showTutorial, tutorialStep, placed?.row, placed?.col, path.length, state?.turn]);


  // ── WebAudio cues: click / capture / bridge / lock / synergy / battle report ──
  useEffect(() => {
    if (!lastMove) return;
    const key = `${lastMove.turn}-${lastMove.player}-${lastMove.word}`;
    const labels = (lastMove.comboLabels || []).map(x => String(x));

    if ((lastMove.captureCount || 0) > 0 && captureSoundRef.current !== key) {
      captureSoundRef.current = key;
      playSfx("capture", 0);
    }
    if (labels.some(x => x.includes("BRIDGE")) && bridgeSoundRef.current !== key) {
      bridgeSoundRef.current = key;
      playSfx("bridge", (lastMove.captureCount || 0) > 0 ? 130 : 0);
    }
    if ((lastMove.fortifiedCellsGained || 0) > 0 && lockSoundRef.current !== key) {
      lockSoundRef.current = key;
      playSfx("lock", labels.some(x => x.includes("BRIDGE")) ? 250 : 120);
    }
    if (labels.some(x => x.startsWith("SYNERGY:")) && soundTurnRef.current !== key) {
      soundTurnRef.current = key;
      playSfx("synergy", 330);
    }
  }, [lastMove?.turn, lastMove?.word, lastMove?.captureCount, lastMove?.fortifiedCellsGained, JSON.stringify(lastMove?.comboLabels || []), soundOn]);

  useEffect(() => {
    if (!state?.winner) return;
    const key = `${gameId}-${state?.winner}-${state?.turn}`;
    if (battleSoundRef.current === key) return;
    battleSoundRef.current = key;
    playSfx("battle", 120);
  }, [state?.winner, gameId, state?.turn, soundOn]);

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
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet"/>
      {/* ③ SEO + social meta tags */}
      <title>Word Territory{dailyMode&&dailyInfo?` · Daily #${dailyInfo.dayNumber}`:""}</title>
      <meta name="description" content="Word Territory is a word-powered territory strategy game where words become the map. Play the Daily Challenge!" />
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
      {showIntro && (
        <div className="intro-bg">
          <div className="intro-card">
            <div className="intro-kicker">30-second demo</div>
            <h2>Words become territory.</h2>
            <p>Watch letters claim ground, trigger captures, lock cells, and reshape the map.</p>
            <div className="intro-steps">
              <span>1. Choose a letter</span>
              <span>2. Tap a glowing cell</span>
              <span>3. Connect a word</span>
              <span>4. Watch territory change</span>
            </div>
            <div className="intro-btns">
              <button className="bprim" onClick={()=>dismissIntro(true)}>▶ Watch Demo</button>
              <button className="bsm" onClick={()=>dismissIntro(false)}>Start Playing</button>
            </div>
          </div>
        </div>
      )}
      {showTutorial && !showIntro && !spectatorMode && !state?.winner && (
        <div className="tutorial-mini">
          <strong>First move</strong>
          <span>{tutorialStep===0 ? "Choose this letter." : tutorialStep===1 ? "Tap a glowing tile." : tutorialStep===2 ? "Connect a word path." : "Capture Word."}</span>
          <button onClick={finishTutorial}>Skip</button>
        </div>
      )}
      {/* ── header ── */}
      <div className="hdr">
        <div className="hdr-l">
          <h1>WORD TERRITORY{dailyMode&&dailyInfo&&<span className="dpill">Daily #{dailyInfo.dayNumber}</span>}</h1>
          <p className="sub">Opening: {state.openingName} · {spectatorMode ? `Spectator Mode · ${state.botStyle || "Raider"} duel` : asyncMode ? `Async PvP · You are ${asyncRole}` : `Bot: ${state.botStyle || "Raider"}`} · {spectatorMode ? "Bot vs Bot" : thinking?"Bot thinking…":asyncMode ? (state.currentPlayer===asyncRole?`Your turn (${asyncRole})`:`Waiting for ${state.currentPlayer}`) : state.currentPlayer===state.botPlayer?"Bot's turn":`Your turn (${state.currentPlayer})`} · {state.boardSize===5?'Quick 5×5':'Standard 7×7'} · Round {state.turn}</p>
          <p className="opening-note">{OPENING_NOTES[state.openingName] || "Words become territory. Each move reshapes the map."}</p>
          <p className="tagline">Words become territory. Each move reshapes the map.</p>
        </div>
        <div className="hdr-r">
          <button className="bsm sound-toggle" onClick={()=>setSoundOn(v=>!v)} title="Toggle sound">{soundOn ? "🔊 Sound" : "🔇 Muted"}</button>
          {!dailyMode&&(
            <div className="mode-box">
              <label>Bot</label>
              <select value={mode} onChange={e=>setMode(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="strong">Strong</option>
              </select> <label className="boardModeCtl">Board <select value={boardMode} onChange={e=>setBoardMode(e.target.value)}><option value="standard">Standard 7×7</option><option value="quick">Quick 5×5</option></select></label>
            </div>
          )}
          {dailyInfo&&!dailyMode&&(
            <div className="dcard">
              <span className="dnum">Day #{dailyInfo.dayNumber}</span>
              <span className="dsub">{streak>1?`🔥 ${streak} day streak`:(dailyResult?"Completed ✓":(state?.openingName || dailyInfo.openingName))}</span>
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
          {dailyMode
            ?<button className="bprim" onClick={()=>boot(mode)}>← Free Play</button>
            :<button className="bprim" onClick={()=>boot(mode)}>New Game</button>
          }
          <button className="bsm demo-btn" onClick={startSpectatorDemo}>▶ Watch Demo</button>
          {spectatorMode&&<button className="bsm" onClick={()=>{setSpectatorMode(false); setSpectatorNote("Demo paused. Press New Game to play.");}}>Stop Demo</button>}
          <button className="bsm" onClick={async()=>{try{const d=await createAsyncMatch({botLevel:mode, boardMode}); setAsyncMode(true); setSpectatorMode(false); setAsyncToken(d.redToken); setAsyncRole('RED'); setGameId(d.game_id); setState(d.state); setDailyMode(false); setInviteUrl(`${window.location.origin}${d.blueUrl}`); setMarket({active:d.state.marketLetters||[], preview:d.state.previewLetters||[], stats:[], freeLetterUsed:!!d.state.freeLetterUsed}); await refresh(d.game_id);}catch(e){setError(e.message||'Could not create async match');}}}>Async PvP</button>
          {asyncMode&&<button className="bsm" onClick={async()=>{try{const d=await getAsyncMatch(gameId, asyncToken); setState(d.state); await refresh(gameId);}catch(e){setError(e.message||'Could not refresh match');}}}>Refresh Match</button>}
        </div>
      </div>

      {/* ── First-move guide ── */}
      {tutTurns === 0 && human() && (
        <div className="firstmove-banner">
          <strong>How to play:</strong>{" "}
          Tap a <span className="fm-green">green square</span> → type a letter → connect letters to make a word → press <strong>Claim Territory</strong>
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
            <li>Tap a <em>green square</em> → type any letter → connect letters to make a 3–6 letter word → press <strong>Claim Territory ⚔</strong>.</li>
            <li>Example: board has D–S–T, place U → select D→U→S→T → DUST! Your letter can go anywhere in the path.</li>
            <li>Enclose opponent cells to <strong>capture</strong> them. Surrounded own cells become 🏰 <strong>Fortified</strong>.</li>
            <li><strong>Role Bonuses</strong> — earn extra territory: BRIDGE +3T · CUT +2T · CROSS WORD +2T · LONG PATH +1T</li>
            <li><strong>Seed</strong> — place a letter without capturing when stuck. Good for setting up future words.</li>
            <li><strong>Goal:</strong> More red cells than blue wins. Territory beats vocabulary.</li>
            <li><strong>Daily Challenge</strong> — same board worldwide each day. One attempt. Strong bot.</li>
          <li><strong>Disarm</strong> — twice per game. Include a locked enemy letter in your word to neutralize that lock.</li>
          </ol>
        </div>
      )}

      {/* ── banners ── */}
      {dailyMode&&<div className="dbanner">🗓️ Daily #{dailyInfo?.dayNumber} · {dailyInfo?.dateStr} · Strong Bot · {state.botStyle || "Raider"}{streak>1?` · 🔥 ${streak} day streak`:""}</div>}
      {asyncMode&&inviteUrl&&<div className="dbanner async-banner">🔗 Async PvP invite: <button className="link-copy" onClick={async()=>{try{await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(()=>setCopied(false),2000);}catch{}}}>{copied?'Copied!':'Copy BLUE link'}</button></div>}
      {spectatorMode&&<div className="dbanner demo-banner">🎬 Spectator Mode · Bot vs Bot · {spectatorNote || "Words become territory. Watch the map reshape itself."}</div>}
      {thinking&&<div className="bnr thinking">{spectatorMode?"Spectator bots are moving…":"Bot is thinking…"}</div>}
      {spectatorMode&&lastMoveIsSwing&&<div className="bnr watch-swing">👀 Watch this swing — {lastMove ? terrainMoveLabel(lastMove) : "the map is changing"}</div>}
      {synergyFlash&&<div className="bnr synergy-flash">{synergyFlash}</div>}
          {comboBanner.length>0&&<div className="bnr combo">{comboBanner.join(" · ")}</div>}
      {error&&<div className="bnr err">{error}<button className="bx" onClick={()=>setError("")}>✕</button></div>}
      {daziMode&&<div className="bnr dazi-help-banner">{"Disarm mode: include a locked enemy letter in your word to neutralize it."}</div>}
      


      {/* ── layout ── */}
      <div className="layout">
        <div className="bcol">
          {/* board */}
          <div className="bwrap">
                        {state?.winner && state.winner !== "" && (
              <div className={`end-flood ${state.winner==="RED"?"flood-red":state.winner==="BLUE"?"flood-blue":"flood-draw"}`} key={`flood-${state.winner}`}/>
            )}
            <div className="board-wrap"><div className={`board ${boardOpeningClass} ${spectatorMode ? "board-demo" : ""} ${lastMoveIsSwing ? "board-swing" : ""} ${bridgeFlash ? "board-bridge" : ""}`}>
              {state.board.map(row=>row.map(cell=>{
                const k=asKey(cell.row,cell.col);
                const vp = Array.isArray(valuePrev)
                  ? valuePrev.find(p => p.row === cell.row && p.col === cell.col)
                  : null;
                const showVp = !state.winner && vp && !cell.letter && ((Number(vp.gain)||0) >= 2 || (vp.roles||[]).length > 0 || !!vp.word);
                return <div key={k} className="cell-slot">
                  <Cell cell={cell}
                    sel={isSel(cell.row,cell.col)} placed={placed?.row===cell.row&&placed?.col===cell.col}
                    legal={!placed&&isLegal(cell.row,cell.col)}
                    changed={changedS.has(k)} captured={capturedS.has(k)} lockedNow={lockedS.has(k)}
                    bridgePath={bridgePathSet.has(k)} lockNeighbor={lockNeighborSet.has(k)}
                    tutorialPlace={tutorialPlaceKey === k} tutorialPath={tutorialPathKey === k}
                    captureOrder={capturedOrderMap.get(k)} lockOrder={lockedOrderMap.get(k)}
                    disabled={isDim(cell.row,cell.col)} gen={animGen}
                    attack={attackableSet.has(k) && !isSel(cell.row,cell.col)}
                    threat={threatCellSet.has(k)} threatMove={threatMoveSet.has(k)} rotateTarget={rotateTargetSet.has(k)}
                    inPath={inPathOpponentSet.has(k)}
                    onClick={()=>clickCell(cell.row,cell.col)}/>
                  {showVp && <div className={`vp-overlay vp-${vp.tier || 'basic'}`} title={vp.word ? `${vp.word} · Territory Swing +${vp.gain||0}${vp.synergyPreview ? ' · '+vp.synergyPreview : ''}` : 'Setup'}>
                    <span className="vp-num">{vp.tier==='strong' ? `+${vp.gain}T` : vp.tier==='frontline' ? `+${vp.gain}T` : (Number(vp.gain)||0) > 0 ? `+${vp.gain}T` : 'SET'}</span>
                    {vp.tier==='strong' && <span className="vp-star">★</span>}
                  </div>}
                </div>;
              }))}
              {bridgeSvgPoints && (
                <svg className="bridge-svg" viewBox="0 0 7 7" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={bridgeSvgPoints} />
                </svg>
              )}
              {boardBannerText && <div className="board-event-banner">{boardBannerText}</div>}
            </div>
          </div>

          {/* ── Winner Banner ── */}
          {state.winner && (
            <>
              <div className="winner-banner">
                <div className="battle-title">Battle Report</div>
                {state.winner === "DRAW" ? "🤝 Draw" :
                 state.winner === "RED"  ? "🔴 RED wins!" :
                                           "🔵 BLUE wins!"}
                <span className="winner-score">
                  {state.winner !== "DRAW" && ` · ${Math.max(redT,blueT)}–${Math.min(redT,blueT)}`}
                </span>
                {bestMove && <div className="best-move-inline">Best Territorial Swing: <strong>{moveLabel(bestMove)}</strong></div>}
              </div>
              <div className="battle-report-card report-polished">
                <div className="report-head">
                  <div><span className="report-kicker">Battle Report Card</span><strong>{state.openingName}</strong></div>
                  <div className="report-score"><span>🔴 {redT}</span><span>🔵 {blueT}</span></div>
                </div>
                {bestMove && <div className="report-best"><span>Best Territorial Swing</span><strong>{moveLabel(bestMove)}</strong></div>}
                <div className="report-stats">
                  <span>Largest capture: {Math.max(0, ...((state.moveHistory||[]).map(m=>m.captureCount||0)))} cells</span>
                  <span>Top swings: {topMoves.length}</span>
                  <span>Opening: {state.openingName}</span>
                </div>
                {state?.board && <pre className="report-emoji">{buildEmojiBoard(state.board)}</pre>}
                <div className="report-actions">
                  <button className="bcopy" onClick={async()=>{try{await navigator.clipboard.writeText(buildShare(dailyInfo?.dayNumber || "Free", "", {winner:state.winner, redScore:redT, blueScore:blueT, bestMove:bestMove?moveLabel(bestMove):"", openingName:state.openingName, emojiBoard:buildEmojiBoard(state.board)}));setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{}}}>{copied?"✓ Copied":"Copy result"}</button>
                  <button className="bcopy" onClick={async()=>{try{await navigator.clipboard.writeText(buildEmojiBoard(state.board));setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{}}}>Copy board</button>
                </div>
              </div>
            </>
          )}

          {/* ── Letter Market ── */}
          {!state.winner && (
            <div className="lm-panel" style={{display: market.active.length > 0 ? 'block' : 'none'}}>
              <div className="lm-header">
                <span className="lm-title">🎴 Letter Market {comebackChance && <b className="come-badge">★ Reclaim</b>}</span>
                <span className="lm-preview">
                  Next: {(market.preview||[]).map((l,i) => <span key={i} className="lm-prev-chip">{l}</span>)}
                </span>
              </div>
              <div className="lm-active">
                {(market.active||[]).map((ltr,i) => {
                  const s = (market.stats||[]).find(x => x.letter === ltr) || {letter:ltr, wordCount:0, bestGain:0, bestWord:'', roles:[]};
                  return <button key={`${ltr}-${i}`}
                    className={`lm-tile ${letter===ltr ? 'lm-selected' : ''} ${showTutorial && tutorialStep===0 && i===0 ? 'tut-pulse tut-target' : ''}`}
                    onClick={() => {
                      if (state?.winner) return;
                      playSfx("click");
                      setLetter(ltr); setPath([]); setPlaced(null); setError(''); setPreview(null);
                      setValuePrev([]);
                      if (gameId && ltr) getLetterPreview(gameId, ltr)
                        .then(r => {
                          const moves = Array.isArray(r) ? r : (r?.moves || []);
                          setValuePrev(moves.filter(p => ((Number(p.gain)||0) >= 2) || (p.roles||[]).length > 0 || !!p.word));
                        })
                        .catch(()=>setValuePrev([]));
                    }}
                    disabled={!human()}
                    title={s.bestWord ? `Best Swing: ${s.bestWord} · Territory Swing +${s.bestGain}` : 'Setup / no direct word'}
                  >
                    {showTutorial && tutorialStep===0 && i===0 && <span className="tut-bubble tut-lm">Choose this</span>}
                    <span className="lm-letter">{ltr}</span>
                    {s.wordCount > 0 ? (
                      <span className="lm-stats">
                        {s.bestGain > 0 && <span className="lm-gain">Swing +{s.bestGain}</span>}
                        {s.wordCount > 0 && <span className="lm-count">{s.wordCount}w</span>}
                        {s.roles?.length > 0 && <span className="lm-role">{s.roles[0].substring(0,3)}</span>}
                      </span>
                    ) : (
                      <span className="lm-stats"><span className="lm-zero" style={{fontSize:10}}>setup</span></span>
                    )}
                  </button>;
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
                          setMarket(m => ({...m, ...r}));
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
                        setMarket(m => ({...m, ...r}));
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
          {!state.winner && <div className="mpanel">
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
                        {" · "}+{preview.wordScore}pts · Territory Swing +{preview.territoryGain}
                        {preview.lockGain>0&&` · Locked ${preview.lockGain}`}
                        {preview.captureHappened&&<span className="pvcap"> ⚔ Captured {preview.captureCount||1}</span>}
                      </div>
                      {preview.comboLabels?.length>0&&<div className="chips">
                        {preview.comboLabels.map((x,xi)=>{
                          const label = terrainComboLabel(x, { captureCount: preview.captureCount || 0 });
                          if(String(x).startsWith('SYNERGY:')){
                            return <span key={xi} className="chip combo synergy-chip" title={label}>✦ {label}</span>;
                          }
                          return <span key={xi} className="chip combo">{label}</span>;
                        })}
                      </div>}
                    </>
                ):(
                  <div className="pvhint">
                    {daziMode
                      ? "奪字モード：既存文字だけをつなぎ、ロック敵文字を含む有効語を作ってください。緑マスは不要です。"
                      : !placed
                      ? (market.active.length > 0 ? (thinking ? "Bot is thinking..." : state?.winner ? "Battle Report" : "Choose a tile from Letter Market above ↑ then read the Territory Preview.") : "Tap a green square to place a letter.")
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
            <div className="brow">
              <button className={`ba bsubmit ${showTutorial && tutorialStep===3 ? "tut-pulse tut-submit" : ""}`} onClick={daziMode ? daziV2 : submit} disabled={!human()}>{daziMode ? "奪字確定" : showTutorial && tutorialStep===3 ? "語を確定 ⚔" : ok ? "領地を確定 ⚔" : "決定"}</button>
              {!isTutorial && <button className="ba bseed" onClick={seed} disabled={!human()} title={state?.selectedSynergy==="SEED_TACTICIAN" ? "Seed (free — +3T next word)" : "Seed costs 1 territory"}>
              <span className="seed-label">{lastStand ? "Reclaim" : "Seed"}</span>{state?.selectedSynergy!=="SEED_TACTICIAN" && <span className="seed-cost">{lastStand ? "Free" : "Cost -1"}</span>}
            </button>}
              {!isTutorial && <button className={`ba bdazi ${daziMode ? "active" : ""}`} onClick={()=>setDaziMode(v=>!v)} disabled={!human() || daziRemaining<=0} title="Twice per game. Include a locked enemy letter in your word to neutralize it.">{daziMode ? "Disarm ON" : "Disarm"} {daziRemaining}/2</button>}
              <button className="ba" onClick={()=>{ setPath([]); setPlaced(null); setError(''); setPreview(null); }} disabled={!human()}>Clear</button>
              {!isTutorial && <button className={`ba ${daziMode ? "active" : ""}`} onClick={()=>{ setDaziMode(v=>!v); setPath([]); setPlaced(null); setLetter(""); setPreview(null); setError(!daziMode ? "奪字モード：盤面上の既存文字だけをつなぎ、ロックされた敵文字を含む有効語を作ると、その1マスを中立化します。" : ""); }} disabled={!human() || daziRemaining<=0} title="緑マス不要。ロック敵文字を含む既存文字パスで発動します。">奪字 {daziMode ? "ON " : ""}{daziRemaining}/2</button>}{/* WT_DAZI_V2_TOGGLE_BUTTON */}
              {!isTutorial && <button className="ba" onClick={pass} disabled={!human()}>Pass</button>}
              {!isTutorial && !rotateRaidUsed && <button className={`ba brotate ${rotateMode ? "active" : ""}`} onClick={()=>{ if(rotateTarget) performRotateRaid(); else { setRotateMode(v=>!v); setRotateTarget(null); setPath([]); setPlaced(null); setPreview(null); setError("Choose the top-left of a 2x2 block. Rotation alone captures nothing."); } }} disabled={!human()} title="Once per game. Rotate letters only in a 2x2 block touching enemy territory. Ownership does not move.">{rotateTarget ? "Confirm Rotation" : rotateMode ? "Pick 2x2" : "Rotation Raid"}</button>}
              {rotateMode && <button className="ba" onClick={()=>{setRotateMode(false);setRotateTarget(null);setError("");}} disabled={!human()}>Cancel</button>}
            </div>
          </div>}
        </div>

        {/* side panel */}
        <div className="mobile-tabs">
          <button className={mobileTab==="hints" ? "active" : ""} onClick={()=>setMobileTab("hints")}>Hints</button>
          <button className={mobileTab==="threat" ? "active" : ""} onClick={()=>setMobileTab("threat")}>Threat</button>
          <button className={mobileTab==="history" ? "active" : ""} onClick={()=>setMobileTab("history")}>History</button>
        </div>
        <div className={`scol tab-${mobileTab}`}>
          {synergy && (() => { const sc = synergyOpts.find(c=>c.key===synergy); return sc ? (
            <div className="syn-active">
              {sc.icon} <strong>{sc.name}</strong>
              <span className="syn-active-effect">{sc.effect}</span>
            </div>
          ) : null; })()}
          {almost.length > 0 && (
            <div className={`panel panel-almost ${comebackChance ? "comeback-box" : ""}`}>
              <div className="ph" onClick={()=>setAlmostOpen(v=>!v)}>
                <span>{comebackChance ? "🔥 Comeback chance" : "🀄 Almost"}</span><span className="ci">{showAlmost?"▲":"▼"}</span>
              </div>
              {showAlmost && <div className="almost-list">
                <div className="almost-title">{comebackChance ? "One letter can swing the map:" : "Place one letter to make:"}</div>
                {almost.map((a,i) => (
                  <span key={i} className="almost-chip">
                    +<strong>{a.needs}</strong> → {a.word}
                  </span>
                ))}
              </div>}
            </div>
          )}
          <div className="panel panel-suggest">
            <div className="ph" onClick={()=>setSuggest(v=>!v)}>
              <span>💡 Suggested</span><span className="ci">{showSuggest?"▲":"▼"}</span>
            </div>
            {showSuggest&&(
              <div className="chips sc">
                {[...new Set(suggestions)].length?[...new Set(suggestions)].map(w=><span key={w} className="chip">{w}</span>):<div className="no-word-hint">No playable word found.<br/>Use <strong>Seed</strong> to place a tile without capturing.</div>}
              </div>
            )}
          </div>
                    <div className="panel panel-threat">
            <div className="ph" onClick={()=>setThreatPanel(v=>!v)}>
              <span>⚠ Threat</span><span className="ci">{showThreatPanel?"▲":"▼"}</span>
            </div>
            {showThreatPanel&&(
              <div className="threat-list">
                {threats && threats.length ? threats.slice(0,5).map((t,i)=>(
                  <div className="threat-row" key={i}>
                    <strong>{t.word || "Capture threat"}</strong>
                    <span>{(t.cells||[]).length} cell{(t.cells||[]).length===1?"":"s"} exposed</span>
                  </div>
                )) : <div className="muted">No immediate capture threat.</div>}
              </div>
            )}
          </div>
<div className="panel panel-history">
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
      </div>

      {/* ── summary modal ── */}
      {/* ── Synergy Card Selection Modal ── */}
      {showSynergy && !synergy && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget&&setShowSynergy(false)}>
          <div className="modal syn-modal">
            <h2 style={{marginBottom:6}}>🎴 Choose Your Strategy</h2>
            <p style={{fontSize:13,color:'#888',marginBottom:20}}>Pick one card. It stays active the whole game.</p>
            <div className="syn-cards">
              {(synergyOpts||[]).map(card => (
                <button key={card.key} className="syn-card"
                  onClick={() => {
                    selectSynergy(gameId, card.key)
                      .then(() => { setSynergy(card.key); setShowSynergy(false); })
                      .catch(() => { setSynergy(card.key); setShowSynergy(false); });
                  }}
                >
                  <div className="syn-icon">{card.icon}</div>
                  <div className="syn-name">{card.name}</div>
                  {card.difficulty && <div className="syn-difficulty" data-diff={card.difficulty}>{card.difficulty}</div>}
                  <div className="syn-effect">{card.effect}</div>
                  {card.tip && <div className="syn-tip">{card.tip}</div>}
                </button>
              ))}
            </div>
            <button className="syn-skip" onClick={() => setShowSynergy(false)}>
              Skip — play without a card
            </button>
          </div>
        </div>
      )}

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
                {bestMove && <div className="best-move-card"><strong>Best Territorial Swing:</strong> {moveLabel(bestMove)}</div>}
                {topMoves.length>0&&<><h3>Top Territorial Swings</h3>{topMoves.map((m,i)=><HistItem key={i} m={m}/>)}</>}
                {state?.board && <div className="emoji-board-card"><div className="muted">Emoji Board</div><pre>{buildEmojiBoard(state.board)}</pre><button className="bcopy" onClick={async()=>{try{await navigator.clipboard.writeText(buildEmojiBoard(state.board));setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{}}}>{copied?"✓ Copied":"Copy board"}</button></div>}

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
                <h2>Battle Report</h2>
                <p>Winner: <strong>{state.winner||"Draw"}</strong></p>
                <div className="scard">
                  <div className="scrow"><span>🔴 RED</span><strong>{redT} cells</strong></div>
                  <div className="scrow"><span>🔵 BLUE</span><strong>{blueT} cells</strong></div>
                </div>
                {bestMove && <div className="best-move-card"><strong>Best Territorial Swing:</strong> {moveLabel(bestMove)}</div>}
                {topMoves.length>0&&<><h3>Top Territorial Swings</h3>{topMoves.map((m,i)=><HistItem key={i} m={m}/>)}</>}
                <div className="modal-btns">
                  <button className="bprim" onClick={()=>boot(mode)}>New Game</button>
                  {dailyInfo&&!dailyResult&&<button onClick={()=>{setSum(false);bootDaily();}}>Daily Challenge</button>}
                  <button onClick={()=>setSum(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showLB&&<LeaderboardModal onClose={()=>setShowLB(false)} dailyInfo={dailyInfo} myRank={myRank}/>}

    </main>

    <style jsx global>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');

      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;background:#f0f2f5;color:#111;font-size:15px}
      button,input,select,textarea{font-family:inherit}
      .loading{padding:30px;text-align:center}
      .page{padding:14px;max-width:1400px;margin:0 auto}

      /* header */
      .hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}
      .hdr-l h1{font-family:'Space Grotesk',sans-serif;font-size:22px;letter-spacing:.04em;font-weight:700}
      .sub{font-size:12px;color:#666;margin-top:2px}
      .tagline{font-size:12px;color:#111;font-weight:800;margin-top:4px;letter-spacing:.2px}
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
      .demo-btn{border-color:#6d28d9;color:#5b21b6;font-weight:800;background:#faf5ff}
      .bprim{padding:9px 16px;border-radius:10px;border:none;background:#111;color:#fff;cursor:pointer;font-size:14px;font-weight:700;white-space:nowrap}
      .bprim:hover{background:#333}

      /* intro / first impression */
      .intro-bg{position:fixed;inset:0;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;z-index:90;padding:18px}
      .intro-card{background:#fff;border-radius:22px;padding:26px;max-width:560px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,.32);text-align:center;border:1px solid rgba(255,255,255,.7)}
      .intro-kicker{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#6d28d9;font-weight:900;margin-bottom:8px}
      .intro-card h2{font-size:28px;margin-bottom:8px;letter-spacing:.3px}
      .intro-card p{font-size:15px;color:#475569;line-height:1.6;margin:0 auto 14px;max-width:440px}
      .intro-steps{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:12px 0 18px}
      .intro-steps span{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;color:#334155}
      .intro-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
      .what-card{background:#fff;border:1px solid #e2e8f0;border-left:5px solid #111;border-radius:12px;padding:11px 14px;margin-bottom:10px;box-shadow:0 2px 10px rgba(15,23,42,.04)}
      .what-card.what-swing{border-left-color:#7c3aed;background:linear-gradient(90deg,#faf5ff,#fff)}
      .what-kicker{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:#64748b;font-weight:900;margin-bottom:3px}
      .what-lines{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
      .what-lines span{background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:3px 8px;font-size:12px;color:#334155;font-weight:700}

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
      .demo-banner{background:linear-gradient(90deg,#111827,#4c1d95,#7c3aed);color:#fff;border:1px solid rgba(255,255,255,.16);box-shadow:0 4px 18px rgba(76,29,149,.25)}
      .demo-status{color:#1e3a8a;font-weight:800}
      .board-demo{background:radial-gradient(circle at 50% 45%,rgba(124,58,237,.08),transparent 60%);padding:8px;border-radius:16px}

      .watch-swing{background:linear-gradient(90deg,#581c87,#7c3aed,#9333ea);color:#fff;font-weight:900;text-align:center;box-shadow:0 0 0 2px rgba(167,139,250,.15)}
      .combo{background:#fff9c4;font-weight:800;text-align:center;font-size:16px;border:2px solid #f5d000}
      .err{background:#ffeaea;color:#8b1a1a;display:flex;justify-content:space-between;align-items:center}
      .bx{background:none;border:none;cursor:pointer;font-size:16px;color:#8b1a1a}

      /* layout */
      .layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
      .bcol{display:flex;flex-direction:column;gap:10px}

      /* board — visual polish */
      .bwrap{background:linear-gradient(180deg,#fffdf8,#f7f3ea);border:1px solid #ddd6c8;border-radius:18px;padding:16px;overflow-x:auto;box-shadow:0 6px 24px rgba(31,41,51,.06)}
      .board-wrap{width:100%;overflow-x:auto;display:flex;justify-content:center;-webkit-overflow-scrolling:touch}
      .board{--cell:52px;--gap:6px;position:relative;display:grid;grid-template-columns:repeat(7,var(--cell));gap:var(--gap);justify-content:center;min-width:max-content;padding:12px;border-radius:20px;background:
        radial-gradient(circle at 50% 50%,rgba(255,255,255,.42),transparent 52%),
        linear-gradient(135deg,rgba(255,255,255,.55),rgba(244,239,228,.72));
        border:1px solid rgba(216,210,196,.9);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 12px 28px rgba(31,41,51,.07)}
      .board.opening-circle{background:radial-gradient(circle at 50% 50%,rgba(245,158,11,.12) 0 32%,transparent 33% 100%),linear-gradient(135deg,#fffdf8,#f4efe4)}
      .board.opening-bridge{background:linear-gradient(90deg,transparent 0 45%,rgba(245,158,11,.12) 46% 54%,transparent 55% 100%),linear-gradient(135deg,#fffdf8,#f4efe4)}
      .board.opening-garden{background:radial-gradient(circle at 22% 18%,rgba(34,197,94,.10),transparent 40%),linear-gradient(135deg,#fffdf8,#eff8ef)}
      .board.opening-stone{background:linear-gradient(135deg,#f8fafc,#e7e5df)}
      .board.opening-river,.board.opening-water{background:linear-gradient(135deg,rgba(79,131,204,.10) 0 18%,transparent 19% 36%,rgba(79,131,204,.08) 37% 55%,transparent 56%),linear-gradient(135deg,#fffdf8,#eef5fb)}
      .board.opening-forest,.board.opening-plant{background:linear-gradient(135deg,#fffdf8,#eff8ef)}
      .board.opening-market{background:linear-gradient(45deg,rgba(245,158,11,.10),transparent 32%),linear-gradient(135deg,#fffdf8,#f4efe4)}
      .board.board-swing{animation:boardpulse 900ms ease both}
      .board-demo .cell{opacity:1!important;filter:none!important}
      .cell-slot{position:relative;width:var(--cell);height:var(--cell);display:flex;align-items:center;justify-content:center}
      .cell{position:relative;width:var(--cell);height:var(--cell);border:1px solid #d8d2c4;border-radius:12px;background:#f7f3ea;font-family:"Space Grotesk",system-ui,sans-serif;font-size:20px;font-weight:700;letter-spacing:-.01em;cursor:pointer;transition:background .16s, transform .12s, box-shadow .16s,color .16s;color:#1f2933;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 2px 7px rgba(31,41,51,.10);font-feature-settings:"kern" 1;user-select:none}
      .cell.cr{background:rgba(216,92,92,.28);border-color:rgba(216,92,92,.58);color:#7a2424;box-shadow:inset 0 1px 0 rgba(255,255,255,.52),0 2px 8px rgba(216,92,92,.12)}
      .cell.cb{background:rgba(79,131,204,.30);border-color:rgba(79,131,204,.58);color:#173e74;box-shadow:inset 0 1px 0 rgba(255,255,255,.52),0 2px 8px rgba(79,131,204,.13)}
      .cell.ft{border:2px solid rgba(17,24,39,.78);box-shadow:inset 0 0 0 3px rgba(17,24,39,.18),inset 0 1px 0 rgba(255,255,255,.55),0 2px 7px rgba(17,24,39,.16)}
      .cell.sl{outline:3px solid #f59e0b;outline-offset:-3px}
      .cell.pl{box-shadow:inset 0 0 0 3px #111827,0 2px 7px rgba(31,41,51,.12)}
      .cell.lg{background:#e9f9e7;border-color:#70bf6f;box-shadow:0 0 0 3px rgba(112,191,111,.12),0 2px 7px rgba(31,41,51,.08)}
      .cell:hover:not(.dm):not(.sl){transform:translateY(-1px);filter:brightness(1.04)}
      .cell.cr:hover:not(.dm){background:rgba(216,92,92,.40)}
      .cell.cb:hover:not(.dm){background:rgba(79,131,204,.42)}
      .cell.lg:hover{background:#dff5dc;transform:translateY(-1px)}
      .cell.dm{opacity:.72;cursor:not-allowed}
      .cell:not(.cr):not(.cb):not(.lg):not([data-letter])::after{
        content:"";display:block;width:5px;height:5px;border-radius:50%;
        background:rgba(31,41,51,.12);position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);pointer-events:none
      }
      .cell[data-chg]{animation:aclaim 500ms ease forwards}
      .cell[data-cap]{animation:acap 1050ms cubic-bezier(.2,.8,.2,1) forwards;animation-delay:calc(var(--cap-order,0) * 90ms);animation-fill-mode:both}
      .cell[data-lk]{animation:alk 850ms ease forwards;animation-delay:var(--lock-delay,0ms);animation-fill-mode:both}
      .lock-shield{position:absolute;right:3px;bottom:2px;font-size:9px;line-height:1;background:rgba(255,255,255,.90);border:1.5px solid rgba(17,24,39,.72);border-radius:999px;padding:2px 3px;box-shadow:0 1px 4px rgba(0,0,0,.18);pointer-events:none;letter-spacing:0}
      .cell.rotate-target{outline:3px solid #8b5cf6!important;outline-offset:-3px;box-shadow:0 0 0 4px rgba(139,92,246,.18),0 0 18px rgba(139,92,246,.35)!important;animation:rotatePulse .75s ease-in-out infinite alternate}
      .brotate.active{background:#ede9fe;border-color:#8b5cf6;color:#4c1d95}
      @keyframes rotatePulse{from{transform:rotate(-1deg) scale(1)}to{transform:rotate(1deg) scale(1.035)}}
      .cell.threat{box-shadow:inset 0 0 0 2px rgba(37,99,235,.48),0 0 0 3px rgba(37,99,235,.08);background:rgba(37,99,235,.08)}
      .cell.threatMove{outline:2px dashed rgba(37,99,235,.42);outline-offset:-5px}
      .threat-dot{position:absolute;bottom:4px;left:4px;width:7px;height:7px;border-radius:50%;background:#2563eb;box-shadow:0 0 8px rgba(37,99,235,.75);pointer-events:none}
      .cell.bridge-path{animation:bridgeGlow 1050ms ease-out 1 forwards}
      .cell.lock-neighbor{animation:lockNeighborPulse 900ms ease-in-out 1}
      .bridge-svg{position:absolute;inset:12px;width:calc(100% - 24px);height:calc(100% - 24px);pointer-events:none;z-index:8;overflow:visible}
      .bridge-svg polyline{fill:none;stroke:#f59e0b;stroke-width:.055;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 .06rem rgba(245,158,11,.85));stroke-dasharray:8;animation:drawBridge 1200ms ease-out forwards}
      .board-event-banner{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:24;background:rgba(17,24,39,.92);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 14px;font-size:13px;font-weight:900;letter-spacing:.15px;box-shadow:0 14px 38px rgba(17,24,39,.22);animation:boardBanner 1550ms ease-out forwards;pointer-events:none;white-space:nowrap;max-width:88%;overflow:hidden;text-overflow:ellipsis}
      .what-title{font-size:15px;font-weight:900;margin-top:2px}
      .what-summary{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .what-summary span{background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;color:#334155}
      .report-emoji{font-size:16px;line-height:1.18;background:#0f172a;color:#fff;border-radius:12px;padding:10px;margin:10px 0 0;letter-spacing:1px;display:inline-block}
      .report-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .report-polished{background:linear-gradient(180deg,#ffffff,#f8fafc);border:1px solid #dbe3ef;box-shadow:0 12px 30px rgba(15,23,42,.10)}
      .report-polished .report-best{background:linear-gradient(90deg,#fef3c7,#fff);border-color:#f59e0b}
      .sound-toggle{min-width:84px}
      .opening-note{font-size:12px;color:#4c1d95;font-weight:800;margin-top:3px}
      .come-badge{display:inline-block;margin-left:6px;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:999px;padding:2px 7px;font-size:10px;vertical-align:middle;box-shadow:0 0 0 3px rgba(245,158,11,.12)}
      .comeback-box{border-color:#f59e0b!important;background:linear-gradient(90deg,#fff7ed,#fff)!important}
      .comeback-box .almost-title{color:#b45309;font-weight:900}
      .tutorial-mini{position:fixed;left:50%;top:78px;transform:translateX(-50%);z-index:80;background:#111827;color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 32px rgba(15,23,42,.28);border-radius:999px;padding:8px 12px;display:flex;align-items:center;gap:10px;font-size:13px}
      .tutorial-mini strong{color:#fde68a}.tutorial-mini span{color:#e5e7eb}.tutorial-mini button{border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:#fff;border-radius:999px;padding:3px 8px;font-weight:800;cursor:pointer}
      .tut-pulse{animation:tutPulse 950ms ease-in-out infinite!important;position:relative;z-index:30}
      .tut-target{border-color:#f59e0b!important;box-shadow:0 0 0 4px rgba(245,158,11,.18),0 0 18px rgba(245,158,11,.32)!important}
      .tut-submit{box-shadow:0 0 0 4px rgba(245,158,11,.25),0 0 22px rgba(245,158,11,.36)!important}
      .tut-bubble{position:absolute;background:#111827;color:#fff;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;white-space:nowrap;z-index:45;box-shadow:0 6px 18px rgba(15,23,42,.24);pointer-events:none}
      .tut-lm{top:-18px;left:50%;transform:translateX(-50%)}
      .tut-board{top:-22px;left:50%;transform:translateX(-50%)}
      .tut-arrow-cell::after,.tut-cell::after{content:"";position:absolute;left:50%;top:-9px;transform:translateX(-50%);border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #111827;z-index:44}
      @keyframes tutPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}



      @keyframes acap{0%{transform:scale(.93);background:var(--opp-color);box-shadow:0 0 0 0 rgba(250,204,21,0)}35%{transform:scale(1.19);background:#fbbf24;box-shadow:0 0 0 8px rgba(251,191,36,.28)}65%{transform:scale(1.05);background:#fde68a}100%{transform:scale(1);background:var(--my-color);box-shadow:0 0 0 0 rgba(250,204,21,0)}}38%{transform:scale(1.17);background:#fde68a;filter:saturate(2.15);box-shadow:0 0 0 7px rgba(250,204,21,.28),0 0 22px rgba(250,204,21,.50)}100%{transform:scale(1);background:var(--my-color);filter:saturate(1.10);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 8px rgba(31,41,51,.10)}}
      @keyframes alk{0%{box-shadow:0 0 0 8px #111827 inset,0 0 0 0 rgba(17,24,39,.60);transform:scale(1.08)}50%{box-shadow:0 0 0 3px #111827 inset,0 0 0 12px rgba(17,24,39,.16);transform:scale(.98)}100%{transform:scale(1)}}
      @keyframes bridgeGlow{0%{box-shadow:0 0 0 0 rgba(245,158,11,.0);filter:brightness(1)}35%{box-shadow:0 0 0 4px rgba(245,158,11,.34),0 0 18px rgba(245,158,11,.42);filter:brightness(1.16)}100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 2px 7px rgba(31,41,51,.08);filter:brightness(1)}}
      @keyframes lockNeighborPulse{0%{box-shadow:0 0 0 0 rgba(17,24,39,.0)}45%{box-shadow:0 0 0 5px rgba(17,24,39,.12)}100%{box-shadow:0 0 0 0 rgba(17,24,39,.0)}}
      @keyframes drawBridge{0%{stroke-dashoffset:8;opacity:.15}30%{opacity:.96}72%{opacity:.82}100%{stroke-dashoffset:0;opacity:0}}
      @keyframes boardBanner{0%{opacity:0;transform:translate(-50%,-42%) scale(.95)}16%{opacity:1;transform:translate(-50%,-50%) scale(1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-58%) scale(.98)}}

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
      .lm-stats{display:flex;gap:3px;align-items:center;flex-wrap:wrap;justify-content:center}
      .lm-gain{background:#dcfce7;color:#166534;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:700}
      .lm-count{background:#e0f2fe;color:#075985;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:600}
      .lm-role{background:#fef9c3;color:#713f12;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700}
      .lm-zero{color:#aaa;font-size:11px}
      .lm-free{background:#fffbeb;border-color:#fbbf24}
      .lm-free:hover:not(:disabled){background:#fef3c7!important;border-color:#d97706!important}
      .lm-endgame{font-size:11px;color:var(--color-text-tertiary);padding:4px 0 6px;font-style:italic;width:100%}
      .lm-freeLabel{background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:800}
      .lm-used{opacity:.4;cursor:default!important}
      .lm-free-row{display:flex;gap:8px;margin-top:8px;align-items:center}
      .lm-free-input{border:2px solid #fbbf24;border-radius:8px;padding:6px 10px;font-size:18px;
                     font-weight:900;width:80px;text-align:center;text-transform:uppercase;outline:none}
      .lm-free-confirm{background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:6px 14px;
                       font-weight:800;cursor:pointer;font-size:13px}
      .lm-free-confirm:hover{background:#d97706}

      /* Territory Preview overlay */
      .vp-overlay{position:absolute;bottom:5px;right:5px;transform:none;
                  font-size:10px;font-weight:900;border-radius:5px;padding:1px 5px;
                  pointer-events:none;white-space:nowrap;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.16)}
      .vp-basic,.vp-safe{background:rgba(74,222,128,.85);color:#14532d}
      .vp-good,.vp-frontline{background:rgba(250,204,21,.9);color:#713f12}
      .vp-path{background:rgba(59,130,246,.88);color:#fff}
      .vp-strong{background:rgba(139,92,246,.92);color:#fff}
      .vp-star{margin-left:2px;font-size:9px}

      /* Synergy flash */
      .synergy-flash{background:linear-gradient(90deg,#1e1b4b,#312e81);color:#c7d2fe;
                     font-size:13px;font-weight:700;padding:7px 14px;border-radius:8px;
                     text-align:center;margin-bottom:4px;letter-spacing:.3pxfont-family:'Space Grotesk',sans-serif;font-weight:700;}
      .syn-difficulty{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;
                      border-radius:20px;margin-bottom:6px;letter-spacing:.5px}
      [data-diff="Easy"]{background:#dcfce7;color:#166534}
      [data-diff="Medium"]{background:#fef9c3;color:#854d0e}
      [data-diff="Hard"]{background:#fee2e2;color:#991b1b}
      .syn-tip{font-size:11px;color:#6b7280;font-style:italic;margin-top:4px;line-height:1.4}
      .synergy-chip{background:linear-gradient(90deg,#312e81,#4338ca)!important;color:#c7d2fe!important;
                    cursor:help}

      /* Winner banner */
      .winner-banner{background:#111;color:#fff;text-align:center;padding:14px;font-size:22px;
                     font-weight:900;border-radius:12px;margin-bottom:8px;letter-spacing:1px}
      .battle-title{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:4px}
      .winner-score{font-size:16px;font-weight:400;color:#aaa;margin-left:8pxfont-family:'Space Grotesk',sans-serif;}
      .best-move-inline{font-size:13px;color:#f8fafc;margin-top:4px;letter-spacing:.2px}
      .best-move-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin:12px 0;font-size:13px;color:#111}
      .battle-report-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:10px;box-shadow:0 6px 24px rgba(15,23,42,.06)}
      .report-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
      .report-kicker{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1.7px;color:#64748b;font-weight:900;margin-bottom:3px}
      .report-score{display:flex;gap:6px;font-weight:900;white-space:nowrap}
      .report-score span{background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;font-size:12px}
      .report-best{background:linear-gradient(90deg,#111827,#312e81);color:#fff;border-radius:12px;padding:10px 12px;margin:8px 0}
      .report-best span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:#c7d2fe;font-weight:900;margin-bottom:3px}
      .report-best strong{font-size:13px;line-height:1.45}
      .report-stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .report-stats span{background:#f1f5f9;color:#334155;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:800}
      .emoji-board-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin:12px 0;text-align:left}
      .emoji-board-card pre{font-size:18px;line-height:1.25;white-space:pre;margin:8px 0;font-family:monospace}
      .async-banner{display:flex;gap:8px;align-items:center;justify-content:center}.link-copy{border:1px solid rgba(255,255,255,.4);background:#fff;color:#111;border-radius:8px;padding:4px 10px;font-weight:800;cursor:pointer}

      /* Synergy Card Modal */
      .syn-modal{max-width:520px;text-align:center}
      .syn-cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px}
      .syn-card{background:#f8f9fa;border:2px solid #e0e0e0;border-radius:14px;padding:14px 10px;
                cursor:pointer;transition:all .15s;text-align:center;font-family:inherit}
      .syn-card:hover{background:#eef2ff;border-color:#6366f1;transform:translateY(-2px);
                      box-shadow:0 4px 16px rgba(99,102,241,.15)}
      .syn-icon{font-size:28px;margin-bottom:6px}
      .syn-name{font-size:14px;font-weight:800;color:#111;margin-bottom:6px}
      .syn-effect{font-size:12px;color:#444;line-height:1.4;margin-bottom:8px}
      .syn-flavor{font-size:11px;color:#999;font-style:italic}
      .syn-skip{background:none;border:none;color:#aaa;font-size:12px;cursor:pointer;
                text-decoration:underline;padding:4px}
      /* Active synergy display */
      .syn-active{background:#f0f4ff;border:1.5px solid #c7d2fe;border-radius:10px;
                  padding:8px 12px;margin-bottom:8px;font-size:12px;color:#3730a3}
      .syn-active-effect{display:block;font-size:11px;color:#6366f1;margin-top:3px;font-style:italic}

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
      @keyframes aclaim{0%{transform:scale(1.12)}100%{transform:scale(1)}
      @keyframes aflood{0%{opacity:0;transform:scale(.96)}25%{opacity:.22}75%{opacity:.20}100%{opacity:0;transform:scale(1.03)}}
      .end-flood{position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:20;animation:aflood 2.6s ease forwards}
      .flood-red{background:#d85c5c}.flood-blue{background:#2563eb}.flood-draw{background:#64748b}
      @keyframes abridge{0%{box-shadow:inset 0 0 0 0 rgba(245,158,11,0)}40%{box-shadow:inset 0 0 0 7px rgba(245,158,11,.45)}100%{box-shadow:inset 0 0 0 0 rgba(245,158,11,0)}}
      .board-bridge{animation:abridge 950ms ease forwards}}
      @keyframes boardpulse{0%{transform:scale(1);filter:saturate(1)}35%{transform:scale(1.018);filter:saturate(1.28)}100%{transform:scale(1);filter:saturate(1)}}
      @keyframes acap{0%{transform:scale(.95);background:var(--opp-color);filter:saturate(1);box-shadow:0 0 0 0 rgba(250,204,21,0)}45%{transform:scale(1.16);background:#fde68a;filter:saturate(2.2);box-shadow:0 0 0 6px rgba(250,204,21,.32),0 0 18px rgba(250,204,21,.52)}100%{transform:scale(1);background:var(--my-color);filter:saturate(1.15)}}35%{transform:scale(1.18);background:#fde68a;filter:saturate(1.9);box-shadow:0 0 0 6px rgba(250,204,21,.28)}70%{transform:scale(.96);box-shadow:0 0 0 2px rgba(250,204,21,.14)}100%{transform:scale(1)}}
      @keyframes alk{0%{box-shadow:0 0 0 8px #111 inset,0 0 0 0 rgba(17,17,17,.7);transform:scale(1.08)}45%{box-shadow:0 0 0 3px #111 inset,0 0 0 8px rgba(17,17,17,.12);transform:scale(.98)}100%{transform:scale(1)}}

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
        .cell-slot,.cell{width:44px;height:44px;font-size:15px;border-radius:7px}
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
        .intro-card{padding:20px 16px}.intro-card h2{font-size:22px}.intro-steps{flex-direction:column}.intro-btns{flex-direction:column}
        .what-lines{flex-direction:column}

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
    
      /* ── Final spacing / sizing / market polish ─────────────────────────── */
      @media(min-width:901px){
        .page{padding:26px 20px 18px;max-width:1280px}
        .hdr{align-items:flex-start;margin-bottom:14px;padding-top:2px}
        .hdr-l h1{margin:0 0 3px;line-height:1.04;font-size:25px;letter-spacing:2.4px}
        .hdr-l .sub{line-height:1.25}
        .tagline{margin-top:5px}
        .layout{
          grid-template-columns:minmax(0,1040px) minmax(260px,300px);
          justify-content:center;
          gap:16px;
        }
        .bcol{max-width:1040px;width:100%}
        .bwrap{
          width:max-content;
          max-width:800px;
          margin:0 auto 12px;
          padding:14px 16px;
          border-radius:18px;
        }
        .board{
          --cell:56px;
          --gap:7px;
          grid-template-columns:repeat(7,var(--cell));
          gap:var(--gap);
          padding:12px;
        }
        .cell-slot,.cell{width:var(--cell);height:var(--cell)}
        .lm-panel,.mpanel{max-width:1040px;margin-left:auto;margin-right:auto}
      }

      .lm-panel{
        background:linear-gradient(180deg,#fffdf8,#f8f5ee);
        border:1px solid #ddd6c8;
        border-radius:16px;
        padding:12px 14px;
        box-shadow:0 4px 18px rgba(31,41,51,.045);
      }
      .lm-header{margin-bottom:10px}
      .lm-title{color:#1f2933;font-weight:900}
      .lm-active{gap:10px}
      .lm-tile{
        min-width:76px;
        min-height:58px;
        border:1px solid #ded7ca;
        border-radius:13px;
        padding:10px 12px;
        background:linear-gradient(180deg,#fffdf8,#f5f0e6);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.68),0 2px 7px rgba(31,41,51,.10);
      }
      .lm-tile:hover:not(:disabled){
        background:linear-gradient(180deg,#fff,#eef4ff);
        border-color:#4f83cc;
        transform:translateY(-2px);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 5px 14px rgba(79,131,204,.16);
      }
      .lm-selected{
        background:linear-gradient(180deg,#fff,#e9f1ff)!important;
        border-color:#4f83cc!important;
        box-shadow:0 0 0 3px rgba(79,131,204,.18),0 6px 16px rgba(79,131,204,.16)!important;
        transform:translateY(-2px);
      }
      .lm-letter{font-size:24px;color:#172033}
      .lm-gain{background:#e7f8eb;color:#166534}
      .lm-count{background:#e9f3ff;color:#173e74}
      .lm-role{background:#fff3cf;color:#7c4a03}
      .lm-free{background:linear-gradient(180deg,#fffaf0,#fff1c6);border-color:#eab308}
      .lm-free:hover:not(:disabled){background:linear-gradient(180deg,#fff7d6,#fde68a)!important;border-color:#d97706!important}
      .seed-label{display:block;font-weight:900;line-height:1}
      .seed-cost{display:block;margin-top:3px;font-size:10px;color:#b45309;font-weight:800}

      @media(max-width:900px){
        .page{padding:18px 10px 12px}
        .hdr{padding-top:4px}
        .hdr-l h1{margin:0 0 3px;line-height:1.05}
        .bwrap{width:max-content;max-width:100%;margin:0 auto 10px;padding:10px;border-radius:16px}
        .board{--cell:min(10.6vw,52px);--gap:5px;grid-template-columns:repeat(7,var(--cell))!important;gap:var(--gap);padding:9px}
        .cell-slot,.cell{width:var(--cell)!important;height:var(--cell)!important}
        .lm-panel,.mpanel{max-width:100%;margin-left:auto;margin-right:auto}
        .lm-tile{min-width:68px;min-height:54px}
      }

      @media(max-width:600px){
        .page{padding:12px 6px 8px}
        .hdr{padding:8px 6px 6px}
        .hdr-l h1{font-size:18px;line-height:1.05;margin:0 0 2px}
        .tagline{font-size:11px}
        .board-wrap{padding:0}
        .board{
          --cell:calc((100vw - 48px) / 7);
          --gap:4px;
          grid-template-columns:repeat(7,var(--cell))!important;
          width:max-content;
          max-width:100%;
          gap:var(--gap);
          padding:7px;
        }
        .cell-slot,.cell{
          width:var(--cell)!important;
          height:var(--cell)!important;
          font-size:clamp(12px,3.3vw,16px);
          border-radius:8px;
        }
        .lm-panel{padding:10px 10px;border-radius:14px}
        .lm-active{gap:7px}
        .lm-tile{min-width:58px;min-height:52px;padding:8px 9px}
        .lm-letter{font-size:21px}
        .lm-preview{font-size:11px}
      }

      @media(max-width:360px){
        .board{--cell:calc((100vw - 36px) / 7);--gap:3px}
        .lm-tile{min-width:52px}
      }

    `}</style>
  </>;
}
