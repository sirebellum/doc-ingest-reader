const fs = require('fs');
const { spawnSync } = require('child_process');

console.log('[Runner] Clearing .expo/web/cache...');
fs.rmSync('.expo/web/cache', { recursive: true, force: true });

console.log('[Runner] Setting environment variables...');
process.env.EXPO_PROJECT_ROOT = __dirname;
process.env.EXPO_ROUTER_APP_ROOT = 'app';

console.log('[Runner] Triggering npx expo export:web...');
const res = spawnSync('npx', ['expo', 'export:web'], { stdio: 'inherit', shell: true });

process.exit(res.status);
