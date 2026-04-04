import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

const LINKS_DIR = join(ROOT, CONFIG.paths.links);
const CONTENT_DIR = join(ROOT, CONFIG.paths.content);
const CONCEPTS_DIR = join(ROOT, CONFIG.paths.concepts);
const ARTICLES_DIR = join(ROOT, CONFIG.paths.articles);
const DATA_DIR = join(ROOT, 'data');

function getContentUrls() {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter(f => extname(f) === '.md')
    .map(f => {
      const filepath = join(CONTENT_DIR, f);
      const content = readFileSync(filepath, 'utf-8');
      const parsed = matter(content);
      return {
        filename: f,
        url: parsed.data?.url,
        title: parsed.data?.title || f,
        fetchedAt: parsed.data?.fetchedAt
      };
    })
    .sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
}

function getWikiCounts() {
  let concepts = 0;
  let articles = 0;
  
  if (existsSync(CONCEPTS_DIR)) {
    concepts = readdirSync(CONCEPTS_DIR).filter(f => extname(f) === '.md').length;
  }
  if (existsSync(ARTICLES_DIR)) {
    articles = readdirSync(ARTICLES_DIR).filter(f => extname(f) === '.md').length;
  }
  
  return { concepts, articles };
}

function getQueueInfo() {
  let pendingLinks = 0;
  if (existsSync(LINKS_DIR)) {
    pendingLinks = readdirSync(LINKS_DIR).filter(f => extname(f) === '.md').length;
  }
  return pendingLinks;
}

function formatDate(isoString) {
  if (!isoString) return 'unknown';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

async function getLastCompileResult() {
  const resultFile = join(DATA_DIR, 'last-compile.json');
  if (existsSync(resultFile)) {
    try {
      const data = JSON.parse(readFileSync(resultFile, 'utf-8'));
      return data;
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function main() {
  console.log('\n========================================');
  console.log('           记不下 - 状态面板');
  console.log('========================================\n');
  
  const contentUrls = getContentUrls();
  const { concepts, articles } = getWikiCounts();
  const pendingLinks = getQueueInfo();
  
  console.log('📊 统计');
  console.log('----------------------------------------');
  console.log(`   待处理链接: ${pendingLinks} 个`);
  console.log(`   已抓取内容: ${contentUrls.length} 个`);
  console.log(`   概念页面:   ${concepts} 个`);
  console.log(`   文章页面:   ${articles} 个`);
  console.log('');
  
  if (contentUrls.length > 0) {
    console.log('📥 最近抓取的内容 (前5个)');
    console.log('----------------------------------------');
    contentUrls.slice(0, 5).forEach(item => {
      const title = item.title.length > 50 ? item.title.slice(0, 50) + '...' : item.title;
      console.log(`   [${formatDate(item.fetchedAt)}] ${title}`);
    });
    console.log('');
  }
  
  const lastCompile = await getLastCompileResult();
  console.log('🔄 编译状态');
  console.log('----------------------------------------');
  if (lastCompile) {
    console.log(`   上次编译: ${formatDate(lastCompile.timestamp)}`);
    console.log(`   结果: ${lastCompile.success ? '✅ 成功' : '❌ 失败'}`);
    if (lastCompile.error) {
      console.log(`   错误: ${lastCompile.error}`);
    }
  } else {
    console.log('   暂无编译记录');
  }
  console.log('');
  
  console.log('========================================\n');
}

main().catch(console.error);
