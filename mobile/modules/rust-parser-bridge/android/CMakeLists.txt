cmake_minimum_required(VERSION 3.12)
project(RustParserBridge)

# Configure compiler properties
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find React Native JSI headers inside the node_modules directory
find_path(JSI_HEADER_DIR jsi/jsi.h
    PATHS 
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../node_modules/react-native/ReactCommon/jsi"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/react-native/ReactCommon/jsi"
)

message(STATUS "React Native JSI headers located at: ${JSI_HEADER_DIR}")

# Locate rust_core precompiled libs and headers
set(RUST_LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../rust_core/libs/aarch64-linux-android")

# Define our library target
add_library(RustParserBridge SHARED
    src/main/cpp/jni-bridge.cpp
    ../../../../src/native/cpp/RustParserBridge.cpp
)

# Set include directories
target_include_directories(RustParserBridge PRIVATE
    "${JSI_HEADER_DIR}/.."
    "../../../../src/native/cpp"
)

# Find native logging library
find_library(LOG_LIB log)

# Link targets
target_link_libraries(RustParserBridge
    ${LOG_LIB}
    android
)

# Statically link rust_core libraries
find_library(RUST_PARSER_LIB parser PATHS "${RUST_LIBS_DIR}")
find_library(RUST_INFERENCE_LIB inference PATHS "${RUST_LIBS_DIR}")

if (RUST_PARSER_LIB)
    target_link_libraries(RustParserBridge ${RUST_PARSER_LIB})
    message(STATUS "Successfully linked Rust parser static library: ${RUST_PARSER_LIB}")
else()
    message(WARNING "Rust parser static library not found at: ${RUST_LIBS_DIR}")
endif()

if (RUST_INFERENCE_LIB)
    target_link_libraries(RustParserBridge ${RUST_INFERENCE_LIB})
    message(STATUS "Successfully linked Rust inference static library: ${RUST_INFERENCE_LIB}")
else()
    message(WARNING "Rust inference static library not found at: ${RUST_LIBS_DIR}")
endif()

if (DEFINED ENV{ENABLE_CORE_DEBUG_LOGS} AND "$ENV{ENABLE_CORE_DEBUG_LOGS}" STREQUAL "true")
    target_compile_definitions(RustParserBridge PRIVATE ENABLE_CORE_DEBUG_LOGS=1)
    message(STATUS "Android JSI Bridge: ENABLE_CORE_DEBUG_LOGS compile-time macro is active")
endif()
