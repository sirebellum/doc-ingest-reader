#include "RustParserBridge.h"
#include <thread>
#include <future>
#include <stdexcept>
#include <iostream>
#include "VectorMath.h"
#include <jni.h>

#ifdef ENABLE_CORE_DEBUG_LOGS
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cmath>

#ifdef __ANDROID__
#include <android/log.h>
#endif

namespace {
std::string getTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    return std::to_string(ms);
}

void logDebug(const char* subsystem, const char* module, const std::string& message, const std::string& metrics = "") {
#ifdef __ANDROID__
    __android_log_print(ANDROID_LOG_DEBUG, "RustParserBridge", "[DEBUG][%s][%s::%s] -> %s | %s", getTimestamp().c_str(), subsystem, module, message.c_str(), metrics.c_str());
#else
    std::cout << "[DEBUG][" << getTimestamp() << "][" << subsystem << "::" << module << "] -> " << message;
    if (!metrics.empty()) {
        std::cout << " | " << metrics;
    }
    std::cout << std::endl;
#endif
}
} // namespace
#endif

namespace facebook {
namespace jsi {

// Rust FFI boundary declarations exposed from the compiled rust_core library
extern "C" {
    /**
     * Executes the Rust-based PDF layout analysis parser synchronously.
     * Returns a dynamically-allocated JSON string pointer (char*) containing PageExtraction.
     * Caller takes ownership and must free using free_rust_string.
     */
    char* parse_pdf_ffi(const char* path);

    /**
     * Executes the Rust-based inference engine asynchronously.
     * Returns a dynamically-allocated JSON string pointer (char*) containing the inference result.
     * Caller takes ownership and must free using free_rust_string.
     */
    char* run_inference_ffi(const char* model_path, const char* prompt);
    char* delineate_page_ffi(const char* page_extraction_json, const char* model_path);
    void free_rust_delineator_string(char* s);

    /**
     * Queries real-time compiled Rust core heap allocations.
     * Returns a dynamically allocated C-string JSON representing current allocation statistics.
     */
    char* get_rust_heap_stats_ffi();

    /**
     * Configures NPU properties and RAM limits.
     * Returns 0 on success, non-zero on failure.
     */
    int configure_npu_ffi(const char* config_json);

    /**
     * Frees a string allocated on the Rust heap to prevent memory leaks across FFI boundaries.
     */
    void free_rust_string(char* s);

    /**
     * Frees a string allocated by the inference crate.
     */
    void free_rust_inference_string(char* s);
}

void RustParserBridge::install(Runtime& runtime, std::shared_ptr<RustParserBridge> bridge) {
    auto bridgeValue = Value(runtime, Object::createFromHostObject(runtime, bridge));
    runtime.global().setProperty(runtime, "RustParserBridge", bridgeValue);
}

RustParserBridge::RustParserBridge() {}
RustParserBridge::~RustParserBridge() {}

std::vector<PropNameID> RustParserBridge::getPropertyNames(Runtime& runtime) {
    std::vector<PropNameID> names;
    names.push_back(PropNameID::forAscii(runtime, "computeSimilarity"));
    names.push_back(PropNameID::forAscii(runtime, "computeBatchSimilarities"));
    names.push_back(PropNameID::forAscii(runtime, "doc_sync"));
    names.push_back(PropNameID::forAscii(runtime, "dbs"));
    return names;
}

Value RustParserBridge::get(Runtime& runtime, const PropNameID& name) {
    std::string propName = name.utf8(runtime);
    if (propName == "computeSimilarity") {
        return Function::createFromHostFunction(
            runtime,
            name,
            2,
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 2) {
                    throw jsi::JSError(rt, "RustParserBridge.computeSimilarity: two arguments are required.");
                }
                return this->computeSimilarity(rt, args[0], args[1]);
            }
        );
    } else if (propName == "computeBatchSimilarities") {
        return Function::createFromHostFunction(
            runtime,
            name,
            2,
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 2) {
                    throw jsi::JSError(rt, "RustParserBridge.computeBatchSimilarities: two arguments are required.");
                }
                return this->computeBatchSimilarities(rt, args[0], args[1]);
            }
        );
    } else if (propName == "doc_sync") {
        class DocSyncBridge : public HostObject {
        public:
            Value get(Runtime& rt, const PropNameID& propNameID) override {
                return Function::createFromHostFunction(
                    rt, propNameID, 0,
                    [](Runtime& r, const Value& thisVal, const Value* args, size_t count) -> Value {
                        return Value::undefined();
                    }
                );
            }
            std::vector<PropNameID> getPropertyNames(Runtime& rt) override {
                return {};
            }
        };
        return Object::createFromHostObject(runtime, std::make_shared<DocSyncBridge>());
    } else if (propName == "dbs") {
        class DbsBridge : public HostObject {
        public:
            Value get(Runtime& rt, const PropNameID& propNameID) override {
                return Function::createFromHostFunction(
                    rt, propNameID, 0,
                    [](Runtime& r, const Value& thisVal, const Value* args, size_t count) -> Value {
                        return Value::undefined();
                    }
                );
            }
            std::vector<PropNameID> getPropertyNames(Runtime& rt) override {
                return {};
            }
        };
        return Object::createFromHostObject(runtime, std::make_shared<DbsBridge>());
    }
    return Value::undefined();
}

void RustParserBridge::set(Runtime& runtime, const PropNameID& name, const Value& value) {
    // JSI host functions are read-only properties
}

// JNI Exports for synchronous Kotlin Expo Modules binding
extern "C" {
    JNIEXPORT jstring JNICALL Java_mobile_rustparserbridge_RustParserBridgeModule_parsePDFSyncNative(JNIEnv* env, jobject thiz, jstring localPathStr) {
        const char* localPath = env->GetStringUTFChars(localPathStr, nullptr);
        char* rust_raw = parse_pdf_ffi(localPath);
        env->ReleaseStringUTFChars(localPathStr, localPath);
        
        if (rust_raw == nullptr) {
            env->ThrowNew(env->FindClass("java/lang/RuntimeException"), "Rust parser returned null");
            return nullptr;
        }
        
        jstring result = env->NewStringUTF(rust_raw);
        free_rust_string(rust_raw);
        return result;
    }

    JNIEXPORT jstring JNICALL Java_mobile_rustparserbridge_RustParserBridgeModule_runInferenceSyncNative(JNIEnv* env, jobject thiz, jstring modelPathStr, jstring promptStr) {
        const char* modelPath = env->GetStringUTFChars(modelPathStr, nullptr);
        const char* prompt = env->GetStringUTFChars(promptStr, nullptr);
        char* rust_raw = run_inference_ffi(modelPath, prompt);
        env->ReleaseStringUTFChars(modelPathStr, modelPath);
        env->ReleaseStringUTFChars(promptStr, prompt);
        
        if (rust_raw == nullptr) {
            env->ThrowNew(env->FindClass("java/lang/RuntimeException"), "Rust inference returned null");
            return nullptr;
        }
        
        jstring result = env->NewStringUTF(rust_raw);
        free_rust_inference_string(rust_raw);
        return result;
    }

    JNIEXPORT jstring JNICALL Java_mobile_rustparserbridge_RustParserBridgeModule_delineatePageSyncNative(JNIEnv* env, jobject thiz, jstring pageExtractionJsonStr, jstring modelPathStr) {
        const char* pageExtractionJson = env->GetStringUTFChars(pageExtractionJsonStr, nullptr);
        const char* modelPath = env->GetStringUTFChars(modelPathStr, nullptr);
        char* rust_raw = delineate_page_ffi(pageExtractionJson, modelPath);
        env->ReleaseStringUTFChars(pageExtractionJsonStr, pageExtractionJson);
        env->ReleaseStringUTFChars(modelPathStr, modelPath);
        
        if (rust_raw == nullptr) {
            env->ThrowNew(env->FindClass("java/lang/RuntimeException"), "Rust delineator returned null");
            return nullptr;
        }
        
        jstring result = env->NewStringUTF(rust_raw);
        free_rust_delineator_string(rust_raw);
        return result;
    }

    JNIEXPORT jstring JNICALL Java_mobile_rustparserbridge_RustParserBridgeModule_getHeapStatsSyncNative(JNIEnv* env, jobject thiz) {
        char* rust_raw = get_rust_heap_stats_ffi();
        if (rust_raw == nullptr) {
            env->ThrowNew(env->FindClass("java/lang/RuntimeException"), "Failed to get heap stats");
            return nullptr;
        }
        
        jstring result = env->NewStringUTF(rust_raw);
        free_rust_inference_string(rust_raw);
        return result;
    }

    JNIEXPORT jint JNICALL Java_mobile_rustparserbridge_RustParserBridgeModule_configureNpuSyncNative(JNIEnv* env, jobject thiz, jstring configJsonStr) {
        const char* configJson = env->GetStringUTFChars(configJsonStr, nullptr);
        int res = configure_npu_ffi(configJson);
        env->ReleaseStringUTFChars(configJsonStr, configJson);
        return res;
    }
}


// Vector Similarity calculations & Helper methods
std::pair<float*, size_t> getFloatArrayData(Runtime& runtime, const Value& val) {
    if (!val.isObject()) {
        throw jsi::JSError(runtime, "Argument must be an Object.");
    }
    jsi::Object obj = val.asObject(runtime);
    if (!obj.hasProperty(runtime, "buffer")) {
        throw jsi::JSError(runtime, "Argument is not a typed array (missing 'buffer' property).");
    }
    jsi::Value bufferVal = obj.getProperty(runtime, "buffer");
    if (!bufferVal.isObject()) {
        throw jsi::JSError(runtime, "Argument buffer is not an Object.");
    }
    jsi::Object bufferObj = bufferVal.asObject(runtime);
    if (!bufferObj.isArrayBuffer(runtime)) {
        throw jsi::JSError(runtime, "Argument buffer is not an ArrayBuffer.");
    }
    jsi::ArrayBuffer arrayBuffer = bufferObj.getArrayBuffer(runtime);
    float* data = reinterpret_cast<float*>(arrayBuffer.data(runtime));
    size_t byteLength = arrayBuffer.size(runtime);
    size_t elementCount = byteLength / sizeof(float);

#ifdef ENABLE_CORE_DEBUG_LOGS
    {
        std::stringstream ss;
        ss << "Transferred Float32Array across language boundary (JSI bridge). Pointer: 0x" 
           << std::hex << reinterpret_cast<uintptr_t>(data) << std::dec 
           << ", ElementCount: " << elementCount;
        std::stringstream metrics;
        metrics << "Bytes: " << byteLength << ", Duration: 0ms, Status: Success";
        logDebug("RUNTIME_INTERFACE", "JsiBridge", ss.str(), metrics.str());
    }
#endif

    return { data, elementCount };
}

Value RustParserBridge::computeSimilarity(Runtime& runtime, const Value& vecA, const Value& vecB) {
#ifdef ENABLE_CORE_DEBUG_LOGS
    auto startTime = std::chrono::high_resolution_clock::now();
#endif

    auto [dataA, sizeA] = getFloatArrayData(runtime, vecA);
    auto [dataB, sizeB] = getFloatArrayData(runtime, vecB);
    
    if (sizeA != sizeB) {
        throw jsi::JSError(runtime, "Vector sizes must match.");
    }
    
    float sim = VectorMath::computeCosineSimilarity(dataA, dataB, sizeA);

#ifdef ENABLE_CORE_DEBUG_LOGS
    {
        auto endTime = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
        std::stringstream ss;
        ss << "Computed cosine similarity synchronous calculation. Result: " << sim;
        std::stringstream metrics;
        metrics << "VectorSize: " << sizeA << ", Duration: " << duration << "ms, Status: Success";
        logDebug("RUNTIME_INTERFACE", "VectorMath", ss.str(), metrics.str());
    }
#endif

    return Value(static_cast<double>(sim));
}

Value RustParserBridge::computeBatchSimilarities(Runtime& runtime, const Value& targetVec, const Value& candidateVecs) {
#ifdef ENABLE_CORE_DEBUG_LOGS
    auto startTime = std::chrono::high_resolution_clock::now();
#endif

    auto [targetData, targetSize] = getFloatArrayData(runtime, targetVec);
    
    if (!candidateVecs.isObject()) {
        throw jsi::JSError(runtime, "candidateVecs must be an Array or Float32Array matrix.");
    }
    
    jsi::Object candidatesObj = candidateVecs.asObject(runtime);
    
    // Check if the input is a single contiguous Float32Array matrix (possessing a 'buffer' property)
    if (candidatesObj.hasProperty(runtime, "buffer")) {
        auto [matrixData, matrixSize] = getFloatArrayData(runtime, candidateVecs);
        if (targetSize == 0) {
            return jsi::Array(runtime, 0);
        }
        size_t numCandidates = matrixSize / targetSize;
        jsi::Array results(runtime, numCandidates);
        
        #pragma clang loop vectorize(enable)
        #pragma GCC ivdep
        for (size_t i = 0; i < numCandidates; ++i) {
            const float* candidateData = matrixData + (i * targetSize);
            float sim = VectorMath::computeCosineSimilarity(targetData, candidateData, targetSize);
            results.setValueAtIndex(runtime, i, static_cast<double>(sim));
        }

#ifdef ENABLE_CORE_DEBUG_LOGS
        {
            auto endTime = std::chrono::high_resolution_clock::now();
            auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
            std::stringstream ss;
            ss << "Computed batch cosine similarity synchronous calculation (contiguous matrix). Count: " << numCandidates;
            std::stringstream metrics;
            metrics << "CandidatesCount: " << numCandidates << ", VectorSize: " << targetSize << ", Duration: " << duration << "ms, Status: Success";
            logDebug("RUNTIME_INTERFACE", "VectorMath", ss.str(), metrics.str());
        }
#endif

        return results;
    }
    
    // Fallback: candidateVecs is a standard JS Array of Float32Array vectors
    if (!candidatesObj.isArray(runtime)) {
        throw jsi::JSError(runtime, "candidateVecs must be an Array or Float32Array matrix.");
    }
    jsi::Array candidatesArray = candidatesObj.getArray(runtime);
    size_t numCandidates = candidatesArray.size(runtime);
    
    jsi::Array results(runtime, numCandidates);
    for (size_t i = 0; i < numCandidates; ++i) {
        jsi::Value candidateVal = candidatesArray.getValueAtIndex(runtime, i);
        if (!candidateVal.isObject()) {
            results.setValueAtIndex(runtime, i, 0.0);
            continue;
        }
        try {
            auto [candidateData, candidateSize] = getFloatArrayData(runtime, candidateVal);
            if (targetSize != candidateSize) {
                results.setValueAtIndex(runtime, i, 0.0);
            } else {
                float sim = VectorMath::computeCosineSimilarity(targetData, candidateData, targetSize);
                results.setValueAtIndex(runtime, i, static_cast<double>(sim));
            }
        } catch (...) {
            results.setValueAtIndex(runtime, i, 0.0);
        }
    }

#ifdef ENABLE_CORE_DEBUG_LOGS
    {
        auto endTime = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime).count() / 1000.0;
        std::stringstream ss;
        ss << "Computed batch cosine similarity synchronous calculation (fallback array). Count: " << numCandidates;
        std::stringstream metrics;
        metrics << "CandidatesCount: " << numCandidates << ", VectorSize: " << targetSize << ", Duration: " << duration << "ms, Status: Success";
        logDebug("RUNTIME_INTERFACE", "VectorMath", ss.str(), metrics.str());
    }
#endif

    return results;
}

} // namespace jsi
} // namespace facebook
