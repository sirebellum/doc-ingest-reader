import { requireNativeModule } from 'expo-modules-core';

let NativeModule;
try {
  NativeModule = requireNativeModule('RustParserBridgeModule');
} catch (e) {
  console.warn('[rust-parser-bridge] Failed to load native module RustParserBridgeModule. Running with fallbacks.');
}

export default NativeModule;
