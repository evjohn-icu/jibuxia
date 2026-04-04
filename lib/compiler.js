import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'fs';
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

mkdirSync(CONCEPTS_DIR, { recursive: true });
mkdirSync(ARTICLES_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });

function parseContentFile(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const parsed = matter(content);
  return {
    ...parsed,
    filepath,
    filename: basename(filepath)
  };
}

function getAllContentFiles() {
  const files = readdirSync(CONTENT_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => join(CONTENT_DIR, f))
    .filter(f => statSync(f).isFile());
  return files.map(parseContentFile);
}

function extractKeyTerms(content) {
  const text = content.toLowerCase();
  const words = text.split(/\s+/);
  const freq = {};
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'or', 'if', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'any', 'its', 'who', 'whom']);
  
  words.forEach(w => {
    const cleaned = w.replace(/[^a-z0-9]/g, '');
    if (cleaned.length > 4 && !stopWords.has(cleaned)) {
      freq[cleaned] = (freq[cleaned] || 0) + 1;
    }
  });
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term]) => term);
}

function generateSummary(content, maxLength = 500) {
  const text = content.replace(/[#*`\[\]]/g, '').trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '...';
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function buildIndex() {
  const files = getAllContentFiles();
  
  const index = {
    updatedAt: new Date().toISOString(),
    totalSources: files.length,
    sources: files.map(f => ({
      filename: f.filename,
      url: f.data?.url,
      title: f.data?.title || f.filename,
      fetchedAt: f.data?.fetchedAt,
      importedAt: f.data?.importedAt,
      terms: extractKeyTerms(f.content)
    })),
    concepts: readdirSync(CONCEPTS_DIR)
      .filter(f => extname(f) === '.md')
      .map(f => ({
        name: basename(f, '.md'),
        file: f
      })),
    articles: readdirSync(ARTICLES_DIR)
      .filter(f => extname(f) === '.md')
      .map(f => ({
        name: basename(f, '.md'),
        file: f
      }))
  };
  
  const indexPath = join(WIKI_DIR, 'index.md');
  const indexContent = matter.stringify(`# 记不下

> Last compiled: ${index.updatedAt}

## Statistics

- **Sources**: ${index.totalSources}
- **Concepts**: ${index.concepts.length}
- **Articles**: ${index.articles.length}

## Sources

${index.sources.map(s => `- [[${s.title}]]${s.url ? ` — ${s.url}` : ''}`).join('\n')}

## Concepts

${index.concepts.length > 0 
  ? index.concepts.map(c => `- [[concepts/${c.name}]]`).join('\n')
  : '_No concepts yet_'
}

## Articles

${index.articles.length > 0
  ? index.articles.map(a => `- [[articles/${a.name}]]`).join('\n')
  : '_No articles yet_'
}
`, { updatedAt: index.updatedAt });
  
  writeFileSync(indexPath, indexContent);
  console.log(`[compiler] Updated index with ${files.length} sources`);
  return index;
}

export function compileConcept(name, content, relatedSources = []) {
  const slug = slugify(name);
  const filepath = join(CONCEPTS_DIR, `${slug}.md`);
  
  const compiled = matter.stringify(content, {
    type: 'concept',
    name,
    createdAt: new Date().toISOString(),
    relatedSources: relatedSources.map(s => s.filename || s.url)
  });
  
  writeFileSync(filepath, compiled);
  console.log(`[compiler] Compiled concept: ${name}`);
  return filepath;
}

export function compileArticle(title, content, metadata = {}) {
  const slug = slugify(title);
  const filepath = join(ARTICLES_DIR, `${slug}.md`);
  
  const compiled = matter.stringify(content, {
    type: 'article',
    title,
    createdAt: new Date().toISOString(),
    ...metadata
  });
  
  writeFileSync(filepath, compiled);
  console.log(`[compiler] Compiled article: ${title}`);
  return filepath;
}

export function findOrCreateConcept(term) {
  const slug = slugify(term);
  const filepath = join(CONCEPTS_DIR, `${slug}.md`);
  
  if (statSafe(filepath)) {
    return filepath;
  }
  
  return compileConcept(term, `# ${term}\n\n> Concept imported from knowledge base\n`);
}

function statSafe(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function autoCompile() {
  const index = buildIndex();
  console.log(`[compiler] Auto-compile complete: ${index.totalSources} sources indexed`);
  return index;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  autoCompile();
}