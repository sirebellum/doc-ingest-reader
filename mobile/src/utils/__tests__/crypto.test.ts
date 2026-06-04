import { generateAuthorKeyPair, signPayload, verifyPayload } from '../crypto';

describe('Elliptic-Curve Note Signing & Cryptographic Validation', () => {
  it('should generate valid PEM encoded public and private EC keypairs', () => {
    const { publicKey, privateKey } = generateAuthorKeyPair();

    expect(publicKey).toBeDefined();
    expect(privateKey).toBeDefined();
    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(publicKey).toContain('-----END PUBLIC KEY-----');
    expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(privateKey).toContain('-----END PRIVATE KEY-----');
  });

  it('should sign a payload text and verify the signature successfully using the public key', () => {
    const { publicKey, privateKey } = generateAuthorKeyPair();
    const payload = JSON.stringify({
      schema_version: '1.0',
      document: { title: 'Verifiable Document', sha256_hash: '12345' },
      annotations: [{ id: 'ann-1', note_body: 'A beautiful highlight' }],
    });

    const signature = signPayload(payload, privateKey);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(32);

    const isValid = verifyPayload(payload, signature, publicKey);
    expect(isValid).toBe(true);
  });

  it('should reject signature verification if the payload text is modified or tampered with', () => {
    const { publicKey, privateKey } = generateAuthorKeyPair();
    const payload = 'original content block';
    
    const signature = signPayload(payload, privateKey);

    // Verify original is valid
    expect(verifyPayload(payload, signature, publicKey)).toBe(true);

    // Verify modified payload fails
    const tamperedPayload = 'original content block - altered';
    expect(verifyPayload(tamperedPayload, signature, publicKey)).toBe(false);
  });

  it('should return false for invalid signature formats or incorrect public keys', () => {
    const { publicKey } = generateAuthorKeyPair();
    const payload = 'secure notes data';

    const signature = 'abcd1234efgh5678'; // Invalid hex signature
    expect(verifyPayload(payload, signature, publicKey)).toBe(false);

    // Correct signature but signed by a different key pair
    const { publicKey: otherPublicKey, privateKey: otherPrivateKey } = generateAuthorKeyPair();
    const validOtherSignature = signPayload(payload, otherPrivateKey);

    expect(verifyPayload(payload, validOtherSignature, publicKey)).toBe(false); // Should fail with primary key
    expect(verifyPayload(payload, validOtherSignature, otherPublicKey)).toBe(true); // Should pass with secondary key
  });
});
