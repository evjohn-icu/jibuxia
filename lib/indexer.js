import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const DATA_DIR = join(__dirname, '..', 'data');
const INDEX_PATH = join(DATA_DIR, 'chunks.json');
const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);

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

function saveIndex(index) {
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
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

export function indexFile(filepath, force = false) {
  const index = loadIndex();
  
  const content = readFileSync(filepath, 'utf-8');
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
    console.log(`[indexer] Skipping ${basename(filepath)} (already indexed)`);
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
  
  saveIndex(index);
  console.log(`[indexer] Indexed ${basename(filepath)}: ${inserted} chunks`);
  return inserted;
}

export function indexAll(force = false) {
  if (!existsSync(CONTENT_DIR)) {
    console.log('[indexer] Content directory does not exist yet');
    return 0;
  }
  
  const files = readdirSync(CONTENT_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => join(CONTENT_DIR, f));
  
  console.log(`[indexer] Found ${files.length} files to index`);
  
  let total = 0;
  for (const file of files) {
    total += indexFile(file, force);
  }
  
  console.log(`[indexer] Total chunks indexed: ${total}`);
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
  if (cmd === 'reindex') {
    indexAll(true);
  } else {
    indexAll();
  }
  console.log('[indexer] Stats:', getStats());
}