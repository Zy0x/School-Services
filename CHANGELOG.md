# Changelog

Semua perubahan penting pada project ini dicatat di file ini.

Format mengikuti prinsip [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dengan versi rilis project.

## [2.0.9] - 2026-05-23

### Added

- Supervisor watchdog yang merestart paksa agent ketika heartbeat agent stale tetapi heartbeat supervisor masih sehat.
- Tombol Pulihkan Agent di Guest Access saat device masih online melalui supervisor namun agent tidak tersambung.
- Log loop agent dan supervisor sekarang menyertakan stack/cause agar audit koneksi putus, sleep/hibernate, DNS, dan ECONNRESET lebih presisi.

### Changed

- Dashboard SuperAdmin/Operator tetap mengaktifkan Restart Agent saat kontrol supervisor siap walaupun heartbeat agent sudah stale.
- Guest Access dapat mengirim command recovery `agent_restart` ke supervisor dengan validasi heartbeat supervisor fresh.

### Fixed

- Recovery tunnel tidak lagi macet dalam rekursi saat `requiresFreshStart=true` tetapi proses Cloudflare/Ngrok lama masih hidup.
- Kondisi WiFi putus-nyambung yang menyisakan `publicUrl=null`, proses tunnel hidup, dan tombol web terkunci kini punya jalur recovery otomatis dan manual.

## [2.0.8] - 2026-05-23

### Added

- Self-check public link berlapis untuk Cloudflare dan Ngrok agar link yang tidak bisa dimuat, 530, timeout, atau ditolak provider otomatis memicu recovery tunnel.
- Discovery dinamis lokasi E-Rapor dari path Windows Service dan pencarian `.env` terbatas pada root instalasi custom seperti drive atau folder sekolah non-standar.
- Matching Windows Service kini membaca `PathName` executable, sehingga service Dapodik/E-Rapor dengan nama custom tetap bisa dikenali bila path instalasinya mengandung identitas aplikasi.
- Scheduled task SYSTEM untuk Start, Stop, dan Restart agent supaya kontrol lokal pasca-install tidak memunculkan UAC.

### Changed

- Restart agent kini membersihkan tunnel/service stale dan membangun ulang public URL sampai state agent kembali sinkron.
- Installer memperkuat permission folder install, runtime binary, firewall, serta grant task access menggunakan path absolut `icacls.exe`.
- Agent mempertahankan versi runtime `2.0.8` untuk memicu self-update dari GitHub latest tanpa mengubah kontrak API atau schema.

### Fixed

- Ngrok error page seperti `ERR_NGROK_727` tidak lagi dianggap link sehat.
- Cloudflare quick tunnel yang sudah membuat URL tetapi belum benar-benar bisa diload tidak lagi dipublish permanen sebagai running.
- Instalasi di direktori E-Rapor custom tidak lagi bergantung penuh pada fallback `C:\newappraporsd2025`.

## [2.0.7] - 2026-05-07

### Added

- Progress realtime untuk Start, Stop, Restart, Update Agent, serta Mulai/Hentikan layanan dengan status fase, persen, error, dan panel yang bisa diminimize.
- Supervisor Agent untuk menjaga progress lifecycle tetap berjalan saat proses Agent utama dihentikan, direstart, atau diupdate.
- Catatan Ngrok gratis yang dinamis sesuai layanan, termasuk format WhatsApp untuk E-Rapor, Dapodik, atau layanan lain yang dibagikan.
- Notifikasi salin tautan dan salin detail yang tampil konsisten di Dashboard, Guest, dan halaman semua role.

### Changed

- Dashboard Guest dan role admin diberi spacing compact-relaxed agar card, modal, disclosure, dan form tunnel tidak saling menempel.
- Preferensi tunnel Cloudflared/Ngrok menampilkan token Ngrok cadangan yang terkunci saat Cloudflared aktif, dengan mode edit eksplisit.
- Startup agent menjaga service lokal yang sudah sehat tetap berjalan dan mengurangi antrean tunnel antar-service.
- Restart Agent menunggu layanan dan public URL stabil sebelum dianggap selesai, kecuali layanan memang tidak tersedia pada perangkat.
- Kontrol layanan Guest dan Dashboard mengikuti status aktif/nonaktif agar tombol Start/Stop tidak terkunci setelah progress selesai.

### Fixed

- Kode referral lingkungan ditampilkan untuk SuperAdmin dan Operator dengan aksi salin dan bagikan.
- Device aktif hanya dapat tertaut ke satu akun dan bisa dilepas secara aman lewat aksi unlink.
- Public URL terakhir tetap dipertahankan selama reconnect tunnel singkat, dan log tunnel baru memakai file per launch untuk menghindari `EPERM`.
- Progress lama tidak lagi langsung muncul saat login ke perangkat offline.
- Modal progress otomatis selesai/tertutup setelah command benar-benar selesai dan tidak menahan klik halaman saat tidak ada command aktif.
- Tunnel Ngrok memakai proxy lokal untuk mengirim header bypass warning pada akses publik bila provider Ngrok gratis dipakai.

## [2.0.6] - 2026-05-03

### Added

- Script `npm run test` di root untuk menjalankan test agent dan build workspace.
- Script `npm run agent:test` untuk validasi unit test agent.
- Unit test self-updater dan tunnel recovery untuk memastikan rilis baru dan retry Cloudflare ditangani benar.
- Fallback tunnel `ngrok` opsional ketika Cloudflare quick tunnel terkena rate-limit dan `ngrok.exe` tersedia.

### Changed

- Versi root, frontend, dan agent dinaikkan menjadi `2.0.6`.
- Build frontend kini memecah bundle vendor React, Supabase, dan icon agar output rilis lebih terstruktur.
- Supabase orchestrator kini memakai executable Supabase CLI lokal bila tersedia dan menjalankan process tanpa shell wrapper.
- README utama diperluas menjadi dokumentasi tunggal untuk pengguna installer, developer, release, deploy, dan troubleshooting.
- Fallback Supabase URL dan anon key project dihapus dari source agent agar repo publik tidak membawa konfigurasi project tertentu.

### Fixed

- Agent mengembalikan status update-in-progress ketika launcher updater gagal, sehingga proses update berikutnya tidak tertahan.
- Retry tunnel Cloudflare kini membersihkan state/log lama setelah cooldown rate-limit selesai.
- Pesan rate-limit Cloudflare diperjelas sebagai throttling request quick tunnel.
- Fresh start tunnel kini mereset retry manager dan log lama sebelum reconnect.
- State tunnel `starting` tanpa proses aktif tidak lagi bisa membuat antar-service saling menunggu selamanya.
- Edge Function `admin-ops` menerima alias command legacy seperti `startService`, `stopService`, dan `restartService`.
- Entry frontend diarahkan langsung ke `src/app/App.jsx` setelah wrapper route lama dihapus.

## [2.0.5] - 2026-05-02

### Changed

- Halaman Guest diringkas agar fokus pada satu panel status layanan, panel akses utama, dan informasi sekunder yang benar-benar dibutuhkan.
- Tampilan offline pada Guest kini memakai latar merah transparan modern yang mengikuti bahasa visual dashboard SuperAdmin.
- Feedback aksi Guest diperjelas dengan notifikasi untuk buka tautan, salin tautan, bagikan, segarkan status, dan kontrol layanan.

### Fixed

- Elemen status, badge, dan teks yang sebelumnya berulang di halaman Guest dihapus agar tata letak lebih bersih dan konsisten.
- Panel akses utama dan status layanan Guest kini lebih rapi pada desktop maupun breakpoint kecil.
- Versi rilis aplikasi dinaikkan menjadi `2.0.5`.

## [2.0.1] - 2026-04-30

### Changed

- Status Guest dan dashboard kini menahan status siap sampai tautan publik benar-benar tersambung kembali setelah perpindahan jaringan.
- Badge perangkat, layanan, dan tautan publik dibuat lebih konsisten dan informatif untuk Guest, User, Operator, dan SuperAdmin.
- Versi installer dinaikkan menjadi `School Services v2.0.1.exe`.

### Fixed

- URL tunnel lama tidak lagi tetap dipublish saat jaringan berubah atau tunnel Cloudflare sedang restart.
- Kasus `530 The origin has been unregistered from argo tunnel` kini ditangani sebagai status menunggu koneksi ulang, bukan langsung dianggap siap.

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
