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

