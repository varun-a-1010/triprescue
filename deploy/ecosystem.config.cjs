// pm2 process definition for the motif box. `pm2 startOrRestart deploy/ecosystem.config.cjs`
// is idempotent (cold-start safe). Runtime env comes from /var/www/triprescue/.env.local
// (chmod 600), which Next.js loads at start; nothing secret lives in this file.
module.exports = {
  apps: [
    {
      name: "triprescue",
      cwd: "/var/www/triprescue",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3040 -H 127.0.0.1",
      env: { NODE_ENV: "production" },
      max_memory_restart: "600M",
      time: true,
      autorestart: true,
    },
  ],
};
