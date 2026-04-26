# E-Rapor Local Agent and Dashboard

## Existing batch script analysis

`Automation E-Rapor.bat` is a single-purpose tunnel launcher for one local service:

1. It prompts for a hardcoded access key.
2. It kills any running `cloudflared.exe`.
3. It starts `cloudflared tunnel --url http://localhost:8535`.
4. It scrapes the first `https://*.trycloudflare.com` URL from the log output.
5. It rewrites `app.baseURL` inside `C:\newappraporsd2025\wwwroot\.env`.
6. It waits until the operator presses `X`, then kills the tunnel.

That script does not model devices, multiple services, central commands, URL change detection, or durable status sync. The new implementation in this workspace replaces that with a modular Node agent plus a Supabase-backed dashboard.

## Workspace layout

- [agent](/E:/Data/GitHub/E-Rapor/agent)
- [dashboard](/E:/Data/GitHub/E-Rapor/dashboard)
- [supabase/setup.sql](/E:/Data/GitHub/E-Rapor/supabase/setup.sql)
- [agent.runtime.json](/E:/Data/GitHub/E-Rapor/agent.runtime.json)

## Setup

1. Edit [agent.runtime.json](/E:/Data/GitHub/E-Rapor/agent.runtime.json).
2. Edit [.env](/E:/Data/GitHub/E-Rapor/.env).
3. Put the real Supabase anon key into `.env`.
4. Set `ERAPOR_ROOT` and `DAPODIK_ROOT` in `.env`.
5. Adjust service `startCommand`, `stopCommand`, and any per-service config settings for the local machine.
6. If a service is managed by Windows Service Control Manager, prefer `startStrategy: "windows-service"` and `stopStrategy: "windows-service"` with a `windowsServices` array instead of killing image names or ports.
7. For machines that should automatically publish Dapodik and E-Rapor when the agent starts, keep `autoStart: true`. The agent also auto-attaches tunnels to services that are already running locally at startup.
8. Install dependencies:

```powershell
npm install
```

5. Apply the SQL in [supabase/setup.sql](/E:/Data/GitHub/E-Rapor/supabase/setup.sql).

## Run locally

Agent:

```powershell
npm run agent:dev
```

Dashboard:

```powershell
npm run dashboard:dev
```

## Build the Windows agent

```powershell
npm run agent:build
```

The executable is written to `agent\dist\e-rapor-agent.exe`.

Keep `cloudflared.exe` next to the built executable, or set `cloudflaredPath` in `agent.runtime.json` to an absolute path.

The agent now writes a persistent local log file. By default it uses `agent\logs\agent-YYYY-MM-DD.log`, or `localLogPath` if that is set in `agent.runtime.json`.

For background execution on Windows without leaving a console window open, use:

- `agent\dist\run-agent-hidden.vbs`
- or `agent\dist\run-agent-hidden.ps1`

If the agent needs to start or stop Windows services such as `DapodikWebSrv`, launch it from an elevated terminal or use an elevated launcher so `sc.exe start` and `sc.exe stop` are allowed.

## Quick tunnel behavior

The agent uses Cloudflare Quick Tunnel only.

- It starts `cloudflared tunnel --url ...`.
- It discovers the public `trycloudflare.com` URL from the local tunnel log.
- If Cloudflare rate-limits the machine, the agent moves the service to `waiting_retry`, applies exponential backoff, and keeps running without crashing.
- Tunnel startup is queued so services do not create tunnels at the exact same moment.

## Supabase connection

Both the agent and the dashboard read Supabase credentials from the root `.env` file:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`supabase` is already installed as a root `devDependency`, and the runtime client code continues to use `@supabase/supabase-js`.

`agent.runtime.json` also supports environment placeholders in string values, for example:

- `${ERAPOR_ROOT}\\wwwroot\\.env`
- `${DAPODIK_ROOT}\\start-dapodik.bat`
- `%ERAPOR_ROOT%\\wwwroot\\.env`

## Per-service config behavior

- `rapor` defaults to `needsConfigUpdate: true`, so the agent will rewrite its configured public URL target when the Cloudflare URL changes.
- `dapodik` defaults to `needsConfigUpdate: false`, so the agent will still start the service, expose it, and sync the public URL to Supabase, but it will skip local config edits.
- A future service can enable config updates by setting:
  - `needsConfigUpdate`
  - `type`
  - `path`
  - `key`
  - optional `formatter`

The agent also continues to accept `configTargets` arrays for services that need more than one file update.

To avoid stopping unrelated services on the same machine:

- use `stopStrategy: "windows-service"` for software that is installed as Windows services, such as Dapodik
- use `stopStrategy: "port"` for standalone apps when the service port maps cleanly to the correct process
- avoid broad `taskkill /IM ...` rules unless there is only one safe target process on the machine

## Netlify dashboard deployment

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. Build with:

```powershell
npm run dashboard:build
```

3. Deploy `dashboard/dist` to Netlify.
