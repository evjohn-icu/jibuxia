import { ask, formatResults } from '../lib/search.js';

async function main() {
  const args = process.argv.slice(2);
  const saveFlag = args.includes('--save');
  const query = args.filter(a => !a.startsWith('--')).join(' ');
  
  if (!query) {
    console.log('Usage: npm run ask -- "your question here" [--save]');
    console.log('   or: node scripts/ask.js "your question here" [--save]');
    console.log('');
    console.log('Options:');
    console.log('  --save    Save the answer to wiki/articles/');
    process.exit(1);
  }
  
  console.log(`[ask] Query: "${query}"${saveFlag ? ' (will save to wiki)' : ''}\n`);
  
  try {
    const results = await ask(query, { saveToWiki: saveFlag });
    console.log(formatResults(results));
  } catch (e) {
    console.error('[ask] Error:', e.message);
    process.exit(1);
  }
}

main();