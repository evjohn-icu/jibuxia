import { watch } from 'chokidar';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

const LINKS_DIR = join(ROOT, CONFIG.paths.links);
const CONTENT_DIR = join(ROOT, CONFIG.paths.content);
const WIKI_DIR = join(ROOT, CONFIG.paths.wiki);
const DATA_DIR = join(ROOT, 'data');
const RAW_DIR = join(ROOT, CONFIG.paths.raw);
const CONCEPTS_DIR = join(ROOT, CONFIG.paths.concepts);
const ARTICLES_DIR = join(ROOT, CONFIG.paths.articles);
const ASSETS_DIR = join(ROOT, CONFIG.paths.assets);
const REPLY_QUEUE_DIR = join(ROOT, 'data', 'reply-queue');

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(LINKS_DIR, { recursive: true });
mkdirSync(CONTENT_DIR, { recursive: true });
mkdirSync(WIKI_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CONCEPTS_DIR, { recursive: true });
mkdirSync(ARTICLES_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });
mkdirSync(REPLY_QUEUE_DIR, { recursive: true });

let compileDebounce = null;
let fetchQueue = [];
let compileQueue = [];
let isCompileRunning = false;
let isShuttingDown = false;
let acpChild = null;
let pendingReplies = new Map();

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function extractReplyTo(filepath) {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const match = content.match(/^replyTo:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function runProcess(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], {
      cwd: ROOT,
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());
    
    child.on('close', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`Script exited with code ${code}`));
    });
  });
}

async function fetchUrl(filepath) {
  log(`[fetch] Processing: ${basename(filepath)}`);
  try {
    await runProcess('lib/fetcher.js', [filepath]);
    log(`[fetch] Done: ${basename(filepath)}`);
  } catch (e) {
    log(`[fetch] Error: ${e.message}`);
  }
}

async function saveCompileResult(result) {
  try {
    const resultFile = join(DATA_DIR, 'last-compile.json');
    writeFileSync(resultFile, JSON.stringify({
      ...result,
      timestamp: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    log(`[compile] Warning: Could not save compile result: ${e.message}`);
  }
}

async function compile(options = {}) {
  const { maxRetries = 3, baseDelayMs = 5000 } = options;
  const replyToSet = new Set(pendingReplies.values());
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`[compile] Running LLM compilation (attempt ${attempt}/${maxRetries})...`);
    try {
      await runProcess('lib/llm-compiler.js');
      await updateIndex();
      await indexContent();
      log('[compile] Done');
      await saveCompileResult({ success: true });
      
      if (replyToSet.size > 0) {
        const concepts = readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md').length;
        const articles = readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md').length;
        const replyContent = `记不下知识库更新完成！\n\n新增 ${concepts} 个概念，${articles} 篇文章。\n\n查看: wiki/index.md`;
        for (const replyTo of replyToSet) {
          queueReply(replyTo, replyContent);
        }
        pendingReplies.clear();
      }
      
      return { success: true };
    } catch (e) {
      log(`[compile] Error: ${e.message}`);
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        log(`[compile] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  log(`[compile] Failed after ${maxRetries} attempts`);
  await saveCompileResult({ success: false, error: 'max_retries_exceeded' });
  return { success: false, error: 'max_retries_exceeded' };
}

async function updateIndex() {
  try {
    await runProcess('lib/compiler.js');
  } catch (e) {
  }
}

async function indexContent() {
  try {
    await runProcess('lib/indexer.js');
  } catch (e) {
  }
}

function debouncedCompile(delay = 30000) {
  if (compileDebounce) clearTimeout(compileDebounce);
  compileDebounce = setTimeout(() => {
    log('[trigger] Compiling after debounce');
    compile().then(() => updateIndex()).then(() => indexContent());
    compileDebounce = null;
  }, delay);
}

async function processFetchQueue() {
  if (fetchQueue.length === 0) return;
  
  const filepath = fetchQueue.shift();
  const replyTo = extractReplyTo(filepath);
  if (replyTo) {
    pendingReplies.set(filepath, replyTo);
    log(`[watch] Tracked replyTo for ${basename(filepath)}: ${replyTo}`);
  }
  await fetchUrl(filepath);
  enqueueCompile();
  
  if (fetchQueue.length > 0) {
    setTimeout(() => processFetchQueue(), 1000);
  }
}

async function processCompileQueue() {
  if (isCompileRunning) return;
  if (compileQueue.length === 0) return;
  
  isCompileRunning = true;
  const task = compileQueue.shift();
  
  await compile({ maxRetries: 3, baseDelayMs: 5000 });
  
  isCompileRunning = false;
  
  if (compileQueue.length > 0) {
    setTimeout(() => processCompileQueue(), 1000);
  }
}

function enqueueCompile() {
  compileQueue.push({ timestamp: Date.now(), replyToFiles: [...pendingReplies.keys()] });
  processCompileQueue();
}

function queueReply(replyTo, content) {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = join(REPLY_QUEUE_DIR, filename);
  writeFileSync(filepath, JSON.stringify({ replyTo, content }));
  log(`[reply] Queued reply to ${replyTo}`);
}

async function startAcpClient() {
  const { gateway, session } = CONFIG;
  const acpPath = join(ROOT, 'acp-client', 'index.js');
  
  if (!existsSync(acpPath)) {
    log('[acp] ACP client not found, skipping');
    return;
  }
  
  log(`[acp] Starting ACP client: ${gateway.url}/${session.key}`);
  
  acpChild = spawn('node', [acpPath], {
    cwd: join(ROOT, 'acp-client'),
    stdio: ['inherit', 'pipe', 'pipe']
  });
  
  acpChild.stdout.on('data', d => {
    const msg = d.toString().trim();
    if (msg.includes('[+]') || msg.includes('[i]')) {
      log(`[acp] ${msg}`);
    }
  });
  
  acpChild.stderr.on('data', d => log(`[acp] ${d.toString()}`));
  
  acpChild.on('close', code => {
    if (!isShuttingDown) {
      log(`[acp] ACP client exited with code ${code}, restarting in 5s`);
      setTimeout(startAcpClient, 5000);
    }
  });
}

async function startWatcher() {
  log('[watch] Starting file watchers...');
  log(`[watch] Links: ${LINKS_DIR}`);
  log(`[watch] Content: ${CONTENT_DIR}`);
  
  const linkWatcher = watch(LINKS_DIR, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });
  
  linkWatcher.on('add', filepath => {
    if (extname(filepath) === '.md') {
      log(`[watch] New link file: ${basename(filepath)}`);
      fetchQueue.push(filepath);
      processFetchQueue();
    }
  });
  
  log('[watch] Watching for changes...');
  
  setInterval(() => {
    const stats = {
      links: readdirSync(LINKS_DIR).filter(f => extname(f) === '.md').length,
      content: readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md').length,
      fetchQueue: fetchQueue.length,
      compileQueue: compileQueue.length,
      isCompiling: isCompileRunning
    };
    log(`[status] links=${stats.links} content=${stats.content} fetchQueue=${stats.fetchQueue} compileQueue=${stats.compileQueue} compiling=${stats.isCompiling}`);
  }, 60000);
}

async function main() {
  log('[main] 记不下 ADHD 外脑系统 启动中');
  log(`[main] Root: ${ROOT}`);
  
  await Promise.all([
    startWatcher(),
    startAcpClient()
  ]);
  
  log('[main] All watchers active. Press Ctrl+C to stop.');
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log(`[main] Received ${signal}, shutting down gracefully...`);
  
  if (compileDebounce) {
    clearTimeout(compileDebounce);
    compileDebounce = null;
  }
  
  log('[main] Waiting for current tasks to finish...');
  
  while (isCompileRunning || compileQueue.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (acpChild) {
    log('[main] Stopping ACP client...');
    acpChild.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  log('[main] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error('[main] Fatal error:', e);
    process.exit(1);
  });
}

export { main, startWatcher, startAcpClient };
