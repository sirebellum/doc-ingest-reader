const { withXcodeProject, withAppBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to prepare target workspace static library bindings and platform search paths
 * for statically linking llama.cpp (libllama.a) into the compiled JSI host binary on iOS and Android.
 */
function withNativeLibraries(config, props = {}) {
  // 1. iOS Xcode Config: Inject search paths for libllama.a static library
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const target = xcodeProject.getFirstTarget().uuid;
    
    // Inject the path to our rust_core static libs directory into Xcode LIBRARY_SEARCH_PATHS
    const libSearchPath = '"$(SRCROOT)/../../rust_core/libs/aarch64-apple-ios"';
    
    xcodeProject.addToBuildSettings('LIBRARY_SEARCH_PATHS', libSearchPath, 'Release', target);
    xcodeProject.addToBuildSettings('LIBRARY_SEARCH_PATHS', libSearchPath, 'Debug', target);
    
    console.log('[withNativeLibraries] Injected iOS static library search path:', libSearchPath);
    return config;
  });

  // 2. Android Config: Update Gradle build properties to include static JNI search targets
  config = withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;
    
    // Inject static libllama linkage instructions inside android configuration blocks
    if (!buildGradle.includes('rust_core/libs')) {
      const searchBlock = `
android {
    // Injected by withNativeLibraries Expo Config Plugin for Phase 9 Static Linkage
    sourceSets {
        main {
            jniLibs.srcDirs += [path.join(project.rootDir, '../../rust_core/libs/aarch64-linux-android')]
        }
    }
}
      `;
      config.modResults.contents = buildGradle + searchBlock;
      console.log('[withNativeLibraries] Injected Android JNI static library search paths.');
    }
    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withNativeLibraries, 'withNativeLibraries', '1.0.0');
