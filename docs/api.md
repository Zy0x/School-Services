# API Contract

All API responses must use the same shape:

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

Initial backend endpoints:

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/users/me`
- `PATCH /api/users/me`
