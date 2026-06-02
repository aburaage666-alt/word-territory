const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function readJson(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || data?.error || "Request failed");
  return data;
}

// Fetch with 12-second timeout — prevents hanging on slow Render cold starts
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch(e) {
    if (e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function createGame(options = {}) {
  const res = await fetchWithTimeout(`${API_BASE}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botLevel: options.botLevel || "normal" }),
  });
  return readJson(res);
}

export async function submitMove(payload) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${payload.game_id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export async function seedMove(gameId, payload) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/seed-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export async function previewMove(gameId, payload) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/preview-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export async function passTurn(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/pass`, { method: "POST" });
  return readJson(res);
}

export async function getSuggestions(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/suggestions`);
  const data = await readJson(res);
  return data.suggestions || [];
}

export async function botMove(gameId) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/bot-move`, { method: "POST" });
  return readJson(res);
}

export async function autoMove(gameId, demo = false) {
  const url = `${API_BASE}/games/${gameId}/auto-move${demo ? "?demo=true" : ""}`;
  const res = await fetchWithTimeout(url, { method: "POST" });
  return readJson(res);
}

export async function getSynergyOptions(gameId) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/synergy-options`, {}, 5000);
    return readJson(res);
  } catch { return { options: [], selected: "" }; }
}

export async function selectSynergy(gameId, card) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/select-synergy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card }),
  });
  return readJson(res);
}

export async function getMarket(gameId) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/market`, {}, 5000);
    return readJson(res);
  } catch { return { active: [], preview: [], stats: [], freeLetterUsed: false }; }
}

export async function useFreeLetter(gameId, letter) {
  const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/free-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ letter }),
  });
  return readJson(res);
}

export async function getLetterPreview(gameId, letter) {
  if (!gameId || !letter) return { letter: letter || "", moves: [] };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/letter-preview/${encodeURIComponent(letter)}`, {}, 5000);
    return readJson(res);
  } catch {
    return { letter, moves: [] };
  }
}

export async function getThreat(gameId) {
  if (!gameId) return [];
  try {
    const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/threat`, {}, 5000);
    const data = await readJson(res);
    return data.threats || [];
  } catch { return []; }
}

export async function createAsyncMatch(options = {}) {
  const res = await fetchWithTimeout(`${API_BASE}/async/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botLevel: options.botLevel || "normal" }),
  });
  return readJson(res);
}

export async function getAsyncMatch(gameId, token) {
  const res = await fetchWithTimeout(`${API_BASE}/async/games/${gameId}?token=${encodeURIComponent(token)}`);
  return readJson(res);
}

export async function submitAsyncMove(gameId, token, payload) {
  const res = await fetchWithTimeout(`${API_BASE}/async/games/${gameId}/move?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export async function seedAsyncMove(gameId, token, payload) {
  const res = await fetchWithTimeout(`${API_BASE}/async/games/${gameId}/seed-move?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export async function passAsyncTurn(gameId, token) {
  const res = await fetchWithTimeout(`${API_BASE}/async/games/${gameId}/pass?token=${encodeURIComponent(token)}`, { method: "POST" });
  return readJson(res);
}

export async function getAlmost(gameId) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/games/${gameId}/almost`, {}, 5000);
    const data = await readJson(res);
    return data.almost || [];
  } catch { return []; }
}

export async function getDailyInfo() {
  const res = await fetchWithTimeout(`${API_BASE}/daily/today`);
  return readJson(res);
}

export async function createDailyGame() {
  const res = await fetchWithTimeout(`${API_BASE}/daily/games`, { method: "POST" });
  return readJson(res);
}

export async function submitDailyScore(body) {
  const res = await fetchWithTimeout(`${API_BASE}/daily/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

export async function getDailyLeaderboard() {
  const res = await fetchWithTimeout(`${API_BASE}/daily/leaderboard`);
  return readJson(res);
}

export async function joinWaitlist(email) {
  const res = await fetchWithTimeout(`${API_BASE}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return readJson(res);
}

export async function getWaitlistCount() {
  const res = await fetchWithTimeout(`${API_BASE}/waitlist/count`);
  return readJson(res);
}
