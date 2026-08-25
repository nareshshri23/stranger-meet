module.exports = {
  apps: [
    {
      name: 'aparichat-backend',
      script: 'server.js',
      // Cluster mode: scales automatically to all available CPU cores or WEB_CONCURRENCY
      instances: process.env.WEB_CONCURRENCY || 'max',
      exec_mode: 'cluster',
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
