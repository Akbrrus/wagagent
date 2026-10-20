# ---------- Stage 1: build ----------
FROM node:20-slim AS build
WORKDIR /app

# Install semua dependency (termasuk dev) untuk kompilasi TypeScript.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Hanya dependency produksi.
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force

# Hasil build.
COPY --from=build /app/dist ./dist

# Folder data (auth WhatsApp, settings, buffer pesan) dipetakan ke volume.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV DATA_DIR=/app/data

CMD ["node", "dist/index.js"]
