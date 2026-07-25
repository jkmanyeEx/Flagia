const path = require('node:path');

// In production this file is loaded through /home/ubuntu/Flagia/current.
// Keeping paths relative makes the same configuration usable in a release
// directory and lets the deploy script switch releases atomically.
const appRoot = process.env.FLAGIA_ROOT || __dirname;

module.exports = {
  apps: [
    {
      name: 'flagia-frontend',
      script: 'serve',
      cwd: appRoot,
      interpreter: '/usr/local/bin/node',
      env: {
        PM2_SERVE_PATH: path.join(appRoot, 'flagia-frontend', 'dist'),
        PM2_SERVE_PORT: 5173,
        PM2_SERVE_HOST: '127.0.0.1',
        PM2_SERVE_SPA: 'true',
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_memory_restart: '150M',
    },
    {
      name: 'flagia-backend',
      script: 'dist/index.js',
      cwd: path.join(appRoot, 'flagia-backend'),
      interpreter: '/usr/local/bin/node',
      node_args: ['--env-file=/home/ubuntu/Flagia/shared/.env'],
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
      },
    },
  ],
};
