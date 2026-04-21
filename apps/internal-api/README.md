```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run internal-api#dev
```

```bash
curl http://localhost:4001/healthz
curl http://localhost:4001/api/auth/get-session
curl -i http://localhost:4001/api/internal/tenants
```
