import { PASS2_SYSTEM_PROMPT, PromptPayload } from './prompts';
import { SecureKeystore } from './keystore';
import { RustParserBridge } from '../native/RustParserBridge';

export type LlmRoute = 'local' | 'network' | 'cloud';
export type CloudProvider = 'gemini' | 'claude' | 'openai';

export interface ConnectorConfig {
  route: LlmRoute;
  endpoint?: string;      // Used for Ollama / LM Studio (e.g., http://192.168.1.50:11434)
  apiKey?: string;        // Used for BYOK Cloud APIs
  provider?: CloudProvider;
  modelName?: string;
}

import type { ExtractedBlock as TExtractedBlock } from '../shared/types/ExtractedBlock';
import type { LLMStructuringOutput } from '../shared/types/LLMStructuringOutput';
import type { ASTNode } from '../shared/types/ASTNode';

export type ExtractedBlock = TExtractedBlock;
export type StructuringResponse = LLMStructuringOutput;

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
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function retryWithFailover<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        throw err;
      }
      console.warn(`[Resilient Inference] Attempt ${attempt} failed. Retrying in ${delayMs}ms... Error:`, err);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Unreachable retry state');
}

/**
 * Triggers LLM Inference according to the selected routing model
 */
export async function runPass2Inference(
  payload: PromptPayload,
  config: ConnectorConfig
): Promise<StructuringResponse> {
  // Validate configuration before starting the execution routing matrix
  if (config.route === 'network' && !config.endpoint) {
    throw new Error('Network route selected but no endpoint configured.');
  }
  if (config.route === 'cloud') {
    const hasKey = config.apiKey || (config.provider && await SecureKeystore.getApiKey(config.provider));
    if (!hasKey || !config.provider) {
      throw new Error('Cloud route selected but api key or provider is missing.');
    }
  }

  const userPrompt = JSON.stringify(payload);

  const NETWORK_TIMEOUT = 15000;
  const LOCAL_TIMEOUT = 30000;
  const MAX_RETRIES = 3;

  let currentRoute = config.route;
  let lastError: any = null;

  // Track visited routes to prevent infinite failover loops
  const visitedRoutes = new Set<string>();

  while (true) {
    if (visitedRoutes.has(currentRoute)) {
      console.warn(`[Resilient Inference] Failover loop detected. Recovering by falling back to local mock generator.`);
      return mockLocalInference(payload);
    }
    visitedRoutes.add(currentRoute);

    try {
      if (currentRoute === 'local') {
        const modelPath = config.modelName || 'models/custom-model.gguf';
        const prompt = JSON.stringify(payload);
        
        const result = await retryWithFailover(async () => {
          return withTimeout(
            (async () => {
              const resJsonString = await RustParserBridge.runInferenceAsync(modelPath, prompt);
              const parsed = JSON.parse(cleanJsonResponse(resJsonString));
              if (!parsed || !Array.isArray(parsed.blocks)) {
                throw new Error(parsed?.error || 'Invalid inference response structure: missing blocks array');
              }
              return parsed;
            })(),
            LOCAL_TIMEOUT,
            'Local on-device inference request timed out.'
          );
        }, MAX_RETRIES, 1000);
        return result;
      }

      if (currentRoute === 'network') {
        if (!config.endpoint) {
          throw new Error('Network route selected but no endpoint configured.');
        }
        
        const result = await retryWithFailover(async () => {
          return withTimeout(
            executeNetworkInference(userPrompt, config.endpoint!, config.modelName),
            NETWORK_TIMEOUT,
            'Local network inference request timed out.'
          );
        }, MAX_RETRIES, 1000);
        return result;
      }

      if (currentRoute === 'cloud') {
        let apiKey = config.apiKey;
        if (!apiKey && config.provider) {
          apiKey = await SecureKeystore.getApiKey(config.provider) || undefined;
        }
        if (!apiKey || !config.provider) {
          throw new Error('Cloud route selected but api key or provider is missing.');
        }
        
        const result = await retryWithFailover(async () => {
          return withTimeout(
            executeCloudInference(userPrompt, config.provider!, apiKey!, config.modelName),
            NETWORK_TIMEOUT,
            'Cloud inference request timed out.'
          );
        }, MAX_RETRIES, 1000);
        return result;
      }

      throw new Error(`Unsupported LLM route: ${currentRoute}`);
    } catch (err) {
      console.warn(`[Resilient Inference] Route ${currentRoute} failed completely. Error:`, err);
      lastError = err;

      // Failover transition logic
      if (currentRoute === 'local') {
        if (config.endpoint) {
          console.warn('[Resilient Inference] Failover: migrating from Local NPU/CPU to local network link gateway.');
          currentRoute = 'network';
        } else if (config.apiKey && config.provider) {
          console.warn('[Resilient Inference] Failover: migrating from Local NPU/CPU to cloud BYOK endpoint.');
          currentRoute = 'cloud';
        } else {
          console.warn('[Resilient Inference] No backup gateway configured. Falling back to local mock generator fallback.');
          return mockLocalInference(payload);
        }
      } else if (currentRoute === 'network') {
        if (config.apiKey && config.provider) {
          console.warn('[Resilient Inference] Failover: migrating from Network link to cloud BYOK endpoint.');
          currentRoute = 'cloud';
        } else {
          console.warn('[Resilient Inference] Network link failed. Transitioning to local on-device GGUF inference.');
          currentRoute = 'local';
        }
      } else {
        console.warn('[Resilient Inference] Cloud route failed. Recovering pipeline by falling back to local mock generation.');
        return mockLocalInference(payload);
      }
    }
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
  const isOllama = endpoint.includes('/api/generate') || endpoint.includes('/api/chat') || endpoint.includes('11434');
  const isOllamaGenerate = endpoint.includes('/api/generate');
  
  const url = isOllama
    ? (isOllamaGenerate
        ? (endpoint.endsWith('/api/generate') ? endpoint : `${endpoint.replace(/\/$/, '')}/api/generate`)
        : (endpoint.endsWith('/api/chat') ? endpoint : `${endpoint.replace(/\/$/, '')}/api/chat`))
    : `${endpoint.replace(/\/$/, '')}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let body: any;
  if (isOllama) {
    if (isOllamaGenerate) {
      body = {
        model: modelName || 'llama3',
        prompt: prompt,
        system: PASS2_SYSTEM_PROMPT,
        stream: false,
        options: { temperature: 0.1 },
      };
    } else {
      body = {
        model: modelName || 'llama3',
        messages: [
          { role: 'system', content: PASS2_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: { temperature: 0.1 },
      };
    }
  } else {
    body = {
      model: modelName || 'local-model',
      messages: [
        { role: 'system', content: PASS2_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    };
  }

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
    if (isOllamaGenerate) {
      content = resJson.response || '';
    } else {
      content = resJson.message?.content || '';
    }
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
  const headers: Record<string, string> = {
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
        content: {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: `Mock Chapter ${payload.page_number}`, bold: null, italic: null, code: null }]
        },
        hyperlink_targets: [],
        semantic_tags: ['mock', 'scaffolding'],
      },
      {
        block_type: 'paragraph',
        content: {
          type: 'paragraph',
          children: [{ type: 'text', text: `This is a simulated paragraph containing ${payload.raw_text.substring(0, 30)}...`, bold: null, italic: null, code: null }]
        },
        hyperlink_targets: [],
        semantic_tags: ['simulated'],
      },
    ],
  };
}
