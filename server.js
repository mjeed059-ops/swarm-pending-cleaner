import express from "express";
import session from "express-session";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me-local-only",
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, "public")));

const API = "https://api.foursquare.com/v2";
const OAUTH = "https://foursquare.com/oauth2";
const VERSION = "20231010";

function requireToken(req, res, next) {
  if (!req.session.oauthToken) return res.status(401).json({error: "Not signed in"});
  next();
}

async function fsq(pathname, token, init = {}) {
  const sep = pathname.includes("?") ? "&" : "?";
  const url = `${API}${pathname}${sep}oauth_token=${encodeURIComponent(token)}&v=${VERSION}&m=foursquare`;
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.meta?.code >= 400) {
    const msg = body?.meta?.errorDetail || body?.meta?.errorType || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body;
}

app.get("/auth/login", (req, res) => {
  const cid = process.env.FOURSQUARE_CLIENT_ID;
  const redirect = process.env.REDIRECT_URI;
  if (!cid || !redirect) return res.status(500).send("Missing FOURSQUARE_CLIENT_ID or REDIRECT_URI");
  const url = `${OAUTH}/authenticate?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}`;
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const params = new URLSearchParams({
      client_id: process.env.FOURSQUARE_CLIENT_ID,
      client_secret: process.env.FOURSQUARE_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: process.env.REDIRECT_URI,
      code
    });
    const r = await fetch(`${OAUTH}/access_token?${params}`);
    const body = await r.json();
    if (!body.access_token) throw new Error(body.error || "OAuth token exchange failed");
    req.session.oauthToken = body.access_token;
    res.redirect("/");
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/auth/token", (req, res) => {
  // Local testing mode: lets the owner paste an OAuth token without storing a password.
  const { token } = req.body || {};
  if (!token) return res.status(400).json({error: "Token required"});
  req.session.oauthToken = token.trim();
  res.json({ok: true});
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ok: true}));
});

app.get("/api/me", requireToken, async (req, res) => {
  try {
    const data = await fsq("/users/self", req.session.oauthToken);
    res.json(data.response.user);
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

/*
  Discovery strategy:
  1) Read authenticated user's friend-like collections if the legacy account exposes them.
  2) Keep ONLY objects where relationship === "pendingThem".
  3) De-duplicate by user id.

  Foursquare's documented /users/requests endpoint is incoming requests
  ("pendingMe"), so we deliberately do NOT treat it as sent requests.
*/
app.get("/api/pending-sent", requireToken, async (req, res) => {
  const token = req.session.oauthToken;
  const candidates = [];
  const attempts = [];

  async function tryEndpoint(name, endpoint, extractor) {
    try {
      const data = await fsq(endpoint, token);
      const items = extractor(data) || [];
      attempts.push({name, ok: true, count: items.length});
      candidates.push(...items);
    } catch (e) {
      attempts.push({name, ok: false, error: e.message});
    }
  }

  // These collections have varied across legacy API eras/accounts.
  await tryEndpoint("self", "/users/self", d => {
    const u = d?.response?.user || {};
    const groups = u?.friends?.groups || [];
    return groups.flatMap(g => g.items || []);
  });

  await tryEndpoint("friends", "/users/self/friends?limit=500", d =>
    d?.response?.friends?.items || []
  );

  await tryEndpoint("following", "/users/self/following?limit=500", d =>
    d?.response?.following?.items ||
    d?.response?.followers?.items ||
    d?.response?.friends?.items || []
  );

  const byId = new Map();
  for (const u of candidates) {
    if (u && String(u.relationship).toLowerCase() === "pendingthem") {
      byId.set(String(u.id), u);
    }
  }

  const items = [...byId.values()].map(u => ({
    id: String(u.id),
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    homeCity: u.homeCity || "",
    relationship: u.relationship,
    canonicalUrl: u.canonicalUrl || "",
    photo: u.photo?.prefix && u.photo?.suffix
      ? `${u.photo.prefix}100x100${u.photo.suffix}`
      : (typeof u.photo === "string" ? u.photo : "")
  }));

  res.json({
    items,
    count: items.length,
    attempts,
    warning: items.length === 0
      ? "No outgoing pending requests were exposed by the legacy collections available to this account. This does not prove there are none."
      : null
  });
});

app.post("/api/cancel/:id", requireToken, async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.id);
    const data = await fsq(`/users/${id}/unfriend`, req.session.oauthToken, {method: "POST"});
    res.json({ok: true, response: data.response || {}});
  } catch (e) {
    res.status(400).json({error: e.message});
  }
});

app.post("/api/cancel-bulk", requireToken, async (req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(String))].slice(0, 750);
  const results = [];
  // Sequential by design: avoids hammering the legacy API.
  for (const raw of ids) {
    try {
      const id = encodeURIComponent(raw);
      await fsq(`/users/${id}/unfriend`, req.session.oauthToken, {method: "POST"});
      results.push({id: raw, ok: true});
    } catch (e) {
      results.push({id: raw, ok: false, error: e.message});
    }
  }
  res.json({
    total: ids.length,
    cancelled: results.filter(x => x.ok).length,
    failed: results.filter(x => !x.ok).length,
    results
  });
});

app.listen(PORT, () => console.log(`Swarm Pending Cleaner: http://localhost:${PORT}`));