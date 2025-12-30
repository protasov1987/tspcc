#!/bin/bash
set -e

cd /var/www/tspcc.ru

echo ">>> Pull from GitHub"
git pull origin main

echo ">>> Install dependencies"
npm install --production

echo ">>> Restart pm2"
pm2 restart tspcc

echo ">>> Done!"
