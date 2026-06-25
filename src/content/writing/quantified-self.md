---
title: "Building a quantified-self dashboard"
date: 2026-06-23
description: "Gluing Oura and Hevy into one local dashboard with Flask and a little React, and how to build your own."
draft: true
---

I wanted my own data (sleep, readiness, workouts) in one place instead of four
different apps. So I built a small local dashboard, "Me, Quantified." It's a file of
Python and one HTML page.
Here's how it works, and how to build your own.

## The shape of it

A tiny Flask server on localhost talks to a couple of APIs, normalizes everything by
date, and hands JSON to a single static page. No database, no build step, nothing
deployed.

```
Oura API ─┐
Hevy API ─┤→  Flask (:5001)  ──fetch()──>  dashboard.html (browser)
GitHub  ──┘     5-min cache · normalize by date · return JSON
```

## The data sources

- **Oura**: sleep, readiness, activity, resilience. You make a personal access token in
  the Oura developer portal; the `oura-ring` Python client covers most endpoints, with
  raw `requests` for the newer ones.
- **Hevy**: strength workouts. Exercises, sets, reps, volume, which I map to muscle
  groups and an auto-detected "split." Auth is a single `api-key` header.
- **GitHub** (optional side feature): a little kanban that reads a course repo's labs
  and turns each README into a task. Unauthenticated REST is plenty.

Keys live in a `.env` next to the server:

```
OURA_TOKEN=...
HEVY_API_KEY=...
```

## A few things worth stealing

- **Cache the upstream calls.** These APIs are slow and rate-limited; a 5-minute
  in-memory cache makes the UI feel instant and keeps you well under any limit.
- **Normalize everything to a `by_date` dict** keyed by ISO date, so the frontend just
  asks "what about this day?" and every source lines up.
- **The 5am rule.** Last night's sleep should count as *yesterday*, so anything logged
  before 5am rolls back a day. Small touch, big difference in how the numbers read.
- **Atomic writes for state.** The task board persists to a plain JSON file, written
  temp-file-then-`os.replace`, so a crash mid-write can't corrupt it; a versioned
  migration bumps the schema when it changes.

## Running it

```
python3 -m venv .venv && .venv/bin/pip install flask requests python-dotenv oura-ring
python server.py          # serves http://localhost:5001
```

It's a long-running local process, not a cron job: the page fetches live, the server
caches, and a background thread or two poll GitHub and any deadlines. Keep it bound to
`127.0.0.1`. It's your data, and it never has to leave your machine.
