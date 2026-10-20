# ---------- Stage 1: build ----------
FROM node:20-slim AS build
WORKDIR /app

# Baileys menarik dependency "libsignal" dari GitHub (butuh git) dan sebagian
# modul native perlu toolchain. Semua ini HANYA diperlukan saat build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install semua dependency (termasuk dev) untuk kompilasi TypeScript.
COPY package.json package-lock.json* ./
RUN npm install

# Build TypeScript -> dist.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Buang devDependencies, sisakan dependency produksi (modul native tetap terpasang).
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Salin node_modules (prod-only) + hasil build dari stage build.
# Tidak perlu git/compiler di runtime.
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Folder data (auth WhatsApp, settings, buffer pesan) dipetakan ke volume.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV DATA_DIR=/app/data

CMD ["node", "dist/index.js"]
