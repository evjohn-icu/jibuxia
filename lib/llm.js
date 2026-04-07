import { config } from './config.js';

export async function createLlmClient() {
  const { provider, apiKey, baseUrl, model } = config.llm || {};
  
  const envApiKey = process.env.JIBUXIA_LLM_API_KEY;
  const effectiveKey = apiKey || envApiKey;
  
  if (!effectiveKey) {
    throw new Error('No API key found. Set JIBUXIA_LLM_API_KEY environment variable or apiKey in config.json');
  }
  
  if (provider === 'openai') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: effectiveKey, baseURL: baseUrl });
  }
  
  if (provider === 'anthropic') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: effectiveKey });
  }
  
  if (provider === 'ollama') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: 'ollama', baseURL: baseUrl || 'http://localhost:11434/v1' });
  }
  
  if (provider === 'minimax') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: effectiveKey, baseURL: baseUrl || 'https://api.minimaxi.com/v1' });
  }
  
  throw new Error(`Unknown LLM provider: ${provider}`);
}

export async function callLlm(messages, options = {}) {
  const { provider, model } = config.llm || {};
  const client = await createLlmClient();
  
  const maxTokens = options.maxTokens || 4096;
  
  if (provider === 'anthropic') {
    const response = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages
    });
    return response.content[0].text;
  }
  
  let response;
  if (provider === 'minimax') {
    response = await client.chat.completions.create({
      model: model || 'MiniMax-M2.7',
      max_tokens: maxTokens,
      temperature: 1.0,
      messages,
      extra_body: { reasoning_split: true }
    });
    const content = response.choices[0].message.content || '';
    const cleanContent = content.replace(/<[^>]*>/g, '').trim();
    return cleanContent;
  }
  
  response = await client.chat.completions.create({
    model: model || 'gpt-4o',
    max_tokens: maxTokens,
    temperature: 1.0,
    messages
  });
  return response.choices[0].message.content;
}
