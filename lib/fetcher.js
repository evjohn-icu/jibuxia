import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import matter from 'gray-matter';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { paths } from './config.js';
import { logger } from './logger.js';

const LINKS_DIR = paths.links;
const CONTENT_DIR = paths.content;

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const RATE_LIMIT_DELAY = 2000;
const MAX_CONCURRENT = 3;

const BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '10.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
];

let activeFetches = 0;
const domainLastFetched = {};

mkdirSync(CONTENT_DIR, { recursive: true });

function isBlockedDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname === blocked || hostname.startsWith(blocked)) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

async function rateLimitDelay(url) {
  try {
    const hostname = new URL(url).hostname;
    const now = Date.now();
    const lastFetch = domainLastFetched[hostname] || 0;
    const elapsed = now - lastFetch;
    if (elapsed < RATE_LIMIT_DELAY) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - elapsed));
    }
    domainLastFetched[hostname] = Date.now();
  } catch {}
}

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
  
  if (isBlockedDomain(url)) {
    logger.error(`[fetcher] Blocked domain: ${url}`);
    return null;
  }
  
  while (activeFetches >= MAX_CONCURRENT) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  activeFetches++;
  
  try {
    await rateLimitDelay(url);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[fetcher] Fetching: ${url} (attempt ${attempt}/${maxRetries})`);
        
        const response = await axios.get(url, {
          timeout: 15000,
          maxContentLength: MAX_RESPONSE_SIZE,
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
        logger.error(`[fetcher] Error fetching ${url} (attempt ${attempt}/${maxRetries}):`, error.message);
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          logger.info(`[fetcher] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    logger.error(`[fetcher] Failed to fetch ${url} after ${maxRetries} attempts`);
    return null;
  } finally {
    activeFetches--;
  }
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
  logger.info(`[fetcher] Saved: ${filename}`);
  return filepath;
}

export async function processLinkFile(filepath, options = {}) {
  const url = extractUrlFromLinkFile(filepath);
  if (!url) {
    logger.warn(`[fetcher] No URL found in ${filepath}`);
    return { skipped: true, reason: 'no_url' };
  }
  
  if (urlExistsInContent(url)) {
    logger.info(`[fetcher] URL already exists, skipping: ${url}`);
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

  logger.info(`[fetcher] Found ${files.length} link files to process`);
  
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
