<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md"><b>Bahasa Indonesia</b></a>
</p>

# dsh-harbor

harbor adalah cermin hanya-baca untuk plugin [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) yang telah Anda pasang: menunjukkan **apa yang dapat dilakukan** setiap plugin, di mana mereka **bertabrakan**, dan **apa yang berubah** sejak pemindaian terakhir—lengkap dengan bukti yang dapat diperiksa untuk setiap kemampuan yang terdeteksi.

Anda yang memutuskan apakah ada yang perlu dirapikan. harbor hanya menyatakan fakta; ia tidak menghakimi, membatasi pemasangan, ataupun mencegat apa pun.

## Apa itu harbor—dan apa yang bukan

harbor hanya melakukan satu hal: memelihara catatan berkelanjutan berbasis bukti mengenai plugin yang telah Anda pasang. Catatan ini memiliki tiga bagian: inventaris itu sendiri (setiap plugin pihak ketiga yang terpasang, beserta lokasi sumber jika dapat ditemukan oleh detektor), pencocokan antara apa yang dinyatakan setiap plugin dan apa yang benar-benar dilakukan kodenya, serta linimasa perubahan dari satu pemindaian ke pemindaian berikutnya.

Hal yang sengaja tidak dilakukan harbor juga merupakan bagian penting dari desainnya. harbor tidak menilai atau membatasi plugin sebelum dipasang—kontrol penerimaan adalah tugas perkakas marketplace plugin. harbor tidak menyelami pemantauan dependensi upstream; pemeriksaan upstream hanya mencakup versi plugin. harbor tidak melakukan audit kode umum, serta tidak mencegat, memblokir, atau menjalankan perilaku plugin di dalam sandbox.

Poin terakhir bukan keputusan tentang cakupan, melainkan kenyataan pada host. Runtime Cordis milik DSH tidak memiliki sandbox kemampuan: plugin berjalan di realm Node utama milik host, dengan hak akses yang sama seperti host. harbor dapat membuat kemampuan **terlihat**, **mendeteksinya**, dan **mencocokkannya** dengan deklarasi—tetapi tidak dapat mematikannya. Pembatasan perilaku plugin membutuhkan dukungan di loader DSH itu sendiri, dan alur deklarasi di bawah ini membantu membangun standar tersebut dengan data alih-alih sekadar memperdebatkannya secara abstrak.

Terakhir, harbor melaporkan fakta, bukan skor. Keluarannya selalu berupa “apa yang terdeteksi dan di mana buktinya”—bukan tingkat risiko dan bukan penilaian kualitas. Arti sebuah temuan bagi Anda merupakan penilaian Anda sendiri, bukan penilaian harbor.

> **Status: `0.1.0-rc.2`, pematangan kandidat rilis.** CLI, rute hub khusus loopback, panel pengaturan DSH, perbedaan lintas profile, dan pemeriksaan upstream opsional telah tersedia. Host yang aktif menyumbangkan alat, Provider, dan rute runtime; tanpa host aktif, bukti runtime secara eksplisit turun menjadi `available: false`. Detektor masih bersifat heuristik dan terus dikalibrasi terhadap ekosistem yang lebih luas, jadi tinjau buktinya dan jangan menganggap tidak ditemukannya sesuatu sebagai bukti bahwa sesuatu itu tidak ada.

## Apa yang diperiksa

```
~/.dsh/profiles/*                → bundle pihak ketiga yang terpasang (npm maupun link:)
  ├─ declared    package.json / cordis.patch.yml — pernyataan plugin tentang dirinya
  ├─ runtime     tools / routes / providers yang benar-benar terdaftar di host
  ├─ static      subproses, lalu lintas keluar, penulisan konfigurasi eksternal — dengan file:line
  ├─ versions    perbedaan (lokal, selalu) + upstream (menggunakan jaringan, opsional)
  └─ snapshot    diff terhadap pemindaian sebelumnya: versi baru, kemampuan baru
        └─ pencocokan: dsh.capabilities yang dideklarasikan vs yang terdeteksi
```

Kemampuan terdiri dari tiga belas jenis tetap: injeksi klien, risiko realm, salinan realm, hook global, adaptor LLM, subproses, lalu lintas jaringan keluar, rute Web, pendaftaran alat, server MCP, penulisan konfigurasi eksternal, penanganan kredensial, dan pembacaan variabel lingkungan. Daftar ini tetap agar laporan dapat dibandingkan dan di-diff antar-pemindaian. Daftar resminya ada di [SPEC.md](./SPEC.md) §2; sumber kebenaran yang dapat dibaca mesin adalah `src/scan/detectors.mjs`.

Istilah yang digunakan sengaja netral: **kemampuan**, bukan risiko. Menjalankan subproses merupakan tujuan utama beberapa plugin. Laporan menjawab “apa yang dapat dilakukannya” dan menyerahkan pertanyaan “apakah seharusnya dilakukan” kepada Anda.

## Versi

harbor menjawab dua pertanyaan tentang versi dan memisahkan keduanya.

**Perbedaan lintas profile** sepenuhnya bersifat lokal. Plugin yang sama dengan versi berbeda pada beberapa profile adalah fakta tentang mesin ini, sehingga dihitung gratis pada setiap pemindaian. Pemasangan `link:` atau `file:` tidak dianggap sebagai acuan “terbaru”: working tree yang lebih maju dari versi terbit merupakan hal normal, bukan perbedaan versi.

**Pemeriksaan upstream** berkomunikasi ke luar mesin, sehingga tidak pernah menjadi bagian dari pemindaian bawaan. CLI memerlukan `harbor scan --check-updates`; panel memerlukan penekanan tombol secara eksplisit, dan teks di sebelah tombol menjelaskannya—itulah satu-satunya tindakan di halaman tersebut yang berkomunikasi ke luar mesin Anda. Setiap hasil memiliki salah satu dari lima status berikut:

- **behind** — registry memiliki versi yang lebih baru
- **current** — versi terpasang sama dengan versi di registry
- **ahead** — versi terpasang lebih baru daripada versi di registry (keadaan yang memang dapat terjadi di mesin pengelola)
- **local** — pemasangan `link:` / `file:` yang tidak memiliki upstream untuk dibandingkan dan tidak pernah ditampilkan sebagai “terbaru”
- **unknown** — pencarian gagal

registry dibaca dari `.npmrc` milik Anda sendiri (termasuk penggantian `@scope:registry`), tidak pernah di-hardcode ke npmjs. Hasil disimpan dalam cache di disk selama enam jam.

## Pemasangan

Untuk pengembangan lokal, pasanglah dari checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` meneruskan argumen lainnya ke pnpm di dalam direktori profile, dan `link:` membuat symlink dari dependensi profile ke checkout ini sehingga hasil build ulang langsung terlihat. Untuk pemasangan dari registry, gunakan tag kandidat `next`:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

Setelah itu, mulai ulang DSH agar lapisan profile yang baru dimuat.

Panel muncul di Web UI DSH pada bagian **Pengaturan** sebagai **DSH Harbor**—cermin yang sama dengan CLI: inventaris beserta bukti, konflik, versi, dan diff sejak pemindaian terakhir. Tombol **Periksa pembaruan** adalah satu-satunya tindakan di halaman tersebut yang berkomunikasi ke luar mesin Anda. Panel merupakan sisi hub dari plugin dan hanya dipasang pada profile yang memiliki server Web.

Berkas executable plugin dipasang di dalam profile yang dipilih; menambahkannya ke `web` tidak menempatkan `harbor` pada `PATH` global shell Anda. Jalankan melalui profile tersebut:

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

Untuk menjalankan sekali dari checkout atau registry, gunakan salah satu perintah berikut:

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## Penggunaan

Contoh di bawah menggunakan `harbor` sebagai singkatan untuk salah satu cara menjalankan di atas.

```bash
harbor scan                 # inventaris, konflik, dan perubahan sejak pemindaian terakhir
harbor scan --check-updates # + pemeriksaan upstream opsional terhadap registry (menggunakan jaringan)
harbor manifest ./my-plugin # buat draf blok dsh.capabilities untuk plugin Anda sendiri
```

Tambahkan `--evidence` untuk menampilkan bukti sumber `file:line` yang tersedia, `--json` untuk laporan lengkap yang dapat dibaca mesin, dan `--no-snapshot` untuk tidak menulis acuan diff. Fakta yang berasal dari manifest, sistem berkas, atau runtime mungkin tidak memiliki baris sumber dan akan diberi label yang sesuai.

Pemindai ini tidak memiliki dependensi dan tidak memerlukan DSH terpasang, sehingga juga dapat dijalankan di CI.

## Untuk pembuat plugin

`harbor manifest` membaca plugin Anda dengan cara yang sama seperti saat membaca plugin lainnya, lalu membuat draf anggota `capabilities` untuk digabungkan ke objek `dsh` yang sudah ada di `package.json`; perintah ini tidak pernah meminta Anda mengganti seluruh objek tersebut hingga kehilangan konfigurasi `bundle` atau `client`. Setelah dideklarasikan, pemeriksaan harbor menjadi **dideklarasikan vs terdeteksi**: kemampuan yang dideklarasikan tetapi tidak pernah digunakan merupakan derau yang dapat Anda buang, sedangkan kemampuan yang terdeteksi tetapi belum dideklarasikan adalah hal yang perlu dijelaskan. harbor juga mendeklarasikan `dsh.capabilities` miliknya sendiri, sehingga alur ini dapat diuji pada perkakas itu sendiri: jalankan `harbor manifest .` di repositori ini.

Konvensi tersebut didokumentasikan di [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). Singkatnya, `dsh.capabilities` adalah daftar biasa di `package.json` yang menyatakan apa yang benar-benar dilakukan oleh kode plugin Anda. Mendeklarasikannya mudah dan memberi dua manfaat: perkakas audit seperti harbor dapat mencocokkan pernyataan Anda dengan kode, dan orang yang menjalankan plugin Anda dapat melihat bahwa tidak ada yang disembunyikan. Periksa sendiri deklarasi Anda kapan saja dengan `harbor manifest <dir>`.

## Batasan, secara terus terang

harbor membaca sumber setiap plugin, menjadikannya entitas dengan hak akses tertinggi di lingkungan ini. harbor juga muncul di laporannya sendiri.

Setelah pemeriksaan upstream diaktifkan, harbor sendiri memiliki kemampuan lalu lintas jaringan keluar, dan deklarasi `dsh.capabilities` miliknya sudah mencantumkan hal tersebut.

## Lisensi

MIT
