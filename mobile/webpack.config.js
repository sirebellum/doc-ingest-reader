const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const path = require('path');
const webpack = require('webpack');

// Set the Expo Router app root environment variable before Webpack starts
// to prevent resolve-from crashes inside Windows Node/Babel compiler environments
process.env.EXPO_ROUTER_APP_ROOT = path.resolve(__dirname, 'app');
process.env.EXPO_PROJECT_ROOT = __dirname;
process.env.BROWSER = 'none';
process.env.EXPO_NO_BROWSER = 'true';

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  
  if (!config.resolve) {
    config.resolve = {};
  }
  if (!config.resolve.fallback) {
    config.resolve.fallback = {};
  }
  
  // Map native 'crypto' to false to prevent bundling failures and let
  // expo-modules-core safely resolve to browser native window.crypto
  config.resolve.fallback.crypto = false;
  config.resolve.fallback.stream = false;
  config.resolve.fallback.buffer = false;
  config.resolve.fallback.vm = false;
  
  if (!config.resolve.alias) {
    config.resolve.alias = {};
  }

  if (!config.plugins) {
    config.plugins = [];
  }
  // Ensure IgnorePlugin accounts for Windows/Mac path separators
  config.plugins.push(new webpack.IgnorePlugin({ 
    resourceRegExp: /[\\/]__tests__[\\/]/ 
  }));
  config.plugins.push(new webpack.IgnorePlugin({ 
    resourceRegExp: /[\\/]__mocks__[\\/]/ 
  }));

  // Inject process.env.ENABLE_CORE_DEBUG_LOGS
  const enableCoreDebugLogs = process.env.ENABLE_CORE_DEBUG_LOGS === 'true';
  config.plugins.push(
    new webpack.DefinePlugin({
      'process.env.ENABLE_CORE_DEBUG_LOGS': JSON.stringify(enableCoreDebugLogs ? 'true' : 'false'),
    })
  );

  // Also exclude these folders from Babel loader processing
  if (config.module && config.module.rules) {
    config.module.rules.forEach(rule => {
      if (rule.oneOf) {
        rule.oneOf.forEach(oneOfRule => {
          if (oneOfRule.use && oneOfRule.use.loader && oneOfRule.use.loader.includes('babel-loader')) {
            oneOfRule.exclude = [
              /[\\/]__tests__[\\/]/,
              /[\\/]__mocks__[\\/]/,
              ...(Array.isArray(oneOfRule.exclude) ? oneOfRule.exclude : [oneOfRule.exclude].filter(Boolean))
            ];
          }
        });
      }
    });
  }

  const wrapperPath = path.resolve(__dirname, 'react-native-web-wrapper.js');
  config.resolve.alias['react-native'] = wrapperPath;
  config.resolve.alias['react-native$'] = wrapperPath;
  config.resolve.alias['react-native-web$'] = wrapperPath;
  config.resolve.alias['react-native-web/dist/index$'] = wrapperPath;
  
  return config;
};
