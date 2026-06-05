Pod::Spec.new do |s|
  s.name           = 'RustParserBridgeModule'
  s.version        = '1.0.0'
  s.summary        = 'High-performance Rust/C++ JSI parser bridge for Expo'
  s.description    = 'High-performance Rust/C++ JSI parser bridge for Expo'
  s.homepage       = 'https://github.com'
  s.license        = 'MIT'
  s.author         = { 'Author' => 'author@example.com' }
  s.platform       = :ios, '13.0'
  s.source         = { :path => '.' }
  
  s.prepare_command = <<-CMD
    if [ ! -f "../../../../rust_core/libs/aarch64-apple-ios/libparser.a" ] || [ ! -f "../../../../rust_core/libs/aarch64-apple-ios/libinference.a" ]; then
      echo "Error: Required Rust static libraries not found in rust_core/libs/aarch64-apple-ios/. Please build them first (e.g. using 'cmake --build . --target rust_core_libs' with BUILD_IOS_FRAMEWORK=ON)." >&2
      exit 1
    fi
  CMD

  
  # Include files from pod directory and the C++ bridge directories
  s.source_files   = '**/*.{h,m,mm,cpp}', '../../../../mobile/src/native/cpp/*.{h,cpp}'
  s.header_dir     = 'RustParserBridgeModule'
  
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-jsi'
  s.dependency 'React-Core'

  cplusplus_flags = '-DFOLLY_NO_CONFIG -DHERMES_ENABLE_DEBUGGER=1'
  if ENV['ENABLE_CORE_DEBUG_LOGS'] == 'true'
    cplusplus_flags += ' -DENABLE_CORE_DEBUG_LOGS=1'
  end

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/../../../../mobile/src/native/cpp" "$(PODS_ROOT)/Headers/Public/React-hermes" "$(PODS_ROOT)/Headers/Public/hermes-engine" "$(PODS_ROOT)/Headers/Public/React-jsi"',
    'OTHER_CPLUSPLUSFLAGS' => cplusplus_flags
  }
  
  # Vendored libraries linked from the built rust_core libs directory
  s.library_search_paths = '"$(PODS_TARGET_SRCROOT)/../../../../rust_core/libs/aarch64-apple-ios"'
  s.vendored_libraries = '../../../../rust_core/libs/aarch64-apple-ios/libparser.a', '../../../../rust_core/libs/aarch64-apple-ios/libinference.a'
end
