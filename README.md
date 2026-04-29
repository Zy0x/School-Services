# School Services

School Services membantu membuka akses E-Rapor dari perangkat sekolah dan menampilkan status layanan melalui Web App yang mudah digunakan.

Aplikasi ini menyediakan portal Guest untuk pengguna umum, halaman login untuk akun terdaftar, serta dashboard sesuai hak akses akun.

## Fitur Utama

- Guest Mode untuk melihat status perangkat dan membuka tautan E-Rapor.
- Dashboard role-based untuk SuperAdmin, Operator, dan User.
- Penautan perangkat setelah login agar layanan lokal dapat tampil di akun pengguna.
- Nama tampilan perangkat per akun tanpa mengubah nama asli perangkat.
- Tombol mulai dan hentikan layanan dari dashboard sesuai hak akses.
- Riwayat berkas untuk melihat aktivitas berkas yang diproses.
- Installer Windows dengan agent background dan auto-update dari GitHub Releases.
- Tampilan Auth, Guest, dan Dashboard yang responsif untuk desktop dan mobile.

## Jenis Akses

| Akses | Fungsi |
| --- | --- |
| Guest | Melihat status perangkat dan membuka E-Rapor jika layanan sudah siap. |
| User | Mengelola perangkat miliknya sendiri dan melihat layanan yang tersedia. |
| Operator | Mengelola pengguna dan perangkat di lingkungan operator. |
| SuperAdmin | Mengelola seluruh perangkat, akun, lingkungan, dan fitur berkas khusus. |

## Instalasi Pengguna

1. Buka halaman [GitHub Releases](https://github.com/Zy0x/School-Services/releases).
2. Unduh installer `School Services v2.0.0.exe`.
3. Jalankan installer di Windows.
4. Buka shortcut `School Services`.
5. Tunggu halaman Guest terbuka di browser.

Jika perangkat sudah siap, halaman Guest akan menampilkan status layanan dan tombol untuk membuka E-Rapor.

## Cara Penggunaan Singkat

1. Buka `School Services` dari shortcut.
2. Gunakan halaman Guest untuk melihat status awal perangkat.
3. Pilih `Masuk` atau `Daftar` jika membutuhkan akses akun.
4. Setelah login, konfirmasi penautan perangkat jika diminta.
5. Buka E-Rapor dari tombol yang tersedia.

## Keamanan

- Akses dibatasi berdasarkan jenis akun.
- Operator hanya melihat perangkat dan pengguna di lingkungannya.
- User hanya melihat perangkat yang menjadi aksesnya.
- Fitur berkas khusus hanya tersedia untuk SuperAdmin.
- File rahasia seperti `.env`, token, password database, dan konfigurasi lokal tidak dipublikasikan di repo.

## Build Dari Source

Dokumentasi build, struktur source, Supabase workflow, dan proses release tersedia di [README_DEV.md](./README_DEV.md).

## Changelog

Catatan rilis tersedia di [CHANGELOG.md](./CHANGELOG.md).

## Support

- GitHub: [Zy0x](https://github.com/Zy0x)
- PayPal: [paypal.me/theamagenta](https://paypal.me/theamagenta)
- Trakteer: [trakteer.id/zy0x](https://trakteer.id/zy0x)

## Lisensi

Project ini menggunakan lisensi yang tersedia di [LICENSE](./LICENSE).
