cmake_minimum_required(VERSION 3.12)
project(LLMPDFIngestMobile LANGUAGES CXX C)

# Find node and npm if not inherited from parent scope
if (NOT NODE_EXE)
    find_program(NODE_EXE node)
    if (NOT NODE_EXE)
        message(FATAL_ERROR "node executable not found! Please install Node.js.")
    endif()
endif()

if (NOT NPM_EXE)
    if (WIN32)
        find_program(NPM_EXE NAMES npm.cmd npm.bat npm)
    else()
        find_program(NPM_EXE npm)
    endif()
    if (NOT NPM_EXE)
        message(FATAL_ERROR "npm executable not found! Please install npm.")
    endif()
endif()


# 1. Target: Install Node dependencies
add_custom_target(mobile_install_deps
    COMMAND "${NPM_EXE}" install
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Installing React Native/Expo client dependencies (npm)..."
    VERBATIM
)

# 2. Target: Build client web assets via run-build.js
add_custom_target(mobile_build_web
    COMMAND "${NODE_EXE}" run-build.js
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Building Expo client web assets using run-build.js..."
    VERBATIM
)
add_dependencies(mobile_build_web mobile_install_deps)

# 3. Target: Start development server
add_custom_target(start-web-server
    COMMAND "${NODE_EXE}" "${CMAKE_CURRENT_SOURCE_DIR}/scripts/start-web-server.js"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Starting Expo React Native Metro and Web development server..."
    USES_TERMINAL
    VERBATIM
)
add_dependencies(start-web-server mobile_install_deps)

# 4. Jest testing suite integration
add_test(
    NAME JestTests
    COMMAND "${NPM_EXE}" test
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
)

# 4a. Ingest CLI validation testing
add_test(
    NAME IngestCLI_Test
    COMMAND "${NPM_EXE}" run ingest:test
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
)

# 4b. Maestro E2E Integration Suite
find_program(BASH_EXE bash)
if (BASH_EXE)
    add_test(
        NAME MaestroE2ETests
        COMMAND "${BASH_EXE}" "scripts/run_maestro_e2e.sh" "${NODE_EXE}"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    )
else()
    message(WARNING "bash executable not found, skipping Maestro E2E test registration.")
endif()

# 5. Android APK Target
if (BUILD_ANDROID_APK)
    if (WIN32)
        set(GRADLE_CMD "gradlew.bat")
    else()
        set(GRADLE_CMD "./gradlew")
    endif()

    add_custom_target(android-apk
        COMMAND npx expo prebuild --platform android --no-install
        COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/android/${GRADLE_CMD}" assembleDebug
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Orchestrating Android prebuild and assembling APK"
        VERBATIM
    )
    # Ensure it depends on compiling Rust libraries and npm dependencies installation
    if (TARGET rust_core_libs)
        add_dependencies(android-apk rust_core_libs mobile_install_deps)
    else()
        add_dependencies(android-apk mobile_install_deps)
    endif()
endif()

# 6. iOS App Target
if (BUILD_IOS_FRAMEWORK)
    add_custom_target(ios-app
        COMMAND npx expo prebuild --platform ios --no-install
        COMMAND pod install
        COMMAND xcodebuild -workspace LLMPDFIngest.xcworkspace -scheme LLMPDFIngest -configuration Debug -sdk iphonesimulator -arch arm64
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/ios"
        COMMENT "Orchestrating iOS prebuild and compiling simulator App bundle"
        VERBATIM
    )
    # Ensure it depends on compiling Rust libraries and npm dependencies installation
    if (TARGET rust_core_libs)
        add_dependencies(ios-app rust_core_libs mobile_install_deps)
    else()
        add_dependencies(ios-app mobile_install_deps)
    endif()
endif()
