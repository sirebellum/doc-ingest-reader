import { PASS2_SYSTEM_PROMPT, PromptPayload } from './prompts';

export type LlmRoute = 'local' | 'network' | 'cloud';
export type CloudProvider = 'gemini' | 'claude' | 'openai';

export interface ConnectorConfig {
  route: LlmRoute;
  endpoint?: string;      // Used for Ollama / LM Studio (e.g., http://192.168.1.50:11434)
  apiKey?: string;        // Used for BYOK Cloud APIs
  provider?: CloudProvider;
  modelName?: string;
}

export interface ExtractedBlock {
  block_type: 'heading' | 'paragraph' | 'table' | 'code' | 'image' | 'quote';
  html_content: string;
  hyperlink_targets: string[];
  semantic_tags: string[];
}

export interface StructuringResponse {
  blocks: ExtractedBlock[];
}

/**
 * Normalizes response content string by stripping markdown backticks
 */
export function cleanJsonResponse(rawContent: string): string {
  let cleaned = rawContent.trim();
  // Strip ```json ... ``` blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '');
    cleaned = cleaned.replace(/\n?```$/, '');
  }
  return cleaned.trim();
}

/**
 * Triggers LLM Inference according to the selected routing model
 */
export async function runPass2Inference(
  payload: PromptPayload,
  config: ConnectorConfig
): Promise<StructuringResponse> {
  const userPrompt = JSON.stringify(payload);

  switch (config.route) {
    case 'local':
      // Local llama.cpp JSI hook (stubbed for Pass 2 scaffolding)
      return mockLocalInference(payload);

    case 'network':
      if (!config.endpoint) {
        throw new Error('Network route selected but no endpoint configured.');
      }
      return executeNetworkInference(userPrompt, config.endpoint, config.modelName);

    case 'cloud':
      if (!config.apiKey || !config.provider) {
        throw new Error('Cloud route selected but api key or provider is missing.');
      }
      return executeCloudInference(userPrompt, config.provider, config.apiKey, config.modelName);

    default:
      throw new Error(`Unsupported LLM route: ${config.route}`);
  }
}

/**
 * Sends request to Local network Ollama or LM Studio endpoints
 */
async function executeNetworkInference(
  prompt: string,
  endpoint: string,
  modelName?: string
): Promise<StructuringResponse> {
  const isOllama = endpoint.includes('/api/generate') || endpoint.includes('11434');
  const url = isOllama
    ? (endpoint.endsWith('/api/chat') ? endpoint : `${endpoint.replace(/\/$/, '')}/api/chat`)
    : `${endpoint.replace(/\/$/, '')}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const body = isOllama
    ? {
        model: modelName || 'llama3',
        messages: [
          { role: 'system', content: PASS2_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: { temperature: 0.1 },
      }
    : {
        model: modelName || 'local-model',
        messages: [
          { role: 'system', content: PASS2_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Network inference failed with status ${response.status}`);
  }

  const resJson = await response.json();
  let content = '';

  if (isOllama) {
    content = resJson.message?.content || '';
  } else {
    content = resJson.choices?.[0]?.message?.content || '';
  }

  return JSON.parse(cleanJsonResponse(content));
}

/**
 * Routes requests to Gemini, Claude, or OpenAI BYOK cloud engines
 */
async function executeCloudInference(
  prompt: string,
  provider: CloudProvider,
  apiKey: string,
  modelName?: string
): Promise<StructuringResponse> {
  let url = '';
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let body: any = {};

  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model: modelName || 'gpt-4-turbo',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PASS2_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    };
  } else if (provider === 'claude') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: modelName || 'claude-3-haiku-20240307',
      max_tokens: 4000,
      system: PASS2_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    };
  } else if (provider === 'gemini') {
    const model = modelName || 'gemini-1.5-flash';
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    body = {
      contents: [
        {
          parts: [
            { text: `${PASS2_SYSTEM_PROMPT}\n\nInput Payload:\n${prompt}` }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      }
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Cloud inference failed for ${provider} with status ${response.status}`);
  }

  const resJson = await response.json();
  let content = '';

  if (provider === 'openai') {
    content = resJson.choices?.[0]?.message?.content || '';
  } else if (provider === 'claude') {
    content = resJson.content?.[0]?.text || '';
  } else if (provider === 'gemini') {
    content = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  return JSON.parse(cleanJsonResponse(content));
}

/**
 * Local inference mock generator for offline dev testing
 */
function mockLocalInference(payload: PromptPayload): StructuringResponse {
  return {
    blocks: [
      {
        block_type: 'heading',
        html_content: `<h2 id="chapter-${payload.page_number}">Mock Chapter ${payload.page_number}</h2>`,
        hyperlink_targets: [],
        semantic_tags: ['mock', 'scaffolding'],
      },
      {
        block_type: 'paragraph',
        html_content: `<p>This is a simulated paragraph containing ${payload.raw_text.substring(0, 30)}...</p>`,
        hyperlink_targets: [],
        semantic_tags: ['simulated'],
      },
    ],
  };
}
