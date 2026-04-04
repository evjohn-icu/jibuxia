import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

const CONTENT_DIR = join(ROOT, CONFIG.paths.content);
const WIKI_DIR = join(ROOT, CONFIG.paths.wiki);

async function compile() {
  console.log('[compile] Starting compilation...');
  
  const { buildIndex, compileConcept, compileArticle } = await import('../lib/compiler.js');
  
  const index = buildIndex();
  console.log(`[compile] Index built: ${index.totalSources} sources`);
  
  const { indexAll } = await import('../lib/indexer.js');
  indexAll(true);
  
  console.log('[compile] Compilation complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await compile();
}