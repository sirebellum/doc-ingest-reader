import { cleanJsonResponse, runPass2Inference, ConnectorConfig } from '../connector';
import { PromptPayload } from '../prompts';

describe('LLM Ingestion Connector Tests', () => {
  const mockPayload: PromptPayload = {
    document_id: 'doc-uuid-12345',
    page_number: 2,
    overlap_context: 'end of page 1 text context',
    raw_text: 'This is the main text of page 2 layout structure.',
    layout_hints: [
      {
        bounding_box: [10.0, 20.0, 100.0, 50.0],
        font_size: 16.0,
        text_snippet: 'Chapter 2: Setup',
      },
    ],
  };

  describe('cleanJsonResponse utility', () => {
    it('should strip markdown code fence formatting', () => {
      const rawInput = '```json\n{\n  "blocks": []\n}\n```';
      const cleaned = cleanJsonResponse(rawInput);
      expect(cleaned).toBe('{\n  "blocks": []\n}');
    });

    it('should handle code fences without language hints', () => {
      const rawInput = '```\n{"blocks": []}```';
      const cleaned = cleanJsonResponse(rawInput);
      expect(cleaned).toBe('{"blocks": []}');
    });

    it('should return pure json content unaffected', () => {
      const rawInput = '{"blocks": []}';
      const cleaned = cleanJsonResponse(rawInput);
      expect(cleaned).toBe('{"blocks": []}');
    });
  });

  describe('Local Inference Stub', () => {
    it('should generate mock layout structures without making network queries', async () => {
      const config: ConnectorConfig = { route: 'local' };
      const response = await runPass2Inference(mockPayload, config);

      expect(response.blocks.length).toBe(2);
      expect(response.blocks[0].block_type).toBe('heading');
      expect(response.blocks[0].html_content).toContain('Mock Chapter 2');
      expect(response.blocks[1].block_type).toBe('paragraph');
    });
  });

  describe('HTTP / Network routes (Ollama & LM Studio mocks)', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should route request correctly to local network Ollama endpoints', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              blocks: [
                {
                  block_type: 'paragraph',
                  html_content: '<p>Ollama paragraph</p>',
                  hyperlink_targets: [],
                  semantic_tags: ['local-ollama'],
                },
              ],
            }),
          },
        }),
      });

      const config: ConnectorConfig = {
        route: 'network',
        endpoint: 'http://192.168.1.50:11434',
        modelName: 'llama3',
      };

      const res = await runPass2Inference(mockPayload, config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('http://192.168.1.50:11434/api/chat');
      expect(res.blocks[0].semantic_tags).toContain('local-ollama');
    });

    it('should route request correctly to BYOK OpenAI endpoint', async () => {
      const mockFetch = global.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  blocks: [
                    {
                      block_type: 'heading',
                      html_content: '<h1>Cloud Heading</h1>',
                      hyperlink_targets: [],
                      semantic_tags: ['cloud-openai'],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      });

      const config: ConnectorConfig = {
        route: 'cloud',
        provider: 'openai',
        apiKey: 'sk-test-key-12345',
        modelName: 'gpt-4o',
      };

      const res = await runPass2Inference(mockPayload, config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer sk-test-key-12345');
      expect(res.blocks[0].semantic_tags).toContain('cloud-openai');
    });
  });
});
