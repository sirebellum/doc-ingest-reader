# Parser Subsystem (`rust_core/parser`)

The `parser` sub-crate is the entry point for all document ingestion. Operating as **Pass 1** of the pipeline, this high-performance native Rust library is responsible for extracting raw text, geometric coordinates, and embedded assets from source files. It prepares optimized payloads that are either handed off to the `agent_harness` (for PDFs) or formatted directly into the final AST (for lightweight formats).

---

## 1. Dual-Engine PDF Layout Extraction

Extracting text from PDFs while maintaining semantic grouping (e.g., keeping multi-column text from blending together) requires a hybrid approach. The parser utilizes two distinct engines working in tandem:

* **`lopdf` (Structural Extraction):** Interacts directly with the raw PDF catalog stream. It decompresses object streams to identify text strings and fonts without geometric distortion, providing 100% accurate character-level extraction.
* **`pdfium-render` (Geometric Mapping):** Renders the document into an invisible virtual viewport to calculate the exact physical bounding boxes (mapped to standard PostScript points) of every text block, column, and image.

By combining the structural data from `lopdf` with the geometric coordinates from `pdfium-render`, the parser accurately reconstructs the reading order of complex, multi-column pages before the LLM ever sees the text.

---

## 2. Semantic Overlap Context Chunker

When parsing PDFs page-by-page, sentences are frequently cut in half across page boundaries. To prevent the LLM in Pass 2 from hallucinating missing context, the `parser` implements a semantic overlap chunker.

* **The Overlap Buffer:** As the parser iterates through pages, it captures the final ~100 tokens (roughly 3-5 sentences) of Page $N-1$.
* **Payload Construction:** It appends this buffer to the beginning of the `ExtractionChunk` payload for Page $N$.
* **Metadata Tagging:** This buffer is strictly tagged in the JSON payload so the downstream `agent_harness` knows to use it for context resolution, but *not* to duplicate it into the final database blocks.

---

## 3. High-Fidelity Asset Sandboxing

The parser securely isolates all embedded graphical assets to prevent the final database payload from ballooning in size.

1. **Interception:** Intercepts inline/vector image drawing operands in the PDF catalog stream or `<img>` tags in EPUB/HTML.
2. **Transcoding & Compression:** Decompresses raw image byte streams and transcodes them into highly compressed PNG files.
3. **Cryptographic Hashing:** Hashes the resulting bytes using SHA-256 to prevent storing duplicate images (e.g., a publisher's logo appearing on every page).
4. **Local URIs:** Saves the image to the secure mobile application sandbox and emits a stable `local-asset://[hash_id].png` link. This dynamic schema is resolved at runtime by the frontend, preventing absolute `file://` path breakages when the mobile OS updates application UUIDs.

---

## 4. Multi-Format Bypass Pipeline (EPUB, HTML, Markdown)

While complex PDFs require an LLM to deduce their structure, standard lightweight formats already contain structural metadata. To save processing time, battery, and token costs, the `parser` implements a direct-bypass pipeline.

* **EPUB Crawler:** Unzips the `.epub` archive, reads the `content.opf` / `toc.ncx` to establish the exact reading order, and parses the internal XHTML nodes.
* **Direct-to-AST:** HTML DOM tag strippers and Markdown line-by-line tree generators parse these formats directly into the `ASTNode` structures defined in the `contracts` module.
* **LLM Bypass:** Because the structure is inherently known, these documents completely bypass the `agent_harness` and `inference` layers, shipping their final structured blocks directly to the `dbs` module for immediate atomic insertion.
