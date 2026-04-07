import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf-8'));

export const paths = {
  raw: join(__dirname, '..', config.paths.raw),
  links: join(__dirname, '..', config.paths.links),
  content: join(__dirname, '..', config.paths.content),
  wiki: join(__dirname, '..', config.paths.wiki),
  concepts: join(__dirname, '..', config.paths.concepts),
  articles: join(__dirname, '..', config.paths.articles),
  assets: join(__dirname, '..', config.paths.assets),
};
