const path = require('path');

// Set environment variables for Expo web execution to avoid launching browser automatically
process.env.BROWSER = 'none';
process.env.EXPO_NO_BROWSER = 'true';

// Inject CLI arguments expected by Expo CLI: node start-web-server.js start --web
if (!process.argv.includes('start')) {
  process.argv.push('start');
}
if (!process.argv.includes('--web')) {
  process.argv.push('--web');
}

// Require the Expo CLI directly to execute it in the same Node.js process.
const cliPath = path.resolve(__dirname, '../node_modules/expo/bin/cli');

console.log('[Runner] Starting Expo web development server...');
try {
  require(cliPath);
} catch (error) {
  console.error('❌ Failed to load Expo CLI:', error);
  process.exit(1);
}
