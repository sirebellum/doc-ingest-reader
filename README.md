# LLM PDF Ingest & Reader App — Development Flow Guide

This document describes how to run and test the complete end-to-end local development flow for the offline-first PDF layout extraction, ingestion, and reading system.

---

## 🛠️ Prerequisites

Ensure you have the following environments installed:
- **CMake**: [cmake.org](https://cmake.org/) (v3.12+)
- **Rust (Cargo)**: [rustup.rs](https://rustup.rs/) (v1.75+)
- **Node.js & npm**: [nodejs.org](https://nodejs.org/) (v18+)

---

## 🚀 Step-by-Step Developer Workflow

### 1. Configure the Workspace

Generate the CMake build files from the root directory:

```bash
# Configure the build directory (default: logging disabled)
cmake -B build

# Configure the build directory with compile-time debug logging enabled
cmake -B build -DENABLE_CORE_DEBUG_LOGS=ON
```

### 1b. Run-Time Logging Configuration

When `ENABLE_CORE_DEBUG_LOGS=ON` is set during CMake configuration, compile-time conditional debug logs are activated across both the native Rust core engines (`parser`, `delineator`, `inference`) and the React Native frontend.
To trace these logs in real-time, launch the development servers. In the default configuration (logging disabled), all debug log strings, formatting logic, and FFI log blocks are entirely stripped from the production release binaries and Javascript bundles via compiler dead-code elimination and Rust `#[cfg(feature = "verbose-logging")]` attributes, ensuring zero performance regression.


### 2. Ingestion Pipeline & Test DB Generation

To parse and ingest raw documents (e.g. `Research Notes.pdf`) into a structured SQLite database file, run the Rust integration tests. This executes layout extraction, paragraph sorting, and FTS5 synchronization.

```bash
# Execute integration tests via CMake
cmake --build build --target CargoTests
```

This test generates a pre-populated SQLite database at `rust_core/parser/target/test_artifacts/test_corpus.db` containing the parsed semantic AST blocks and sections of the PDF.

### 3. Run the Gateway Database Server

The React Native Expo Web build runs inside the web browser sandbox and cannot access the local filesystem database directly. We host the SQLite database on a lightweight, local CORS-compliant HTTP gateway.

```bash
# Start the desktop database server gateway
cmake --build build --target start-desktop-server
```

The gateway server starts at `http://localhost:8080`.
- **Database Endpoint**: `http://localhost:8080/db` serves the raw SQLite binary.
- **REST Endpoints**: `/parse`, `/inference`, `/delineate`, `/similarity` are available for layout and model actions.

### 4. Run the UI Web Server (React Native Web)

Start the Metro and Expo web compiler to serve the React Native frontend application in the browser. This target will automatically install npm dependencies if they are missing.

```bash
# Start the Expo web developer server on port 19006
cmake --build build --target start-web-server
```

### 5. Verify in the Browser

Open your browser and navigate to:
👉 **[http://localhost:19006](http://localhost:19006)**

- **When the desktop server is running**: The Library page fetches the SQLite database from the gateway, initializes `sql.js` in the browser, displays `Research Notes.pdf`, and lets you read/annotate the document.
- **When the desktop server is stopped**: The Library shows a clean warning banner explaining the connection problem, and displays an empty library (instead of falling back to fake mock data).

---

## 🧪 Unified Verification & Testing (ctest)

To run all automated test suites uniformly across the repository (Cargo workspace tests, Jest tests, and README configuration validation), use CMake's native testing tool `ctest`:

```bash
# Navigate to the build directory and run tests
cd build
ctest --output-on-failure
```

### Run Specific Test Suites

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
  ctest -C Debug-R JestTests --output-on-failure
  ```


