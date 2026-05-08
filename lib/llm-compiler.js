import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import matter from 'gray-matter';
import { callLlm } from './llm.js';
import { config, paths } from './config.js';
import { logger } from './logger.js';

const CONTENT_DIR = paths.content;
const WIKI_DIR = paths.wiki;
const CONCEPTS_DIR = paths.concepts;
const ARTICLES_DIR = paths.articles;
const ASSETS_DIR = paths.assets;
const DATA_DIR = join(WIKI_DIR, '..', 'data');
const LAST_COMPILE_FILE = join(DATA_DIR, 'last-compile.json');

mkdirSync(WIKI_DIR, { recursive: true });
mkdirSync(CONCEPTS_DIR, { recursive: true });
mkdirSync(ARTICLES_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

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
  const startedAt = new Date().toISOString();

  logger.info('[llm-compiler] Starting LLM-driven compilation...');

  const sources = getAllContent();
  const existing = getExistingWiki();

  logger.info(`[llm-compiler] ${sources.length} sources, ${existing.concepts.length} concepts, ${existing.articles.length} articles`);

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

  logger.info('[llm-compiler] Calling LLM...');

  try {
    const response = await callLlm([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 8192 });

    const saved = await saveCompiledPages(response);

    await updateIndex();

    await updateBacklinks();

    logger.info('[llm-compiler] Compilation complete');

    const result = {
      success: saved.errors.length === 0,
      timestamp: new Date().toISOString(),
      startedAt,
      sources: sources.length,
      pages: saved.pages,
      pageCount: saved.pages.length,
      concepts: saved.concepts,
      articles: saved.articles,
      warnings: saved.warnings,
      errors: saved.errors
    };

    if (saved.errors.length > 0) {
      result.error = `Saved ${saved.pages.length} page(s), ${saved.errors.length} block(s) failed`;
    }

    writeLastCompile(result);
    return result;
  } catch (error) {
    logger.error('[llm-compiler] Error:', error.message);
    const result = {
      success: false,
      timestamp: new Date().toISOString(),
      startedAt,
      sources: sources.length,
      pages: [],
      pageCount: 0,
      concepts: 0,
      articles: 0,
      warnings: [],
      errors: [error.message],
      error: error.message
    };
    writeLastCompile(result);
    return result;
  }
}

async function saveCompiledPages(response) {
  const saved = { concepts: 0, articles: 0, pages: [], warnings: [], errors: [] };

  const blocks = response.split(/(?=CREATE:|UPDATE:)/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    try {
      const actionMatch = block.match(/(CREATE|UPDATE):\s*(.+?)\n---/);
      if (!actionMatch) {
        saved.warnings.push('Skipped block without CREATE/UPDATE header');
        continue;
      }

      const action = actionMatch[1].toLowerCase();
      const filename = actionMatch[2].trim().replace(/\.md$/i, '');

      const fmMatch = block.match(/---\n([\s\S]+?)\n---\n([\s\S]+)$/);
      if (!fmMatch) {
        saved.errors.push(`Missing frontmatter/content for ${actionMatch[2].trim()}`);
        continue;
      }

      const frontmatter = {};
      fmMatch[1].split('\n').forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) frontmatter[key.trim()] = valueParts.join(':').trim();
      });

      const type = frontmatter.type === 'concept' ? 'concept' : 'article';
      const title = frontmatter.title || filename;
      const dir = type === 'concept' ? CONCEPTS_DIR : ARTICLES_DIR;
      const filepath = join(dir, slugify(filename) + '.md');
      const previous = existsSync(filepath)
        ? matter(readFileSync(filepath, 'utf-8')).data
        : {};

      const fullContent = matter.stringify(fmMatch[2].trim(), {
        ...previous,
        title,
        type,
        updatedAt: new Date().toISOString(),
        createdAt: previous.createdAt || new Date().toISOString(),
        source: 'llm-compiler'
      });

      writeFileSync(filepath, fullContent);

      if (type === 'concept') saved.concepts++;
      else saved.articles++;

      saved.pages.push({
        action,
        type,
        title,
        path: filepath
      });

      logger.info(`[llm-compiler] Saved: ${type}/${slugify(filename)} (${action})`);
    } catch (error) {
      saved.errors.push(error.message);
      logger.error('[llm-compiler] Failed to save block:', error.message);
    }
  }

  logger.info(`[llm-compiler] Saved ${saved.concepts} concepts, ${saved.articles} articles`);
  return saved;
}

function writeLastCompile(result) {
  writeFileSync(LAST_COMPILE_FILE, JSON.stringify(result, null, 2));
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
  logger.info('[llm-compiler] Updated index with backlinks');
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
  await buildIndex();

  const sources = getAllContent();
  if (sources.length > 0) {
    await compileWithLLM(sources, { force: false });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  await compileWithLLM([], { force });
}
