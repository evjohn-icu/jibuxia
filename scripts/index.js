import { indexAll, getStats } from '../lib/indexer.js';

async function main() {
  const force = process.argv.includes('--reindex');
  
  console.log('[index] Running indexer...\n');
  
  try {
    if (force) {
      console.log('[index] Reindexing all files (force mode)');
      indexAll(true);
    } else {
      indexAll();
    }
    
    const stats = getStats();
    console.log('\n[index] Stats:', stats);
  } catch (e) {
    console.error('[index] Error:', e.message);
    process.exit(1);
  }
}

main();