// Reads/writes your Training Plan checkbox state to Netlify Blobs (built-in KV).
// Cookie-verified with the same secret the gate uses, so only you can touch it.
//
// POST merges into the stored state instead of overwriting it: a device that
// saves while holding stale state (e.g. before its first GET resolves) must
// never erase drill history (mm), the miss log, or PB records logged elsewhere.
// Scalars (step checkboxes, snoozes) take the incoming value: the latest user
// action wins. Deliberate log deletions ride along as tombstone keys in `dl`.
// Quirk accepted: deleting a PB on one device can resurrect from another.
// The first POST of each day also snapshots the previous state to
// "backup-YYYY-MM-DD" (restore: netlify blobs:get training-plan backup-...).

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

export function mergeState(base, over) {
  const out = Object.assign({}, base, over);
  const dl = {};
  [].concat(base.dl || [], over.dl || []).forEach((x) => { if (typeof x === "string") dl[x] = 1; });
  const seen = {}, mm = [];
  [].concat(base.mm || [], over.mm || []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    const k = e.d + "|" + e.v;
    if (!seen[k]) { seen[k] = 1; mm.push(e); }
  });
  out.mm = mm.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const byK = {}, order = [];
  [].concat(base.log || [], over.log || []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    const k = e.dd + "|" + e.src + "|" + e.fix;
    if (dl[k]) return;
    if (!byK[k]) { byK[k] = e; order.push(k); }
    else byK[k] = Object.assign({}, byK[k], {
      r48: (byK[k].r48 || e.r48) ? 1 : 0,
      rfri: (byK[k].rfri || e.rfri) ? 1 : 0,
    });
  });
  out.log = order.map((k) => byK[k]).sort((a, b) => (a.dd < b.dd ? -1 : a.dd > b.dd ? 1 : 0));
  out.pb = Object.assign({}, base.pb || {}, over.pb || {});
  out.sn = Object.assign({}, base.sn || {}, over.sn || {});
  const bc = base.ct, oc = over.ct;
  if (bc && oc) out.ct = bc.d === oc.d ? { d: bc.d, n: Math.max(bc.n || 0, oc.n || 0) } : (oc.d > bc.d ? oc : bc);
  out.dl = Object.keys(dl).slice(-50);
  return out;
}

export default async (req) => {
  if (!(await authed(req))) return new Response("unauthorized", { status: 401 });
  const store = getStore("training-plan");

  if (req.method === "GET") {
    const data = await store.get("progress", { type: "json" });
    return Response.json(data || {});
  }
  if (req.method === "POST") {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return new Response("bad request", { status: 400 });
    const prev = (await store.get("progress", { type: "json" })) || {};
    const bkey = "backup-" + new Date().toISOString().slice(0, 10);
    if (!(await store.get(bkey))) await store.setJSON(bkey, prev);
    await store.setJSON("progress", mergeState(prev, body));
    return Response.json({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};
