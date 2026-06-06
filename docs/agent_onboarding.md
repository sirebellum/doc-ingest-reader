# Developer Onboarding & System Topology Handbook

This document serves as the high-density reference manual for AI agents and human developers entering the `llm-pdf-ingest` repository. It outlines the multi-language system topology, relational schema boundaries, JSI host-object bindings, critical performance guardrails, and environment execution commands.

---

## 1. Architectural System Topology

The system is split into two primary layers: a high-performance native engine written in Rust and C++ (`rust_core`), and a cross-platform React Native mobile client (`mobile`) communicating via a zero-copy JSI bridge.

```
                    +------------------------------------+
                    |        React Native Client         |
                    |            (Expo SDK 50)           |
                    +------------------+-----------------+
                                       |
                                       | JSI Bridge FFI
                                       v
                    +------------------------------------+
                    |             rust_core              |
                    | (parser | delineator | inference)  |
                    +------------------+-----------------+
                                       |
                                       +--> lopdf & pdfium-render (Pass 1)
                                       +--> llama.cpp & GGUF (Pass 2)
```

### `rust_core/` (Native Engine)
The native engine consists of Cargo-managed crates compiled to run locally on the host machine or cross-compiled for mobile platforms:
* **`parser` (Pass 1 - Visual Extraction)**: Coordinates layout boundary mapping. It reads raw object streams via `lopdf` (retaining text drawing operations `TJ` and `Tj` for precise text boundaries) and calculates geometric bounding boxes using `pdfium-render` scaled to PostScript points (1/72 inch). Bounding boxes are measured relative to the page dimensions from top-left (0,0). Sandboxed image bytes are extracted, decompressed, saved as Sandboxed PNGs (`documents/images/[sha256_hash]_[image_id].png`), and referenced in SQLite as dynamic portable `local-asset://[image_id].png` URIs.
* **`delineator` (Pass 2 - Semantic Structuring)**: Responsible for partitioning raw text and coordinate layout data into semantic block elements (`ASTNode`) and section hierarchies (Table of Contents) using LLM structuring models. It coordinates the 100-token (3-5 sentences) semantic overlap buffer for page boundary continuity.
* **`inference` (llama.cpp Offline Engine)**: Embeds `llama.cpp` bindings for zero-cost, local offline inference on-device (linked statically via the `llama_native` feature flag). It targets Apple's CoreML / Neural Engine via Metal shaders (iOS) and Qualcomm Snapdragon/MediaTek NPUs via NNAPI/OpenCL (Android). Restricts RAM footprints using 4-bit quantization (`Q4_K_M` or similar) to stay below $\le 1.8\text{ GB}$ to prevent OS-level Out-of-Memory (OOM) background terminations.
* **`desktop_server` (Developer HTTP Gateway)**: A lightweight `tiny_http` server hosting native parser, inference, and vector similarities. Exposes REST endpoints (`/parse`, `/inference`, `/delineate`, `/similarity`) and serves the SQLite database on `GET /db` to enable web-platform simulator execution without native mobile emulators.

### `mobile/src/` (Managed UI & Local Storage)
The mobile application runs on Expo SDK 50/React Native:
* **Directory Structure**:
  * `mobile/src/database/`: SQLite schema initializations, Drizzle ORM migrations (`mobile/drizzle/`), and search indexing triggers.
  * `mobile/src/native/`: React Native JSI bridge definitions and mock implementations for non-native environments (Web/Jest).
  * `mobile/src/screens/`: Layout screens (Tablet 3-pane responsive grid vs Smartphone sliding drawer and Bottom Sheet configurations).
  * `mobile/src/components/`: Performance cell renderers (Shopify FlashList block recycling) and visual block styling.
* **Local Storage & Schema**: Relational database is managed locally via `expo-sqlite` and Drizzle ORM. Auto-migration checks run synchronously at startup.
* **FTS5 Plain-Text Index**: Full-Text Search uses virtual tables and native SQLite FTS5 extension, with custom triggers extracting text recursively from AST JSON content to prevent XHTML/JSON formatting pollution.

### `mobile/modules/` (The High-Speed JSI Bridge)
* **Technology**: Local Expo Module (`mobile/modules/rust-parser-bridge` and C++ JNI exports `mobile/src/native/cpp/RustParserBridge.cpp`).
* **JSI Host Object & Expo Module**: Asynchronous thread offloading (`parsePDFAsync`, `delineatePageAsync`, `runInferenceAsync`) is safely orchestrated via Expo's `AsyncFunction` Kotlin bindings. The pure C++ JSI host object registers only synchronous methods (`computeSimilarity`, `computeBatchSimilarities`) to avoid raw `std::thread` stability issues in React Native contexts.
* **Hardware-Accelerated Math**: Bypasses JSI array serializations by obtaining direct pointers to `Float32Array` raw memory buffers. Computes cosine similarity synchronously with SIMD vectorization loops (`#pragma clang loop vectorize(enable)` / `#pragma GCC ivdep`), giving high-speed vector math performance directly in the JavaScript thread.

---

## 2. High-Density Unified Data Relational Map

### Relational Entity-Relationship Flow
The persistent entities are structured as follows:
```
corpora (Collections)
   └── documents (SHA-256 Identification, Sandbox Storage Path)
          └── sections (Recursive TOC Hierarchy, Sort Order)
                 └── blocks (Atomic Page Segments, Serialized JSON ASTNode)
```
Secondary tables link annotations, tags, and progress tracking:
* **`annotations`**: Highlight coordinates and markdown notes. Links to `documents` and `blocks` (nullable for Orphan Notes).
* **`tags`**: Lowercase, stripped semantic indices.
* **`block_tags`**: Junction table mapping many-to-many concepts.
* **`processing_jobs` & `job_chunks`**: Status tracker enabling resilient resume loops if background execution crashes.
* **`vector_cache`**: Synchronous cache storing `Float32Array` embeddings as raw SQLite `BLOB` fields (mapped directly to blocks, cascading on block removal).

### SQLite FTS5 Trigger Architecture
To isolate plain-text from JSON AST formatting strings (avoiding search hits on formatting attributes like `type`, `children`, `level`), the FTS virtual index is updated using native triggers. If the block contains valid JSON AST, the triggers utilize `json_tree` to select and concatenate only text-heavy keys:
* **Insert Trigger (`blocks_fts_ai`)**:
  ```sql
  CREATE TRIGGER IF NOT EXISTS blocks_fts_ai AFTER INSERT ON blocks BEGIN
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      CASE 
        WHEN json_valid(new.content) THEN (
          SELECT group_concat(value, ' ') 
          FROM json_tree(new.content) 
          WHERE key IN ('text', 'code', 'alt', 'caption')
        )
        ELSE new.content
      END
    );
  END;
  ```
* **Update Trigger (`blocks_fts_au`)**:
  ```sql
  CREATE TRIGGER IF NOT EXISTS blocks_fts_au AFTER UPDATE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
    INSERT INTO blocks_fts(block_id, content)
    VALUES (
      new.id,
      CASE 
        WHEN json_valid(new.content) THEN (
          SELECT group_concat(value, ' ') 
          FROM json_tree(new.content) 
          WHERE key IN ('text', 'code', 'alt', 'caption')
        )
        ELSE new.content
      END
    );
  END;
  ```
* **Delete Trigger (`blocks_fts_ad`)**:
  ```sql
  CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
  END;
  ```

---

## 3. Production Architecture Boundaries & Critical Guardrails

To maintain peak performance and avoid regression bottlenecks, developers must follow these six guardrails:

### 1. FlashList Bridge Serialization Volumetrics
* **Risk**: Large blocks freeze the bridge during serialization and trigger layout recalculations in recycled FlashList cells, introducing micro-stutters.
* **Limit**: Enforce a strict token/character upper bound ($200 \text{ to } 500 \text{ tokens}$ or ~1500 characters) per `blocks` entity. Longer sections must be segmented into multiple block entities to ensure smooth 120 FPS recyclerview recycling loops.

### 2. Main-Thread Transaction Stalling
* **Risk**: Opening SQLite write transactions or executing complex regex tag stripping/structural parsing on the JavaScript main UI thread freezes UI responsiveness.
* **Rule**: Execute regex cleaning and structural delineation in native Rust or on background thread workers (via JSI Promise threads). Keep SQLite write loops batch-oriented and minimize open transaction duration.

### 3. JSI Zero-Copy Memory Rules
* **Risk**: Copying float vectors as standard JavaScript arrays over JSI bindings causes extensive memory allocation overhead and serialization latency.
* **Rule**: Always pass vectors as `Float32Array` structures. Retrieve the raw float pointer on the C++ side using `ArrayBuffer` bindings directly:
  ```cpp
  jsi::ArrayBuffer arrayBuffer = bufferObj.getArrayBuffer(runtime);
  float* data = reinterpret_cast<float*>(arrayBuffer.data(runtime));
  ```

### 4. Context Overlap Purging
* **Risk**: Duplicate text blocks are saved in the database if overlap context elements (used to bridge page boundaries) are not stripped.
* **Rule**: Delineation prompts contain instructions ordering the LLM to filter out the 100-token prefix overlap context when generating the page output blocks. Future prompt alterations must preserve this context-filtering constraint.

### 5. Sync Conflict Topologies & Visual Merging
* **Risk**: Collaborative annotation editing can clump the SQLite database or lead to UI clutter when multiple users highlight the same lines.
* **Resolution**: 
  * **Myers 3-Way LCS Merge**: Character/word-level Myers LCS merge rules (using `<<<<<<< OURS`, `=======`, `>>>>>>> THEIRS` markers) resolve collisions on markdown notes.
  * **Decoupled Visual Merging**: Overlapping/identical highlights are stored as individual database records (with unique UUIDs and `author_id` identifiers). The mobile app uses `mergeOverlappingHighlights` to segment character offsets and dynamically display overlapping ranges cleanly, preventing database clumping.

### 6. Mock Storage Degradation
* **Risk**: Unit tests running against browser SQL mocks pass silently but fail on native devices.
* **Warning**: The web-based SQL mock environment (when `NODE_ENV === 'test'`) operates as a basic in-memory JS structure. It does NOT enforce foreign keys, `ON DELETE CASCADE` cascades, multi-table FTS5 triggers, or atomic transaction locks. Always run integration tests on the native target or CORS gateway to validate database features.

---

## 4. Interactive Testing, Building, & Verification Playbook

### Developer Commands Matrix

#### A. Configure & Build Build System
```bash
# Initialize build directory
cmake -B build

# Compile Rust native target libraries (libparser.a, libinference.a)
cmake --build build --target rust_core_libs

# Compile desktop gateway HTTP server
cmake --build build --target desktop-server
```

#### B. Run Servers Locally
```bash
# Start desktop server (serves SQLite DB on port 8080/db)
cmake --build build --target start-desktop-server

# Start Expo Web Metro development server (runs client on port 19006)
cmake --build build --target start-web-server
```

#### C. Run Test Suites
```bash
# Navigate to the build directory to run ctest
cd build

# Run all verification suites (Cargo, Jest, and Readme checks)
ctest --output-on-failure

# Run Synthetic Validation Integration pipeline only
ctest -C Debug -R SyntheticValidationTest --output-on-failure

# Run Cargo Rust tests only
ctest -C Debug -R CargoTests --output-on-failure

# Run Jest client tests only
ctest -C Debug -R JestTests --output-on-failure
```

### Compile-Time Options & Configuration Switches
These variables are passed to CMake during configuration (`cmake -B build -DOPTION=VALUE`):
* `-DBUILD_ANDROID_APK=ON/OFF` (Default: `OFF`): Cross-compiles for Android architectures, resolving NDK toolchain compilers automatically.
* `-DBUILD_IOS_FRAMEWORK=ON/OFF` (Default: `OFF`): Prepares Objective-C++ dynamic targets for CocoaPods / EAS iOS builds.
* `-DLLAMA_NATIVE=ON/OFF` (Default: `OFF`): Links upstream `llama.cpp` using local cache directories.
* `-DRUN_INTEGRATION_TESTS=ON/OFF` (Default: `ON`): Sets up Cargo and Jest test wrappers under `ctest`.
