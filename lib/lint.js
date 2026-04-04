import { readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);
const WIKI_DIR = join(__dirname, '..', CONFIG.paths.wiki);
const CONCEPTS_DIR = join(__dirname, '..', CONFIG.paths.concepts);
const ARTICLES_DIR = join(__dirname, '..', CONFIG.paths.articles);

export function checkConsistency() {
  const issues = [];
  
  const files = readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md');
  const seen = new Map();
  
  for (const file of files) {
    const filepath = join(CONTENT_DIR, file);
    const content = readFileSync(filepath, 'utf-8');
    const parsed = matter(content);
    
    const url = parsed.data?.url;
    if (url) {
      if (seen.has(url)) {
        issues.push({
          type: 'duplicate_url',
          file,
          duplicate: seen.get(url),
          url
        });
      }
      seen.set(url, file);
    }
    
    if (!parsed.data?.title) {
      issues.push({
        type: 'missing_title',
        file
      });
    }
  }
  
  const wikiFiles = [
    ...readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md').map(f => join(CONCEPTS_DIR, f)),
    ...readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md').map(f => join(ARTICLES_DIR, f))
  ];
  
  for (const file of wikiFiles) {
    const content = readFileSync(file, 'utf-8');
    const parsed = matter(content);
    
    if (!parsed.data?.title && !parsed.data?.name) {
      issues.push({
        type: 'wiki_missing_title',
        file: basename(file)
      });
    }
    
    const wordCount = parsed.content.split(/\s+/).length;
    if (wordCount < 20) {
      issues.push({
        type: 'empty_or_very_short',
        file: basename(file),
        wordCount
      });
    }
  }
  
  return issues;
}

export function checkBrokenLinks() {
  const issues = [];
  
  const wikiFiles = [
    ...readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md').map(f => join(CONCEPTS_DIR, f)),
    ...readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md').map(f => join(ARTICLES_DIR, f))
  ];
  
  const knownFiles = new Set([
    ...readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md'),
    ...readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md'),
    ...readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md')
  ]);
  
  for (const file of wikiFiles) {
    const content = readFileSync(file, 'utf-8');
    const wikiLinks = content.match(/\[\[([^\]]+)\]\]/g) || [];
    
    for (const link of wikiLinks) {
      const target = link.replace(/\[\[|\]\]/g, '');
      const pathParts = target.split('/');
      const filename = pathParts[pathParts.length - 1] + '.md';
      
      if (!knownFiles.has(filename)) {
        issues.push({
          type: 'broken_wiki_link',
          source: basename(file),
          target
        });
      }
    }
  }
  
  return issues;
}

export function suggestNewArticles() {
  const suggestions = [];
  
  const files = readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md');
  const termFreq = {};
  
  for (const file of files) {
    const filepath = join(CONTENT_DIR, file);
    const content = readFileSync(filepath, 'utf-8');
    const parsed = matter(content);
    const text = (parsed.content || '').toLowerCase();
    
    const words = text.split(/\s+/)
      .filter(w => w.length > 6)
      .filter(w => !/^[0-9]+$/.test(w));
    
    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (clean.length > 6) {
        termFreq[clean] = (termFreq[clean] || 0) + 1;
      }
    }
  }
  
  const topTerms = Object.entries(termFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .filter(([term]) => {
      const existingConcepts = readdirSync(CONCEPTS_DIR).filter(f => f.includes(term.slice(0, 10)));
      return existingConcepts.length === 0;
    });
  
  for (const [term, freq] of topTerms.slice(0, 5)) {
    suggestions.push({
      type: 'potential_topic',
      term,
      frequency: freq,
      reason: `Frequently mentioned (${freq} occurrences) but not yet a concept`
    });
  }
  
  return suggestions;
}

export function generateReport() {
  const consistency = checkConsistency();
  const brokenLinks = checkBrokenLinks();
  const suggestions = suggestNewArticles();
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      consistency_issues: consistency.length,
      broken_links: brokenLinks.length,
      suggestions: suggestions.length
    },
    issues: [...consistency, ...brokenLinks],
    suggestions
  };
  
  let markdown = `# 记不下 体检报告\n\n`;
  markdown += `Generated: ${report.timestamp}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- Consistency Issues: ${report.summary.consistency_issues}\n`;
  markdown += `- Broken Links: ${report.summary.broken_links}\n`;
  markdown += `- Suggestions: ${report.summary.suggestions}\n\n`;
  
  if (report.issues.length > 0) {
    markdown += `## Issues\n\n`;
    for (const issue of report.issues.slice(0, 20)) {
      markdown += `### ${issue.type}\n`;
      markdown += `- ${JSON.stringify(issue)}\n\n`;
    }
  }
  
  if (report.suggestions.length > 0) {
    markdown += `## Suggestions\n\n`;
    for (const s of report.suggestions) {
      markdown += `- **${s.term}**: ${s.reason}\n`;
    }
    markdown += `\n`;
  }
  
  return { report, markdown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report, markdown } = generateReport();
  console.log(markdown);
  
  const reportDir = join(WIKI_DIR, 'health-reports');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${Date.now()}.md`);
  writeFileSync(reportPath, markdown);
  console.log(`[lint] Report saved to ${reportPath}`);
}