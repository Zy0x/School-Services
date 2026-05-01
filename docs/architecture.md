# Architecture

This monorepo uses a hybrid provider architecture.

The frontend talks to `src/services/api/*` only. Those services delegate to `src/services/client.js`, which selects either Supabase providers or backend providers based on `VITE_USE_SUPABASE`.

Switching data providers should be an environment change:

```env
VITE_USE_SUPABASE=false
```

The backend is scaffolded as a modular Express API with controller, service, repository, route, validation, middleware, and config layers.
