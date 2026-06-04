// Detect if running in Jest / Node environment to gracefully fall back to Node's native 'crypto'
const isTest = typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || 'jest' in global);
const crypto = isTest ? require('crypto') : require('react-native-quick-crypto');

// Standard AES-256-CBC encryption parameters
const ALGORITHM = 'aes-256-cbc';
const PBKDF2_ITERATIONS = 10000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits block size

// Stable credentials derivation secrets
const MASTER_SECRET = 'llm-pdf-ingest-secure-master-secret-salt-2026';
const SALT = 'keystore-salt-unique-to-app-sandbox';

// In-memory store cache
let inMemoryStore: Record<string, string> = {};

// Cache key derived synchronously using pbkdf2
function deriveKey(): any {
  return crypto.pbkdf2Sync(MASTER_SECRET, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export const SecureKeystore = {
  /**
   * Encrypts and securely stores an API key for a given provider
   */
  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key as any, iv as any);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const ivHex = (iv as any).toString('hex');
    const securePayload = JSON.stringify({ iv: ivHex, encrypted });
    
    // Store in-memory
    inMemoryStore[provider] = securePayload;
    
    // Attempt persistence in React Native / Expo environment
    try {
      const FileSystem = require('expo-file-system');
      if (FileSystem && FileSystem.documentDirectory) {
        const filePath = `${FileSystem.documentDirectory}keystore.json`;
        await FileSystem.writeAsStringAsync(filePath, JSON.stringify(inMemoryStore));
        return;
      }
    } catch (e) {
      // expo-file-system is unavailable (e.g. in Jest tests). Fall back to Node fs.
      try {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(__dirname, '../../scratch');
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, 'keystore_test.json'), JSON.stringify(inMemoryStore));
      } catch (err) {
        // Fallback silently if fs is blocked or not available
      }
    }
  },

  /**
   * Retrieves and decrypts the API key for a given provider
   */
  async getApiKey(provider: string): Promise<string | null> {
    // Sync memory store from disk if empty
    if (Object.keys(inMemoryStore).length === 0) {
      try {
        const FileSystem = require('expo-file-system');
        if (FileSystem && FileSystem.documentDirectory) {
          const filePath = `${FileSystem.documentDirectory}keystore.json`;
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          if (fileInfo.exists) {
            const content = await FileSystem.readAsStringAsync(filePath);
            inMemoryStore = JSON.parse(content);
          }
        }
      } catch (e) {
        try {
          const fs = require('fs');
          const path = require('path');
          const filePath = path.join(__dirname, '../../scratch/keystore_test.json');
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            inMemoryStore = JSON.parse(content);
          }
        } catch (err) {}
      }
    }

    const securePayload = inMemoryStore[provider];
    if (!securePayload) {
      return null;
    }

    try {
      const { iv: ivHex, encrypted } = JSON.parse(securePayload);
      const key = deriveKey();
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, key as any, iv as any);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8') as any;
      decrypted += decipher.final('utf8') as any;
      
      return decrypted.toString();
    } catch (error) {
      console.error(`Failed to decrypt API key for provider ${provider}:`, error);
      return null;
    }
  },

  /**
   * Deletes the stored API key for a given provider
   */
  async deleteApiKey(provider: string): Promise<void> {
    delete inMemoryStore[provider];
    try {
      const FileSystem = require('expo-file-system');
      if (FileSystem && FileSystem.documentDirectory) {
        const filePath = `${FileSystem.documentDirectory}keystore.json`;
        await FileSystem.writeAsStringAsync(filePath, JSON.stringify(inMemoryStore));
        return;
      }
    } catch (e) {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '../../scratch/keystore_test.json');
        fs.writeFileSync(filePath, JSON.stringify(inMemoryStore));
      } catch (err) {}
    }
  },

  /**
   * Clears all stored keys
   */
  async clearAll(): Promise<void> {
    inMemoryStore = {};
    try {
      const FileSystem = require('expo-file-system');
      if (FileSystem && FileSystem.documentDirectory) {
        const filePath = `${FileSystem.documentDirectory}keystore.json`;
        await FileSystem.deleteAsync(filePath, { idempotent: true });
        return;
      }
    } catch (e) {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '../../scratch/keystore_test.json');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {}
    }
  }
};
