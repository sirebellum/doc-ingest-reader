#include "VectorMath.h"
#include <cmath>

namespace VectorMath {

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

} // namespace VectorMath
