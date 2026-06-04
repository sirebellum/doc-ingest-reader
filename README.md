# LLM PDF Ingest & Reader App — Development Flow Guide

This document describes how to run and test the complete end-to-end local development flow for the offline-first PDF layout extraction, ingestion, and reading system.

---

## 🛠️ Prerequisites

Ensure you have the following environments installed:
- **Rust (Cargo)**: [rustup.rs](https://rustup.rs/) (v1.75+)
- **Node.js & npm**: [nodejs.org](https://nodejs.org/) (v18+)

---

## 🚀 Step-by-Step Developer Workflow

### 1. Ingestion Pipeline & Test DB Generation

To parse and ingest raw documents (e.g. `Research Notes.pdf`) into a structured SQLite database file, run the Rust integration tests. This executes layout extraction, paragraph sorting, and FTS5 synchronization.

```bash
# Navigate to the native rust core
cd rust_core

# Execute the integration tests (this populates parser/target/test_artifacts/test_corpus.db)
cargo test
```

This test generates a pre-populated SQLite database at `rust_core/parser/target/test_artifacts/test_corpus.db` containing the parsed semantic AST blocks and sections of the PDF.

### 2. Run the Gateway Database Server

The React Native Expo Web build runs inside the web browser sandbox and cannot access the local filesystem database directly. We host the SQLite database on a lightweight, local CORS-compliant HTTP gateway.

```bash
# Navigate to rust_core (if you aren't already there)
cd rust_core

# Compile and start the desktop database server gateway
cargo run -p desktop_server -- --db parser/target/test_artifacts/test_corpus.db
```

The gateway server starts at `http://localhost:8080`.
- **Database Endpoint**: `http://localhost:8080/db` serves the raw SQLite binary.
- **REST Endpoints**: `/parse`, `/inference`, `/delineate`, `/similarity` are available for layout and model actions.

### 3. Run the UI Web Server (React Native Web)

Start the Metro and Expo web compiler to serve the React Native frontend application in the browser.

```bash
# Navigate to the mobile package folder
cd mobile

# Install frontend dependencies
npm install

# Start the Expo web developer server on port 19006 (without stealing window focus)
npm run web
```

### 4. Verify in the Browser

Open your browser and navigate to:
👉 **[http://localhost:19006](http://localhost:19006)**

- **When the desktop server is running**: The Library page fetches the SQLite database from the gateway, initializes `sql.js` in the browser, displays `Research Notes.pdf`, and lets you read/annotate the document.
- **When the desktop server is stopped**: The Library shows a clean warning banner explaining the connection problem, and displays an empty library (instead of falling back to fake mock data).

---

## 🧪 Programmatic Synthetic PDF Validation Flow

To verify character-level and structural correctness of the pipeline without relying on external static PDF assets, you can run the synthetic validation suite.

```bash
# Navigate to the native rust core
cd rust_core

# Run the synthetic validation test suite
cargo test --test e2e_synthetic_validation
```

This pipeline executes the following stages:
1. **Stage 0: Pre-PDF Generation**: Serializes raw golden text content to `synthetic_pre_pdf.json`.
2. **Stage 1: PDF Compilation**: Compiles a multi-column PDF with paragraphs and tables to `golden_test.pdf`.
   - *Navigation Metadata Assertion*: Programmatically verifies that the compiled PDF contains **no navigation outlines/bookmarks**, validating that the downstream LLM handles section delineation and indexing independently.
3. **Stage 2: Pass 1 Extraction**: Extracts layout boundaries, coordinates, and words to `synthetic_pass1_output.json`.
4. **Stage 3: Pass 2 Delineation**: Simulates LLM inference to partition the text, discard the overlap buffer, and generate chapter bounds (`synthetic_pass2_output.json`).
5. **Stage 4: DB Synchronization**: Writes structured blocks, sections, and metadata tables to `synthetic_test.db` with FTS5 search triggers.
6. **Stage 5: Differential Checks**: Compares token-by-token database text against Stage 0 pre-PDF content to verify 100% ingestion fidelity.

