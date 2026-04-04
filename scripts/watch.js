import { watch } from 'chokidar';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

const LINKS_DIR = join(ROOT, CONFIG.paths.links);
const CONTENT_DIR = join(ROOT, CONFIG.paths.content);
const WIKI_DIR = join(ROOT, CONFIG.paths.wiki);

let compilePending = false;
let compileTimeout = null;
let pendingLinks = [];

function debouncedCompile() {
  if (compileTimeout) {
    clearTimeout(compileTimeout);
  }
  
  compileTimeout = setTimeout(async () => {
    console.log('[watch] Triggering compile after debounce...');
    compilePending = true;
    
    try {
      await runCompile();
      await runIndex();
    } catch (e) {
      console.error('[watch] Compile error:', e.message);
    }
    
    compilePending = false;
    compileTimeout = null;
  }, CONFIG.compile?.debounceMs || 30000);
}

async function runCompile() {
  console.log('[watch] Running compiler...');
  try {
    execSync(`cd ${ROOT} && node lib/compiler.js`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[watch] Compiler error:', e.message);
  }
}

async function runIndex() {
  console.log('[watch] Running indexer...');
  try {
    execSync(`cd ${ROOT} && node lib/indexer.js`, { stdio: 'inherit' });
  } catch (e) {
    console.error('[watch] Indexer error:', e.message);
  }
}

async function runFetch(filepath) {
  console.log('[watch] Fetching new link:', filepath);
  try {
    execSync(`cd ${ROOT} && node lib/fetcher.js "${filepath}"`, { stdio: 'inherit' });
    pendingLinks.push(filepath);
    debouncedCompile();
  } catch (e) {
    console.error('[watch] Fetch error:', e.message);
  }
}

function checkForNewLinks() {
  try {
    const files = readdirSync(LINKS_DIR)
      .filter(f => extname(f) === '.md')
      .map(f => join(LINKS_DIR, f));
    
    for (const file of files) {
      const stat = statSync(file);
      const age = Date.now() - stat.mtimeMs;
      
      if (age < 60000 && !pendingLinks.includes(file)) {
        runFetch(file);
      }
    }
  } catch (e) {
  }
}

function startWatcher() {
  console.log('[watch] Starting file watcher...');
  console.log(`[watch] Monitoring: ${LINKS_DIR}`);
  
  mkdirSync(LINKS_DIR, { recursive: true });
  mkdirSync(CONTENT_DIR, { recursive: true });
  mkdirSync(WIKI_DIR, { recursive: true });
  
  const watcher = watch(LINKS_DIR, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });
  
  watcher.on('add', (filepath) => {
    if (extname(filepath) === '.md') {
      console.log('[watch] New link file detected:', basename(filepath));
      runFetch(filepath);
    }
  });
  
  watcher.on('change', (filepath) => {
    if (extname(filepath) === '.md') {
      console.log('[watch] Link file changed:', basename(filepath));
    }
  });
  
  watcher.on('error', (error) => {
    console.error('[watch] Watcher error:', error);
  });
  
  setInterval(checkForNewLinks, 30000);
  
  console.log('[watch] File watcher active. Waiting for changes...');
  console.log('[watch] Press Ctrl+C to stop.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWatcher();
}

export { startWatcher, debouncedCompile };