// Gates every /private/* path behind a password.
// Serves a login page, checks SITE_PASSWORD, sets a signed HttpOnly cookie.
// Runs on Netlify's edge (Deno) — Web Crypto + Netlify.env are available here.

const DAY = 86400000;
const MAX_AGE_DAYS = 90;

async function hmac(msg, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(sig)))
    .replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}

async function makeToken(secret) {
  const exp = String(Date.now() + MAX_AGE_DAYS * DAY);
  return exp + "." + (await hmac(exp, secret));
}

async function valid(token, secret) {
  if (!token) return false;
  const i = token.indexOf(".");
  if (i < 0) return false;
  const exp = token.slice(0, i), sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const expect = await hmac(exp, secret);
  if (sig.length !== expect.length) return false;
  let d = 0;
  for (let n = 0; n < sig.length; n++) d |= sig.charCodeAt(n) ^ expect.charCodeAt(n);
  return d === 0; // constant-time compare
}

function loginPage(msg) {
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0F1620;color:#C9D3E2;font:16px ui-monospace,Menlo,monospace}
form{display:flex;flex-direction:column;gap:12px;width:260px}
input{padding:10px;border:1px solid #3A4A66;border-radius:4px;background:#131C2A;color:#E9EDF3;font:inherit}
button{padding:10px;border:0;border-radius:4px;background:#B85C1E;color:#12100C;font:inherit;font-weight:600;cursor:pointer}
.m{color:#E89350;min-height:18px;font-size:13px}h1{font-size:18px;margin:0 0 4px}</style>
<form method="POST" action="/private/login"><h1>The Training Plan</h1>
<div class="m">${msg || ""}</div>
<input type="password" name="password" placeholder="password" autofocus autocomplete="current-password">
<button>Enter</button></form>`;
  return new Response(html, {
    status: msg ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default async (request, context) => {
  const secret = Netlify.env.get("COOKIE_SECRET");
  const password = Netlify.env.get("SITE_PASSWORD");
  const url = new URL(request.url);

  // Handle the login form POST.
  if (url.pathname === "/private/login" && request.method === "POST") {
    const form = await request.formData();
    if (secret && password && form.get("password") === password) {
      const token = await makeToken(secret);
      return new Response(null, {
        status: 303,
        headers: {
          "location": "/private/plan/",
          "set-cookie": `tp_sess=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_DAYS * 86400}`,
        },
      });
    }
    return loginPage("Wrong password.");
  }

  // Already authenticated? Let the request through to the static page.
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/tp_sess=([^;]+)/);
  if (m && secret && (await valid(m[1], secret))) return context.next();

  // Otherwise show the login page.
  return loginPage();
};

export const config = { path: "/private/*" };
