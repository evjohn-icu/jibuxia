import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import axios from 'axios';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

const LINKS_DIR = join(__dirname, '..', CONFIG.paths.links);
const CONTENT_DIR = join(__dirname, '..', CONFIG.paths.content);

mkdirSync(CONTENT_DIR, { recursive: true });

export function urlExistsInContent(url) {
  if (!existsSync(CONTENT_DIR)) return false;
  
  const files = readdirSync(CONTENT_DIR).filter(f => extname(f) === '.md');
  
  for (const file of files) {
    try {
      const filepath = join(CONTENT_DIR, file);
      const content = readFileSync(filepath, 'utf-8');
      const parsed = matter(content);
      if (parsed.data?.url === url) {
        return true;
      }
    } catch (e) {
      // Ignore errors, skip file
    }
  }
  return false;
}

function extractUrlFromLinkFile(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const parsed = matter(content);
  return parsed.data?.url || null;
}

async function fetchUrlContent(url, options = {}) {
  const { maxRetries = 3, baseDelayMs = 3000 } = options;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[fetcher] Fetching: ${url} (attempt ${attempt}/${maxRetries})`);
      
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBaseBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const html = response.data;
      const $ = cheerio.load(html);

      $('script, style, nav, header, footer, aside, .ads, .advertisement, .social-share, .comments, #comments, .sidebar, .navigation, .menu, .nav').remove();

      const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled';
      const text = $('article, .content, .post, .entry, main, [role="main"]').first().html() || $('body').html();
      
      $('script, style, iframe, noscript').remove();
      let cleanText = $(text).text().trim();
      
      cleanText = cleanText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');
      
      const timestamp = new Date().toISOString();
      
      return {
        url,
        title,
        content: cleanText,
        timestamp,
        fetchedAt: timestamp
      };
    } catch (error) {
      console.error(`[fetcher] Error fetching ${url} (attempt ${attempt}/${maxRetries}):`, error.message);
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[fetcher] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`[fetcher] Failed to fetch ${url} after ${maxRetries} attempts`);
  return null;
}

function generateContentFilename(url, timestamp) {
  const hash = url.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(36);
  const date = timestamp.slice(0, 10);
  return `${date}-${hash}.md`;
}

async function saveContent(data) {
  const filename = generateContentFilename(data.url, data.timestamp);
  const filepath = join(CONTENT_DIR, filename);
  
  const frontmatter = matter.stringify(data.content, {
    source: 'fetcher',
    url: data.url,
    title: data.title,
    fetchedAt: data.fetchedAt,
    importedAt: data.timestamp
  });
  
  writeFileSync(filepath, frontmatter);
  console.log(`[fetcher] Saved: ${filename}`);
  return filepath;
}

export async function processLinkFile(filepath, options = {}) {
  const url = extractUrlFromLinkFile(filepath);
  if (!url) {
    console.warn(`[fetcher] No URL found in ${filepath}`);
    return { skipped: true, reason: 'no_url' };
  }
  
  if (urlExistsInContent(url)) {
    console.log(`[fetcher] URL already exists, skipping: ${url}`);
    return { skipped: true, reason: 'duplicate', url };
  }
  
  const content = await fetchUrlContent(url, options);
  if (!content) return { skipped: true, reason: 'fetch_failed' };
  
  return saveContent(content);
}

export async function processAllLinks(options = {}) {
  const files = readdirSync(LINKS_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => join(LINKS_DIR, f));

  console.log(`[fetcher] Found ${files.length} link files to process`);
  
  const results = { processed: [], skipped: [] };
  for (const file of files) {
    const result = await processLinkFile(file, options);
    if (result?.skipped) {
      results.skipped.push(result);
    } else if (result) {
      results.processed.push(result);
    }
  }
  
  return results;
}

export async function fetchUrl(url, options = {}) {
  const content = await fetchUrlContent(url, options);
  if (!content) return null;
  return saveContent(content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const options = { maxRetries: 3, baseDelayMs: 3000 };
  
  for (const arg of args) {
    if (arg.startsWith('--retries=')) {
      options.maxRetries = parseInt(arg.split('=')[1], 10) || 3;
    }
  }
  
  const input = args.find(a => !a.startsWith('--'));
  if (input) {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      await fetchUrl(input, options);
    } else {
      await processLinkFile(input, options);
    }
  } else {
    await processAllLinks(options);
  }
}
