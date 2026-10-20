# Layer 1: Identity and tenancy

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in MONGODB_URI and JWT_SECRET
3. `npm run seed`
4. `npm start`

## Try it
```bash
# Log in as the Acme HR manager
curl -s -X POST localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenant":"acme","email":"hr.manager@acme.test","password":"ChangeMe123!"}'

# Use the token
curl -s localhost:3000/me -H "Authorization: Bearer <token>"

# Role guard: 200 for admin, 403 for others
curl -s localhost:3000/admin-only -H "Authorization: Bearer <token>"
```

## Done when
- Valid login returns a token; /me echoes tenantId, role, groups
- Wrong password, wrong email, and wrong tenant all return the same 401
- Missing, tampered, or expired token returns 401 on /me
- Employee token gets 403 on /admin-only; admin token gets 200
