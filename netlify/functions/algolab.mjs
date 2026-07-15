// Cross-device save for Algorithm Lab (/private/algolab/), stored in Netlify
// Blobs and cookie-verified with the same secret the gate uses — so only the
// owner can read or write, exactly like the Training Plan's progress.mjs.
//
// POST MERGES into the stored save rather than overwriting it, so a device that
// saves while holding stale state can only move progress forward, never erase
// another device's history: best-scores take the max, lesson status advances
// only (new -> started -> passed), SM-2 concept state keeps the furthest-
// scheduled review, streak keeps the later day, placements the more recent,
// and the append-only activity ledger is unioned by stable event id.
// DELETE clears the save (used by the app's Reset button). The first write of
// each day snapshots the previous state to "backup-YYYY-MM-DD".

import { getStore } from "@netlify/blobs";

async function hmac(msg, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(sig)))
    .replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}

async function authed(req) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) return false;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/tp_sess=([^;]+)/);
  if (!m) return false;
  const token = m[1], i = token.indexOf(".");
  if (i < 0) return false;
  const exp = token.slice(0, i), sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const expect = await hmac(exp, secret);
  if (sig.length !== expect.length) return false;
  let d = 0;
  for (let n = 0; n < sig.length; n++) d |= sig.charCodeAt(n) ^ expect.charCodeAt(n);
  return d === 0;
}

const RANK = { new: 0, started: 1, passed: 2 };

function maxN(a, b) {
  if (a == null) return b == null ? null : b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function mergeLesson(x, y) {
  if (!x) return y;
  if (!y) return x;
  return {
    status: (RANK[x.status] ?? 0) >= (RANK[y.status] ?? 0) ? x.status : y.status,
    stageReached: Math.max(x.stageReached || 0, y.stageReached || 0),
    bestQuiz: maxN(x.bestQuiz, y.bestQuiz),
    bestDrill: maxN(x.bestDrill, y.bestDrill),
    bestAnalysis: maxN(x.bestAnalysis, y.bestAnalysis),
    fadedDone: !!(x.fadedDone || y.fadedDone),
    stars: Math.max(x.stars || 0, y.stars || 0),
    discovery: x.discovery || y.discovery || null,
  };
}

function mergeConcept(x, y) {
  if (!x) return y;
  if (!y) return x;
  if ((y.reps || 0) !== (x.reps || 0)) return y.reps > x.reps ? y : x;
  return (y.due || 0) >= (x.due || 0) ? y : x;
}

// Exported for a possible future unit test; behavior mirrors the client's
// src/store/sync.ts mergeSave exactly.
export function mergeSave(base, over) {
  base = base && typeof base === "object" ? base : {};
  over = over && typeof over === "object" ? over : {};

  const lessons = Object.assign({}, base.lessons);
  for (const [k, v] of Object.entries(over.lessons || {})) lessons[k] = mergeLesson(lessons[k], v);

  const concepts = Object.assign({}, base.concepts);
  for (const [k, v] of Object.entries(over.concepts || {})) concepts[k] = mergeConcept(concepts[k], v);

  const placements = Object.assign({}, base.placements);
  for (const [k, v] of Object.entries(over.placements || {})) {
    const p = placements[k];
    placements[k] = !p || (v.takenAt || 0) >= (p.takenAt || 0) ? v : p;
  }

  let streak = base.streak;
  const os = over.streak;
  if (os) {
    if (!streak || !streak.last) streak = os;
    else if (os.last > streak.last) streak = os;
    else if (os.last === streak.last) streak = { days: Math.max(streak.days || 0, os.days || 0), last: streak.last };
  }

  const historyById = new Map();
  for (const event of [...(base.history || []), ...(over.history || [])]) {
    if (event && typeof event.id === "string") historyById.set(event.id, event);
  }
  const history = [...historyById.values()]
    .sort((a, b) => (a.at || 0) - (b.at || 0) || a.id.localeCompare(b.id))
    .slice(-1000);

  return { version: 3, lessons, concepts, streak: streak || { days: 0, last: "" }, placements, history };
}

export default async (req) => {
  if (!(await authed(req))) return new Response("unauthorized", { status: 401 });
  const store = getStore("algolab");

  if (req.method === "GET") {
    const data = await store.get("save", { type: "json" });
    return Response.json(data || {});
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return new Response("bad request", { status: 400 });
    const prev = (await store.get("save", { type: "json" })) || {};
    const bkey = "backup-" + new Date().toISOString().slice(0, 10);
    if (!(await store.get(bkey))) await store.setJSON(bkey, prev);
    await store.setJSON("save", mergeSave(prev, body));
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const prev = (await store.get("save", { type: "json" })) || {};
    const bkey = "backup-" + new Date().toISOString().slice(0, 10);
    if (!(await store.get(bkey))) await store.setJSON(bkey, prev);
    await store.setJSON("save", {});
    return Response.json({ ok: true });
  }

  return new Response("method not allowed", { status: 405 });
};
