module.exports = {
  apps: [
    {
      name: 'aparichat-backend',
      script: 'server.js',
      // Shared Redis state is required before multiple workers can match users safely.
      instances: process.env.REDIS_URL ? (process.env.WEB_CONCURRENCY || 'max') : 1,
      exec_mode: process.env.REDIS_URL ? 'cluster' : 'fork',
      watch: false,
      // Memory safety limit: automatically recycles workers if RAM exceeds 450MB
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      }
    }
  ]
};
