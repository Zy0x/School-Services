# Changelog

Semua perubahan penting pada project ini dicatat di file ini.

Format mengikuti prinsip [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dengan versi rilis project.

## [2.0.0] - 2026-04-30

### Added

- Web App baru untuk Auth, Guest Mode, dan Dashboard.
- Guest Mode untuk melihat status perangkat dan membuka E-Rapor.
- Dashboard role-based untuk SuperAdmin, Operator, dan User.
- Supabase Edge Functions untuk akses akun, operasi admin, Guest, dan cleanup.
- Installer Windows `School Services v2.0.0.exe`.
- Agent Windows dengan background service, logging, tunnel, dan self-update.
- Device alias per akun tanpa mengubah nama asli perangkat.
- Kontrol mulai dan hentikan layanan sesuai hak akses.
- Riwayat berkas untuk SuperAdmin.
- Output build Web App ke `Output/web-app/`.

### Changed

- Folder dashboard dipindahkan menjadi `web-app`.
- UI Auth, Guest, dan Dashboard diperbarui agar lebih siap publish.
- Copywriting UI diubah menjadi bahasa Indonesia yang lebih singkat dan profesional.
- Brand icon dibuat circle dengan animasi backlight.
- Dashboard memakai routing internal dengan halaman Ringkasan, Perangkat, Berkas, Aktivitas, Akun, dan Profil.
- Installer memakai nama final `School Services v2.0.0.exe`.

### Fixed

- Perangkat baru pada clean install dapat diproses oleh Guest Mode.
- Penautan perangkat dari Guest setelah login User atau Operator.
- Tampilan referral code untuk Operator.
- Blank screen pada dashboard account form.
- Guest Mode yang sebelumnya refresh/blinking berkala.
- Reset password berhasil diarahkan kembali ke halaman login.
- Web preview setelah rename folder dashboard menjadi `web-app`.

### Security

- Scope akses dipisahkan untuk SuperAdmin, Operator, dan User.
- Operator dibatasi hanya pada lingkungan miliknya.
- User dibatasi hanya pada perangkat miliknya.
- Fitur berkas khusus dibatasi untuk SuperAdmin.
- File sensitif seperti `.env`, token, password database, dan konfigurasi runtime lokal tidak dipublish.

### Build

- Script kompatibel tetap tersedia: `dashboard:dev`, `dashboard:build`, dan `dashboard:preview`.
- Script baru tersedia: `web-app:dev`, `web-app:build`, dan `web-app:preview`.
- Build Web App menghasilkan output ke `Output/web-app/`.
- Build agent menghasilkan installer final ke `agent/dist/release/`.
