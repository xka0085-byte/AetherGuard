module.exports = {
  apps: [{
    name: 'aetherguard-bot',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};