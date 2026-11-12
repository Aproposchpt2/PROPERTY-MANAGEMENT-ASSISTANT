#!/usr/bin/env bash
# Builds the PMA web app (mobile/, Expo web export) into ./app, served at pma.stellaruc.com/app.
# Run by Netlify on every deploy (netlify.toml [build] command). Public EXPO_PUBLIC_* values come
# from netlify.toml [build.environment]; never add secrets there.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf app
(cd mobile && npm ci --no-audit --no-fund && EXPO_OFFLINE=1 CI=1 npx expo export --platform web --output-dir ../app)
test -f app/index.html
echo "PMA web app built into ./app"
