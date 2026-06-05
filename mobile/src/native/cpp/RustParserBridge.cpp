#include "RustParserBridge.h"
#include <thread>
#include <future>
#include <stdexcept>
#include <iostream>

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
    names.push_back(PropNameID::forAscii(runtime, "parsePDFAsync"));
    names.push_back(PropNameID::forAscii(runtime, "runInferenceAsync"));
    names.push_back(PropNameID::forAscii(runtime, "getHeapStats"));
    names.push_back(PropNameID::forAscii(runtime, "configureNpu"));
    names.push_back(PropNameID::forAscii(runtime, "delineatePageAsync"));
    names.push_back(PropNameID::forAscii(runtime, "computeSimilarity"));
    names.push_back(PropNameID::forAscii(runtime, "computeBatchSimilarities"));
    return names;
}

Value RustParserBridge::get(Runtime& runtime, const PropNameID& name) {
    std::string propName = name.utf8(runtime);
    if (propName == "parsePDFAsync") {
        return Function::createFromHostFunction(
            runtime,
            name,
            1, // expects localPath argument
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 1) {
                    throw jsi::JSError(rt, "RustParserBridge.parsePDFAsync: localPath argument is required.");
                }
                return this->parsePDFAsync(rt, args[0]);
            }
        );
    } else if (propName == "runInferenceAsync") {
        return Function::createFromHostFunction(
            runtime,
            name,
            2, // expects modelPath and prompt arguments
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 2) {
                    throw jsi::JSError(rt, "RustParserBridge.runInferenceAsync: modelPath and prompt arguments are required.");
                }
                return this->runInferenceAsync(rt, args[0], args[1]);
            }
        );
    } else if (propName == "getHeapStats") {
        return Function::createFromHostFunction(
            runtime,
            name,
            0,
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                return this->getHeapStats(rt);
            }
        );
    } else if (propName == "configureNpu") {
        return Function::createFromHostFunction(
            runtime,
            name,
            1,
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 1) {
                    throw jsi::JSError(rt, "RustParserBridge.configureNpu: config argument is required.");
                }
                return this->configureNpu(rt, args[0]);
            }
        );
    } else if (propName == "delineatePageAsync") {
        return Function::createFromHostFunction(
            runtime,
            name,
            2,
            [this](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
                if (count < 2) {
                    throw jsi::JSError(rt, "RustParserBridge.delineatePageAsync: pageExtractionJson and modelPath arguments are required.");
                }
                return this->delineatePageAsync(rt, args[0], args[1]);
            }
        );
    } else if (propName == "computeSimilarity") {
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
    }
    return Value::undefined();
}

void RustParserBridge::set(Runtime& runtime, const PropNameID& name, const Value& value) {
    // JSI host functions are read-only properties
}

Value RustParserBridge::parsePDFAsync(Runtime& runtime, const Value& localPathValue) {
    if (!localPathValue.isString()) {
        throw jsi::JSError(runtime, "RustParserBridge.parsePDFAsync: localPath must be a string.");
    }
    
    std::string localPath = localPathValue.asString(runtime).utf8(runtime);
    
    // Access global Promise constructor in JS execution context
    Function promiseConstructor = runtime.global().getPropertyAsFunction(runtime, "Promise");
    
    auto promiseExecutor = Function::createFromHostFunction(
        runtime,
        PropNameID::forAscii(runtime, "executor"),
        2,
        [localPath](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
            auto resolve = std::make_shared<Value>(rt, args[0]);
            auto reject = std::make_shared<Value>(rt, args[1]);
            
            // Capture reference to runtime pointer safely (only valid while JS thread is alive)
            Runtime* rtPtr = &rt;
            
            // Spawn a background native C++ thread to prevent blocking the React Native UI/JS thread
            std::thread([localPath, resolve, reject, rtPtr]() {
                try {
                    // Call the compiled Rust core parser FFI
                    char* rust_raw = parse_pdf_ffi(localPath.c_str());
                    if (rust_raw == nullptr) {
                        std::cerr << "[RustParserBridge C++] Rust parser returned null result pointer" << std::endl;
                        reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, "Rust parser returned null result"));
                        return;
                    }

                    std::string json_result(rust_raw);
                    free_rust_string(rust_raw);

                    // Successful resolution payload returned back to JS
                    resolve->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::String::createFromUtf8(*rtPtr, json_result));
                } catch (const std::exception& e) {
                    std::cerr << "[RustParserBridge C++] Error during PDF extraction: " << e.what() << std::endl;
                    reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, e.what()));
                }
            }).detach();
            
            return Value::undefined();
        }
    );
    
    return promiseConstructor.callAsConstructor(runtime, promiseExecutor);
}

Value RustParserBridge::runInferenceAsync(Runtime& runtime, const Value& modelPathValue, const Value& promptValue) {
    if (!modelPathValue.isString()) {
        throw jsi::JSError(runtime, "RustParserBridge.runInferenceAsync: modelPath must be a string.");
    }
    
    if (!promptValue.isString()) {
        throw jsi::JSError(runtime, "RustParserBridge.runInferenceAsync: prompt must be a string.");
    }
    
    std::string modelPath = modelPathValue.asString(runtime).utf8(runtime);
    std::string prompt = promptValue.asString(runtime).utf8(runtime);
    
    // Access global Promise constructor in JS execution context
    Function promiseConstructor = runtime.global().getPropertyAsFunction(runtime, "Promise");
    
    auto promiseExecutor = Function::createFromHostFunction(
        runtime,
        PropNameID::forAscii(runtime, "executor"),
        2,
        [modelPath, prompt](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
            auto resolve = std::make_shared<Value>(rt, args[0]);
            auto reject = std::make_shared<Value>(rt, args[1]);
            
            Runtime* rtPtr = &rt;
            
            // Spawn a background native C++ thread to prevent blocking the React Native UI/JS thread
            std::thread([modelPath, prompt, resolve, reject, rtPtr]() {
                try {
                    // Call the compiled Rust inference engine FFI
                    char* rust_raw = run_inference_ffi(modelPath.c_str(), prompt.c_str());
                    if (rust_raw == nullptr) {
                        std::cerr << "[RustParserBridge C++] Rust inference returned null result pointer" << std::endl;
                        reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, "Rust inference returned null"));
                        return;
                    }

                    std::string json_result(rust_raw);
                    free_rust_inference_string(rust_raw);

                    // Successful resolution payload returned back to JS
                    resolve->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::String::createFromUtf8(*rtPtr, json_result));
                } catch (const std::exception& e) {
                    std::cerr << "[RustParserBridge C++] Error during inference: " << e.what() << std::endl;
                    reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, e.what()));
                }
            }).detach();
            
            return Value::undefined();
        }
    );
    
    return promiseConstructor.callAsConstructor(runtime, promiseExecutor);
}

Value RustParserBridge::delineatePageAsync(Runtime& runtime, const Value& pageExtractionJsonValue, const Value& modelPathValue) {
    if (!pageExtractionJsonValue.isString()) {
        throw jsi::JSError(runtime, "RustParserBridge.delineatePageAsync: pageExtractionJson must be a string.");
    }
    if (!modelPathValue.isString()) {
        throw jsi::JSError(runtime, "RustParserBridge.delineatePageAsync: modelPath must be a string.");
    }
    
    std::string pageExtractionJson = pageExtractionJsonValue.asString(runtime).utf8(runtime);
    std::string modelPath = modelPathValue.asString(runtime).utf8(runtime);
    
    Function promiseConstructor = runtime.global().getPropertyAsFunction(runtime, "Promise");
    
    auto promiseExecutor = Function::createFromHostFunction(
        runtime,
        PropNameID::forAscii(runtime, "executor"),
        2,
        [pageExtractionJson, modelPath](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
            auto resolve = std::make_shared<Value>(rt, args[0]);
            auto reject = std::make_shared<Value>(rt, args[1]);
            
            Runtime* rtPtr = &rt;
            
            std::thread([pageExtractionJson, modelPath, resolve, reject, rtPtr]() {
                try {
                    char* rust_raw = delineate_page_ffi(pageExtractionJson.c_str(), modelPath.c_str());
                    if (rust_raw == nullptr) {
                        std::cerr << "[RustParserBridge C++] Rust delineator returned null result pointer" << std::endl;
                        reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, "Rust delineator returned null"));
                        return;
                    }
                    
                    std::string json_result(rust_raw);
                    free_rust_delineator_string(rust_raw);
                    
                    resolve->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::String::createFromUtf8(*rtPtr, json_result));
                } catch (const std::exception& e) {
                    std::cerr << "[RustParserBridge C++] Error during page delineation: " << e.what() << std::endl;
                    reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, e.what()));
                }
            }).detach();
            
            return Value::undefined();
        }
    );
    
    return promiseConstructor.callAsConstructor(runtime, promiseExecutor);
}

Value RustParserBridge::getHeapStats(Runtime& runtime) {
    Function promiseConstructor = runtime.global().getPropertyAsFunction(runtime, "Promise");
    
    auto promiseExecutor = Function::createFromHostFunction(
        runtime,
        PropNameID::forAscii(runtime, "executor"),
        2,
        [](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
            auto resolve = std::make_shared<Value>(rt, args[0]);
            auto reject = std::make_shared<Value>(rt, args[1]);
            
            Runtime* rtPtr = &rt;
            
            std::thread([resolve, reject, rtPtr]() {
                try {
                    char* rust_raw = get_rust_heap_stats_ffi();
                    if (rust_raw == nullptr) {
                        reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, "Failed to get heap stats"));
                        return;
                    }

                    std::string json_result(rust_raw);
                    free_rust_inference_string(rust_raw);

                    resolve->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::String::createFromUtf8(*rtPtr, json_result));
                } catch (const std::exception& e) {
                    reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, e.what()));
                }
            }).detach();
            
            return Value::undefined();
        }
    );
    
    return promiseConstructor.callAsConstructor(runtime, promiseExecutor);
}

Value RustParserBridge::configureNpu(Runtime& runtime, const Value& configValue) {
    if (!configValue.isObject()) {
        throw jsi::JSError(runtime, "RustParserBridge.configureNpu: config must be an object.");
    }
    
    // Convert JS config object to JSON string to pass over FFI
    // Access global JSON.stringify
    Object jsonObject = runtime.global().getPropertyAsObject(runtime, "JSON");
    Function stringify = jsonObject.getPropertyAsFunction(runtime, "stringify");
    std::string configJson = stringify.call(runtime, configValue).asString(runtime).utf8(runtime);
    
    Function promiseConstructor = runtime.global().getPropertyAsFunction(runtime, "Promise");
    
    auto promiseExecutor = Function::createFromHostFunction(
        runtime,
        PropNameID::forAscii(runtime, "executor"),
        2,
        [configJson](Runtime& rt, const Value& thisVal, const Value* args, size_t count) -> Value {
            auto resolve = std::make_shared<Value>(rt, args[0]);
            auto reject = std::make_shared<Value>(rt, args[1]);
            
            Runtime* rtPtr = &rt;
            
            std::thread([configJson, resolve, reject, rtPtr]() {
                try {
                    int res = configure_npu_ffi(configJson.c_str());
                    resolve->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::Value(res));
                } catch (const std::exception& e) {
                    reject->asObject(*rtPtr).asFunction(*rtPtr).call(*rtPtr, jsi::JSError(*rtPtr, e.what()));
                }
            }).detach();
            
            return Value::undefined();
        }
    );
    
    return promiseConstructor.callAsConstructor(runtime, promiseExecutor);
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

float computeCosineSimilarity(const float* vecA, const float* vecB, size_t size) {
    if (size == 0) return 0.0f;
    float dotProduct = 0.0f;
    float normA = 0.0f;
    float normB = 0.0f;
    
    #pragma clang loop vectorize(enable)
    #pragma GCC ivdep
    for (size_t i = 0; i < size; ++i) {
        float a = vecA[i];
        float b = vecB[i];
        dotProduct += a * b;
        normA += a * a;
        normB += b * b;
    }
    
    if (normA == 0.0f || normB == 0.0f) {
        return 0.0f;
    }
    return dotProduct / (std::sqrt(normA) * std::sqrt(normB));
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
    
    float sim = computeCosineSimilarity(dataA, dataB, sizeA);

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
            float sim = computeCosineSimilarity(targetData, candidateData, targetSize);
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
                float sim = computeCosineSimilarity(targetData, candidateData, targetSize);
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
