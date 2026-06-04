cmake_minimum_required(VERSION 3.12)
project(LLMPDFIngest LANGUAGES CXX C)

# Set workspace properties
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(LLAMA_NATIVE "Enable native llama.cpp integration" OFF)

message(STATUS "LLAMA_NATIVE: ${LLAMA_NATIVE}")

# Find rust/cargo
find_program(CARGO_EXE cargo)
if (NOT CARGO_EXE)
    message(FATAL_ERROR "cargo executable not found! Please install Rust.")
endif()

# Setup target libs directory
set(RUST_LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/libs")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}/aarch64-linux-android")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}/aarch64-apple-ios")

# Configure build flags for cargo
set(CARGO_FLAGS "")
if (LLAMA_NATIVE)
    set(CARGO_FLAGS "--features" "llama_native")
endif()

# Compile Targets
# Android Targets (parser and inference)
add_custom_command(
    OUTPUT "${RUST_LIBS_DIR}/aarch64-linux-android/libparser.a"
    COMMAND "${CARGO_EXE}" build --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/Cargo.toml" --target "aarch64-linux-android" --release ${CARGO_FLAGS}
    COMMAND ${CMAKE_COMMAND} -E make_directory "${RUST_LIBS_DIR}/aarch64-linux-android"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/target/aarch64-linux-android/release/libparser.a" "${RUST_LIBS_DIR}/aarch64-linux-android/"
    COMMENT "Compiling rust_core parser static library (aarch64-linux-android)"
    VERBATIM
)
add_custom_target(rust_core_parser_android DEPENDS "${RUST_LIBS_DIR}/aarch64-linux-android/libparser.a")

add_custom_command(
    OUTPUT "${RUST_LIBS_DIR}/aarch64-linux-android/libinference.a"
    COMMAND "${CARGO_EXE}" build --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/Cargo.toml" --target "aarch64-linux-android" --release ${CARGO_FLAGS}
    COMMAND ${CMAKE_COMMAND} -E make_directory "${RUST_LIBS_DIR}/aarch64-linux-android"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/target/aarch64-linux-android/release/libinference.a" "${RUST_LIBS_DIR}/aarch64-linux-android/"
    COMMENT "Compiling rust_core inference static library (aarch64-linux-android)"
    VERBATIM
)
add_custom_target(rust_core_inference_android DEPENDS "${RUST_LIBS_DIR}/aarch64-linux-android/libinference.a")

# iOS Targets
add_custom_command(
    OUTPUT "${RUST_LIBS_DIR}/aarch64-apple-ios/libparser.a"
    COMMAND "${CARGO_EXE}" build --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/Cargo.toml" --target "aarch64-apple-ios" --release ${CARGO_FLAGS}
    COMMAND ${CMAKE_COMMAND} -E make_directory "${RUST_LIBS_DIR}/aarch64-apple-ios"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/target/aarch64-apple-ios/release/libparser.a" "${RUST_LIBS_DIR}/aarch64-apple-ios/"
    COMMENT "Compiling rust_core parser static library (aarch64-apple-ios)"
    VERBATIM
)
add_custom_target(rust_core_parser_ios DEPENDS "${RUST_LIBS_DIR}/aarch64-apple-ios/libparser.a")

add_custom_command(
    OUTPUT "${RUST_LIBS_DIR}/aarch64-apple-ios/libinference.a"
    COMMAND "${CARGO_EXE}" build --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/Cargo.toml" --target "aarch64-apple-ios" --release ${CARGO_FLAGS}
    COMMAND ${CMAKE_COMMAND} -E make_directory "${RUST_LIBS_DIR}/aarch64-apple-ios"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/rust_core/target/aarch64-apple-ios/release/libinference.a" "${RUST_LIBS_DIR}/aarch64-apple-ios/"
    COMMENT "Compiling rust_core inference static library (aarch64-apple-ios)"
    VERBATIM
)
add_custom_target(rust_core_inference_ios DEPENDS "${RUST_LIBS_DIR}/aarch64-apple-ios/libinference.a")

# Target groups
add_custom_target(rust_core_android DEPENDS rust_core_parser_android rust_core_inference_android)
add_custom_target(rust_core_ios DEPENDS rust_core_parser_ios rust_core_inference_ios)

# Android APK Target
if (WIN32)
    set(GRADLE_CMD "gradlew.bat")
else()
    set(GRADLE_CMD "./gradlew")
endif()

add_custom_target(android-apk
    COMMAND npx expo prebuild --platform android --no-install
    COMMAND ${CMAKE_COMMAND} --build . --target rust_core_android
    COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/mobile/android/${GRADLE_CMD}" assembleDebug
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/mobile"
    COMMENT "Orchestrating Android prebuild and assembling APK"
    VERBATIM
)

# iOS target
add_custom_target(ios-app
    COMMAND npx expo prebuild --platform ios --no-install
    COMMAND ${CMAKE_COMMAND} --build . --target rust_core_ios
    COMMAND pod install
    COMMAND xcodebuild -workspace LLMPDFIngest.xcworkspace -scheme LLMPDFIngest -configuration Debug -sdk iphonesimulator -arch arm64
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/mobile/ios"
    COMMENT "Orchestrating iOS prebuild and compiling simulator App bundle"
    VERBATIM
)

# Desktop Server Target (compiled for host machine)
add_custom_target(desktop-server
    COMMAND "${CARGO_EXE}" build -p desktop_server
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/rust_core"
    COMMENT "Compiling host desktop http server"
    VERBATIM
)

# Start Desktop Server Target
add_custom_target(start-desktop-server
    COMMAND "${CARGO_EXE}" run -p desktop_server
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/rust_core"
    COMMENT "Starting host desktop HTTP gateway"
    USES_TERMINAL
    VERBATIM
)

# Documentation helper target
add_custom_target(help-deps
    COMMAND ${CMAKE_COMMAND} -E echo "--- LLMPDFIngest Build Dependencies Guide ---"
    COMMAND ${CMAKE_COMMAND} -E echo "Please ensure the following tools are installed:"
    COMMAND ${CMAKE_COMMAND} -E echo "1. Rust (rustup) with target toolchains:"
    COMMAND ${CMAKE_COMMAND} -E echo "   - rustup target add aarch64-linux-android"
    COMMAND ${CMAKE_COMMAND} -E echo "   - rustup target add aarch64-apple-ios"
    COMMAND ${CMAKE_COMMAND} -E echo "2. Java Development Kit (JDK 17) for Android builds"
    COMMAND ${CMAKE_COMMAND} -E echo "3. Android NDK and SDK (configured in environment variables)"
    COMMAND ${CMAKE_COMMAND} -E echo "4. Node.js & npm (for Expo prebuild)"
    COMMAND ${CMAKE_COMMAND} -E echo "5. CocoaPods & Xcode (for iOS builds on macOS)"
    VERBATIM
)
