#!/bin/bash
set -e

echo "🚀 Initializing Ultra Codex Environment..."

# ==============================
# 1. SYSTEM UPDATE
# ==============================
apt-get update

# ==============================
# 2. CORE TOOLS (WAJIB)
# ==============================
apt-get install -y \
  git \
  curl \
  wget \
  jq \
  ripgrep \
  fd-find \
  unzip

# ==============================
# 3. ADVANCED CLI TOOLS
# ==============================
apt-get install -y \
  fzf \
  bat \
  git-delta \
  httpie

# ==============================
# 4. DEV / CONFIG TOOLS
# ==============================
apt-get install -y \
  yq

# ==============================
# 5. OPTIONAL (SAFE FAIL)
# ==============================
apt-get install -y gh || true

# ==============================
# 6. FIX BINARIES / ALIAS
# ==============================
# Debian: fd = fdfind
ln -sf $(which fdfind) /usr/bin/fd || true

# bat kadang jadi batcat
if command -v batcat >/dev/null 2>&1; then
  ln -sf $(which batcat) /usr/bin/bat || true
fi

# ==============================
# 7. NODE CHECK
# ==============================
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm tidak ditemukan. Pastikan runtime tersedia."
  exit 1
fi

# ==============================
# 8. PROJECT DEPENDENCIES
# ==============================
echo "📦 Installing dependencies..."
npm install || true

# Dev tools (non-fatal)
npm install -D eslint prettier || true

# ==============================
# 9. GIT CONFIG
# ==============================
git config --global user.name "Zy0x"
git config --global user.email "zy0x.noir@gmail.com"
git config --global init.defaultBranch main

# ==============================
# 10. GIT DELTA CONFIG (DIFF BAGUS)
# ==============================
git config --global core.pager "delta"
git config --global delta.side-by-side true
git config --global delta.syntax-theme "Dracula"

# ==============================
# 11. VALIDATION
# ==============================
echo "🔍 Validating tools..."

command -v rg >/dev/null && echo "✔ ripgrep OK"
command -v fd >/dev/null && echo "✔ fd OK"
command -v jq >/dev/null && echo "✔ jq OK"
command -v git >/dev/null && echo "✔ git OK"
command -v fzf >/dev/null && echo "✔ fzf OK"

echo "✅ ULTRA SETUP COMPLETE"

# Implementasi Penuh Guest UX + Role Scope + Sinkronisasi ke `main`

## Ringkasan
- Implementasi dilakukan sebagai satu rangkaian perubahan penuh: UI Guest publish-ready, auth fallback yang user-friendly, reset password redirect ke login, sinkronisasi visibility password, serta redesign model akses `super_admin / operator / user` berbasis lingkungan, referral, dan assignment device.
- Semua perubahan dieksekusi dengan target akhir: build bersih, function Supabase terdeploy, uji role-scope lolos, uji file besar lolos, versi tetap `2.0.0`, lalu commit langsung ke `main` dan push sinkron ke GitHub.
- Dalam mode saat ini, pekerjaan ini diperlakukan sebagai spesifikasi eksekusi lengkap; tidak ada mutasi tambahan yang dilakukan pada turn ini.

## Urutan Eksekusi
### 1. Fondasi data dan akses
- Tambah migration baru untuk:
  - `operator_environments`
  - `environment_invitations`
  - `environment_memberships`
  - `device_assignments`
  - perluasan `app_settings.auth_policy` untuk approval matrix terpisah
  - perluasan `admin_profiles` untuk metadata source/manager/standalone state
- Tambah helper SQL/DB untuk cek scope:
  - `is_super_admin()`
  - `is_operator()`
  - `is_operator_for_environment(env_id)`
  - `can_access_device(device_id)`
  - `can_manage_user(target_user_id)`
- Rework RLS agar:
  - `super_admin` akses global
  - `operator` hanya environment miliknya
  - `user` hanya device miliknya
  - remote file/storage preview/archive tetap `super_admin` only

### 2. Edge Functions dan policy approval
- Perluas `account-access`:
  - `register` mendukung mode:
    - `invite_email`
    - `referral_code`
    - `direct_superadmin`
  - tentukan approval window dari policy:
    - operator = `24h`
    - user terikat environment = `8h`
    - user direct standalone = manual by default
  - simpan `registration_source`, `environment_id`, `managed_by_user_id` bila relevan
- Perluas `admin-ops`:
  - CRUD environment operator
  - generate/rotate referral code
  - invite user by email
  - create user langsung
  - approve/reject standalone user
  - approve/reject join-request ke environment
  - assign/unassign device
  - list accounts/devices scoped sesuai role caller
  - expose auth policy baru termasuk toggle auto-approval standalone oleh superadmin
- Perluas `guest-access` hanya pada payload read/status agar Guest UI punya data status lebih kaya; akses publik tetap minimal.

### 3. Dashboard role-aware
- Ubah bootstrap profile/session agar dashboard membaca scope environment dan assignment device.
- Bedakan tampilan:
  - `super_admin`: fleet global, approval queue, environment monitoring, referral monitoring, remote files
  - `operator`: fleet environment sendiri, create/invite user, join-request moderation, tanpa remote files
  - `user`: status device lokal sendiri dan kontrol terbatas non-file
- Pastikan query dashboard tidak lagi bergantung pada role string saja, tetapi juga scope hasil backend/RLS.

### 4. Guest Mode publish-ready
- Hapus total overlay `Traktir`.
- Ganti footer guest menjadi blok responsif `Buy Me a Coffee` berisi:
  - `Support GitHub`
  - `PayPal`
  - `Trakteer`
  - semua dengan inline SVG icons, hover/press animation, dan layout modern/fluent
- Gunakan `icon.png` sebagai logo/brand Guest Mode.
- Tulis ulang semua deskripsi Guest Mode menjadi netral, profesional, dan cocok untuk user umum.
- Tambah UX state:
  - modal loading modern saat `Start/Stop`
  - progress text yang human-friendly
  - tombol refresh dengan busy animation dan fallback state
  - badge/status realtime yang konsisten
- Pertahankan `Salin link` dan `Bagikan WA`.

### 5. Auth UX dan fallback user-friendly
- Ganti pesan `invalid credentials` ke copy Indonesia yang ramah.
- Samakan seluruh fallback error auth/network/reset menjadi non-teknis tetapi tetap akurat.
- Setelah reset password sukses:
  - sign out local
  - clear auth artifacts
  - tampilkan success state singkat
  - redirect otomatis ke login
- Refactor `PasswordField`:
  - visibility state dikendalikan parent
  - pasangan `password baru` + `konfirmasi` sinkron
  - `password saat ini` tetap independen

### 6. Asset, branding, dan versi
- Track `icon.png` ke repo dan salin ke public asset yang dibutuhkan dashboard.
- Pertahankan `version` package dan installer di `2.0.0`.
- Pastikan rebuild agent/dashboard tidak mengubah penomoran release.

## API / Interface yang Berubah
- `account-access.register` menerima source onboarding dan identitas environment/referral.
- `admin-ops` bertambah action baru untuk environment, referral, invite, join approval, dan device assignment.
- `app_settings.auth_policy` diperluas dari satu approval window menjadi policy matrix:
  - operator auto-approval window
  - environment-user auto-approval window
  - standalone-user auto/manual mode
  - password reset redirect
- Data profile/session efektif akan memuat informasi environment/scope, bukan hanya `role` dan `status`.

## Test Plan
- Registration:
  - operator signup -> pending -> auto approve 24 jam
  - invited/referral user signup -> pending -> auto approve 8 jam
  - direct standalone user -> pending manual superadmin
- Scope:
  - superadmin melihat semua
  - operator tidak bisa akses file remote
  - operator hanya melihat device/user environment sendiri
  - user hanya melihat device miliknya
- Guest:
  - logo memakai `icon.png`
  - footer `Buy Me a Coffee` tampil benar desktop/mobile
  - start/stop modal muncul dan state selesai benar
  - refresh punya busy animation
  - copy/share URL tetap jalan
- Auth:
  - forgot password sukses
  - reset password sukses lalu redirect login
  - invalid credential dan fallback error lain berubah ke copy yang ramah
  - visibility password sinkron
- File besar:
  - build archive melebihi satu part tetap pecah sesuai limit
  - unduhan tiap part tetap valid
- Release:
  - `dashboard:build` sukses
  - `agent:build` sukses
  - function deploy sukses
  - `main` bersih, commit masuk, push sinkron

## Asumsi
- `super_admin` tetap satu-satunya role dengan hak penuh lintas environment dan remote file.
- Satu operator hanya punya satu environment aktif.
- User standalone bisa tetap berdiri sendiri, lalu request masuk environment operator via referral dengan approval operator.
- Self-claim device tetap ada, tetapi assignment final tetap dibatasi oleh scope role dan dapat dioverride superadmin.
- Semua perubahan akan langsung diarahkan ke branch `main`, bukan branch kerja terpisah.
