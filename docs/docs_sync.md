# Sync & Collaboration Subsystem (`rust_core/doc_sync`)

The `doc_sync` sub-crate handles the heavy lifting for the application's collaborative features. Previously, synchronization logic was managed by the TypeScript frontend. To ensure absolute transmission integrity, high-speed binary compression, and complex algorithmic merging without blocking the React Native UI thread, this logic has been fully migrated down into the native Rust core.

This module enables students and study circles to share annotations, highlights, and tags completely offline.

---

## 1. LZW Binary Notes Packer (`.notes`)

To prepare data for low-bandwidth, offline peer-to-peer transfers, the `doc_sync` crate implements a highly optimized binary packer.

* **Serialization:** It packages a user's selected highlights, markdown notes, semantic tags, author IDs, and the associated sandboxed image binaries into a single, structured payload.
* **LZW Compression:** Instead of transmitting raw, bloated JSON strings, the crate compresses the payload using a custom 16-bit Big-Endian LZW (Lempel-Ziv-Welch) algorithm. This aggressively minimizes the memory footprint, ensuring fast transfers even over weak or distant local connections.
* **Output:** The result is a highly portable `.notes` binary file that can be easily shared or stored.

---

## 2. Ad-hoc P2P Bluetooth LE (BLE) Sync

The core routing mechanism for offline sharing relies on Bluetooth Low Energy. The `doc_sync` crate manages the packet manipulation required to push data across the native BLE hardware.

* **MTU Partitioning:** BLE struggles with large continuous data streams. The crate systematically partitions the compressed `.notes` payloads into strict 512-byte MTU (Maximum Transmission Unit) delta chunks.
* **Integrity Validation:** As packets are reassembled on the receiving device's native backend, they are validated against a DJB2 checksum algorithm. If a chunk is dropped or corrupted in transit, the Rust core gracefully requests a re-transmission of that specific chunk rather than failing the entire sync.

---

## 3. Conflict Resolution & Myers 3-Way LCS Merge

When multiple users annotate the same document, data collisions are inevitable. The `doc_sync` crate acts as the master arbitrator for merging imported data into the local `dbs` Content DB.

* **Deduplicated Co-existence (Upserts):** If an imported annotation shares an identical UUID with a local one, the system evaluates the `updated_at` timestamps, automatically retaining the most recent version.
* **Visual Overlays:** If two different authors highlight the exact same text range independently, the crate assigns them separate unique entries. (The frontend will visually stack these so the user can tap and view notes from both authors without layout breakage).
* **Myers 3-Way Merge:** If two authors collaboratively edit the *exact same* annotation body offline, the crate runs a high-speed Myers Longest Common Subsequence (LCS) 3-way character merge. If it detects an unresolvable collision, it safely injects standard Git-style conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> AUTHOR`) directly into the markdown AST, allowing the user to manually resolve it in the UI's Split-Pane editor.

---

## 4. W3C Fuzzy Annotation Re-Anchoring

A major challenge in document collaboration is edition mismatch (e.g., User A highlights a paragraph in Version 1 of a PDF, and sends it to User B who owns Version 2, where the page numbers and exact document `sha256_hash` differ).

* **Anchor Extraction:** Instead of tying annotations strictly to static database IDs, the `doc_sync` module wraps shared notes in W3C-standard fuzzy parameters, including the preceding text (prefix), the exact text span, and the trailing text (suffix).
* **Heuristic Re-Alignment:** Upon import, if the document hashes do not match, the crate queries the local `dbs` FTS5 index using these prefix/suffix context buffers. It mathematically recalculates the relative offsets and "fuzzy-anchors" the imported note to the correct text block in the new edition.
* **Orphan Quarantine:** If the confidence score of the fuzzy match is too low (e.g., the paragraph was entirely deleted in Version 2), the crate safely isolates the annotation and routes it to the frontend's **Orphan Notes** sidebar, ensuring no data is ever permanently lost.
