module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Custom inline babel plugin to replace process.env.ENABLE_CORE_DEBUG_LOGS
      function inlineEnvVars() {
        return {
          visitor: {
            MemberExpression(path) {
              if (
                path.matchesPattern('process.env.ENABLE_CORE_DEBUG_LOGS')
              ) {
                const val = process.env.ENABLE_CORE_DEBUG_LOGS === 'true' ? 'true' : 'false';
                path.replaceWith({ type: 'StringLiteral', value: val });
              }
            },
          },
        };
      },
    ],
  };
};
