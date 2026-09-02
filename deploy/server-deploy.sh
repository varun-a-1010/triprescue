#!/usr/bin/env bash
# Server-side deploy step, run over SSH by .github/workflows/deploy.yml as the
# `deploy` user on the motif box. Pull → install → build → restart-or-start.
set -euo pipefail
APP_DIR=/var/www/triprescue
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
cd "$APP_DIR"
git fetch --quiet origin
git reset --quiet --hard origin/main
test -f .env.local || { echo "::error::$APP_DIR/.env.local missing (DUFFEL_ACCESS_TOKEN, SESSION_SECRET, TRIPRESCUE_PROVIDER)"; exit 1; }
grep -q '^DUFFEL_ACCESS_TOKEN=duffel_test_' .env.local || { echo "::error::.env.local must hold a duffel_test_ token"; exit 1; }
npm ci --no-audit --no-fund
npm run build
pm2 startOrRestart deploy/ecosystem.config.cjs --update-env
pm2 save
echo "deployed $(git rev-parse --short HEAD)"
