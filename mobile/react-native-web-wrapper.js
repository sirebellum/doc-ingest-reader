export * from 'react-native-web/dist/index.js';
import * as RNWeb from 'react-native-web/dist/index.js';

export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: () => null,
};

const defaultExport = {
  ...RNWeb,
  TurboModuleRegistry,
};

export default defaultExport;
