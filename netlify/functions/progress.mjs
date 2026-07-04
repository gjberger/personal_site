// Reads/writes your Training Plan checkbox state to Netlify Blobs (built-in KV).
// Cookie-verified with the same secret the gate uses, so only you can touch it.

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

export default async (req) => {
  if (!(await authed(req))) return new Response("unauthorized", { status: 401 });
  const store = getStore("training-plan");

  if (req.method === "GET") {
    const data = await store.get("progress", { type: "json" });
    return Response.json(data || {});
  }
  if (req.method === "POST") {
    const body = await req.json();
    await store.setJSON("progress", body);
    return Response.json({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};
