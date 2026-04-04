import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);
const WIKI_DIR = join(__dirname, '..', CONFIG.paths.wiki);
const CONCEPTS_DIR = join(__dirname, '..', CONFIG.paths.concepts);
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
  
  throw new Error(`Unknown LLM provider: ${provider || 'not configured'}`);
}

async function callLlm(messages, options = {}) {
  const { provider, model } = CONFIG.llm || {};
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

async function webSearch(query) {
  try {
    const { apiKey } = CONFIG.llm || {};
    if (!apiKey && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return null;
    }
    
    const response = await axios.get('https://api.search.brave.com/search/v1/web', {
      params: { q: query, count: 5 },
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_KEY || ''
      }
    }).catch(() => null);
    
    if (response?.data?.results) {
      return response.data.results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description
      }));
    }
  } catch (e) {
  }
  
  return null;
}

function getWikiFiles() {
  const files = [];
  
  for (const dir of [CONCEPTS_DIR, ARTICLES_DIR]) {
    if (!existsSync(dir)) continue;
    readdirSync(dir)
      .filter(f => extname(f) === '.md')
      .forEach(f => files.push({ path: join(dir, f), type: basename(dir) }));
  }
  
  return files;
}

function findInconsistencies() {
  const issues = [];
  const files = getWikiFiles();
  const titles = new Map();
  
  for (const { path, type } of files) {
    const content = readFileSync(path, 'utf-8');
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : basename(path, '.md');
    const filename = basename(path, '.md');
    
    if (titles.has(title) && titles.get(title) !== path) {
      issues.push({
        type: 'duplicate_title',
        title,
        files: [titles.get(title), path]
      });
    }
    titles.set(title, path);
    
    const words = content.split(/\s+/).length;
    if (words < 30 && !content.includes('> Concept imported')) {
      issues.push({
        type: 'stub_page',
        file: filename,
        wordCount: words
      });
    }
  }
  
  return issues;
}

function findBrokenLinks() {
  const issues = [];
  const files = getWikiFiles();
  const knownPages = new Set(files.map(f => basename(f.path, '.md')));
  
  for (const { path, type } of files) {
    const content = readFileSync(path, 'utf-8');
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const target = match[1].split('/').pop().replace('.md', '');
      if (!knownPages.has(target) && target !== basename(path, '.md')) {
        issues.push({
          type: 'broken_link',
          source: basename(path, '.md'),
          target
        });
      }
    }
  }
  
  return issues;
}

function suggestConnections() {
  const suggestions = [];
  const files = getWikiFiles();
  
  const allContent = files.map(f => ({
    name: basename(f.path, '.md'),
    content: readFileSync(f.path, 'utf-8')
  }));
  
  const terms = {};
  for (const item of allContent) {
    const words = item.content.toLowerCase().split(/\s+/)
      .filter(w => w.length > 6 && /^[a-z]+$/.test(w));
    for (const w of words) {
      terms[w] = terms[w] || [];
      terms[w].push(item.name);
    }
  }
  
  const coOccurrences = {};
  for (const [term, pages] of Object.entries(terms)) {
    if (pages.length >= 2 && pages.length <= 5) {
      const key = pages.slice().sort().join('|');
      if (!coOccurrences[key]) {
        coOccurrences[key] = { term, pages: [...new Set(pages)] };
      }
    }
  }
  
  const suggestions_list = Object.values(coOccurrences)
    .sort((a, b) => b.pages.length - a.pages.length)
    .slice(0, 10);
  
  for (const s of suggestions_list) {
    suggestions.push({
      type: 'potential_connection',
      term: s.term,
      pages: s.pages,
      reason: `Terms "${s.term}" appear in multiple related pages`
    });
  }
  
  return suggestions;
}

export async function runLint(options = {}) {
  const { includeWebSearch = true } = options;
  
  console.log('[lint] Running knowledge base health check...\n');
  
  const inconsistencies = findInconsistencies();
  const brokenLinks = findBrokenLinks();
  const connections = suggestConnections();
  
  console.log(`[lint] Found ${inconsistencies.length} inconsistencies, ${brokenLinks.length} broken links, ${connections.length} connection suggestions`);
  
  if (inconsistencies.length === 0 && brokenLinks.length === 0) {
    console.log('[lint] No critical issues found');
    return { issues: [], suggestions: connections };
  }
  
  const systemPrompt = `You are a knowledge base health assistant. Analyze the following issues and suggest specific fixes.`;
  
  const userPrompt = `## Issues Found

### Inconsistencies
${inconsistencies.map(i => `- [${i.type}] ${JSON.stringify(i)}`).join('\n')}

### Broken Links
${brokenLinks.map(b => `- [${b.type}] ${JSON.stringify(b)}`).join('\n')}

### Connection Suggestions
${connections.map(c => `- ${c.pages.join(', ')}: "${c.term}"`).join('\n')}

For each issue, suggest a concrete fix. If web search would help resolve something (e.g., finding missing info), say so.`;

  try {
    const response = await callLlm([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 2048 });
    
    console.log('\n[lint] LLM Analysis:\n');
    console.log(response);
    
    const report = {
      timestamp: new Date().toISOString(),
      issues: [...inconsistencies, ...brokenLinks],
      suggestions: connections,
      analysis: response
    };
    
    const reportDir = join(WIKI_DIR, 'health-reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${Date.now()}-report.md`), `# Health Report\n\n${response}\n\n---\nIssues: ${report.issues.length}\nSuggestions: ${report.suggestions.length}`);
    
    return report;
  } catch (error) {
    console.error('[lint] LLM error:', error.message);
    return { issues: [...inconsistencies, ...brokenLinks], suggestions: connections, error: error.message };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runLint({ includeWebSearch: true });
}