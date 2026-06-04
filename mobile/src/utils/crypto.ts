// Dynamically load react-native-quick-crypto with fallback to Node crypto in test runs
let crypto: any;
try {
  crypto = require('react-native-quick-crypto');
} catch (err) {
  crypto = require('crypto');
}

/**
 * Generates an on-device ECDSA public/private key pair (secp256r1 / prime256v1).
 */
export function generateAuthorKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return {
    publicKey,
    privateKey,
  };
}

/**
 * Computes a cryptographically secure ECDSA SHA-256 signature for the given payload text.
 */
export function signPayload(payloadText: string, privateKeyPem: string): string {
  const sign = crypto.createSign('SHA256');
  sign.update(payloadText);
  sign.end();
  
  const signature = sign.sign(privateKeyPem);
  return signature.toString('hex');
}

/**
 * Validates a signature against a payload text using the author's public key.
 */
export function verifyPayload(payloadText: string, signatureHex: string, publicKeyPem: string): boolean {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(payloadText);
    verify.end();
    
    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    return verify.verify(publicKeyPem, signatureBuffer);
  } catch (err) {
    console.error('[Crypto] Verification error:', err);
    return false;
  }
}
