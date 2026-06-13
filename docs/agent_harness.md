# Agentic Pass 2 Architecture (Agent Harness)

This document details the Pass 2 pipeline architecture residing in `rust_core/agent_harness`, which is responsible for semantic structuring of ingested documents.

---

## 1. Architectural Shift: From Pipeline to Stateful ReAct Loop

The Pass 2 semantic structuring has moved away from a traditional, linear delineator pipeline. Instead, it utilizes a stateful **Agent Harness** operating as a ReAct (Reasoning and Acting) loop.

- **Stateful Execution**: The `AgentState` manages the active lifecycle of the ingestion process. Instead of passing data blindly through functions, the LLM actively explores the provided context and coordinates the database mapping.
- **C FFI Interface**: The loop operates efficiently over C FFI, enabling seamless interop with the JSI bridge and the React Native frontend without native memory overhead or thread blockages.

## 2. Ephemeral Agent Database (`temp_agent_scratch.db`)

To ensure maximum performance and protect the primary UI thread rendering the 120fps FlashList, the Agent Harness utilizes a dedicated ephemeral database: `temp_agent_scratch.db`.

- **Isolated Sandbox**: The `temp_agent_scratch.db` is an isolated physical file on disk wiped between sessions.
- **1-to-1 Mirror**: It contains exact structural replicas of `sections`, `blocks`, `block_tags`, and `cross_references` tables to enable rapid inserts.
- **Pipeline Memory (`agent_context`)**: Immediate prompt history and reasoning steps (`id`, `session_id`, `role`, `content`, `token_count`) are tracked linearly in this database. This provides the LLM with conversational context without polluting the permanent layout DB.
- **Atomic Migration Hook**: When ingestion completes, the `migrate_agent_to_content` hook runs an `ATTACH DATABASE` maneuver. This atomically inserts the scratch data into the permanent `content.db` wrapped securely within a `BEGIN TRANSACTION; ... COMMIT;` block.

## 3. Type-Safe Rust Tools (MCP / JSON Schema)

The LLM is strictly prohibited from running raw SQL. Instead, the Agent Harness provides a Model Context Protocol (MCP) compatible suite of type-safe Rust tools, accessible via `serde_json` arguments:

1. **`QueryAgentDB`**: Fetch semantic layout text and metadata (including 100-token overlaps) from `pass1_chunks`.
2. **`CreateNode`**: Safely insert new `sections` or `blocks` with appropriate CRDT configurations.
3. **`LinkNodes`**: Dynamically link structural sections together.
4. **`AskHuman`**: Suspend operation and yield a Human-in-the-Loop request for clarification.
5. **`ParsingComplete`**: Signal the Rust orchestrator that the chunk has been fully processed and to begin atomic migration.

## 4. Parser Resiliency & Human-in-the-Loop (HITL)

The parser logic strictly avoids thread panics. Idiomatic Rust `Result<T, E>` vectors are utilized heavily.

- **Error Catching**: If the LLM generates malformed JSON, the step loop catches the parsing error and returns a clean "System Error" string back into the prompt context, allowing the LLM to self-correct automatically.
- **5-Failure Threshold**: If the LLM fails 5 consecutive tool calls (e.g. repeated invalid JSON, hallucinated tool schemas), the Agent Harness does not crash. Instead, it pauses the execution and transitions the `AgentStatus` to `WaitingForHuman`, yielding control back to the UI for Human-in-the-Loop interventions.

---

## 5. Change Log & Addendums

### [v1.0.0] - Agent Harness Initial Specification
- Specified the stateful ReAct loop orchestration within `rust_core/agent_harness`
- Detailed the ephemeral `temp_agent_scratch.db` atomic migration hook (`migrate_agent_to_content`).
- Mapped out the 5 type-safe JSON tools and the 5-failure threshold HITL protection.
