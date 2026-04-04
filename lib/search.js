import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);
const WIKI_DIR = join(__dirname, '..', CONFIG.paths.wiki);
const ARTICLES_DIR = join(__dirname, '..', CONFIG.paths.articles);

async function createLlmClient() {
  const { provider, apiKey, baseUrl, model } = CONFIG.llm || {};
  
  if (provider === 'openai') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY, baseURL: baseUrl });
  }
  
  if (provider === 'anthropic') {
    const { Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  }
  
  if (provider === 'ollama') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: 'ollama', baseURL: baseUrl || 'http://localhost:11434/v1' });
  }
  
  if (provider === 'minimax') {
    const { OpenAI } = await import('openai');
    return new OpenAI({ apiKey: apiKey, baseURL: baseUrl || 'https://api.minimaxi.com/v1' });
  }
  
  return null;
}

async function callLlm(messages, options = {}) {
  const client = await createLlmClient();
  if (!client) {
    throw new Error('No LLM client configured');
  }
  
  const { provider, model } = CONFIG.llm || {};
  const maxTokens = options.maxTokens || 2048;
  
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

function searchChunks(query, files) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const results = [];
  
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const parsed = matter(content);
    const text = parsed.content || '';
    const lower = text.toLowerCase();
    
    let score = 0;
    const matchedTerms = [];
    
    for (const term of terms) {
      if (lower.includes(term)) {
        score += 1;
        matchedTerms.push(term);
      }
    }
    
    if (score > 0) {
      const lines = text.split('\n').filter(l => l.trim());
      const snippetLines = [];
      
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (terms.some(t => lowerLine.includes(t))) {
          snippetLines.push(line.trim());
          if (snippetLines.length >= 3) break;
        }
      }
      
      results.push({
        file: basename(file),
        url: parsed.data?.url,
        title: parsed.data?.title || basename(file),
        score,
        matchedTerms,
        snippet: snippetLines.join(' | ').slice(0, 300)
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

function searchWiki(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const results = [];
  
  const searchDir = (dir, type) => {
    try {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter(f => extname(f) === '.md');
      for (const file of files) {
        const filepath = join(dir, file);
        const content = readFileSync(filepath, 'utf-8');
        const parsed = matter(content);
        const text = (parsed.content || '').toLowerCase();
        
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) score++;
          if (parsed.data?.title?.toLowerCase().includes(term)) score += 2;
          if (parsed.data?.name?.toLowerCase().includes(term)) score += 2;
        }
        
        if (score > 0) {
          results.push({
            type,
            name: parsed.data?.title || parsed.data?.name || basename(file, '.md'),
            path: filepath,
            score
          });
        }
      }
    } catch (e) {
    }
  };
  
  searchDir(join(WIKI_DIR, 'concepts'), 'concept');
  searchDir(join(WIKI_DIR, 'articles'), 'article');
  
  return results.sort((a, b) => b.score - a.score);
}

function buildPrompt(query, chunks, wikiResults) {
  let prompt = `You are a knowledgeable research assistant. Based on the following information from the user's knowledge base, answer their question thoroughly.\n\n`;
  prompt += `Question: ${query}\n\n`;
  
  if (chunks.length > 0) {
    prompt += `## Relevant Source Material\n\n`;
    for (const chunk of chunks.slice(0, 5)) {
      prompt += `### ${chunk.title}${chunk.url ? ` (Source: ${chunk.url})` : ''}\n`;
      prompt += `${chunk.snippet}\n\n`;
    }
  }
  
  if (wikiResults.length > 0) {
    prompt += `## Related Wiki Articles\n\n`;
    for (const r of wikiResults.slice(0, 5)) {
      prompt += `- **${r.name}** (${r.type})\n`;
    }
    prompt += `\n`;
  }
  
  prompt += `## Your Answer\n\n`;
  prompt += `Provide a comprehensive, well-structured answer. Reference specific sources where appropriate.`;
  
  return prompt;
}

export async function ask(query, options = {}) {
  const { limit = 10, saveToWiki = false } = options;
  
  const files = existsSync(CONTENT_DIR)
    ? readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md').map(f => join(CONTENT_DIR, f))
    : [];
  
  const chunks = searchChunks(query, files);
  const wikiResults = searchWiki(query);
  
  console.log(`[search] Found ${chunks.length} chunk matches, ${wikiResults.length} wiki matches`);
  
  let answer = null;
  let llmError = null;
  
  try {
    const { search: vectorSearch } = await import('./indexer.js');
    const vectorResults = vectorSearch(query, limit);
    
    const prompt = buildPrompt(query, chunks, wikiResults);
    
    console.log('[search] Calling LLM...');
    answer = await callLlm([
      { role: 'system', content: 'You are a helpful research assistant with access to a personal knowledge base.' },
      { role: 'user', content: prompt }
    ], { maxTokens: 2048 });
    
    console.log('[search] LLM response received');
    
    if (saveToWiki && answer) {
      await saveAnswerToWiki(query, answer, chunks, wikiResults);
    }
    
  } catch (e) {
    llmError = e.message;
    console.error(`[search] LLM error: ${e.message}`);
  }
  
  return {
    query,
    chunks,
    wikiResults,
    answer,
    llmError,
    savedToWiki: saveToWiki
  };
}

async function saveAnswerToWiki(query, answer, chunks, wikiResults) {
  const title = query.split(/\s+/).slice(0, 5).join(' ');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const filepath = join(ARTICLES_DIR, `${slug}.md`);
  
  mkdirSync(ARTICLES_DIR, { recursive: true });
  
  const sourceLinks = chunks.slice(0, 3).map(c => c.url).filter(Boolean);
  const wikiLinks = wikiResults.slice(0, 5).map(r => `[[${r.name}]]`).join(', ');
  
  const content = `# ${title}\n\n`;
  const content_md = `${answer}\n\n`;
  const sources_md = sourceLinks.length > 0 ? `## Sources\n\n${sourceLinks.map(u => `- ${u}`).join('\n')}\n\n` : '';
  const links_md = wikiLinks ? `## Related\n\n${wikiLinks}\n\n` : '';
  const meta = `---\ntitle: ${title}\ntype: article\nquery: "${query}"\ncreatedAt: ${new Date().toISOString()}\nsavedFromQuery: true\n---\n`;
  
  writeFileSync(filepath, meta + content + content_md + sources_md + links_md);
  console.log(`[search] Answer saved to: ${filepath}`);
  
  return filepath;
}

export function formatResults(results) {
  let output = `# Search Results: "${results.query}"\n\n`;
  
  if (results.answer) {
    output += `## Answer\n\n${results.answer}\n\n`;
  } else if (results.llmError) {
    output += `## LLM Error\n\n${results.llmError}\n\n`;
  }
  
  if (results.chunks.length > 0) {
    output += `## Source Material\n\n`;
    for (const c of results.chunks.slice(0, 5)) {
      output += `### ${c.title}\n`;
      output += `${c.snippet}\n`;
      output += `Score: ${c.score}\n\n`;
    }
  }
  
  if (results.wikiResults.length > 0) {
    output += `## Wiki Articles\n\n`;
    for (const r of results.wikiResults.slice(0, 5)) {
      output += `- **${r.name}** (${r.type})\n`;
    }
    output += `\n`;
  }
  
  if (results.savedToWiki) {
    output += `_[Answer saved to wiki]_\n`;
  }
  
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const saveFlag = args.includes('--save');
  const query = args.filter(a => !a.startsWith('--')).join(' ');
  
  if (query) {
    console.log(`[ask] Query: "${query}"${saveFlag ? ' (will save to wiki)' : ''}\n`);
    const results = await ask(query, { saveToWiki: saveFlag });
    console.log(formatResults(results));
  } else {
    console.log('Usage: node search.js "your question" [--save]');
  }
}