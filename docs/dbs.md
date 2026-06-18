# Database Subsystem (`rust_core/dbs`)

The `dbs` crate acts as the centralized Data Access Layer (DAL) for the entire Document-to-Reader ecosystem. In previous iterations, the React Native frontend directly managed its own SQLite instance via `expo-sqlite`. To achieve maximum performance, strict data integrity, and seamless integration with the native ingestion pipeline, all database operations have been pushed down into this highly optimized Rust crate. The frontend now communicates with it entirely over the JSI bridge.

---

## 1. The Dual-Database Architecture

To safely accommodate the iterative, error-prone nature of LLM generation while maintaining a pristine user reading experience, the `dbs` crate manages two distinct SQLite databases:

### A. The Content DB (Persistent)

This is the permanent, local truth for the application. It houses the user's entire library, including corpora, fully processed document blocks, user-generated annotations, and search indices. The React Native frontend strictly reads from and writes user data to this database.

### B. The Agent DB (Ephemeral Workspace)

When a new document enters Pass 2 of the ingestion pipeline, the `dbs` crate dynamically provisions a temporary "scratch" database (e.g., `agent_scratch.db`). This completely isolates the LLM's iterative generation and reasoning process from the main app state.

* **Schema Parity for Content:** It utilizes an identical schema to the Content DB (for `sections`, `blocks`, `block_tags`) so the agent can format and validate entities exactly as they will appear in production.
* **Agent Scratch Space:** It contains distinct operational tables designed to manage the LLM's context window, state, and complex tool execution. These tables are *never* migrated to the Content DB:
* **`conversation_history`**: Tracks the ReAct loop state (including `id`, `system_prompt`, `input_json`, `error(s)`, and `next_prompt_id`). This allows the system to maintain the LLM's linear memory and retry logic without passing massive layout chunks back and forth in memory.
* **`pass1_chunks`**: Stores the raw structural output and 100-token overlap buffers from Pass 1 in strictly sized boundaries. The agent queries this table selectively to prevent overloading its context window.
* **`job_queue`**: Tracks asynchronous ingestion states (`status`, `error_message`), allowing the mobile UI to poll for real-time progress.
* **`hypothesized_entities`**: Temporarily stores, deduplicates, and refines extracted concepts and proposed tags. This is heavily utilized when the agent is performing inter-document linking and semantic tagging.
* **`scratch_vector_cache`**: An ephemeral embedding table that allows the agent to run similarity searches against its own freshly generated AST blocks. This enables accurate internal cross-referencing (e.g., dynamically anchoring a "See Figure 3" text span to the actual figure block).
* **`tool_results_cache`**: Caches the outputs of expensive or multi-step tool calls. If the ReAct loop is interrupted or encounters an error, the agent can retrieve these results without re-executing heavy data extraction protocols.
* **`malformed_blocks`**: A staging/quarantine table for LLM outputs that fail schema validation. Instead of crashing, the agent pushes broken JSON here, allowing it to query its own past mistakes and iteratively correct them via a repair loop without polluting the clean `blocks` table.



---

## 2. Relational Schema & Data Integrity

Both databases enforce strict referential integrity through foreign keys, cascades, and UUID primary keys (`TEXT`) to guarantee offline sync compatibility. The core entity-relationship model includes:

* **`corpora`**: Logical collections or libraries of documents.
* **`documents`**: The source files (PDF, EPUB, MD), uniquely identified by their cryptographic `sha256_hash`.
* **`sections`**: Self-referencing Table of Contents hierarchy (supports chapters, sub-chapters, and sub-sections).
* **`blocks`**: The atomic text segments, stored as serialized JSON `ASTNode` structures.
* **`annotations` & `tags**`: User highlights and notes linked directly to specific blocks via junction tables.

---

## 3. Atomic Migrations (The Agent Handoff)

Once the `agent_harness` successfully completes its ReAct loop for a document, the `dbs` crate handles the complex migration from the Agent DB to the Content DB.

1. **Attach & Lock:** The `dbs` module attaches the ephemeral `agent_scratch.db` to the main Content DB connection.
2. **Transactional Insert:** It executes a strict, atomic SQL transaction (e.g., `BEGIN TRANSACTION; INSERT INTO main.blocks SELECT * FROM scratch.blocks WHERE document_id = ?; COMMIT;`).
3. **Cleanup:** If the transaction succeeds, the temporary Agent DB is securely dropped from the filesystem. If it fails, the transaction rolls back gracefully, preventing any partial or corrupted document reads in the UI.

---

## 4. Advanced Indexing: Hybrid FTS5 & Vector Search

The `dbs` crate is responsible for ensuring instantaneous query capabilities across millions of tokens using a hybrid search approach.

* **AST-Aware FTS5 (Plain-Text Indexing):** Running standard SQLite Full-Text Search (FTS5) over JSON ASTs results in keyword pollution (e.g., searching for the word "text" returns every JSON key). The `dbs` module utilizes intelligent native SQLite triggers (`AFTER INSERT`) combined with `json_valid` and `json_tree` queries to extract *only* the plain-text content from the AST blocks, indexing it securely into a decoupled virtual table (`blocks_fts`).
* **Vector Embeddings Cache (`vector_cache`):** Semantic vector floats are persisted natively as raw `BLOB` fields.
* **Reciprocal Rank Fusion (RRF):** When a user searches the library, the `dbs` module performs an RRF calculation, dynamically fusing standard keyword matching (`BM25` via FTS5) with dense vector cosine similarity metrics (accelerated via C++ SIMD instructions). This provides highly accurate, semantically aware search results.
