module.exports = {
  apps: [{
    name: 'batalla-naval-online',
    script: 'npm',
    args: 'start -- -p 3970',
    cwd: '/home/gelt/apps/batalla-naval-online',
    env: {
      NODE_ENV: 'production',
      PORT: 3970,
    },
  }],
}
