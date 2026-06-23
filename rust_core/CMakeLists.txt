cmake_minimum_required(VERSION 3.12)
project(LLMPDFIngestRustCore LANGUAGES CXX C)

# Find Cargo if not inherited from parent scope
if (NOT CARGO_EXE)
    find_program(CARGO_EXE cargo)
    if (NOT CARGO_EXE)
        message(FATAL_ERROR "cargo executable not found! Please install Rust.")
    endif()
endif()

# Setup target libs directory
set(RUST_LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/libs")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}/aarch64-linux-android")
file(MAKE_DIRECTORY "${RUST_LIBS_DIR}/aarch64-apple-ios")

# Configure build flags, environment variables and targets
set(CARGO_TARGET_FLAGS "")
set(CARGO_ENV_VARS "")
set(RUST_TARGET "")
set(RUST_LIBS_SUBDIR "")

if (BUILD_ANDROID_APK)
    set(RUST_TARGET "aarch64-linux-android")
    set(RUST_LIBS_SUBDIR "aarch64-linux-android")
    set(CARGO_TARGET_FLAGS "--target" "${RUST_TARGET}")
    
    # Resolve Android NDK path for compiler toolchain setup
    if (CMAKE_ANDROID_NDK)
        set(NDK_ROOT "${CMAKE_ANDROID_NDK}")
    elseif (DEFINED ENV{ANDROID_NDK_HOME})
        set(NDK_ROOT "$ENV{ANDROID_NDK_HOME}")
    elseif (DEFINED ENV{ANDROID_NDK})
        set(NDK_ROOT "$ENV{ANDROID_NDK}")
    endif()

    if (NDK_ROOT)
        # Determine host OS tag for NDK prebuilt tools
        if (CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows")
            set(NDK_HOST_TAG "windows-x86_64")
            set(LINKER_EXT ".cmd")
        elseif (CMAKE_HOST_SYSTEM_NAME STREQUAL "Darwin")
            set(NDK_HOST_TAG "darwin-x86_64")
            set(LINKER_EXT "")
        else()
            set(NDK_HOST_TAG "linux-x86_64")
            set(LINKER_EXT "")
        endif()

        # Android API Level 24 corresponds to Android 7.0+
        set(NDK_BIN_DIR "${NDK_ROOT}/toolchains/llvm/prebuilt/${NDK_HOST_TAG}/bin")
        set(RUST_LINKER "${NDK_BIN_DIR}/aarch64-linux-android24-clang${LINKER_EXT}")
        if (NOT EXISTS "${RUST_LINKER}")
            set(RUST_LINKER "${NDK_BIN_DIR}/aarch64-linux-android-clang${LINKER_EXT}")
        endif()

        # Set environment variables for Cargo cross-compilation
        set(CARGO_ENV_VARS
            ${CMAKE_COMMAND} -E env
            "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=${RUST_LINKER}"
            "CC_aarch64_linux_android=${RUST_LINKER}"
            "CXX_aarch64_linux_android=${NDK_BIN_DIR}/aarch64-linux-android24-clang++${LINKER_EXT}"
            "AR_aarch64_linux_android=${NDK_BIN_DIR}/llvm-ar${LINKER_EXT}"
        )
    endif()

elseif (BUILD_IOS_FRAMEWORK)
    set(RUST_TARGET "aarch64-apple-ios")
    set(RUST_LIBS_SUBDIR "aarch64-apple-ios")
    set(CARGO_TARGET_FLAGS "--target" "${RUST_TARGET}")
    
    # iOS arm64 toolchain environment stubs (to be populated in target environment)
    set(CARGO_ENV_VARS
        ${CMAKE_COMMAND} -E env
        "IPHONEOS_DEPLOYMENT_TARGET=13.0"
        "SDKROOT="
    )
endif()

# Configure optional features like llama_native and verbose-logging
set(RUST_FEATURES "")
if (LLAMA_NATIVE)
    list(APPEND RUST_FEATURES "llama_native")
endif()
if (ENABLE_CORE_DEBUG_LOGS)
    list(APPEND RUST_FEATURES "verbose-logging")
endif()

set(CARGO_FEATURE_FLAGS "")
if (RUST_FEATURES)
    string(REPLACE ";" "," RUST_FEATURES_STR "${RUST_FEATURES}")
    set(CARGO_FEATURE_FLAGS "--features" "${RUST_FEATURES_STR}")
endif()

# Define Cargo Build Command Template
set(CARGO_BUILD_CMD "${CARGO_EXE}" "build" "--manifest-path" "${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml" ${CARGO_TARGET_FLAGS} ${CARGO_FEATURE_FLAGS})

# Add Targets depending on the build configuration
if (BUILD_ANDROID_APK OR BUILD_IOS_FRAMEWORK)
    # Output file paths for the static libraries
    set(PARSER_LIB_OUT "${RUST_LIBS_DIR}/${RUST_LIBS_SUBDIR}/libparser.a")
    set(INFERENCE_LIB_OUT "${RUST_LIBS_DIR}/${RUST_LIBS_SUBDIR}/libinference.a")

    add_custom_command(
        OUTPUT "${PARSER_LIB_OUT}" "${INFERENCE_LIB_OUT}"
        COMMAND ${CARGO_ENV_VARS} ${CARGO_BUILD_CMD} --release
        COMMAND ${CMAKE_COMMAND} -E make_directory "${RUST_LIBS_DIR}/${RUST_LIBS_SUBDIR}"
        COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/target/${RUST_TARGET}/release/libparser.a" "${PARSER_LIB_OUT}"
        COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/target/${RUST_TARGET}/release/libinference.a" "${INFERENCE_LIB_OUT}"
        COMMENT "Compiling and copying rust_core static libraries (Release: ${RUST_TARGET})"
        VERBATIM
    )

    add_custom_target(rust_core_libs DEPENDS "${PARSER_LIB_OUT}" "${INFERENCE_LIB_OUT}")
    
    # Create target aliases for compatibility with top-level configurations
    if (BUILD_ANDROID_APK)
        add_custom_target(rust_core_android DEPENDS rust_core_libs)
    elseif (BUILD_IOS_FRAMEWORK)
        add_custom_target(rust_core_ios DEPENDS rust_core_libs)
    endif()
else()
    # Host builds (compile dynamic/static libraries using Cargo default config)
    add_custom_target(rust_core_libs
        COMMAND ${CARGO_BUILD_CMD}
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMENT "Compiling rust_core library targets for Host"
        VERBATIM
    )
endif()

# Target: Desktop Server (Host application)
add_custom_target(desktop-server
    COMMAND ${CARGO_EXE} build -p desktop_server ${CARGO_FEATURE_FLAGS}
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Compiling Host Desktop Server..."
    VERBATIM
)

# Target: Start Desktop Server (runs it)
add_custom_target(start-desktop-server
    COMMAND ${CARGO_EXE} run -p desktop_server ${CARGO_FEATURE_FLAGS} -- --db "${CMAKE_CURRENT_SOURCE_DIR}/../test_artifacts/e2e_integration_test/test_corpus.db"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Starting Host Desktop Server..."
    USES_TERMINAL
    VERBATIM
)

# Native cargo tests integration
if (RUN_INTEGRATION_TESTS)
    add_test(
        NAME CargoTests
        COMMAND "${CARGO_EXE}" test --workspace ${CARGO_FEATURE_FLAGS}
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    )
    if (DOWNLOAD_TEST_MODEL)
        set_tests_properties(CargoTests PROPERTIES ENVIRONMENT "RUN_LLM_E2E_TESTS=1;LLM_TEST_MODEL_URL=https://huggingface.co/bartowski/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf")
    endif()
    # Specific integration validation tests mapping
    # Note: tests referencing delineator were refactored into agent_harness
endif()
