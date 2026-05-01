# E-Rapor Control Plane

Production-oriented monorepo for the E-Rapor control plane.

## Structure

```text
apps/
  frontend/
  backend/
packages/
  config/
  types/
  utils/
supabase/
  migrations/
  schema.sql
  seed.sql
infra/
  docker/
  ci-cd/
docs/
scripts/
```

## Provider Strategy

The frontend uses a provider abstraction in `apps/frontend/src/services/client.js`.

Use Supabase:

```env
VITE_USE_SUPABASE=true
```

Use custom backend:

```env
VITE_USE_SUPABASE=false
```

UI code should use `services/api/*` instead of importing a provider directly.

## Commands

```sh
npm install
npm run frontend:dev
npm run backend:dev
npm run build
```
