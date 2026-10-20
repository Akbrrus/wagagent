# WagAgent 🤖

Agent WhatsApp yang **membaca semua grup** dan mengirim **ringkasan otomatis** pada jam tertentu, memakai [Baileys](https://github.com/WhiskeySockets/Baileys) (Node.js) + **Claude Haiku** untuk meringkas. Bisa dikontrol lewat perintah berawalan `!`.

> ⚠️ **Catatan penting:** Baileys adalah library tidak resmi (WhatsApp Web). Gunakan pada nomor yang Anda kontrol dan patuhi ToS WhatsApp — ada risiko nomor dibatasi jika dipakai berlebihan. Disarankan pakai nomor khusus/sekunder.

## Fitur

- Memantau & menyimpan pesan dari semua grup (buffer dengan retensi otomatis).
- Ringkasan harian otomatis pada jam yang bisa diatur (per timezone).
- Ringkasan on-demand lewat perintah `!summary`.
- Dikontrol penuh lewat perintah `!` dari chat Anda sendiri.
- Berjalan di Docker, deploy otomatis via GitHub Actions → Docker Hub → VM.

## Arsitektur singkat

```
WhatsApp  ──(Baileys)──►  WagAgent (Node/TS)  ──(pesan)──►  buffer (data/messages.json)
                                │
                     jam terjadwal / perintah !summary
                                │
                                ▼
                        Claude Haiku (ringkas)
                                │
                                ▼
                   kirim ringkasan ke chat target
```

---

## 1. Menjalankan lokal (untuk tes & scan QR pertama kali)

Butuh Node.js 20+.

```bash
cp .env.example .env
#  edit .env → isi ANTHROPIC_API_KEY (wajib)

npm install
npm run dev
```

QR code akan muncul di terminal. Buka WhatsApp → **Perangkat Tertaut (Linked Devices)** → **Tautkan Perangkat** → scan QR. Sesi tersimpan di folder `data/auth` sehingga tidak perlu scan ulang saat restart.

### Perintah yang tersedia

Kirim dari chat Anda (akun yang discan selalu diizinkan; nomor lain harus didaftarkan di `OWNER_JIDS`):

| Perintah | Fungsi |
|---|---|
| `!help` | Tampilkan bantuan |
| `!summary` | Ringkas **grup ini** (24 jam terakhir) — jalankan di dalam grup |
| `!summary all` | Ringkas **semua grup** sekarang, kirim ke target |
| `!status` | Lihat pengaturan saat ini |
| `!settime HH:MM` | Set jam ringkasan harian (mis. `!settime 21:00`) |
| `!settz Asia/Jakarta` | Set timezone |
| `!setlang id` / `!setlang en` | Bahasa ringkasan |
| `!on` / `!off` | Aktif/matikan ringkasan otomatis |
| `!settarget` | Jadikan chat ini sebagai tujuan ringkasan (default: chat pribadi Anda) |
| `!allgroups` | Tampilkan **semua grup + ID-nya** untuk di-copy |
| `!whitelist <id> [id...]` | **Hanya** ringkas grup dengan ID tsb (aktifkan mode whitelist). Bisa dari chat mana saja. |
| `!unwhitelist <id> [id...]` | Keluarkan grup dari whitelist |
| `!watchall` | Kembali ringkas semua grup (mode default) |
| `!exclude` / `!include` | (mode `all`) Kecualikan / ikutkan grup ini |
| `!groups` | Daftar grup yang punya aktivitas tersimpan |

> **Dua konsep terpisah:**
> - **Di mana ringkasan dikirim** → `!settarget`. Mau ringkasan muncul di satu grup khusus? Buka grup itu, ketik `!settarget`. Default-nya chat ke diri sendiri (Pesan ke diri sendiri).
> - **Grup mana yang diringkas** → daftarkan via ID: ketik `!allgroups` untuk melihat ID semua grup, lalu `!whitelist <id1> <id2> ...` (bisa dari chat mana saja, tanpa masuk grup). Atau pakai mode `all` + `!exclude`. Cek mode aktif lewat `!status`.

---

## 2. Menjalankan dengan Docker Compose (lokal)

```bash
cp .env.example .env   # isi ANTHROPIC_API_KEY
docker compose up -d --build
docker compose logs -f   # lihat QR di sini untuk scan pertama kali
```

Folder `./data` di-mount ke container, jadi sesi WhatsApp & pengaturan tetap aman saat container di-restart.

---

## 3. CI/CD: GitHub → Docker Hub → VM

Alurnya: **push ke `main`** → GitHub Actions build image & push ke Docker Hub → SSH ke VM → `docker compose pull` + `up -d`.

### 3a. Secrets di GitHub repo

`Settings → Secrets and variables → Actions → New repository secret`:

| Secret | Isi |
|---|---|
| `DOCKERHUB_USERNAME` | Username Docker Hub |
| `DOCKERHUB_TOKEN` | Access token Docker Hub (`Account Settings → Security`) |
| `VM_HOST` | IP/hostname VM |
| `VM_USER` | User SSH di VM (mis. `ubuntu`) |
| `VM_SSH_KEY` | **Private key** SSH (isi file key, bukan path) |
| `VM_PORT` | Port SSH (opsional, default `22`) |
| `DEPLOY_DIR` | Folder deploy di VM (opsional, default `/opt/wagagent`) |

> Buat repo di Docker Hub bernama `wagagent` (boleh private). Image akan jadi `docker.io/<username>/wagagent`.

### 3b. Persiapan di VM (sekali saja)

Install Docker + Compose plugin, lalu siapkan folder deploy:

```bash
sudo mkdir -p /opt/wagagent/data
cd /opt/wagagent

# Salin file compose produksi + env (dari folder deploy/ repo ini).
# docker-compose.yml → /opt/wagagent/docker-compose.yml
# deploy/.env.example → /opt/wagagent/.env  (lalu edit)
```

Isi `/opt/wagagent/.env`:

```env
WAGAGENT_IMAGE=docker.io/USERNAME/wagagent:latest
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-5-5
TZ=Asia/Jakarta
# ... (lihat deploy/.env.example)
```

Pastikan user VM bisa `docker login` (image private) — GitHub Action sudah melakukan login otomatis saat deploy.

### 3c. Scan QR pertama di VM

Karena WhatsApp butuh scan QR, setelah container jalan pertama kali:

```bash
cd /opt/wagagent
docker compose logs -f wagagent   # QR muncul di log → scan
```

Setelah tertaut, sesi tersimpan di `/opt/wagagent/data/auth` dan bertahan di deploy berikutnya (folder `data` tidak ikut ter-overwrite).

### 3d. Push = deploy

```bash
git add .
git commit -m "update"
git push origin main
```

GitHub Actions akan build, push, dan deploy otomatis ke VM. 🎉

---

## Struktur project

```
src/
  index.ts              # bootstrap
  config.ts             # env + default settings
  logger.ts
  whatsapp/
    client.ts           # koneksi Baileys, tangkap pesan, orkestrasi ringkasan
    commands.ts         # handler perintah "!"
  store/
    settings.ts         # pengaturan runtime (JSON persisten)
    messageStore.ts     # buffer pesan per grup (JSON persisten)
  summary/
    summarizer.ts       # panggilan Claude Haiku
    scheduler.ts        # cron ringkasan harian
.github/workflows/ci-cd.yml   # build → Docker Hub → deploy VM
Dockerfile                    # multi-stage build
docker-compose.yml            # build lokal
deploy/                       # compose + env + script untuk VM
```

## Troubleshooting

- **QR tidak muncul / "logout":** hapus folder `data/auth` lalu restart untuk scan ulang.
- **`cache_read` nol / ringkasan error auth:** cek `ANTHROPIC_API_KEY`.
- **Perintah tak direspon:** pastikan dikirim dari akun yang discan, atau daftarkan nomor di `OWNER_JIDS`.
- **Nomor sering disconnect:** jangan kirim pesan massal; gunakan nomor sekunder.
