#!/usr/bin/env bash
# Dijalankan DI VM untuk pull image terbaru lalu restart container.
# Dipakai oleh GitHub Actions (via SSH) maupun manual.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/wagagent}"
cd "$DEPLOY_DIR"

echo "==> Login Docker Hub (opsional, untuk image private)"
if [[ -n "${DOCKERHUB_USERNAME:-}" && -n "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
fi

echo "==> Pull image terbaru"
docker compose pull

echo "==> Restart container"
docker compose up -d

echo "==> Bersihkan image lama"
docker image prune -f

echo "==> Selesai. Status:"
docker compose ps
