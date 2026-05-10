import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import crypto from 'crypto';
import { paths } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = join(paths.wiki, '..', 'data');
const INGESTED_FILE = join(DATA_DIR, 'ingested.json');

mkdirSync(DATA_DIR, { recursive: true });

function computeUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function loadIngested() {
  try {
    if (existsSync(INGESTED_FILE)) {
      return JSON.parse(readFileSync(INGESTED_FILE, 'utf-8'));
    }
  } catch (e) {
  }
  return {};
}

function saveIngested(ingested) {
  writeFileSync(INGESTED_FILE, JSON.stringify(ingested, null, 2));
}

function isIngested(url, force = false) {
  const ingested = loadIngested();
  const hash = computeUrlHash(url);
  return !force && ingested[hash] !== undefined;
}

function markIngested(url, data) {
  const ingested = loadIngested();
  const hash = computeUrlHash(url);
  ingested[hash] = {
    url,
    ingestedAt: new Date().toISOString(),
    ...data
  };
  saveIngested(ingested);
}

async function fetchSingleUrl(url) {
  const { fetchUrl } = await import('../lib/fetcher.js');
  return fetchUrl(url);
}

async function compileIncremental() {
  const { compileWithLLM } = await import('../lib/llm-compiler.js');
  return compileWithLLM([], { force: false });
}

async function indexNewContent() {
  const { indexAll } = await import('../lib/indexer.js');
  return indexAll(false);
}

async function ingestUrl(url, options = {}) {
  const { force = false, fetchOnly = false } = options;
  
  const result = {
    url,
    status: 'ok',
    skipped: false,
    skippedReason: null,
    contentPath: null,
    wikiPages: [],
    indexedChunks: 0,
    compileStatus: fetchOnly ? 'skipped' : 'pending',
    compileStrategy: 'incremental-trigger-full-context',
    title: null
  };
  
  if (isIngested(url, force)) {
    result.skipped = true;
    result.skippedReason = 'duplicate';
    result.status = 'skipped';
    result.compileStatus = 'skipped';
    logger.info(`[ingest] Already ingested: ${url}`);
    return result;
  }
  
  try {
    const contentPath = await fetchSingleUrl(url);
    
    if (!contentPath) {
      result.status = 'error';
      result.error = 'fetch_failed';
      result.compileStatus = 'skipped';
      return result;
    }
    
    result.contentPath = contentPath;
    logger.info(`[ingest] Fetched: ${url} -> ${contentPath}`);
    
    if (fetchOnly) {
      markIngested(url, { contentPath });
      result.compileStatus = 'skipped';
      logger.info('[ingest] Fetch only mode, skipping compilation');
      return result;
    }
    
    const compileResult = await compileIncremental();
    result.compileStatus = compileResult.success ? 'ok' : 'warning';
    result.wikiPages = compileResult.pages || [];
    
    if (!compileResult.success) {
      result.status = 'warning';
      result.compileError = compileResult.error;
      logger.warn(`[ingest] Compilation had issues: ${compileResult.error}`);
    }
    
    result.indexedChunks = await indexNewContent();
    
    markIngested(url, {
      contentPath,
      wikiPages: result.wikiPages,
      indexedChunks: result.indexedChunks,
      compileStatus: result.compileStatus
    });
    
    result.title = basename(contentPath, '.md');
    
    return result;
    
  } catch (error) {
    result.status = 'error';
    result.error = error.message;
    result.compileStatus = result.compileStatus === 'pending' ? 'error' : result.compileStatus;
    return result;
  }
}

async function ingestStdin() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  const urls = input.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('http://') || line.startsWith('https://'));
  
  logger.info(`[ingest] Processing ${urls.length} URLs from stdin`);
  
  const results = [];
  for (const url of urls) {
    const result = await ingestUrl(url, { force: false });
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return results;
}

function showHelp() {
  console.log(`
Usage:
  node ingest.js <url>              Ingest a single URL
  node ingest.js <url> --json       Output JSON format
  node ingest.js <url> --fetch-only Only fetch, don't compile
  node ingest.js <url> --force      Re-ingest even if already done
  echo "url" | node ingest.js --stdin  Batch ingest from stdin
  
Examples:
  node ingest.js https://example.com/article
  node ingest.js https://example.com/article --json
  node ingest.js https://example.com/article --fetch-only --force
  echo "https://a.com\\nhttps://b.com" | node ingest.js --stdin
`);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  if (jsonOutput) {
    logger.level = 'silent';
  }
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  if (args.includes('--stdin')) {
    const results = await ingestStdin();
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  
  const options = {
    force: args.includes('--force'),
    fetchOnly: args.includes('--fetch-only'),
    json: jsonOutput
  };
  
  const url = args.find(arg => arg.startsWith('http://') || arg.startsWith('https://'));
  
  if (!url) {
    console.error('[ingest] No URL provided. Use --help for usage.');
    process.exit(1);
  }
  
  const result = await ingestUrl(url, options);

  if (options.json) {
    console.log(JSON.stringify(result));
  } else if (result.status === 'skipped') {
    console.log(`[ingest] Skipped (${result.skippedReason}): ${url}`);
  } else if (result.status === 'error') {
    console.error(`[ingest] Error: ${result.error}`);
  } else {
    console.log(`[ingest] Done: ${url}`);
    console.log(`[ingest] Content: ${result.contentPath}`);
    if (result.compileStatus !== 'skipped') {
      console.log(`[ingest] Compile: ${result.compileStatus}, pages: ${result.wikiPages.length}, indexed chunks: ${result.indexedChunks}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('[ingest] Fatal error:', error.message);
    process.exit(1);
  });
}

export { ingestUrl, isIngested, markIngested };
