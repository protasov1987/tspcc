#!/bin/bash
set -e

APP_DIR="/var/www/tspcc.ru"
APP_NAME="tspcc"

cd "$APP_DIR"

echo ">>> Pull from GitHub"
git pull origin main

echo ">>> Install dependencies (production only)"
npm install --omit-dev

echo ">>> Restart pm2 with updated env"
pm2 restart "$APP_NAME" --update-env

echo ">>> Done!"
