# AskPDF Enterprise

Permission-aware multi-tenant RAG: companies share one deployment, users upload PDFs and ask questions, and **retrieval is filtered by tenant and role inside Atlas Vector Search** before anything reaches the LLM.

This repo started as Layer 1 identity (`tenants`, `users`, JWT). The original standalone AskPDF app was not in this folder, so the parse → chunk → embed → index → search pipeline is implemented here on top of that auth layer.

## Security rules (enforced in code)

- Identity comes only from a verified JWT (`req.user`). Body/query `tenantId` / `role` are ignored.
- Fail closed: if an ACL filter cannot be built, the request is 401.
- ACL is applied **inside** `$vectorSearch.filter`, not after retrieval.
- The LLM only sees chunks that passed the filter. Document text is wrapped in `<document_context>` and treated as untrusted.
- Every `/ask` writes an append-only audit row **before** the stream is returned. A failed audit fails the request.
- Redis job/chat/embedding keys that users can observe are namespaced `t:{tenantId}:...`.
- Missing document and forbidden document both return `{ "error": "Document not found" }`.

## Stack

Node.js, Express, Mongoose (CommonJS), MongoDB Atlas Vector Search (one shared 768-dim index), Redis queue, Gemini embeddings + generation, HS256 JWT + bcryptjs.

`VECTOR_SEARCH=memory` is a **test/local** path that still applies the same ACL query in MongoDB, then cosine-scores. Production should use `VECTOR_SEARCH=atlas`.

## Setup

```bash
npm install
cp .env.example .env
# set MONGODB_URI, JWT_SECRET (>= 32 chars), REDIS_URL, GEMINI_API_KEY
npm run seed
npm run index:ensure   # Atlas only; needs listSearchIndexes permission
npm start              # API
npm run worker         # ingestion worker (second terminal)
npm test
```

## Manual checks (after seed)

Shared password: `ChangeMe123!`

```bash
# Login
TOKEN=$(curl -s -X POST localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenant":"acme","email":"employee@acme.test","password":"ChangeMe123!"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -s localhost:3000/me -H "Authorization: Bearer $TOKEN"

# Upload (202)
curl -s -X POST localhost:3000/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@./sample.pdf \
  -F title=handbook

# Job status (404 for another tenant)
curl -s localhost:3000/jobs/JOB_ID -H "Authorization: Bearer $TOKEN"

# Ask (SSE). Forged tenantId must not change results.
curl -N -X POST localhost:3000/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"what is the PTO policy?","tenantId":"forged"}'

# Admin audit (Acme admin only; Globex admin must not see Acme rows)
ADMIN=$(curl -s -X POST localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenant":"acme","email":"admin@acme.test","password":"ChangeMe123!"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
curl -s localhost:3000/audit -H "Authorization: Bearer $ADMIN"
```

Expected: valid login returns a token; wrong tenant/email/password all return the same 401; `/ask` streams tokens; Globex users never see Acme chunk text; employees do not see `hr`-restricted docs; missing/tampered tokens are 401 on `/me`, `/ask`, `/documents`.
