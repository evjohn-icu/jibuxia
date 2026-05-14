import { config } from './config.js';

function getEnvApiKey(provider) {
  if (provider === 'minimax') {
    return process.env.MINIMAX_API_KEY || process.env.ANTHROPIC_API_KEY;
  }

  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY;
  }

  if (provider === 'openai') {
    return process.env.OPENAI_API_KEY;
  }

  return null;
}

export async function createLlmClient() {
  const { provider, apiKey, baseUrl } = config.llm || {};
  
  const envApiKey = getEnvApiKey(provider);
  const effectiveKey = process.env.JIBUXIA_LLM_API_KEY || apiKey || envApiKey;
  
  if (!effectiveKey) {
    throw new Error(`No API key found for ${provider || 'unknown'} provider. Set JIBUXIA_LLM_API_KEY, the provider-specific API key, or apiKey in config.json`);
  }
  
  if (provider === 'openai') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: effectiveKey, baseURL: baseUrl });
  }
  
  if (provider === 'anthropic') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: effectiveKey, baseURL: baseUrl });
  }
  
  if (provider === 'ollama') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: 'ollama', baseURL: baseUrl || 'http://localhost:11434/v1' });
  }
  
  if (provider === 'minimax') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({
      apiKey: effectiveKey,
      baseURL: baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic'
    });
  }
  
  throw new Error(`Unknown LLM provider: ${provider}`);
}

export async function callLlm(messages, options = {}) {
  const { provider, model } = config.llm || {};
  const client = await createLlmClient();
  
  const maxTokens = options.maxTokens || 4096;
  
  if (provider === 'anthropic' || provider === 'minimax') {
    const systemMessages = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .filter(Boolean);
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    const response = await client.messages.create({
      model: model || (provider === 'minimax' ? 'MiniMax-M2.7' : 'claude-sonnet-4-20250514'),
      max_tokens: maxTokens,
      ...(systemMessages.length > 0 ? { system: systemMessages.join('\n\n') } : {}),
      messages: chatMessages
    });
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
  }
  
  const response = await client.chat.completions.create({
    model: model || 'gpt-4o',
    max_tokens: maxTokens,
    temperature: 1.0,
    messages
  });
  return response.choices[0].message.content;
}
