# School Services

School Services adalah control plane E-Rapor untuk membuka akses Guest, mengelola perangkat sekolah, menjalankan service E-Rapor/Dapodik, dan mendistribusikan agent Windows dengan self-update melalui GitHub Releases.

## Repository Description

Control plane dan installer Windows untuk mengelola akses E-Rapor, Guest Mode, device dashboard, Supabase backend, dan agent self-update.

## Fitur Utama

- Web App React/Vite untuk Login, Register, Guest Mode, dan Dashboard role-based.
- Dashboard SuperAdmin, Operator, dan User untuk melihat perangkat, status service, command, file, aktivitas, akun, dan profil.
- Agent Windows `School Services` untuk menjalankan service lokal, membuat Cloudflare quick tunnel, publish status perangkat, dan menjalankan self-update.
- Supabase migrations dan Edge Functions untuk auth policy, guest access, account access, cleanup, command queue, dan admin operations.
- Installer Windows versi rilis dengan format `School Services vX.Y.Z.exe`.

## Instalasi Pengguna

Cara paling mudah untuk pengguna biasa adalah memakai installer rilis terbaru.

1. Buka halaman [Latest Release](https://github.com/Zy0x/School-Services/releases/latest).
2. Unduh file `School Services v2.0.6.exe` atau asset installer terbaru.
3. Jalankan installer di Windows dengan akses Administrator.
4. Buka shortcut `School Services` dari Desktop atau Start Menu.
5. Pastikan Guest Mode menampilkan status perangkat dan tombol buka E-Rapor.

Installer akan memasang agent, launcher, konfigurasi startup, dan komponen yang dibutuhkan untuk menjalankan akses lokal melalui tunnel.

## Kebutuhan Sistem

- Windows 10/11 atau Windows Server modern.
- Node.js dan npm hanya dibutuhkan untuk development/build, bukan untuk pengguna installer.
- Akses internet untuk Cloudflare quick tunnel, Supabase, dan self-update GitHub.
- Service E-Rapor/Dapodik sudah terpasang bila perangkat ini akan dipakai sebagai host layanan.

## Struktur Repo

```text
agent/                 Agent Windows, launcher, service manager, tunnel, logging, dan self-update
apps/frontend/         Web App React/Vite untuk Auth, Guest Mode, dan Dashboard
apps/backend/          Backend Express modular alternatif
packages/              Shared config, types, dan utility
supabase/              Schema, migrations, seed, dan Edge Functions
installer/             Konfigurasi Inno Setup untuk installer Windows
infra/                 Docker dan CI/CD
docs/                  Dokumen arsitektur, setup, dan API singkat
scripts/               Helper Supabase dan maintenance
```

## Setup Developer

Install dependency dari root repo:

```powershell
npm install
```

Siapkan konfigurasi lokal:

```powershell
Copy-Item .env.example .env
Copy-Item agent.runtime.example.json agent.runtime.json
```

Isi `.env` sesuai project Supabase dan environment lokal. Jangan commit `.env`, `agent.runtime.json`, token, password, service-role key, atau file runtime lokal.

## Konfigurasi Penting

Frontend memakai Supabase secara default:

```env
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Untuk memakai backend Express lokal:

```env
VITE_USE_SUPABASE=false
VITE_BACKEND_BASE_URL=http://localhost:8080/api
```

Agent membutuhkan:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
CLOUDFLARED_PATH=C:\path\to\cloudflared.exe
```

Script admin Supabase membutuhkan `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `ADMIN_EMAIL`, dan opsional `SUPABASE_ACCESS_TOKEN` untuk deploy Edge Functions.

## Script Utama

```powershell
npm run frontend:dev
npm run frontend:build
npm run frontend:preview
npm run backend:dev
npm run backend:build
npm run agent:dev
npm run agent:test
npm run agent:build
npm run test
```

Alias lama tetap tersedia:

```powershell
npm run dashboard:dev
npm run dashboard:build
npm run dashboard:preview
npm run web-app:dev
npm run web-app:build
npm run web-app:preview
```

## Supabase Workflow

```powershell
npm run supabase:apply
npm run supabase:verify
npm run supabase:seed-admin
npm run supabase:deploy-functions
npm run supabase:reset-admin
```

Alur rilis backend:

1. Isi `.env` dengan Supabase URL, anon key, service-role key, database password, admin email, dan admin password.
2. Jalankan `npm run supabase:apply` untuk push migrations, membuat bucket, seed admin, deploy functions, dan verify.
3. Jalankan `npm run supabase:verify` setelah perubahan database/fungsi.
4. Gunakan `npm run supabase:reset-admin` jika perlu reset password SuperAdmin dari `.env`.

## Build dan Release

Output build:

- Web App: `apps/frontend/dist/`
- Agent payload: `agent/dist/payload/`
- Installer final: `agent/dist/release/School Services vX.Y.Z.exe`

Syarat build installer:

- Windows.
- Node.js dan npm tersedia.
- Inno Setup 6 (`ISCC.exe`) tersedia di PATH atau set `ISCC_PATH`.
- `cloudflared.exe` tersedia sesuai konfigurasi build.

Workflow release:

1. Pastikan versi root, `agent/package.json`, dan `apps/frontend/package.json` sama.
2. Jalankan `npm run test`.
3. Jalankan `npm run agent:build` bila installer perlu dibuat ulang.
4. Validasi installer di perangkat Windows bersih.
5. Buat tag GitHub dengan format `vX.Y.Z`.
6. Upload installer `School Services vX.Y.Z.exe` ke GitHub Releases.
7. Agent self-updater akan mencari rilis lebih baru dan memilih asset installer yang sesuai.

## Deploy Frontend

Repository sudah menyertakan `netlify.toml`:

```toml
[build]
  command = "npm run frontend:build"
  publish = "apps/frontend/dist"
```

Pastikan environment Netlify berisi `VITE_USE_SUPABASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, dan `VITE_PUBLIC_SITE_URL`.

## Docker

```powershell
docker compose -f infra/docker/docker-compose.yml up --build
```

Frontend akan tersedia di port `8080`, backend di port `8081`.

## Troubleshooting

### Agent offline

- Pastikan installer sudah dijalankan sebagai Administrator.
- Pastikan scheduled task `School Services Agent Startup` aktif.
- Jalankan ulang shortcut `School Services`.
- Cek log agent di folder instalasi atau `ProgramData\School Services`.
- Pastikan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` benar.

### Guest tidak tersambung

- Pastikan agent berjalan dan perangkat sudah terdaftar.
- Pastikan koneksi internet aktif.
- Tunggu retry tunnel beberapa saat, lalu refresh halaman Guest.
- Jika status Cloudflare throttled/rate-limited, biarkan cooldown selesai; agent akan membersihkan log tunnel lama dan mencoba ulang.

### Preview Web App gagal

```powershell
npm install
npm run frontend:build
npm run frontend:preview
```

Buka `http://127.0.0.1:4173`.

### Build frontend gagal karena environment

- Pastikan `VITE_USE_SUPABASE=true` memakai `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
- Untuk backend lokal, set `VITE_USE_SUPABASE=false` dan `VITE_BACKEND_BASE_URL`.
- Hapus `apps/frontend/dist/`, lalu build ulang.

### Build installer gagal

- Pastikan Inno Setup 6 terpasang.
- Pastikan `ISCC.exe` dapat ditemukan atau set `ISCC_PATH`.
- Pastikan path build tidak dikunci antivirus/proses lain.
- Jalankan `npm run agent:build` dari root repo.

### Supabase apply/deploy gagal

- Pastikan `.env` berisi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `SUPABASE_DB_PASSWORD`.
- Untuk deploy Edge Functions, set `SUPABASE_ACCESS_TOKEN` atau login Supabase CLI.
- Pastikan akun Supabase punya akses ke project yang sama.

## File Yang Tidak Boleh Dipublish

- `.env`
- `.env.local`
- `agent.runtime.json`
- Log runtime
- Token GitHub atau Supabase
- Supabase service-role key
- Password database
- Output build besar yang tidak dimaksudkan sebagai source repo

## Catatan Maintainer

- UI frontend harus memakai service layer `apps/frontend/src/services/api/*`, bukan import provider langsung.
- Provider data dipilih dari `apps/frontend/src/services/client.js`.
- Perubahan database harus disertai migration di `supabase/migrations/`.
- Setelah perubahan agent/tunnel/self-update, jalankan `npm run agent:test`.
- Setelah perubahan lintas workspace, jalankan `npm run test`.
- File build seperti `apps/frontend/dist/`, `Output/`, `agent/dist/`, log, dan konfigurasi lokal harus tetap ignored.

## Lisensi

Project ini menggunakan lisensi pada [LICENSE](./LICENSE).
