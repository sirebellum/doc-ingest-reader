cmake_minimum_required(VERSION 3.12)
project(LLMPDFIngest LANGUAGES CXX C)

# Set workspace properties
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 1. Global Options & Configuration Toggles
option(BUILD_ANDROID_APK "Build Android APK cross-compilation target" OFF)
option(BUILD_IOS_FRAMEWORK "Build iOS Framework cross-compilation target" OFF)
option(RUN_INTEGRATION_TESTS "Run automated integration and synthetic validation suites" ON)
option(LLAMA_NATIVE "Enable native llama.cpp integration" OFF)

message(STATUS "LLMPDFIngest Configuration:")
message(STATUS "  - BUILD_ANDROID_APK:   ${BUILD_ANDROID_APK}")
message(STATUS "  - BUILD_IOS_FRAMEWORK: ${BUILD_IOS_FRAMEWORK}")
message(STATUS "  - RUN_INTEGRATION_TESTS: ${RUN_INTEGRATION_TESTS}")
message(STATUS "  - LLAMA_NATIVE:        ${LLAMA_NATIVE}")

# 2. Fetch and compile llama.cpp if enabled
if (LLAMA_NATIVE)
    include(FetchContent)
    
    # Configure offline-safe cache and checking directory to avoid repeated downloads
    set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps" CACHE PATH "FetchContent downloads cache directory")
    
    # Declare llama_cpp using a stable tag and git shallow clone
    FetchContent_Declare(
        llama_cpp
        GIT_REPOSITORY "https://github.com/ggerganov/llama.cpp.git"
        GIT_TAG        "b3000"
        GIT_SHALLOW    ON
        GIT_PROGRESS   ON
    )

    FetchContent_GetProperties(llama_cpp)
    if(NOT llama_cpp_POPULATED)
        message(STATUS "Fetching upstream llama.cpp dependency...")
        FetchContent_Populate(llama_cpp)
        
        # Configure llama.cpp to build minimal required assets
        set(LLAMA_BUILD_TESTS OFF CACHE BOOL "Build llama.cpp tests" FORCE)
        set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "Build llama.cpp examples" FORCE)
        set(LLAMA_BUILD_SERVER OFF CACHE BOOL "Build llama.cpp server" FORCE)
        
        # Add subdirectory but exclude from default builds
        add_subdirectory(${llama_cpp_SOURCE_DIR} ${llama_cpp_BINARY_DIR} EXCLUDE_FROM_ALL)
    endif()
endif()

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
