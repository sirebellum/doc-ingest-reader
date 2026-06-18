# Inference Subsystem (`rust_core/inference`)

The `inference` crate manages the AI execution layer of the Document-to-Reader pipeline. It does not orchestrate the high-level logic or ReAct loops (which is handled by `agent_harness`); rather, it provides the low-level bindings, network connectors, and hardware-accelerated drivers required to prompt language models and retrieve structured responses.

---

## 1. Flexible Pre-Ingestion Routing Matrix

Recognizing that users have different needs regarding battery life, processing speed, and absolute privacy, the `inference` module implements a flexible routing matrix. When the `agent_harness` requests an LLM completion, this crate routes the prompt through one of three execution layers:

| Routing Option | Privacy Level | Underlying Execution Layer |
| --- | --- | --- |
| **Local Inference** | **100% Private & Offline** | Embedded `llama.cpp` static library linked directly in the Rust core. Runs strictly on-device with zero token costs. |
| **Local Network Link** | **Local Network Private** | Wi-Fi link routing structured payloads to local developer setups (e.g., Ollama via `/api/generate` or LM Studio via `/v1/chat/completions`) with transaction retry fallbacks. |
| **BYOK Cloud Fallback** | **Cloud-Dependent** | *Bring Your Own Key* API connectors routing JSON payloads directly to Google Gemini, Anthropic Claude, or OpenAI GPT. API Keys are passed securely via the JSI bridge from the device's Keychain/Keystore. |

---

## 2. On-Device Execution Engine (`llama.cpp`)

For the primary offline route, the crate utilizes embedded native bindings to `llama.cpp` to execute generative tasks directly on mobile hardware.

* **Hardware Acceleration Hooks**:
* *iOS*: Hooks into Apple's CoreML and Apple Neural Engine (ANE) via native Metal performance shaders.
* *Android*: Targets Qualcomm Snapdragon DSPs, MediaTek APUs, and general ARM NEON registers using standard OpenCL / NNAPI execution layers.


* **Strict Memory Optimization**: To prevent the host mobile operating system (OOM killers) from terminating the background ingestion process, the engine enforces strict 4-bit quantization formats (e.g., `Q4_K_M`). It artificially restricts the RAM footprint to $\le 1.8\text{ GB}$, optimizing for models like `Gemma-3-1b` or quantized `Phi-3`.

---

## 3. Resilient Model Downloader (`downloader.rs`)

To support the fully offline LLM pipeline, the application must be able to fetch GGUF model weights locally. The `inference` crate implements a highly resilient model downloader utility built to interact with the Hugging Face hub.

* **Atomic File Protection**: Uses atomic lock-files during the download phase to prevent file corruption if the app is closed or crashes mid-download.
* **Network Resiliency**: Implements range-header HTTP requests, allowing the engine to seamlessly pause and resume massive GGUF binary downloads if the user drops Wi-Fi connection or background execution is suspended.
* **Verification**: Executes cryptographic post-download checksum validations (SHA-256) to guarantee model integrity before loading it into neural memory.

---

## 4. Deterministic Output & Repair Loop

Because the LLM's primary role is to generate valid JSON Abstract Syntax Trees (`ASTNode`) for the `dbs` module, the `inference` crate implements strict output formatting controls.

* **Grammar Constraints**: Applies strict JSON grammar rules to the local model's decoding sequence, mathematically forcing the model to only output tokens that form valid JSON.
* **Retry & Repair Loop**: If an external cloud API or minor context hallucination results in a structurally deformed JSON payload, the crate utilizes a `serde_json` repair loop. It intercepts the payload, attempts to correct minor syntax deformities (like missing trailing brackets), or throws a typed `InferenceError` to the `agent_harness` to request a generation retry, ensuring database migrations never fail due to bad string parsing.
