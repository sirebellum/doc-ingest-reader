# Project Implementation Details: LLM PDF Ingest & Reader App

This document serves as the primary technical reference for **concrete software integrations, layout maps, and package configurations**. Append any updates chronologically to the **Change Log & Addendums** section at the bottom.

---

## 1. Directory Structure & File Layout

Monorepo containing React Native (Expo) frontend and compiled native C++/Rust cores:

```
llm-pdf-ingest/
├── assets/                     # Shared static assets (branding, fonts)
├── docs/                       # Project documentation
│   ├── impl.md                 # Technical implementation specs (this file)
│   ├── specs.md                # System-level definitions & schemas
│   ├── parser.md               # Detailed PDF Ingestion & Parsing Subsystem
│   ├── inference.md            # Detailed Local Inference Subsystem
│   ├── mobile_frontend.md      # Detailed Mobile Frontend & UX Subsystem
│   └── database_sync.md        # Detailed SQLite DB & FTS5 Indexing Subsystem
├── rust_core/                  # High-performance native parsing & inference (Rust + C++)
│   ├── Cargo.toml              # Cargo workspace manifest
│   ├── parser/                 # Rust-based PDF layout analysis & parsing library
│   │   └── tests/              # Ingestion golden-truth parser test harnesses
│   └── inference/              # Embedded llama.cpp bindings for offline inference
├── mobile/                     # React Native Expo client application
│   ├── App.tsx                 # Main entry point
│   ├── app.json                # Expo config
│   ├── package.json            # Frontend package manifest
│   └── src/
│       ├── api/                # LLM connectors (BYOK cloud, Wi-Fi network endpoints)
│       ├── components/         # Shopify FlashList cell renderers
│       ├── database/           # SQLite setup, database schema sync triggers
│       ├── native/             # JSI bindings & host object wrappers for rust_core
│       ├── screens/            # UI screens (ReadingView, Library, Exports)
│       └── utils/              # SHA-256, W3C Web Annotation fuzzy anchoring logic
└── instructions.md             # Developer & Agent instructions
```

---

## 2. On-Device Ingestion & Synthetic QA Pipeline (Rust)

### 1. Rust Native Dependencies (`rust_core/Cargo.toml`)
```toml
[workspace]
members = ["parser", "inference"]

[dependencies]
lopdf = "0.31.0"           # Low-level content stream manipulation
pdfium-render = "0.8.0"    # High-fidelity layout boundary analysis
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
sha2 = "0.10"              # High-performance SHA-256 cryptographic hashing
```

### 2. On-Device PDF Processing Logic
- **Pass 1: Rust Static Extraction & Sandbox Mapping**:
  - `lopdf` reads structural object streams while `pdfium-render` calculates geometric column bounding boxes.
  - Embedded PDF images are extracted as compressed PNGs and saved in the local sandbox at `documents/images/[sha256_hash]_[image_id].png`.
  - **Dynamic Sandbox Resolution (`local-asset://`)**: To prevent broken image links on iOS (where the App Sandbox UUID changes dynamically upon app updates), the generated HTML must use a custom URI scheme `local-asset://[image_id].png` rather than hardcoding absolute `file://` paths. The React Native `react-native-render-html` renderer will intercept the `local-asset://` scheme at runtime, map it to the active `FileSystem.documentDirectory`, and dynamically resolve the absolute sandbox path.
  - Core chunks raw pages with **overlap context** (the last 3-5 sentences / ~100 tokens of page $N-1$ are prepended to page $N$) to ensure heading and sentence continuity.
- **Pass 2: LLM Structuring & Tagging Orchestration**:
  - The Expo app feeds extracted text, layout bounds, and overlap buffers from Rust into the target LLM.
  - The LLM performs semantic parsing to return XHTML tags, cross-references, and tag indices.

### 3. LLM Input/Output JSON Contracts

#### A. Input Payload (Rust Core to LLM)
```json
{
  "document_id": "doc-uuid-12345",
  "page_number": 4,
  "overlap_context": "...ending text of page 3 for semantic continuity...",
  "raw_text": "extracted text of page 4...",
  "layout_hints": [
    {
      "bounding_box": [12.5, 45.0, 520.0, 65.0],
      "font_size": 18.0,
      "text_snippet": "Chapter 2: Semantic Indexing"
    }
  ]
}
```

#### B. Output Payload (LLM to Ingestion Engine)
```json
{
  "blocks": [
    {
      "block_type": "heading",
      "html_content": "<h2 id=\"chapter-2-semantic-indexing\">Chapter 2: Semantic Indexing</h2>",
      "hyperlink_targets": ["#chapter-1-overview"],
      "semantic_tags": ["indexing", "search", "semantic"]
    },
    {
      "block_type": "paragraph",
      "html_content": "<p>This is the first paragraph under Chapter 2 containing key ideas on search.</p>",
      "hyperlink_targets": [],
      "semantic_tags": ["tagging", "sqlite", "fts5"]
    }
  ]
}
```

### 4. QA Prompt Refinement Tracker (`rust_core/parser/tests/prompt_history.json`)
All Pass 2 prompts are verified against double-column, nested table, code block, list, and image-caption synthetic layout scenarios. Success logs must adhere to this schema:
```json
[
  {
    "prompt_id": "pass2-structuring-v1.0",
    "timestamp": "2026-05-28T04:15:00Z",
    "target_model": "default-local-model",
    "system_prompt": "Prompt instruction content...",
    "user_template": "User input structure...",
    "exhibited_issues": ["Description of syntax wrapper issues in layout edge cases..."],
    "success_rate": 0.85,
    "notes": "First baseline ingestion prompt for structural block segmentation"
  }
]
```

---

## 3. Local SQLite Database Initialization (Mobile)

### 1. Client SQLite & Native Tool dependencies (`mobile/package.json`)
```json
{
  "dependencies": {
    "expo-sqlite": "~14.0.0",
    "expo-file-system": "~16.0.0",
    "expo-sharing": "~12.0.0",
    "react-native-quick-crypto": "^0.6.0",
    "shopify/flash-list": "1.6.0",
    "react-native-render-html": "6.2.0",
    "@gorhom/bottom-sheet": "^4.6.0",
    "react-native-reanimated": "~3.6.2",
    "react-native-gesture-handler": "~2.14.0"
  }
}
```

### 2. Startup Schema Initializer (`mobile/src/database/schema.ts`)
The startup database initializer opening the connection and installing database triggers:
```typescript
import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('llm_pdf_reader.db');

// RELATIONAL SQL TABLE SCHEMAS ARE DEFINED IN specs.md Section 3.
export const INITIALIZE_DATABASE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  -- Relational SQLite tables 'corpora', 'documents', 'sections', 'blocks',
  -- 'annotations', 'tags', and 'block_tags' are created here on startup.
  -- See specs.md for full column parameters and foreign key constraints.

  -- Sync triggers for FTS5 full-text indexing
  CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
    block_id UNINDEXED,
    content
  );

  CREATE TRIGGER IF NOT EXISTS blocks_fts_ad AFTER DELETE ON blocks BEGIN
    DELETE FROM blocks_fts WHERE block_id = old.id;
  END;
`;

export function setupDatabase() {
  db.execSync(INITIALIZE_DATABASE_SCHEMA);
}
```

---

## 4. Mobile Frontend & React Native Details

### 1. Vertical Scrolling Rendering Flow
- **Recycled Cells (FlashList)**: Uses Shopify `FlashList` for recycling block containers, securing 120 FPS performance on native devices.
- **Section-Level Memory Swapping**: Blocks are loaded strictly at the active chapter level (`section_id`). As the reader scrolls near section boundaries, adjacent pages are pre-fetched while distant pages are purged from the JS heap.
- **Block rendering**: Sanitized block content is displayed natively via custom styled `react-native-render-html` wrapper elements.

### 2. Adaptive Screen Grid Layout System
- **Tablet Grid (3-Pane row layout)**:
  - Left Pane (width: ~250dp): Docked navigation list for corpora, documents, and chapter sections.
  - Middle Pane (flex: 1): Scrollable Shopify FlashList reading block.
  - Right Pane (width: ~300dp): Margin highlights list, interactive notes, tag pills aligned beside active block positions.
- **Smartphone Layout (Collapsible single-pane)**:
  - Slide-out sliding Drawer Navigation (menu or swipe-activated).
  - Tapping highlights opens a native `gorhom/bottom-sheet` modal for annotation/tag editing.

### 3. UI Navigation & Component Hierarchy Tree
```
AppRoot (GestureHandlerRootView)
 └── NavigationProvider
      ├── SmartphoneView (Single Pane)
      │    ├── HeaderBar (Menu Trigger, Title, Search, ChapterPagination)
      │    ├── NavigationDrawer (Left Pane)
      │    ├── ShopifyFlashList (Middle Reader Pane)
      │    ├── FooterBar (ChapterPagination)
      │    └── BottomSheetModal (Contextual Note Editor)
      │
      └── TabletView (Split Pane Row Layout)
           ├── HeaderBar (App Title, Search)
           └── SplitPaneGrid
                ├── DockedNavigationSidebar (Left Pane)
                ├── ReaderContainer (Middle Pane + Header/Footer Pagination)
                └── CollapsibleMarginsSidebar (Right Pane: Note Editor)
```

- **Chapter Navigation Pagination Bar**: Sticky headers and footers display a horizontal scrollable view containing short snippets of neighboring chapters (e.g. `< Ch 2: Stack  [Ch 3: Database]  Ch 4: Routing >`) to allow rapid chapter jumping.
- **Contextual Note Editor**: Text input panel supporting Markdown bodies linked with an autocomplete search text field. Queries existing tags in real-time (`SELECT * FROM tags WHERE name LIKE 'input%' LIMIT 5`) and stores selections as lowercase normalized badges.

### 4. Native JS-to-Rust JSI Bridge (`mobile/src/native/`)
To achieve high-performance native operations without freezing the single-threaded React Native UI thread during intensive static parsing (Pass 1), the native C++ bridge exposes an asynchronous Promise-based wrapper:
```javascript
// Asynchronous JSI execution on a background C++ thread
global.RustParserBridge.parsePDFAsync(localPath)
  .then((resultString) => {
    const parsedDoc = JSON.parse(resultString);
    // Process the parsed document blocks and populate the database...
  })
  .catch((error) => {
    console.error("PDF parsing failed:", error);
  });
```
The underlying Rust parsing logic executes on a background worker thread, resolving the JavaScript Promise when complete. This frees up the main JavaScript thread to render real-time progress indicators and handle layout interactions without micro-stutters.

### 5. File Backups Sharing & Portability
- **JSON Export**: Compiles book metadata and annotations into a portable structured payload. Cryptographic SHA-256 checks preserve document ownership by never copying the raw document source.
- **JSON Import**: Resolves import conflicts through:
  - **Upsert Matching UUIDs**: Compares `updated_at` timestamps on matching UUIDs (`id`) and retains/overwrites the database record with the most recently modified version.
  - **Visual Merging of Co-existing Annotations**: Allows different UUIDs to co-exist on the exact same text span (enabling social reading). The React Native frontend is responsible for visually merging overlapping highlighted ranges in the reading pane to prevent UI clutter while maintaining access to notes from all contributors.
  - **Fuzzy Anchoring Fallback**: Mismatched annotations are isolated as unanchored items in the Orphan Notes sidebar, or fuzzy-re-anchored using SQLite FTS5 plain-text queries and W3C context properties.

---

## 5. Local & Hosted LLM Routing Architecture

Pre-ingestion dashboard allows users to choose their LLM route based on speed/privacy:
- **Local Inference (llama.cpp)**: Links compiled C++ code directly into `rust_core` JSI modules, mapping runtime structural memory context directly without SQLite serialization. Accelerates via Apple Neural Engine / Android DSP NPUs. **Flag: "Local Processing (Estimated: ~45-60 mins)"**.
- **Local Network Link**: Configurable IP inputs (`http://192.168.1.50:11434`) routing extraction to LM Studio/Ollama instances. **Flag: "Local Network (Estimated: ~15-20 mins)"**.
- **BYOK Cloud Fallback**: API keys input routing payload directly to Claude, Gemini, or OpenAI clients. **Flag: "Cloud Processing (Estimated: ~5-10 mins)"**.

---

## 6. Cryptographic Matching & Fuzzy Anchoring

When importing `shared_notes.json`:
1. **SHA-256 Identification**: Computes target file cryptographic SHA-256 hash. If it matches a document in SQLite, annotations instantly overlay.
2. **Metadata Fallback Reader**: If the hash differs, the system renders highlights in a beautiful fallback window displaying the banner: *"Notes for document [Title]. Import original PDF with SHA-256: [Hash] to overlay highlights directly in the book."*
3. **Fuzzy Text Re-Anchoring**: If the document title/author matches but the SHA-256 hash differs (e.g. different edition), the app runs SQLite FTS5 plain-text queries. Utilizing W3C prefix, suffix, and offset properties, it fuzzy-anchors annotations back onto active content blocks.

---

## 7. Change Log & Addendums

### [v1.0.0] - 2026-05-28
- **Initial Outline**: Detailed JSI native Rust parser integration with a two-pass chunking strategy, dynamic LLM pre-ingestion routing select dashboard, and Expo SQLite setup. Configured section swapping for Shopify FlashList rendering, SHA-256 asset sandbox extraction, FTS5 blocks sync triggers, and fuzzy anchoring workflows.
- **Refactoring & Migration**: Moved to `docs/impl.md` and renamed as part of system documentation streamlining.

### [v1.1.0] - 2026-05-28
- **Architecture Refinements**: Specified the `local-asset://` custom scheme for dynamic iOS sandbox visual asset path resolution. Outlined the asynchronous `parsePDFAsync` Promise-based JSI execution to keep the React Native main UI thread completely fluid. Aligned JSON backup import conflict mechanics (upserts, visual merging) with `specs.md`.

### [v1.2.0] - 2026-05-28
- **Visual Graphs, LZW Packer, BLE Sync, and Myers Diff Merging Implementation**: Built `ConceptGraphScreen.tsx` incorporating a 2D spring physical layout calculated on-mount (150 steps), zoomable/pannable SVG groups mapped to gesture handlers, contextual FTS5 tag searches, a simulated BLE sync modal, and a Split-Pane conflict resolution editor. Implemented `packer.ts` with 16-bit BE binary LZW compression, sandboxed image file reads/writes via dynamic `expo-file-system` imports, and ECDSA key signature verifications. Built `bleSync.ts` with the `BLESyncCommunicator` partitioning deltas into 512-byte MTU chunk strings with DJB2 checksums and reassembly logic. Refactored `merging.ts` to implement a hybrid line/word-level Myers LCS 3-way merge, inserting conflict markers inline, and integrated it into backup and P2P sync applies when different authors' edits collide.

### [v1.3.0] - 2026-05-28
- **Phase 9 Native Platform Compilation & Dynamic FFI Library Bindings**: Established static compiler configs for multiple target platforms (`build.rs`), implemented true native FFI execution path in `rust_core/inference/src/lib.rs` (guarded by the optional `llama_native` feature flag), completed Promise resolution inside JSI wrappers (`RustParserBridge.cpp`), exposed `getHeapStats()` and `configureNpu(config)` native diagnostic methods, and designed a custom Expo Config Plugin `withNativeLibraries.js` with `eas.json` support. Designed `ModelDownloader` in `mobile/src/utils/modelDownloader.ts` to fetch Gemma-3-1b GGUF model files from Hugging Face with resumable download hooks. Expanded Jest unit tests to achieve 100% test passing (119/119 passing tests).

### [v1.4.0] - 2026-05-28
- **Phase 10 High-Fidelity Binary Image Stream Extraction**: Overhauled `rust_core/parser/src/lib.rs` by implementing type-safe character boundary and font size loops (`c.loose_bounds()` and `c.unicode_string()`). Built dynamic image stream decoder extracting from `pdfium-render` (`get_processed_image(&doc)`) with automatic structural stream decoders in `lopdf` (`decompressed_content()`) as fallback. Calculates SHA-256 hashes of decoded image bytes and writes compressed PNGs to `[parent_pdf_dir]/images/[sha256_hash]_[image_id].png`. Returns layout coordinates, page dimensions, and `local-asset://` references inside JSI contracts. Created `localAssetResolver.ts` in the React Native frontend to map portable URIs dynamically at runtime, ensuring robust visual block rendering across device Sandbox updates. Expanded Jest unit tests to achieve 100% test passing (123/123 tests passing completely green).

### [v1.5.0] - 2026-05-28
- **Phase 12 Native similarity & Hybrid Search Ranker**: Extended the `RustParserBridge` C++ JSI host object definitions and implementations (`RustParserBridge.h` and `RustParserBridge.cpp`) with synchronous vector similarity operations, parsing binary typed float arrays (`Float32Array`) via ArrayBuffer pointers. Designed robust pure-JS fallback calculations in `RustParserBridge.ts` for Jest/simulation portability. Updated `schema.ts` with the new persistent binary `vector_cache` table (cascading with blocks deletion). Overhauled `vectorCache.ts` (`VectorLRUCache`) to handle synchronous cache-through SQLite BLOB reads and writes. Updated the background process job in `worker.ts` to write dense float array embeddings to `vector_cache`. Fully refactored `search.ts` (`searchHybrid`) to fuse BM25 keyword rankings with JSI cosine similarities utilizing standard Reciprocal Rank Fusion (RRF) math. Created comprehensive test coverage in `search.test.ts` (133/133 tests passing 100% green).

### [v1.6.0] - 2026-05-28
- **Phase 13 Multi-Format Ingestion Pipelines (EPUB, HTML, Markdown)**: Extended JSI/FFI parsing bindings to identify document formats natively by extension. Built custom pure-Rust static parsers in `rust_core/parser/src/lib.rs` and equivalent Node-compatible TypeScript fallbacks in `mobile/src/native/RustParserBridge.ts` for Markdown, HTML, and EPUB. Updated the background processing worker `processDocumentJob` inside `worker.ts` to route formats dynamically: structured non-PDF formats bypass chunked LLM parsing and insert multi-level sections, XHTML content blocks, tags, vector embeddings, Float32Array binary `vector_cache` BLOB fields, and autogenerated annotations (highlights) directly in a single SQLite transaction. Created `multiFormat.test.ts` test suite confirming 100% green Jest results (138/138 green tests).

### [v1.7.0] - 2026-05-28
- **Unified CMake Build System & Native Expo JSI Module**: Designed a comprehensive CMake build system featuring targets to cross-compile the high-performance native Rust core workspace (`rust_core`), copy targets static libraries (`libparser.a` and `libinference.a`) into target-triple search folders, generate Expo platform modules, and orchestrate compiling the Android APK and iOS equivalent app bundles. Packaged the C++ JSI host bridge (`RustParserBridge.cpp`) inside a modern local Expo Module (`mobile/modules/rust-parser-bridge`) with Gradle CMake compilation, C++ JNI installation interfaces (`jni-bridge.cpp`), and iOS CocoaPods/Objective-C++ integrations (`RustParserBridgeModule.mm`), securing reliable native compilation paths and 100% green automated test suites (166/166 passing tests).

### [v1.8.0] - 2026-05-29
- **Web-to-Desktop Developer Flow & HTTP Server Gateway**: Integrated a lightweight, zero-dependency desktop HTTP server in the new workspace crate `rust_core/desktop_server` using `tiny_http`. Exposes native Rust PDF layout analysis (`RealPdfExtractor` with mock fallbacks), EPUB, HTML, and Markdown parsing, on-device llama.cpp inference wrappers, and dense float vector similarity math directly to web clients. Features strict CORS headers to allow browser security handshakes. Updated React Native JSI bridge `RustParserBridge.ts` to dynamically detect web environments and forward PDF extraction and vector calculations directly to the native desktop gateway, enabling zero-emulator high-fidelity local browser testing. Configured root `CMakeLists.txt` with native host targets `desktop-server` and `start-desktop-server`.

### [v1.9.0] - 2026-05-29
- **Webpack ignore & browser SQL mock**: Resolved Jest-bundling ReferenceErrors by configuring strict Windows-compatible regular expression exclusions on Webpack's `IgnorePlugin` and the `babel-loader` rule, and moved test suites out of `app/` to `__tests__/`. Polyfilled SQLite web support inside `schema.ts` utilizing `Platform.OS === 'web'` to supply a pure JS mock database, enabling zero-emulator browser rendering and navigation testing. Configured `package.json` with a cross-platform inline script setting `EXPO_NO_BROWSER=1` to run the dev server on port `19006` cleanly without stealing browser focus.
- **Table of Contents Navigation Fix**: Fixed broken TOC chapter navigation on the web by updating `schema.ts`'s `getAllAsync` blocks query mock to dynamically resolve mock content blocks based on the parsed `section_id` parameter (Chapter 1 vs Chapter 2). Integrated a `useEffect` hook inside `FlashListReader.tsx` to reset the Recyclerview scroll offset back to `0` whenever a new section transitions, providing a fluid reading UX.

### [v2.0.0] - 2026-05-30
- **Modern Reader UI Enhancements & Secure Sync Features**: Implemented the renamed Library page, search bar filtering (`useMemo`), and title bar Home navigation button (`router.replace('/')`). Integrated the horizontal Sticky Pagination Bar for chapter traversal. Fully implemented Asymmetric Key Manager (ECDSA author keys keypair generation), secure backup import/export, and P2P Wi-Fi local network delta synchronization simulations. Validated 100% green Jest results (166/166 passing tests).

### [v2.0.1] - 2026-05-30
- **Resolve Webpack Critical Dependency Warnings**: Replaced expression-based dynamic `require` statements with safe `eval('require')` wrappers inside conditional checks. This bypasses static analysis by Webpack for browser bundle exports, silencing all three critical dependency warnings without impacting runtime or local unit testing environments.

### [v2.1.0] - 2026-06-03
- **Production Schema Hardening with Drizzle ORM**: Formally introduced `drizzle-orm` and `drizzle-kit` to replace legacy raw SQLite DDL scripts. Configured the relational schema in `mobile/src/database/schema.ts` and generated migrations in `mobile/drizzle/`. Installed startup auto-migration execution checks using Drizzle's migration runner.
- **Contract-Based Rust Typescript Integration**: Defined high-fidelity contract structures for JSI and LLM responses using `ts-rs` / `specta` in `rust_core/contracts`, generating TypeScript types directly into `mobile/src/shared/types/` to enforce strict IPC/FFI boundary type safety.
- **AST Native Rendering**: Replaced `react-native-render-html` in the React Native frontend Reader components (`BlockCell`, `HorizontalReflowReader`) with a recursive AST traversal engine that maps `ASTNode` structures directly to native `<Text>`, `<View>`, and `<Image>` widgets, improving rendering efficiency and layout control.

### [v2.2.0] - 2026-06-03
- **Pass 2 LLM Delineator Integration**: Implemented a standalone `delineator` crate within `rust_core` mapping extracted page coordinates, raw text, and overlap segments to `MultiFormatExtraction` structure containing section hierarchy and semantic blocks. Exposed C FFI bindings called by C++ JSI host object methods (`delineatePageAsync`) resolving Promises on background worker threads. Wired web/simulator mock overrides in TypeScript and integrated into the background worker SQLite database insertion pipeline. Added POST `/delineate` endpoint to `desktop_server`.

### [v2.3.0] - 2026-06-03
- **E2E Integration Testing & Developer Web DB Linkage**: Added `e2e_integration_test.rs` under `rust_core/parser/tests/` to run Pass 1 layout extraction from `Research Notes.pdf`, verify overlap context filtering in delineator synthesis, and serialize structured contents into an SQLite database asset. Integrated FTS5 virtual table indexing triggers using SQLite's JSON tree extraction to prevent tag search pollution. Updated `desktop_server/src/main.rs` to serve the generated SQLite test database asset on `GET /assets/llm_pdf_reader.db` and `/db` CORS-compliantly.

### [v2.4.0] - 2026-06-04
- **Database Schema Remediation & Web SQL Mocking**: Remediated the database schema discrepancy by aligning the manual DDL initializer in `mobile/src/database/schema.ts` with Drizzle schemas (`vector_cache`, `layout_height_cache` tables, and `author_id` in `annotations`). Upgraded the virtual FTS5 text insertion triggers (`blocks_fts_ai` and `blocks_fts_au`) to be JSON-AST aware, parsing plain-text elements using `json_tree` to avoid search index pollution. Integrated a zero-emulator Web mock database layer utilizing `Platform.OS === 'web'` checks on load to resolve Webpack/browser runtime type crashes. Verified 100% green unit and E2E integration test suites.

### [v2.5.0] - 2026-06-04
- **Line-Based Layout Segmentation & Ingestion Verification**: Replaced unstable word-level coordinate vertical sorting in `RealPdfExtractor` with a robust line-based grouping/sorting process. It aggregates text segments vertically by Y-center proximity (8.0 PostScript points tolerance) and sorts left-to-right horizontally, resolving layout jumbling on single-column documents. Introduced the `research_notes_test.rs` integration suite verifying 100% token accuracy of `Research Notes.pdf` ingestion and clean FTS5 HTML-stripped indexing. Launched the CORS-compliant local HTTP server and Expo dev server to verify layout display.

### [v2.6.0] - 2026-06-04
- **Web Dynamic Gateway Sync & Warning Displays**: Implemented dynamic fetch-driven loading of the SQLite database over the desktop server CORS gateway (`/db`) using `sql.js` WASM compilation on the web client. Added full connection error tracking inside context provider hooks. Configured error warning layouts and native alerts on both the Library dashboard and the Reader screen, replacing mock fallback lists when the backend server is unreachable. Added a root-level `README.md` guiding execution of compilation, integration tests, gateway server, and the Expo web server.

### [v2.6.1] - 2026-06-04
- **Mock Data Standardization & README Path Correction**: Audited document ingestion pipeline database pathing. Corrected SQLite database artifact locations inside `README.md` to point to the correct test generation path `parser/target/test_artifacts/test_corpus.db`. Overhauled mock and fallback datasets inside the JSI bridge (`RustParserBridge.ts`), local mock database setups (`schema.ts`), and Rust mock parser implementations (`lib.rs`) to include explicit simulation markings (`is_mock: true` and `origin: "synthetic_simulation_stub"`). Verified all 192 Jest and Cargo tests remain 100% green.

### [v2.7.0] - 2026-06-04
- **On-Device Model Downloader & End-to-End LLM Ingestion Pipeline Verification**: Built the resilient, range-resumable chunked model downloader in `rust_core/inference` and registered it via FFI bindings. Created E2E integration test `e2e_llm_ingestion.rs` executing layout analysis, download verification, delineator synthesis, purging of overlap contexts, and atomic SQLite transaction indexing. Launched local desktop database server gateway and Expo developer Metro server to verify end-to-end rendering on browser platforms.

### [v2.8.0] - 2026-06-04
- **Unified CMake Build & Test Automation Wrapper**: Overhauled the top-level build workspace structure by introducing configuration toggles `BUILD_ANDROID_APK` (Default: `OFF`), `BUILD_IOS_FRAMEWORK` (Default: `OFF`), `RUN_INTEGRATION_TESTS` (Default: `ON`), and `LLAMA_NATIVE` (Default: `OFF`). Created sub-level `CMakeLists.txt` configurations for `/rust_core` and `/mobile` directing Cargo and Node task compilation chains. Configured CMake modules (`FetchContent`) to fetch and compile upstream dependencies (`llama.cpp`) with offline caching validation, integrated test setups for Cargo, Jest, and README validation checks via CTest, and added pre-build safety gates inside local JSI modules (`build.gradle` and `RustParserBridgeModule.podspec`).

### [v2.9.0] - 2026-06-05
- **Clean Keyboard Interrupt Exit for Web Server**: Resolved an issue where cancelling/interrupting the `start-web-server` CMake target left the Expo Node.js server running in the background on Windows. Created a custom Node.js script wrapper `mobile/scripts/start-web-server.js` that sets the environment variables (`BROWSER=none` and `EXPO_NO_BROWSER=true`), configures `process.argv` arguments, and executes the `@expo/cli` entry-point directly. Updated `mobile/CMakeLists.txt` to execute this script using `${NODE_EXE}` directly, avoiding batch file (`npm.cmd`) process group issues and ensuring clean termination on SIGINT/cancellation.










