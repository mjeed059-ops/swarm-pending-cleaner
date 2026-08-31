# Swarm Pending Cleaner

A small local web app for finding outgoing Swarm/Foursquare friend requests that appear with the legacy relationship value `pendingThem`, then cancelling them individually or in bulk.

## Important limitation

Foursquare's legacy v2 API documents:

- `pendingThem` = the authenticated user sent the friend request and it is still waiting.
- `POST /users/{USER_ID}/unfriend` = removes the relationship and also cancels a pending friend request.
- `GET /users/requests` represents incoming requests (`pendingMe`), not outgoing ones.

There is no currently documented single endpoint that guarantees a complete list of all outgoing pending requests. This app therefore probes the legacy relationship collections available to your account and filters any returned users whose relationship is `pendingThem`.

**If it shows zero, that does not prove you have zero pending sent requests.** It may mean your Foursquare developer access does not expose a collection containing them.

## Security

- Never enter your Swarm password into this app.
- OAuth client secret stays server-side.
- The OAuth token is kept in the local session only.
- Run it locally unless you know how to secure and deploy an Express app.

## Setup

1. Make sure your Foursquare developer project has access to the legacy v2 API.
2. Copy `.env.example` values into your shell environment.
3. Install dependencies:
   `npm install`
4. Start:
   `npm start`
5. Open:
   `http://localhost:3000`
6. Tap **Connect Swarm**.

For local testing, the UI also accepts an existing Foursquare OAuth token. Do not paste a password.

## What "Cancel" does

For each selected user ID the server calls:

`POST https://api.foursquare.com/v2/users/{USER_ID}/unfriend`

The legacy API describes this operation as removing the relationship, including cancelling a pending friend request.