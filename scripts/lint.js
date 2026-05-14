import { generateReport } from '../lib/lint.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

async function lint() {
  console.log('[lint] Running health checks...\n');
  
  const { report, markdown } = generateReport();
  
  console.log(markdown);
  
  const reportDir = join(ROOT, CONFIG.paths.wiki, 'health-reports');
  mkdirSync(reportDir, { recursive: true });
  
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportDir, `${date}-report.md`);
  
  writeFileSync(reportPath, markdown);
  console.log(`\n[lint] Report saved to: ${reportPath}`);
  
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await lint();
}
