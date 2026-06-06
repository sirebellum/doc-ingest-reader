#pragma once

#include <jsi/jsi.h>
#include <memory>
#include <vector>
#include <string>

namespace facebook {
namespace jsi {

/**
 * C++ JSI HostObject wrapper exposing high-performance asynchronous PDF parsing
 * capabilities directly to the React Native JS runtime.
 */
class JSI_EXPORT RustParserBridge : public HostObject {
public:
    // Installs the global.RustParserBridge object onto the JS global runtime namespace
    static void install(Runtime& runtime, std::shared_ptr<RustParserBridge> bridge);

    RustParserBridge();
    virtual ~RustParserBridge();

    // Expose HostObject overrides to resolve and execute runtime properties
    Value get(Runtime& runtime, const PropNameID& name) override;
    void set(Runtime& runtime, const PropNameID& name, const Value& value) override;
    std::vector<PropNameID> getPropertyNames(Runtime& runtime) override;

    // High-performance JSI synchronous vector similarity methods
    Value computeSimilarity(Runtime& runtime, const Value& vecA, const Value& vecB);
    Value computeBatchSimilarities(Runtime& runtime, const Value& targetVec, const Value& candidateVecs);
};

} // namespace jsi
} // namespace facebook
