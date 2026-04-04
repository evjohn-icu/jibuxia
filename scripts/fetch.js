import { processAllLinks } from '../lib/fetcher.js';

async function main() {
  console.log('[fetch] Processing all pending links...\n');
  
  try {
    const results = await processAllLinks();
    console.log(`\n[fetch] Processed ${results.length} links`);
  } catch (e) {
    console.error('[fetch] Error:', e.message);
    process.exit(1);
  }
}

main();