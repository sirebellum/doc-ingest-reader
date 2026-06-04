import { resolveLocalAssetUri, resolveLocalAssetsInHtml } from '../localAssetResolver';

// Mock expo-file-system module completely
jest.mock('expo-file-system', () => {
  return {
    documentDirectory: 'file:///mock/documents/',
  };
});

describe('localAssetResolver Utility Tests', () => {
  describe('resolveLocalAssetUri', () => {
    it('should dynamically map local-asset:// URIs to dynamic sandbox folders', () => {
      const mockUri = 'local-asset://e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855_img-1.png';
      const expectedUri = 'file:///mock/documents/documents/images/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855_img-1.png';
      
      const resolved = resolveLocalAssetUri(mockUri);
      expect(resolved).toBe(expectedUri);
    });

    it('should ignore and return as-is non local-asset:// URIs', () => {
      const normalUri = 'file:///mock-path/documents/images/some-img.png';
      const httpUri = 'https://example.com/assets/img.png';

      expect(resolveLocalAssetUri(normalUri)).toBe(normalUri);
      expect(resolveLocalAssetUri(httpUri)).toBe(httpUri);
      expect(resolveLocalAssetUri('')).toBe('');
    });
  });

  describe('resolveLocalAssetsInHtml', () => {
    it('should replace all instances of local-asset:// inside an HTML segment with Sandbox paths', () => {
      const htmlBlock = `
        <div>
          <h2>Chapter Overview</h2>
          <img src="local-asset://sha1_img1.png" alt="figure 1" />
          <p>Some paragraph text flow.</p>
          <img src="local-asset://sha2_img2.png" alt="figure 2" />
        </div>
      `;
      
      const expectedHtml = `
        <div>
          <h2>Chapter Overview</h2>
          <img src="file:///mock/documents/documents/images/sha1_img1.png" alt="figure 1" />
          <p>Some paragraph text flow.</p>
          <img src="file:///mock/documents/documents/images/sha2_img2.png" alt="figure 2" />
        </div>
      `;

      const resolved = resolveLocalAssetsInHtml(htmlBlock);
      expect(resolved).toBe(expectedHtml);
    });

    it('should handle empty or null string inputs gracefully', () => {
      expect(resolveLocalAssetsInHtml('')).toBe('');
    });
  });
});
