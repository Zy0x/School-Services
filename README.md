# E-Rapor Agent and Dashboard

Repository ini berisi source yang aman untuk dipublikasikan dan dibuild sendiri.

Supabase schema dan Edge Function tetap dipertahankan di repo. File env, kredensial admin, token deploy, password database, dan konfigurasi mesin pribadi tetap tidak dipublikasikan.

Untuk instalasi Windows yang umum, agent sekarang mencoba langsung:

- konek ke Supabase publik bawaan repo
- mendeteksi service Windows E-Rapor dan Dapodik secara otomatis
- mendeteksi lalu mensinkronkan file `.env` lokal E-Rapor untuk `app.baseURL` di root install dan `wwwroot`
- memasang aplikasi `School Services` ke `C:\Program Files\School Services`
- menyimpan state tulis ke `C:\ProgramData\School Services`
- membuka halaman guest lewat launcher `School Services` di browser default
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

Build ini sekarang menghasilkan:

- payload installer internal di `agent/dist/payload/`
- installer final di `agent/dist/release/School Services vX.Y.Z.exe`

Syarat build installer:

- Inno Setup 6 (`ISCC.exe`) harus terpasang atau path-nya diset lewat `ISCC_PATH`

## Layout Instalasi Windows

Installer `School Services vX.Y.Z.exe` akan:

- memasang binary read-only ke `C:\Program Files\School Services`
- menyimpan konfigurasi, log, cache, update, dan tunnel state ke `C:\ProgramData\School Services`
- membuat Start Menu entry `School Services`
- membuat desktop shortcut `.lnk` hanya jika dipilih saat install
- mendaftarkan Scheduled Task Windows agar agent otomatis jalan saat startup sistem dengan hak tertinggi
- membersihkan scheduled task lama dan shortcut legacy `School Services.url`

Saat user membuka `School Services`, launcher akan memastikan background agent aktif lalu membuka guest portal di browser default.

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
- `ERAPOR_ROOT` untuk override root folder E-Rapor agar agent bisa sinkronkan `.env` root dan `wwwroot`
- `ERAPOR_ENV_PATH` untuk override file `.env` webroot jika lokasi instalasi tidak standar
- `ERAPOR_DB_SERVICE_NAME`
- `ERAPOR_APP_SERVICE_NAME`
- `DAPODIK_DB_SERVICE_NAME`
- `DAPODIK_WEB_SERVICE_NAME`

`agent.runtime.json`:

- atur service lokal yang ingin dijalankan
- atur `cloudflaredPath` jika `cloudflared.exe` tidak ada di PATH Windows
- atur file config target lokal jika agent perlu menulis URL publik ke file aplikasi Anda
- atur `guestPortal.baseUrl` jika domain guest portal berubah

Kalau `agent.runtime.json` tidak ada, agent tetap akan memakai built-in defaults dan autodiscovery.

## Catatan Publikasi

- Jangan commit `.env`, `agent.runtime.json`, log runtime, atau file automation lokal.
- Jangan masukkan service role key, secret key, access token, password database, atau token admin lain ke repo.
- Release Windows resmi sekarang berupa satu file installer: `School Services vX.Y.Z.exe`.
- Tag release yang didukung updater adalah `vX.Y.Z` atau `X.Y.Z`.
- Updater agent akan mengambil installer GitHub yang versinya lebih baru lalu menjalankan silent upgrade di background.
