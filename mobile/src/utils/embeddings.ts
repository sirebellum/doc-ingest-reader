/**
 * Generates a deterministic vector embedding for text using a hashing-based approach.
 * 
 * @param text - The input text to embed
 * @param dimensions - The number of dimensions for the output vector (default: 384)
 * @returns A unit-normalized vector of specified dimensions
 */
export function generateEmbedding(text: string, dimensions: number = 384): number[] {
  // Handle empty or invalid input
  if (!text || typeof text !== 'string') {
    const result = Array(dimensions).fill(0);
    result[0] = 1.0;
    return result;
  }

  // Preprocess text: lowercase and split into words
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 0);

  // Initialize vector with zeros
  const vector = Array(dimensions).fill(0);

  // If no words, return a deterministic unit vector
  if (words.length === 0) {
    const result = Array(dimensions).fill(0);
    result[0] = 1.0;
    return result;
  }

  // Process each word
  for (const word of words) {
    // Generate multiple indices per word using salted hashing
    for (let i = 0; i < 3; i++) { // Use 3 indices per word
      const hash = djb2Hash(word, i);
      const index1 = Math.abs(hash) % dimensions;
      const index2 = Math.abs(hash * 31 + 17) % dimensions;
      const index3 = Math.abs(hash * 97 + 43) % dimensions;

      // Assign sign based on hash value
      const sign = ((hash >> i) & 1) ? 1 : -1;

      // Add contribution to vector
      vector[index1] += sign;
      vector[index2] += sign;
      vector[index3] += sign;
    }
  }

  // Normalize to unit vector (L2 norm = 1.0)
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  
  if (norm === 0) {
    const result = Array(dimensions).fill(0);
    result[0] = 1.0;
    return result;
  }

  return vector.map(val => val / norm);
}

/**
 * Computes cosine similarity between two vectors.
 * Since vectors are assumed to be unit-normalized, this is simply their dot product.
 * 
 * @param v1 - First vector
 * @param v2 - Second vector
 * @returns Cosine similarity (dot product)
 */
export function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) {
    throw new Error('Vector dimensions do not match');
  }

  // Compute dot product
  return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

/**
 * Simple deterministic hash function using DJB2 algorithm with salt.
 * 
 * @param str - String to hash
 * @param salt - Salt value for deterministic variation
 * @returns Hash value as number
 */
function djb2Hash(str: string, salt: number): number {
  let hash = 5381;
  const saltedStr = str + salt.toString();
  
  for (let i = 0; i < saltedStr.length; i++) {
    const char = saltedStr.charCodeAt(i);
    hash = ((hash << 5) + hash) + char;
    hash = hash & 0xFFFFFFFF; // Stay within 32-bit integer range
  }
  
  return hash;
}
