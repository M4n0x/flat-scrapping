const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');
const env = {};
try {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
} catch {}

module.exports = {
  apps: [{
    name: 'apartment-search-web',
    script: 'scripts/serve-dashboard.mjs',
    cwd: __dirname,
    env
  }]
};
