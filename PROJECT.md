# AskPDF Enterprise — project brief (implemented)

See `README.md` for run instructions. Layers:

1. Identity and tenancy — JWT, tenants `acme`/`globex`, `authenticate`, `requireRole`
2. Access model — document ACL, sanitized on upload, owner/admin PATCH
3. Tenant-aware ingestion — Redis jobs, chunk ACL copy, namespaced status keys, cleanup by documentId+tenantId, ACL restamp jobs
4. Permission-filtered retrieval — `src/services/aclFilter.js` + `$vectorSearch.filter`
5. Generation — delimited untrusted context, SSE stream
6. Audit — append-only, write-before-response, admin `GET /audit`
7. Leak surfaces — tenant-scoped cache/chat, generic 404s, delete cleanup
8. Verification — `tests/leakage.test.js`
