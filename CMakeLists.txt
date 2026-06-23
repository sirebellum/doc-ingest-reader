cmake_minimum_required(VERSION 3.12)
project(LLMPDFIngest LANGUAGES CXX C)

# Set workspace properties
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. Global Options & Configuration Toggles
option(BUILD_ANDROID_APK "Build Android APK cross-compilation target" OFF)
option(BUILD_IOS_FRAMEWORK "Build iOS Framework cross-compilation target" OFF)
option(RUN_INTEGRATION_TESTS "Run automated integration and synthetic validation suites" ON)
option(LLAMA_NATIVE "Enable native llama.cpp integration" ON)
option(ENABLE_CORE_DEBUG_LOGS "Enable compile-time gated debug logs across all subsystems" OFF)
option(DOWNLOAD_TEST_MODEL "Download local LLM model weights for integration testing" OFF)

message(STATUS "LLMPDFIngest Configuration:")
message(STATUS "  - BUILD_ANDROID_APK:   ${BUILD_ANDROID_APK}")
message(STATUS "  - BUILD_IOS_FRAMEWORK: ${BUILD_IOS_FRAMEWORK}")
message(STATUS "  - RUN_INTEGRATION_TESTS: ${RUN_INTEGRATION_TESTS}")
message(STATUS "  - LLAMA_NATIVE:        ${LLAMA_NATIVE}")
message(STATUS "  - ENABLE_CORE_DEBUG_LOGS: ${ENABLE_CORE_DEBUG_LOGS}")
message(STATUS "  - DOWNLOAD_TEST_MODEL: ${DOWNLOAD_TEST_MODEL}")

if (DOWNLOAD_TEST_MODEL)
    set(TEST_MODEL_URL "https://huggingface.co/Qwen/Qwen1.5-0.5B-Chat-GGUF/resolve/main/qwen1_5-0_5b-chat-q4_0.gguf")
    set(TEST_MODEL_DEST "${CMAKE_SOURCE_DIR}/test_artifacts/gemma-3-1b-it-Q4_K_M.gguf")
    
    if (NOT EXISTS "${TEST_MODEL_DEST}")
        message(STATUS "Downloading test model from ${TEST_MODEL_URL} to ${TEST_MODEL_DEST}...")
        file(MAKE_DIRECTORY "${CMAKE_SOURCE_DIR}/test_artifacts")
        file(DOWNLOAD "${TEST_MODEL_URL}" "${TEST_MODEL_DEST}" SHOW_PROGRESS)
    else()
        message(STATUS "Test model already exists at ${TEST_MODEL_DEST}, skipping download.")
    endif()
endif()

# 2. Compile llama.cpp if enabled
if (LLAMA_NATIVE)
    message(STATUS "Adding llama.cpp dependency...")
    # Configure llama.cpp to build minimal required assets
    set(LLAMA_BUILD_TESTS OFF CACHE BOOL "Build llama.cpp tests" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "Build llama.cpp examples" FORCE)
    set(LLAMA_BUILD_SERVER OFF CACHE BOOL "Build llama.cpp server" FORCE)
    set(LLAMA_CCACHE OFF CACHE BOOL "Disable ccache warning" FORCE)
    if (BUILD_ANDROID_APK OR BUILD_IOS_FRAMEWORK)
        set(LLAMA_METAL OFF CACHE BOOL "Disable Metal for mobile builds" FORCE)
        set(LLAMA_CUDA OFF CACHE BOOL "Disable CUDA for mobile builds" FORCE)
    elseif (APPLE)
        execute_process(COMMAND xcrun -f metal RESULT_VARIABLE METAL_FOUND OUTPUT_QUIET ERROR_QUIET)
        if (METAL_FOUND EQUAL 0)
            set(LLAMA_METAL ON CACHE BOOL "Enable Metal on Apple devices" FORCE)
        else()
            set(LLAMA_METAL OFF CACHE BOOL "Disable Metal because compiler is missing" FORCE)
        endif()
    else()
        find_program(NVCC_EXE nvcc)
        if (NVCC_EXE)
            set(LLAMA_CUDA ON CACHE BOOL "Enable CUDA since nvcc was found" FORCE)
        else()
            set(LLAMA_CUDA OFF CACHE BOOL "Disable CUDA since nvcc was not found" FORCE)
        endif()
        set(LLAMA_METAL OFF CACHE BOOL "Disable Metal on non-Apple devices" FORCE)
    endif()

    add_subdirectory(third_party/llama.cpp)
endif()

# 2.5 Compile PDFium
include(ExternalProject)

set(DEPOT_TOOLS_DIR "${CMAKE_SOURCE_DIR}/third_party/depot_tools")
set(PDFIUM_WORK_DIR "${CMAKE_SOURCE_DIR}/third_party")

file(WRITE "${CMAKE_BINARY_DIR}/patch_pdfium.sh" "
cat << 'EOF' > \${1}/pdfium/build/config/apple/sdk_info.py
import sys
print('machine_os_build=\"24A335\"')
print('sdk_build=\"24A335\"')
print('sdk_path=\"/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk\"')
print('sdk_platform_path=\"/Library/Developer/CommandLineTools\"')
print('sdk_version=\"15.4\"')
print('toolchains_path=\"/Library/Developer/CommandLineTools/usr/bin\"')
print('xcode_build=\"16C5032a\"')
print('xcode_version=\"1600\"')
print('xcode_version_int=1600')
sys.exit(0)
EOF
cat << 'EOF' > \${1}/pdfium/build/mac/find_sdk.py
import sys
if '--print_sdk_path' in sys.argv:
    print('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk')
if '--print_bin_path' in sys.argv:
    print('/Library/Developer/CommandLineTools/usr/bin/')
if '--print_sdk_build' in sys.argv:
    print('24A335')
print('15.4')
sys.exit(0)
EOF
")

ExternalProject_Add(
    pdfium_build
    PREFIX "${CMAKE_BINARY_DIR}/_deps/pdfium_ext"
    DOWNLOAD_COMMAND ""
    CONFIGURE_COMMAND bash -c "cd ${PDFIUM_WORK_DIR} && env \"PATH=${DEPOT_TOOLS_DIR}:$ENV{PATH}\" gclient config --unmanaged https://pdfium.googlesource.com/pdfium.git"
        COMMAND bash -c "cd ${PDFIUM_WORK_DIR} && env \"PATH=${DEPOT_TOOLS_DIR}:$ENV{PATH}\" gclient sync --no-history --shallow --reset --force"
        COMMAND bash ${CMAKE_BINARY_DIR}/patch_pdfium.sh ${PDFIUM_WORK_DIR}
    BUILD_COMMAND bash -c "cd ${PDFIUM_WORK_DIR}/pdfium && env \"PATH=${DEPOT_TOOLS_DIR}:$ENV{PATH}\" gn gen out/Release '--args=is_component_build=true pdf_is_standalone=true is_debug=false mac_deployment_target=\"10.13\"'"
        COMMAND bash -c "cd ${PDFIUM_WORK_DIR}/pdfium && env \"PATH=${DEPOT_TOOLS_DIR}:$ENV{PATH}\" ninja -C out/Release pdfium"
    INSTALL_COMMAND cmake -E make_directory ${CMAKE_SOURCE_DIR}/rust_core/target/debug
        COMMAND cmake -E copy ${PDFIUM_WORK_DIR}/pdfium/out/Release/libpdfium.dylib ${CMAKE_SOURCE_DIR}/rust_core/target/debug/libpdfium.dylib
)

# Find developer toolchains
find_program(CARGO_EXE cargo)
if (NOT CARGO_EXE)
    message(FATAL_ERROR "cargo executable not found! Please install Rust.")
endif()

find_program(NODE_EXE node)
if (NOT NODE_EXE)
    message(FATAL_ERROR "node executable not found! Please install Node.js.")
endif()

if (WIN32)
    find_program(NPM_EXE NAMES npm.cmd npm.bat npm)
else()
    find_program(NPM_EXE npm)
endif()
if (NOT NPM_EXE)
    message(FATAL_ERROR "npm executable not found! Please install npm.")
endif()


# 4. Comprehensive Testing Testbeds (ctest)
enable_testing()

# 3. Add Subdirectories
add_subdirectory(rust_core)
add_subdirectory(mobile)


# Root verification test mapping to verify README test configs and database integrity
add_test(
    NAME VerifyReadmeConfig
    COMMAND "${NODE_EXE}" "${CMAKE_CURRENT_SOURCE_DIR}/scripts/verify_readme_config.js"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
)

# 5. Documentation/Help Target
add_custom_target(help-deps
    COMMAND ${CMAKE_COMMAND} -E echo "--- LLMPDFIngest Build Dependencies & Commands Guide ---"
    COMMAND ${CMAKE_COMMAND} -E echo "Options:"
    COMMAND ${CMAKE_COMMAND} -E echo "  -DALL_TESTS=ON/OFF   -DRUN_INTEGRATION_TESTS=ON/OFF   -DLLAMA_NATIVE=ON/OFF"
    COMMAND ${CMAKE_COMMAND} -E echo "  -DBUILD_ANDROID_APK=ON/OFF                            -DBUILD_IOS_FRAMEWORK=ON/OFF"
    COMMAND ${CMAKE_COMMAND} -E echo "Core CMake Targets:"
    COMMAND ${CMAKE_COMMAND} -E echo "  cmake --build build --target rust_core_libs           - Compiles Rust core libraries"
    COMMAND ${CMAKE_COMMAND} -E echo "  cmake --build build --target desktop-server           - Compiles Host Desktop HTTP server"
    COMMAND ${CMAKE_COMMAND} -E echo "  cmake --build build --target start-desktop-server     - Runs Desktop HTTP server gateway"
    COMMAND ${CMAKE_COMMAND} -E echo "  cmake --build build --target start-web-server         - Starts UI dev web server"
    COMMAND ${CMAKE_COMMAND} -E echo "Testing Commands:"
    COMMAND ${CMAKE_COMMAND} -E echo "  cd build && ctest --output-on-failure                 - Runs all Cargo, Jest & Readme tests"
    VERBATIM
)
