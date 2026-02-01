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
      WEBPUSH_VAPID_PUBLIC: 'BBzMaGbGyr4AK4615dq8Zs3DlaGuUaLG8Eb3uki1RkiB7OgPAowYVLy1NNf9dT55qkkT5hNGpAKbEQjbFK82NMw',
      WEBPUSH_VAPID_PRIVATE: 'LvLeud9iAgLtPFb1eSTJZQEXOQPahWA4mpweDnLDwCM',
      WEBPUSH_VAPID_SUBJECT: 'mailto:admin@tspcc.ru',
      FCM_SERVER_KEY: 'BM3rAWNj0m6Y73hvtcSENR-Qe99CK2IjsmhSQ8FMWwZ5mdjrWBw3SWU1zewT_iLUQUmwtaDHsc-JlSp5kQ34QNM',
      FCM_SERVICE_ACCOUNT_PATH: '/var/www/tspcc.ru/fcm-service-account.json',
      FCM_PROJECT_ID: 'tspc-chat'
    }
  }]
};
