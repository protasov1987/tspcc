#!/bin/bash
# filepath: c:\GH\tspcc_31_01_26\tspcc.ru\setup-webpush.sh

set -e

echo "=== TSPCC WebPush Setup Script ==="
echo ""

# 1. Проверка PM2
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 не установлен. Установите: npm install -g pm2"
    exit 1
fi

# 2. Проверка, запущен ли процесс tspcc
if ! pm2 list | grep -q "tspcc"; then
    echo "⚠️  Процесс 'tspcc' не найден в PM2"
    echo "Запустите приложение сначала: pm2 start ecosystem.config.js"
    exit 1
fi

# 3. Проверка текущих VAPID-ключей в окружении PM2
echo "🔍 Проверяю текущие VAPID-ключи..."
CURRENT_PUBLIC=$(pm2 env 0 | grep WEBPUSH_VAPID_PUBLIC | cut -d'=' -f2 || echo "")
CURRENT_PRIVATE=$(pm2 env 0 | grep WEBPUSH_VAPID_PRIVATE | cut -d'=' -f2 || echo "")
CURRENT_SUBJECT=$(pm2 env 0 | grep WEBPUSH_VAPID_SUBJECT | cut -d'=' -f2 || echo "")

if [ -n "$CURRENT_PUBLIC" ] && [ -n "$CURRENT_PRIVATE" ] && [ -n "$CURRENT_SUBJECT" ]; then
    echo "✅ VAPID-ключи уже настроены в PM2:"
    echo "   PUBLIC: ${CURRENT_PUBLIC:0:20}..."
    echo "   PRIVATE: ${CURRENT_PRIVATE:0:20}..."
    echo "   SUBJECT: $CURRENT_SUBJECT"
    echo ""
    read -p "Перегенерировать ключи? (y/N): " REGENERATE
    if [[ ! "$REGENERATE" =~ ^[Yy]$ ]]; then
        echo "✅ Используем существующие ключи. Настройка завершена."
        exit 0
    fi
fi

# 4. Генерация новых VAPID-ключей
echo "🔑 Генерирую новые VAPID-ключи..."

if ! command -v npx &> /dev/null; then
    echo "❌ npx не найден. Проверьте установку Node.js."
    exit 1
fi

VAPID_JSON=$(npx web-push generate-vapid-keys --json 2>/dev/null || echo "")

if [ -z "$VAPID_JSON" ]; then
    echo "❌ Не удалось сгенерировать VAPID-ключи"
    echo "Попробуйте вручную: npx web-push generate-vapid-keys"
    exit 1
fi

# Извлекаем ключи из JSON
NEW_PUBLIC=$(echo "$VAPID_JSON" | grep -oP '"publicKey":\s*"\K[^"]+')
NEW_PRIVATE=$(echo "$VAPID_JSON" | grep -oP '"privateKey":\s*"\K[^"]+')
NEW_SUBJECT="mailto:admin@tspcc.ru"

if [ -z "$NEW_PUBLIC" ] || [ -z "$NEW_PRIVATE" ]; then
    echo "❌ Ошибка парсинга VAPID-ключей"
    exit 1
fi

echo "✅ Ключи сгенерированы:"
echo "   PUBLIC: ${NEW_PUBLIC:0:30}..."
echo "   PRIVATE: ${NEW_PRIVATE:0:30}..."
echo "   SUBJECT: $NEW_SUBJECT"
echo ""

# 5. Создание/обновление ecosystem.config.js
echo "📝 Обновляю ecosystem.config.js..."

cat > ecosystem.config.js <<EOF
module.exports = {
  apps: [{
    name: 'tspcc',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      WEBPUSH_VAPID_PUBLIC: '${NEW_PUBLIC}',
      WEBPUSH_VAPID_PRIVATE: '${NEW_PRIVATE}',
      WEBPUSH_VAPID_SUBJECT: '${NEW_SUBJECT}'
    }
  }]
};
EOF

echo "✅ ecosystem.config.js обновлён"
echo ""

# 6. Перезапуск PM2 с новыми переменными
echo "🔄 Перезапускаю приложение с новыми VAPID-ключами..."
pm2 delete tspcc 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "✅ WebPush настроен!"
echo ""

# 7. Проверка применения переменных
echo "🔍 Проверяю переменные в PM2..."
sleep 2

CHECK_PUBLIC=$(pm2 env 0 | grep WEBPUSH_VAPID_PUBLIC | cut -d'=' -f2 || echo "")

if [ -n "$CHECK_PUBLIC" ]; then
    echo "✅ Переменные окружения применены:"
    pm2 env 0 | grep WEBPUSH
else
    echo "⚠️  Переменные не видны в PM2. Проверьте вручную: pm2 env 0"
fi

echo ""
echo "📋 Полезные команды:"
echo "   pm2 logs tspcc          - просмотр логов"
echo "   pm2 restart tspcc       - перезапуск"
echo "   pm2 env 0               - проверка переменных окружения"
echo ""

# 8. Проверка в логах
echo "🔔 Проверяю логи на наличие WebPush..."
sleep 3

if pm2 logs tspcc --lines 100 --nostream 2>/dev/null | grep -qi "webpush"; then
    echo "✅ WebPush упоминается в логах (вероятно, настроен корректно)"
else
    echo "⚠️  WebPush не найден в логах. Проверьте вручную:"
    echo "   pm2 logs tspcc --lines 50"
fi

echo ""
echo "=== Настройка WebPush завершена ==="
echo ""
echo "⚠️  ВАЖНО: сохраните VAPID-ключи в безопасном месте!"
echo "   Они записаны в ecosystem.config.js"
echo ""
