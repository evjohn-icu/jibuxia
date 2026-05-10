import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JIBUXIA_ROOT = join(__dirname, '..', '..');
const PORT = process.env.JIBUXIA_WEBHOOK_PORT || 3456;

function runIngest(url, force = false) {
  return new Promise((resolve, reject) => {
    const args = [join(JIBUXIA_ROOT, 'scripts', 'ingest.js'), url, '--json'];
    if (force) args.push('--force');
    
    const child = spawn('node', args, {
      cwd: JIBUXIA_ROOT
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    
    child.on('close', code => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ status: 'ok', raw: stdout.trim() });
        }
      } else {
        reject(new Error(stderr || `Exit code ${code}`));
      }
    });
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const path = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (path !== '/ingest') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await parseBody(req);
    
    if (!body.url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url field' }));
      return;
    }

    const url = body.url;
    const force = body.force === true;

    console.error(`[webhook] Ingesting: ${url} (force=${force})`);

    const result = await runIngest(url, force);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    
    console.error(`[webhook] Done: ${url} -> ${result.status}`);
    
  } catch (error) {
    console.error(`[webhook] Error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function main() {
  const server = http.createServer(handleRequest);
  
  server.listen(PORT, () => {
    console.error(`[jibuxia-webhook] Server started on port ${PORT}`);
    console.error(`[jibuxia-webhook] POST http://localhost:${PORT}/ingest`);
  });

  server.on('error', (err) => {
    console.error(`[jibuxia-webhook] Server error: ${err.message}`);
    process.exit(1);
  });
}

main().catch(console.error);
