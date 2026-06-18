# Agent Harness Subsystem (`rust_core/agent_harness`)

The `agent_harness` sub-crate manages Pass 2 of the ingestion pipeline. Rather than executing a simple, linear LLM pass, this module deploys a stateful, tool-calling AI agent operating in a ReAct (Reason + Act) loop. Its primary responsibility is to autonomously navigate, semantically tag, and structure the raw layout data extracted during Pass 1 into a clean JSON Abstract Syntax Tree (AST).

---

## 1. The Ephemeral Workspace (Agent DB)

To prevent polluting the main application database (Content DB) with incomplete or malformed LLM outputs, the Agent Harness operates entirely within an isolated, temporary SQLite database workspace.

* **Initialization:** When a document enters Pass 2, the harness spins up a temporary database (`agent_scratch.db`).
* **Data Ingestion:** The raw text and layout coordinates from Pass 1 (including the 100-token semantic overlap buffers) are pushed into this scratch database.
* **Schema Parity:** The Agent DB utilizes a table schema that explicitly mirrors the main Content DB, allowing the agent to format blocks, sections, and metadata exactly as they will appear in production.

---

## 2. Iterative ReAct Orchestration

The harness acts as the execution boundary between the embedded LLM (via the `inference` module) and the temporary database. It runs a ReAct loop that allows the LLM to process the document iteratively:

1. **Querying:** The agent issues tool calls to query specific chunks of raw text from the Agent DB.
2. **Structuring:** The LLM parses the raw text, identifies structural markers (e.g., chapter headings, list items, tables, and indices), and formats them into the unified JSON AST schema.
3. **Updating:** The agent uses writing tools to iteratively update the rows in the Agent DB with the newly structured blocks and metadata tags.
4. **Context Management:** The harness manages the LLM's context window by aggressively pruning history and utilizing the database as the primary source of memory state, preventing context overflow on long PDFs.

---

## 3. Extensible Tooling Interfaces

The agent's capabilities are defined by a strict set of JSON/MCP (Model Context Protocol) tool schemas. This design ensures that metadata generation is highly extensible.

Current tooling allows the agent to:

* Extract and generate Table of Contents (ToC) indices for documents missing native structural metadata.
* Create semantic links and cross-references between different sections.
* Tag text blocks with relational metadata.
* *(Future Extensibility)*: Because the tooling is abstracted, developers can easily add new tool schemas (e.g., "Extract Entities", "Summarize Chapter") without rewriting the core ReAct loop.

---

## 4. Atomic Migration

Once the agent concludes its extraction and formatting tasks (or reaches a defined completion state), the harness orchestrates a secure handoff:

1. **Validation:** The harness verifies the structured AST nodes within the Agent DB for schema compliance.
2. **Migration:** The `agent_harness` signals the `dbs` (Database) module to attach the ephemeral database to the main Content DB. An atomic SQL transaction safely copies all completed entities (documents, sections, blocks, tags) into the permanent storage.
3. **Cleanup:** Upon successful migration, the temporary Agent DB is securely dropped from the file system, leaving no orphaned data.
