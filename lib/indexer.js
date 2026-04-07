import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, readFile, writeFile } from 'fs';
import { join, basename, extname } from 'path';
import { paths } from './config.js';
import { logger } from './logger.js';

const DATA_DIR = join(paths.wiki, '..', 'data');
const INDEX_PATH = join(DATA_DIR, 'chunks.json');
const CONTENT_DIR = paths.content;

mkdirSync(DATA_DIR, { recursive: true });

function loadIndex() {
  try {
    if (existsSync(INDEX_PATH)) {
      return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    }
  } catch (e) {
  }
  return { chunks: [], files: {} };
}

async function loadIndexAsync() {
  try {
    if (existsSync(INDEX_PATH)) {
      const data = await readFile(INDEX_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
  }
  return { chunks: [], files: {} };
}

function saveIndex(index) {
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

async function saveIndexAsync(index) {
  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
}

function computeHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function chunkText(text, maxChars = 800, overlap = 100) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + maxChars;
    
    if (end < text.length) {
      const periodIndex = text.lastIndexOf('.', end);
      const newlineIndex = text.lastIndexOf('\n', end);
      const breakIndex = Math.max(periodIndex, newlineIndex);
      
      if (breakIndex > start + maxChars * 0.5) {
        end = breakIndex + 1;
      }
    }
    
    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        text: chunkText,
        start,
        end
      });
    }
    
    start = end - overlap;
    if (start <= chunks[chunks.length - 1]?.start) break;
  }
  
  return chunks;
}

export async function indexFile(filepath, force = false) {
  const index = await loadIndexAsync();
  
  const content = await readFile(filepath, 'utf-8');
  const matterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  let sourceUrl = '';
  let cleanContent = content;
  
  if (matterMatch) {
    const yaml = matterMatch[1];
    const urlMatch = yaml.match(/url:\s*(.+)/);
    if (urlMatch) sourceUrl = urlMatch[1].trim();
    cleanContent = matterMatch[2];
  }
  
  const fileHash = computeHash(filepath);
  
  if (!force && index.files[fileHash]) {
    logger.info(`[indexer] Skipping ${basename(filepath)} (already indexed)`);
    return 0;
  }
  
  index.chunks = index.chunks.filter(c => c.source !== filepath);
  
  const chunks = chunkText(cleanContent);
  let inserted = 0;
  
  for (const chunk of chunks) {
    const chunkHash = computeHash(chunk.text);
    
    if (!index.chunks.some(c => c.hash === chunkHash)) {
      index.chunks.push({
        text: chunk.text,
        hash: chunkHash,
        source: filepath,
        url: sourceUrl,
        createdAt: new Date().toISOString()
      });
      inserted++;
    }
  }
  
  index.files[fileHash] = {
    filepath,
    url: sourceUrl,
    indexedAt: new Date().toISOString(),
    chunkCount: inserted
  };
  
  await saveIndexAsync(index);
  logger.info(`[indexer] Indexed ${basename(filepath)}: ${inserted} chunks`);
  return inserted;
}

export async function indexAll(force = false) {
  if (!existsSync(CONTENT_DIR)) {
    logger.info('[indexer] Content directory does not exist yet');
    return 0;
  }
  
  const files = readdirSync(CONTENT_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => join(CONTENT_DIR, f));
  
  logger.info(`[indexer] Found ${files.length} files to index`);
  
  let total = 0;
  for (const file of files) {
    total += await indexFile(file, force);
  }
  
  logger.info(`[indexer] Total chunks indexed: ${total}`);
  return total;
}

export function search(query, limit = 10) {
  const index = loadIndex();
  
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  
  if (terms.length === 0) {
    return [];
  }
  
  const scored = [];
  
  for (const chunk of index.chunks) {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    
    for (const term of terms) {
      if (lower.includes(term)) {
        score++;
        const regex = new RegExp(term, 'gi');
        const matches = lower.match(regex);
        if (matches) score += matches.length * 0.5;
      }
    }
    
    if (score > 0) {
      const snippetStart = chunk.text.toLowerCase().indexOf(terms[0]);
      let snippet = chunk.text;
      if (snippetStart > 50) {
        snippet = '...' + chunk.text.slice(snippetStart - 50);
      }
      if (snippet.length > 300) {
        snippet = snippet.slice(0, 300) + '...';
      }
      
      scored.push({
        text: snippet,
        source: chunk.source,
        url: chunk.url,
        score
      });
    }
  }
  
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function getStats() {
  const index = loadIndex();
  return {
    total_chunks: index.chunks.length,
    total_files: Object.keys(index.files).length,
    total_urls: new Set(index.chunks.map(c => c.url).filter(Boolean)).size
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  (async () => {
    if (cmd === 'reindex') {
      await indexAll(true);
    } else {
      await indexAll();
    }
    logger.info('[indexer] Stats:', getStats());
  })();
}