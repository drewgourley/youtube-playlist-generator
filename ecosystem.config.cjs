// PM2 process definition. All configuration and secrets live in `.env`
// (loaded by the server via dotenv). Set up `.env` on the Pi before starting.
// Uses .cjs because package.json sets "type": "module".
module.exports = {
  apps: [
    {
      name: 'YouTube Playlist Generator',
      script: 'server/index.js',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '300M',
    },
  ],
};
