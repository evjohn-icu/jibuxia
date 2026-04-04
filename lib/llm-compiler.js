import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);
const WIKI_DIR = join(__dirname, '..', CONFIG.paths.wiki);
const CONCEPTS_DIR = join(__dirname, '..', CONFIG.paths.concepts);
const ARTICLES_DIR = join(__dirname, '..', CONFIG.paths.articles);
const ASSETS_DIR = join(__dirname, '..', CONFIG.paths.assets);

mkdirSync(WIKI_DIR, { recursive: true });
mkdirSync(CONCEPTS_DIR, { recursive: true });
mkdirSync(ARTICLES_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });

async function createLlmClient() {
  const { provider, apiKey, baseUrl, model } = CONFIG.llm || {};
  
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

function detectLanguage(text) {
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(text) ? 'chinese' : 'english';
}

function getAllContent() {
  if (!existsSync(CONTENT_DIR)) return [];
  
  return readdirSync(CONTENT_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => {
      const filepath = join(CONTENT_DIR, f);
      const content = readFileSync(filepath, 'utf-8');
      const parsed = matter(content);
      return {
        filepath,
        filename: f,
        url: parsed.data?.url,
        title: parsed.data?.title || f,
        content: parsed.content,
        fetchedAt: parsed.data?.fetchedAt,
        language: detectLanguage(parsed.content)
      };
    })
    .sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
}

function getExistingWiki() {
  const existing = { concepts: [], articles: [] };
  
  if (existsSync(CONCEPTS_DIR)) {
    existing.concepts = readdirSync(CONCEPTS_DIR)
      .filter(f => extname(f) === '.md')
      .map(f => {
        const content = readFileSync(join(CONCEPTS_DIR, f), 'utf-8');
        const parsed = matter(content);
        return { name: basename(f, '.md'), title: parsed.data?.name || parsed.data?.title, content: parsed.content };
      });
  }
  
  if (existsSync(ARTICLES_DIR)) {
    existing.articles = readdirSync(ARTICLES_DIR)
      .filter(f => extname(f) === '.md')
      .map(f => {
        const content = readFileSync(join(ARTICLES_DIR, f), 'utf-8');
        const parsed = matter(content);
        return { name: basename(f, '.md'), title: parsed.data?.title, content: parsed.content };
      });
  }
  
  return existing;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extractBacklinks(content) {
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  const links = [];
  let match;
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)];
}

export async function compileWithLLM(newContent = [], options = {}) {
  const { force = false } = options;
  
  console.log('[llm-compiler] Starting LLM-driven compilation...');
  
  const sources = getAllContent();
  const existing = getExistingWiki();
  
  console.log(`[llm-compiler] ${sources.length} sources, ${existing.concepts.length} concepts, ${existing.articles.length} articles`);
  
  const systemPrompt = `You are a knowledge compiler. Your job is to organize source material into a structured wiki.

## CRITICAL LANGUAGE RULE (NON-NEGOTIABLE)
- Chinese sources MUST produce Chinese wiki pages ONLY
- English sources MUST produce English wiki pages ONLY
- NEVER translate content between languages
- NEVER mix languages in a single wiki page
- If a source contains ANY Chinese characters, write the entire wiki page in Chinese
- If a source is entirely in English, write in English
- Mixing languages = FAILURE. Chinese source with English output = FAILURE.

Rules:
1. Create concept pages for key ideas/topics (use singular, e.g., "machine-learning" not "machine-learnings")
2. Create article pages that synthesize multiple sources
3. Always use wiki-style links [[page-name]] to link related concepts and articles
4. Write comprehensive content, not just summaries - explain, connect, provide context
5. Keep concepts focused on one topic; articles can cover broader themes
6. Update existing pages if they need revision rather than creating duplicates

Output format for EACH page you create:
---
title: Page Title
type: concept|article
---

# Page Title

Content here...`;

  const sourcesSummary = sources.map(s => {
    const lang = s.language.toUpperCase();
    return `## Source: ${s.title}\nURL: ${s.url}\n**[LANGUAGE: ${lang}]** - This source is in ${s.language}. You MUST write the wiki page in ${s.language}.\n\n${s.content.slice(0, 1000)}${s.content.length > 1000 ? '\n...' : ''}`;
  }).join('\n\n---\n\n');
  
  const existingSummary = `Existing concepts: ${existing.concepts.map(c => c.title).join(', ')}\nExisting articles: ${existing.articles.map(a => a.title).join(', ')}`;
  
  const userPrompt = `## Task
Analyze the sources and create/update wiki pages. **CRITICAL**: Respect the [LANGUAGE] tag for each source.

Prioritize:
1. New sources that haven't been covered
2. Connections between existing and new content
3. Filling gaps in the wiki structure

${force ? '## Force recompile - revise existing pages too' : '## Only create new content, do not revise existing unless necessary'}

## Sources to process:
${sourcesSummary}

${existingSummary}

For each page you want to create or update, respond with:
CREATE: filename.md
---
title: Title
type: concept|article
---

# Title

Content...`;

  console.log('[llm-compiler] Calling LLM...');
  
  try {
    const response = await callLlm([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 8192 });
    
    await saveCompiledPages(response);
    
    await updateIndex();
    
    await updateBacklinks();
    
    console.log('[llm-compiler] Compilation complete');
    
    return { success: true, sources: sources.length };
  } catch (error) {
    console.error('[llm-compiler] Error:', error.message);
    return { success: false, error: error.message };
  }
}

async function saveCompiledPages(response) {
  let saved = { concepts: 0, articles: 0 };
  
  const blocks = response.split(/(?=CREATE:|UPDATE:)/);
  
  for (const block of blocks) {
    if (!block.trim()) continue;
    
    const createMatch = block.match(/CREATE:\s*(.+?)\n---/);
    if (!createMatch) continue;
    
    const filename = createMatch[1].trim().replace(/\.md$/i, '');
    
    const fmMatch = block.match(/---\n([\s\S]+?)\n---\n([\s\S]+)$/);
    if (!fmMatch) continue;
    
    const frontmatter = {};
    fmMatch[1].split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length) frontmatter[key.trim()] = valueParts.join(':').trim();
    });
    
    const type = frontmatter.type || 'article';
    const title = frontmatter.title || filename;
    const dir = type === 'concept' ? CONCEPTS_DIR : ARTICLES_DIR;
    const filepath = join(dir, slugify(filename) + '.md');
    
    const fullContent = matter.stringify(fmMatch[2].trim(), {
      title,
      type,
      createdAt: new Date().toISOString(),
      source: 'llm-compiler'
    });
    
    writeFileSync(filepath, fullContent);
    
    if (type === 'concept') saved.concepts++;
    else saved.articles++;
    
    console.log(`[llm-compiler] Saved: ${type}/${slugify(filename)}`);
  }
  
  console.log(`[llm-compiler] Created ${saved.concepts} concepts, ${saved.articles} articles`);
}

async function updateIndex() {
  const concepts = readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md');
  const articles = readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md');
  const sources = getAllContent();
  
  const backlinks = collectAllBacklinks();
  
  let index = `# 记不下\n\n`;
  index += `> Last compiled: ${new Date().toISOString()}\n\n`;
  index += `## Stats\n\n`;
  index += `- **Sources**: ${sources.length}\n`;
  index += `- **Concepts**: ${concepts.length}\n`;
  index += `- **Articles**: ${articles.length}\n\n`;
  index += `## Concepts\n\n`;
  for (const c of concepts) {
    const name = basename(c, '.md');
    index += `- [[concepts/${name}]]\n`;
  }
  index += `\n## Articles\n\n`;
  for (const a of articles) {
    const name = basename(a, '.md');
    index += `- [[articles/${name}]]\n`;
  }
  index += `\n## Sources\n\n`;
  for (const s of sources) {
    index += `- [[${s.title}]]${s.url ? ` — [link](${s.url})` : ''}\n`;
  }
  index += `\n## Backlinks Index\n\n`;
  for (const [page, links] of Object.entries(backlinks)) {
    if (links.length > 0) {
      index += `### ${page}\n`;
      for (const link of links) {
        index += `- [[${link}]]\n`;
      }
    }
  }
  
  writeFileSync(join(WIKI_DIR, 'index.md'), index);
  console.log('[llm-compiler] Updated index with backlinks');
}

function collectAllBacklinks() {
  const backlinks = {};
  
  const dirs = [CONCEPTS_DIR, ARTICLES_DIR];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    
    const files = readdirSync(dir).filter(f => extname(f) === '.md');
    
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      const links = extractBacklinks(content);
      const pageName = basename(file, '.md');
      backlinks[pageName] = links;
    }
  }
  
  return backlinks;
}

async function updateBacklinks() {
  const backlinks = collectAllBacklinks();
  
  for (const [page, links] of Object.entries(backlinks)) {
    const dir = links.some(l => existsSync(join(CONCEPTS_DIR, l + '.md'))) ? CONCEPTS_DIR : ARTICLES_DIR;
    const filepath = join(dir, page + '.md');
    
    if (!existsSync(filepath)) continue;
    
    const content = readFileSync(filepath, 'utf-8');
    const parsed = matter(content);
    
    const backlinkSection = `\n\n---\n\n## Backlinks\n\n${links.map(l => `- [[${l}]]`).join('\n')}\n`;
    
    if (!content.includes('## Backlinks')) {
      writeFileSync(filepath, matter.stringify(parsed.content + backlinkSection, parsed.data));
    }
  }
}

export async function quickCompile() {
  const { buildIndex } = await import('./compiler.js');
  buildIndex();
  
  const sources = getAllContent();
  if (sources.length > 0) {
    await compileWithLLM(sources, { force: false });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  await compileWithLLM([], { force });
}
