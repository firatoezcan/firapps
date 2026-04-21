```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/firapps vp run public-api#dev
```

```bash
curl http://localhost:4000/healthz
curl http://localhost:4000/api/public/products
```
