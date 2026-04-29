# School Services Developer README

Dokumen ini ditujukan untuk maintainer dan pengembangan. README publik untuk pengguna umum ada di [README.md](./README.md).

## Struktur Repo

- `agent/`: source agent Windows, launcher, service manager, tunnel, logging, dan self-update.
- `web-app/`: Web App React/Vite untuk Auth, Guest Mode, dan Dashboard.
- `supabase/`: migration database dan Edge Functions.
- `installer/`: konfigurasi installer Windows.
- `scripts/`: helper untuk apply, verify, seed, dan deploy Supabase.
- `Output/`: hasil build Web App dan artifact release lokal.

## Setup Lokal

Install dependency dari root repo:

```powershell
npm install
```

File konfigurasi lokal bersifat opsional:

```powershell
Copy-Item .env.example .env
Copy-Item agent.runtime.example.json agent.runtime.json
```

Gunakan file lokal hanya untuk override konfigurasi development. Jangan commit `.env`, `agent.runtime.json`, token, password, atau key admin.

## Script Utama

```powershell
npm run dashboard:dev
npm run dashboard:build
npm run dashboard:preview
npm run web-app:dev
npm run web-app:build
npm run web-app:preview
npm run agent:dev
npm run agent:build
```

Script Supabase:

```powershell
npm run supabase:apply
npm run supabase:verify
npm run supabase:seed-admin
npm run supabase:deploy-functions
```

## Build Output

- Web App build: `Output/web-app/`
- Agent payload: `agent/dist/payload/`
- Installer final: `agent/dist/release/School Services vX.Y.Z.exe`

Syarat build installer:

- Windows.
- Node.js dan npm tersedia.
- Inno Setup 6 (`ISCC.exe`) tersedia di PATH atau lewat `ISCC_PATH`.
- `cloudflared.exe` tersedia sesuai konfigurasi build.

## Supabase Workflow

1. Jalankan `npm run supabase:apply` untuk menerapkan migration.
2. Jalankan `npm run supabase:verify` untuk memeriksa schema dan fungsi penting.
3. Jalankan `npm run supabase:seed-admin` bila perlu membuat akun awal.
4. Jalankan `npm run supabase:deploy-functions` untuk deploy Edge Functions.

Pastikan environment lokal memiliki konfigurasi Supabase yang diperlukan sebelum menjalankan script admin.

## Release Workflow

1. Pastikan versi package dan installer tetap sesuai rilis.
2. Jalankan `npm run dashboard:build`.
3. Jalankan `npm run agent:build`.
4. Validasi installer di perangkat Windows bersih.
5. Buat tag GitHub dengan format `vX.Y.Z`.
6. Upload installer `School Services vX.Y.Z.exe` ke GitHub Releases.
7. Agent self-updater akan mencari rilis yang lebih baru dan menjalankan installer secara silent.

## File Yang Tidak Boleh Dipublish

- `.env`
- `.env.local`
- `agent.runtime.json`
- Log runtime
- Token GitHub atau Supabase
- Supabase service-role key
- Password database
- Artifact build besar yang tidak dimaksudkan untuk source repo

## Troubleshooting

### Agent offline

- Pastikan installer sudah dijalankan.
- Pastikan scheduled task School Services aktif.
- Cek log agent di lokasi instalasi atau ProgramData.
- Jalankan ulang shortcut `School Services`.

### Guest tidak tersambung

- Pastikan agent berjalan.
- Pastikan koneksi internet aktif.
- Pastikan perangkat sudah berhasil terdaftar.
- Segarkan halaman Guest setelah beberapa saat.

### Preview Web App gagal

- Jalankan `npm install`.
- Jalankan `npm run dashboard:build`.
- Jalankan `npm run dashboard:preview`.
- Buka `http://127.0.0.1:4173`.

### Build installer gagal

- Pastikan Inno Setup 6 terpasang.
- Pastikan `ISCC.exe` dapat ditemukan.
- Pastikan path build tidak sedang dikunci antivirus atau proses lain.
- Jalankan ulang `npm run agent:build`.

## Catatan Maintainer

- Jangan ubah file sensitif menjadi tracked.
- Jangan commit output build kecuali memang diputuskan sebagai artifact source.
- `Output/`, `agent/dist/`, log, dan konfigurasi lokal harus tetap ignored.
- Jika ada perubahan backend, jalankan verifikasi Supabase sebelum release.
