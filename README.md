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
| `DEPLOY_DIR` | Folder **checkout repo** di VM (opsional, default `~/wagagent`) |

> Buat repo di Docker Hub bernama `wagagent` (boleh private). Image akan jadi `docker.io/<username>/wagagent`.

### 3b. Persiapan di VM (sekali saja)

Install Docker + Compose plugin, lalu **clone repo** ini di VM (dipakai sebagai folder deploy):

```bash
git clone git@github.com:USERNAME/wagagent.git ~/wagagent
cd ~/wagagent
cp .env.example .env
nano .env
```

Di `.env`, untuk **mode PULL** (CI/CD), isi `WAGAGENT_IMAGE` + konfigurasi LLM:

```env
WAGAGENT_IMAGE=docker.io/USERNAME/wagagent:latest
LLM_PROVIDER=openai
LLM_BASE_URL=http://9router:20128/v1
LLM_MODEL=kr/claude-sonnet-4.5
LLM_API_KEY=<key dari dashboard 9Router>
NINEROUTER_PASSWORD=<password dashboard pilihan Anda>
TZ=Asia/Jakarta
```

> Deploy memakai **satu `docker-compose.yml`** yang sama. Karena `WAGAGENT_IMAGE` diisi, Compose menarik image dari Docker Hub (tidak build). Kalau mau build langsung di VM, kosongkan `WAGAGENT_IMAGE` dan jalankan `docker compose up -d --build`.

### 3c. Scan QR pertama di VM

Setelah container jalan pertama kali:

```bash
cd ~/wagagent
docker compose logs -f wagagent   # QR muncul di log → scan
```

Sesi tersimpan di `~/wagagent/data/auth` dan bertahan di deploy berikutnya (folder `data` tidak ter-overwrite).

### 3d. Push = deploy

```bash
git add .
git commit -m "update"
git push origin main
```

GitHub Actions: build image → push ke Docker Hub → SSH ke VM → `git pull` + `docker compose pull` + `up -d`. Set secret `DEPLOY_DIR=~/wagagent` (atau path clone Anda). 🎉

---

## Ganti LLM: Claude ↔ Qwen lokal (atau model lain)

WagAgent punya lapisan provider, jadi mesin ringkasnya bisa diganti **tanpa ubah kode** — cukup env.

| `LLM_PROVIDER` | Dipakai untuk | Env yang diisi |
|---|---|---|
| `anthropic` | Claude (default) | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| `openai` | Qwen lokal, **9Router**, atau endpoint apa pun yang kompatibel OpenAI (`/v1/chat/completions`) | `LLM_BASE_URL`, `LLM_MODEL`, (opsional) `LLM_API_KEY`, `LLM_MAX_INPUT_CHARS` |

### Contoh: 9Router (gateway self-hosted, satu compose)

[9Router](https://9router.com/) adalah gateway kompatibel-OpenAI yang merutekan ke banyak provider. Image `decolua/9router` **sudah dimasukkan sebagai service di compose**, jadi cukup satu `docker compose up` untuk menjalankan WagAgent + 9Router bersama di **satu VM**. WagAgent memanggilnya lewat **nama service**:

```env
LLM_PROVIDER=openai
LLM_BASE_URL=http://9router:20128/v1       # nama service di network compose
LLM_MODEL=kr/claude-sonnet-4.5             # alias/combo model dari dashboard 9Router
LLM_API_KEY=<key dari dashboard 9Router>
```

**Setup dashboard 9Router** (untuk daftarkan provider & buat API key):
- Dashboard di-bind ke `127.0.0.1:20128` (tidak diekspos publik). Akses dari laptop via SSH tunnel:
  ```bash
  ssh -L 20128:localhost:20128 user@IP_VM
  # lalu buka http://localhost:20128 di browser laptop
  ```
- Di dashboard: tambahkan provider (OAuth/API key), buat **API key** → pakai nilainya di `LLM_API_KEY`, dan catat **model id** → pakai di `LLM_MODEL`.
- Data 9Router persisten di `./9router-data` (folder repo).

Varian lain:
- **9Router di VM terpisah** → `LLM_BASE_URL=http://IP_9ROUTER:20128/v1` (hapus service `9router` dari compose, buka port 20128 di firewall VM itu).
- Override image: set `NINEROUTER_IMAGE` di `.env`.
- Cek endpoint/model aktif kapan saja via `!status`.

### Contoh: Qwen 1.7B di VM lain

Serve Qwen pakai salah satu server berikut **di VM model**, pastikan bind ke `0.0.0.0` (bukan `127.0.0.1`) agar bisa diakses dari VM WagAgent:

```bash
# Opsi A — vLLM (OpenAI-compatible server bawaan)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-1.7B --host 0.0.0.0 --port 8000
# -> LLM_BASE_URL=http://IP_VM_MODEL:8000/v1   LLM_MODEL=Qwen/Qwen3-1.7B

# Opsi B — Ollama (set OLLAMA_HOST=0.0.0.0 agar listen ke jaringan)
ollama pull qwen3:1.7b
# -> LLM_BASE_URL=http://IP_VM_MODEL:11434/v1  LLM_MODEL=qwen3:1.7b
```

Lalu di `.env` WagAgent:

```env
LLM_PROVIDER=openai
LLM_BASE_URL=http://IP_VM_MODEL:8000/v1
LLM_MODEL=Qwen/Qwen3-1.7B
LLM_API_KEY=                 # kosongkan bila server tak minta key
LLM_MAX_INPUT_CHARS=12000    # penting: Qwen 1.7B context kecil, potong transkrip panjang
```

Cek provider aktif lewat perintah `!status` (menampilkan model & endpoint).

> **Catatan jaringan:** WagAgent hanya melakukan koneksi **keluar** ke VM model, jadi cukup pastikan port model (mis. 8000/11434) terbuka di firewall/security group VM model dan server-nya listen di `0.0.0.0`. Tidak perlu network Docker khusus antar-VM.
>
> **Catatan kualitas:** Qwen 1.7B jauh lebih kecil dari Claude — kualitas ringkasan lebih sederhana dan context window kecil (±32K token). Untuk grup ramai, set `LLM_MAX_INPUT_CHARS` agar transkrip panjang otomatis dipangkas (ambil pesan terbaru). Anda bisa mulai dengan Claude lalu pindah ke Qwen kapan saja hanya dengan mengganti env + restart container.

## Isolasi (tidak bentrok dengan stack lain di VM)

WagAgent dirancang berdiri sendiri dan aman dijalankan berdampingan dengan container/compose lain:

- **Nama project di-pin** (`name: wagagent`) → network & resource selalu di-namespace `wagagent_...`, berapapun nama folder deploy.
- **Network khusus** (`wagagent_wagagent`, driver bridge) → tidak ikut network `default` milik stack lain.
- **Tidak publish port apa pun** → aplikasi hanya koneksi keluar (WhatsApp Web + Claude API), jadi mustahil bentrok port dengan service lain.
- **Volume bind-mount lokal** (`./data`) → data tersimpan di folder deploy, tidak memakai named-volume global yang bisa tertukar.
- **Satu service, `container_name: wagagent`** → pastikan tidak ada container lain di VM yang sudah memakai nama ini (nama container bersifat global di Docker).

Cek isolasi setelah jalan:

```bash
docker compose -p wagagent ps          # hanya container wagagent
docker network ls | grep wagagent      # network wagagent_wagagent
docker inspect wagagent --format '{{json .NetworkSettings.Networks}}'
```

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
    summarizer.ts       # bangun prompt + potong transkrip
    llmClient.ts        # pilih provider: Claude / OpenAI-compatible (9Router, Qwen, dll)
    scheduler.ts        # cron ringkasan harian
.github/workflows/ci-cd.yml   # build → Docker Hub → deploy VM
Dockerfile                    # multi-stage build
docker-compose.yml            # SATU compose: build (--build) atau pull (WAGAGENT_IMAGE)
.env.example                  # template konfigurasi (salin ke .env)
```

## Troubleshooting

- **QR tidak muncul / "logout":** hapus folder `data/auth` lalu restart untuk scan ulang.
- **Ringkasan "⚠️ Gagal (error LLM)":** cek provider aktif via `!status`; untuk 9Router/OpenAI cek `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` & `docker compose logs -f wagagent`; untuk Claude cek `ANTHROPIC_API_KEY`.
- **Perintah tak direspon:** pastikan dikirim dari akun yang discan, atau daftarkan nomor di `OWNER_JIDS`.
- **Nomor sering disconnect:** jangan kirim pesan massal; gunakan nomor sekunder.
