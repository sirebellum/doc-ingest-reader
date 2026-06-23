# LLM PDF Ingest & Reader App — Development Flow Guide

This document describes how to run and test the complete end-to-end local development flow for the offline-first PDF layout extraction, ingestion, and reading system.

---

## 🛠️ Prerequisites

Ensure you have the following environments installed:
- **CMake**: [cmake.org](https://cmake.org/) (v3.12+)
- **Rust (Cargo)**: [rustup.rs](https://rustup.rs/) (v1.75+)
- **Node.js & npm**: [nodejs.org](https://nodejs.org/) (v18+)

---

## 🏗️ Build

### Configure the Workspace

Generate the CMake build files from the root directory:

```bash
# Configure the build directory (default: logging disabled)
cmake -B build

# Configure the build directory with compile-time debug logging enabled
cmake -B build -DENABLE_CORE_DEBUG_LOGS=ON
```

### Run-Time Logging Configuration

When `ENABLE_CORE_DEBUG_LOGS=ON` is set during CMake configuration, compile-time conditional debug logs are activated across both the native Rust core engines (`parser`, `delineator`, `inference`) and the React Native frontend.
To trace these logs in real-time, launch the development servers. In the default configuration (logging disabled), all debug log strings, formatting logic, and FFI log blocks are entirely stripped from the production release binaries and Javascript bundles via compiler dead-code elimination and Rust `#[cfg(feature = "verbose-logging")]` attributes, ensuring zero performance regression.

### CMake Build Flags

You can customize the compilation behavior by passing the following flags to the `cmake -B build` configuration command (e.g., `cmake -B build -DLLAMA_NATIVE=ON`):

| Flag | Default | Description |
|------|---------|-------------|
| `-DALL_TESTS` | `OFF` | Enables all testing targets across the workspace. |
| `-DRUN_INTEGRATION_TESTS` | `ON` | Enables integration tests and synthetic programmatic validation suites. |
| `-DLLAMA_NATIVE` | `ON` | Configures and natively compiles `llama.cpp` from source for local device inference. |
| `-DBUILD_ANDROID_APK` | `OFF` | Sets up the NDK toolchain and cross-compiles the Android APK target. |
| `-DBUILD_IOS_FRAMEWORK` | `OFF` | Configures the Xcode toolchain and builds the iOS cross-compiled Framework target. |
| `-DENABLE_CORE_DEBUG_LOGS` | `OFF` | Activates compile-time conditional debug logging across the native engines and React Native frontend. |

---

## 🚀 Run

### Run the Gateway Database Server

The React Native Expo Web build runs inside the web browser sandbox and cannot access the local filesystem database directly. You can specify a custom database file to be served by the gateway by setting the `SERVED_DB_PATH` environment variable before starting the desktop server (e.g., `$env:SERVED_DB_PATH="test_artifacts/e2e_synthetic_validation/test_agent.db"; cmake --build build --target start-desktop-server`). If not provided, it will serve an empty `llm_pdf_reader.db` production database where you can manually add PDFs. The gateway server starts at `http://localhost:8080`.
- **Database Endpoint**: `http://localhost:8080/db` serves the raw SQLite binary.
- **REST Endpoints**: `/parse`, `/inference`, `/delineate`, `/similarity` are available for layout and model actions.

### Run the UI Web Server (React Native Web)

Start the Metro and Expo web compiler to serve the React Native frontend application in the browser. This target will automatically install npm dependencies if they are missing.

```bash
# Start the Expo web developer server on port 19006
cmake --build build --target start-web-server
```

### Verify in the Browser

Open your browser and navigate to:
👉 **[http://localhost:19006](http://localhost:19006)**

- **When the desktop server is running**: The Library page fetches the SQLite database from the gateway, initializes `sql.js` in the browser, displays `Research Notes.pdf`, and lets you read/annotate the document.
- **When the desktop server is stopped**: The Library shows a clean warning banner explaining the connection problem, and displays an empty library (instead of falling back to fake mock data).

---

## 🧪 Test

### Unified Verification & Testing (ctest)

To run all automated test suites uniformly across the repository (Cargo workspace tests, Jest tests, and README configuration validation), use CMake's native testing tool `ctest`:

```bash
# Navigate to the build directory and run tests
cd build
ctest -C Debug --output-on-failure
```

#### Run Specific Test Suites

You can filter and run specific test suites using the `-R` flag:

- **Run Synthetic Validation pipeline**:
  ```bash
  cd build
  ctest -C Debug -R SyntheticValidationTest --output-on-failure
  ```
  This pipeline executes Stage 0 (Pre-PDF Generation), Stage 1 (PDF Compilation), Stage 2 (Pass 1 Extraction), Stage 3 (Pass 2 Delineation), Stage 4 (DB Synchronization), and Stage 5 (Differential Checks).

- **Run Cargo tests only**:
  ```bash
  cd build
  ctest -C Debug -R CargoTests --output-on-failure
  ```

- **Run Jest tests only**:
  ```bash
  cd build
  ctest -C Debug -R JestTests --output-on-failure
  ```

### Ingestion Pipeline & Test DB Generation

To parse and ingest raw documents (e.g. `Research Notes.pdf`) into a structured SQLite database file, run the Rust integration tests. This executes layout extraction, paragraph sorting, and FTS5 synchronization.

```bash
# Execute integration tests via CMake
cmake --build build --target CargoTests
```

This test generates a pre-populated SQLite database at `test_artifacts/e2e_synthetic_validation/test_corpus.db` containing the parsed semantic AST blocks and sections of the PDF.

### Standard Unit Tests vs Gated E2E Tests

The `rust_core` workspace distinguishes between fast, lightweight unit tests and heavy, integration-level End-to-End (E2E) tests. 
Standard unit tests run quickly and are executed automatically by the `ctest` suite. 
The E2E tests (located under `rust_core/e2e_tests/`), which evaluate the Agent's ReAct loop and ingestion pipeline using actual local LLM inference, are computationally expensive and require specialized hardware and models. To prevent these from blocking the standard CI pipelines, they are "gated" behind the `#[ignore]` attribute.

### Running Gated E2E Tests

To run the gated integration tests with actual local LLM inference, you must explicitly invoke them using the `--ignored` flag, and specify the `e2e_tests` package along with the `llama_native` feature to ensure the underlying LLM engine is utilized:

```bash
cd rust_core
cargo test -p e2e_tests --features llama_native -- --ignored
```

#### Required Environment Variables

When running the local inference tests, you must configure the following environment variables so the test suite can locate the necessary models:

- **`LLM_TEST_MODEL_URL`**: The path or URL to the local GGUF model used for inference during testing.

*Example:*
```bash
export LLM_TEST_MODEL_URL="path/to/your/local/model.gguf"
cargo test -p e2e_tests --features llama_native -- --ignored
```
