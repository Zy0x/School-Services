# E-Rapor Agent and Dashboard

Repository ini berisi source yang aman untuk dipublikasikan dan dibuild sendiri.

Supabase schema dan Edge Function tetap dipertahankan di repo. File env, kredensial admin, token deploy, password database, dan konfigurasi mesin pribadi tetap tidak dipublikasikan.

Untuk instalasi Windows yang umum, agent sekarang mencoba langsung:

- konek ke Supabase publik bawaan repo
- mendeteksi service Windows E-Rapor dan Dapodik secara otomatis
- mendeteksi file config lokal E-Rapor yang perlu diubah untuk `app.baseURL`
- tetap jalan walau software target belum terpasang atau agent belum dijalankan sebagai Administrator

## Isi Repo

- `agent/`: source agent Windows
- `dashboard/`: source dashboard React/Vite
- `supabase/`: migrations dan Edge Functions
- `agent.runtime.example.json`: template konfigurasi agent
- `.env.example`: template environment variable

## Yang Tidak Lagi Dipublikasikan

- `Automation E-Rapor.bat`
- `.codex/`
- `agent.runtime.json`

Repo publik ini tetap diarahkan ke control plane Supabase yang dipakai aplikasi, sehingga build publik bisa langsung terkoneksi tanpa harus mem-publish file `.env`. Konfigurasi sensitif untuk administrasi dan deploy tetap hanya dibaca dari file env lokal maintainer.

## Build Dari Source

1. Install dependency root:

```powershell
npm install
```

2. Jika ingin override konfigurasi lokal, salin template:

```powershell
Copy-Item .env.example .env
Copy-Item agent.runtime.example.json agent.runtime.json
```

3. Untuk instalasi yang umum, Anda bisa langsung build tanpa mengedit apa pun. `agent.runtime.json` dan `.env` hanya diperlukan jika Anda ingin override deteksi default, memakai path custom, atau menjalankan operasi admin/deploy Supabase.

4. Build dashboard:

```powershell
npm run dashboard:build
```

5. Build agent Windows:

```powershell
npm run agent:build
```

Output agent akan berada di `agent/dist/e-rapor-agent.exe`.

Untuk menjalankan:

- `agent/dist/run-agent-hidden.vbs`: mode biasa
- `agent/dist/run-agent-admin-hidden.vbs`: mode Administrator, dipakai jika agent perlu start/stop Windows service yang belum berjalan

## Konfigurasi Minimum

`.env` opsional untuk override lokal:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Opsional:

- `VITE_PUBLIC_SITE_URL`
- `GUEST_PORTAL_BASE_URL`
- `CLOUDFLARED_PATH`
- `ERAPOR_ROOT`
- `ERAPOR_ENV_PATH`
- `ERAPOR_DB_SERVICE_NAME`
- `ERAPOR_APP_SERVICE_NAME`
- `DAPODIK_DB_SERVICE_NAME`
- `DAPODIK_WEB_SERVICE_NAME`

`agent.runtime.json`:

- atur service lokal yang ingin dijalankan
- atur `cloudflaredPath` jika `cloudflared.exe` tidak ada di PATH Windows
- atur file config target lokal jika agent perlu menulis URL publik ke file aplikasi Anda

Kalau `agent.runtime.json` tidak ada, agent tetap akan memakai built-in defaults dan autodiscovery.

## Catatan Publikasi

- Jangan commit `.env`, `agent.runtime.json`, log runtime, atau file automation lokal.
- Jangan masukkan service role key, secret key, access token, password database, atau token admin lain ke repo.
- Updater agent hanya akan mengambil rilis GitHub jika versi rilis memang lebih baru daripada versi agent yang sedang berjalan.
