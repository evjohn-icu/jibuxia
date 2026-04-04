import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'config.json');
const ROOT_DIR = resolve(__dirname, '..');

const DEFAULT_CONFIG = {
  gateway: {
    url: 'ws://127.0.0.1:18789',
    token: ''
  },
  session: {
    key: 'agent:main:link-collector',
    label: 'link-collector'
  }
};

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return DEFAULT_CONFIG;
  }
}

const config = loadConfig();
const LINKS_DIR = join(ROOT_DIR, 'raw', 'links');

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

function extractUrls(text) {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

function generateFilename() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}.md`;
}

async function writeLinkFile(url) {
  const { writeFileSync, mkdirSync } = await import('fs');
  
  mkdirSync(LINKS_DIR, { recursive: true });
  
  const filename = generateFilename();
  const filepath = join(LINKS_DIR, filename);
  const timestamp = new Date().toISOString();
  
  const content = `---
source: acp
timestamp: ${timestamp}
url: ${url}
---

# Source: ${url}

> Imported via ACP link collector
`;
  
  writeFileSync(filepath, content);
  console.log(`[+] Saved: ${url} → ${filename}`);
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function handleMessage(obj) {
  let text = '';
  
  if (obj.type === 'text' || obj.content) {
    text = obj.content?.[0]?.text || obj.text || '';
  } else if (obj.type === 'agent_message' || obj.type === 'agent_message_chunk') {
    text = obj.content?.[0]?.text || '';
  }
  
  if (text) {
    const urls = extractUrls(text);
    for (const url of urls) {
      await writeLinkFile(url);
    }
    if (urls.length > 0) {
      console.log(`[i] Extracted ${urls.length} URL(s)`);
    }
  }
}

async function start() {
  const { url, token } = config.gateway;
  const sessionKey = config.session.key;
  
  console.log(`[i] Connecting to ${url}`);
  console.log(`[i] Session: ${sessionKey}`);
  console.log(`[i] Output: ${LINKS_DIR}`);
  
  const ws = new WebSocket(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  
  ws.on('open', () => {
    console.log('[i] Connected, initializing...');
    send(ws, {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '0.15',
        capabilities: {
          streaming: true,
          prompts: true
        },
        clientInfo: {
          name: 'acp-link-collector',
          version: '1.0.0'
        }
      },
      id: 1
    });
  });
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      if (msg.id === 1 && msg.result) {
        console.log('[i] Protocol initialized');
        send(ws, {
          jsonrpc: '2.0',
          method: 'newSession',
          params: {
            sessionKey,
            sessionLabel: config.session.label
          },
          id: 2
        });
        return;
      }
      
      if (msg.id === 2 && msg.result) {
        const sessionId = msg.result.session?.id || msg.result.sessionId;
        console.log(`[i] Session started: ${sessionId}`);
        console.log('[i] Listening for links...');
        return;
      }
      
      if (msg.method === 'agent_message' || msg.method === 'agent_message_chunk') {
        await handleMessage(msg.params || msg);
      }
      
      if (msg.type === 'prompt' || (msg.params && msg.params.content)) {
        await handleMessage(msg.params || msg);
      }
      
    } catch (e) {
      console.error('[!] Parse error:', e.message);
    }
  });
  
  ws.on('error', (e) => {
    console.error('[!] WebSocket error:', e.message);
  });
  
  ws.on('close', () => {
    console.log('[!] Disconnected, reconnecting in 5s...');
    setTimeout(start, 5000);
  });
}

start().catch(console.error);