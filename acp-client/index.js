import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { WebSocket } from 'ws';
import { watch } from 'chokidar';

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
const REPLY_QUEUE_DIR = join(ROOT_DIR, 'data', 'reply-queue');

mkdirSync(REPLY_QUEUE_DIR, { recursive: true });

let ws = null;
let reconnectAttempts = 0;
let heartbeatTimer = null;
const MAX_RECONNECT_DELAY = 300000;
const HEARTBEAT_INTERVAL = 30000;

function getReconnectDelay() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  return delay;
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

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

async function writeLinkFile(url, replyTo = null) {
  const filename = generateFilename();
  const filepath = join(LINKS_DIR, filename);
  const timestamp = new Date().toISOString();
  
  const frontmatter = {
    source: 'acp',
    timestamp,
    url
  };
  
  if (replyTo) {
    frontmatter.replyTo = replyTo;
  }
  
  let content = '---\n';
  for (const [key, value] of Object.entries(frontmatter)) {
    content += `${key}: ${value}\n`;
  }
  content += '---\n\n';
  content += `# Source: ${url}\n\n> Imported via ACP link collector`;
  
  mkdirSync(LINKS_DIR, { recursive: true });
  writeFileSync(filepath, content);
  console.log(`[+] Saved: ${url} → ${filename}${replyTo ? ` (replyTo: ${replyTo})` : ''}`);
}

function sendWs(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function extractReplyTo(obj) {
  return obj.replyTo || obj.params?.replyTo || null;
}

async function handleMessage(obj) {
  let text = '';
  const replyTo = extractReplyTo(obj);
  
  if (obj.type === 'text' || obj.content) {
    text = obj.content?.[0]?.text || obj.text || '';
  } else if (obj.type === 'agent_message' || obj.type === 'agent_message_chunk') {
    text = obj.content?.[0]?.text || '';
  }
  
  if (text) {
    const urls = extractUrls(text);
    for (const url of urls) {
      await writeLinkFile(url, replyTo);
    }
    if (urls.length > 0) {
      console.log(`[i] Extracted ${urls.length} URL(s)`);
    }
  }
}

function sendReply(replyTo, content) {
  if (!replyTo) return;
  
  sendWs({
    jsonrpc: '2.0',
    method: 'agent_message',
    params: {
      sessionKey: replyTo,
      content: [
        {
          type: 'text',
          text: content
        }
      ]
    }
  });
  console.log(`[i] Sent reply to ${replyTo}`);
}

function processReplyQueue() {
  try {
    const files = readdirSync(REPLY_QUEUE_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const filepath = join(REPLY_QUEUE_DIR, file);
      try {
        const data = JSON.parse(readFileSync(filepath, 'utf-8'));
        
        if (data.replyTo && data.content) {
          sendReply(data.replyTo, data.content);
        }
        
        unlinkSync(filepath);
      } catch (e) {
        console.error(`[!] Failed to process reply file ${file}:`, e.message);
      }
    }
  } catch (e) {
  }
}

function startReplyQueueWatcher() {
  const watcher = watch(REPLY_QUEUE_DIR, {
    persistent: true,
    ignoreInitial: true
  });
  
  watcher.on('add', () => {
    processReplyQueue();
  });
  
  console.log(`[i] Reply queue watcher active: ${REPLY_QUEUE_DIR}`);
}

async function start() {
  const { url, token } = config.gateway;
  const sessionKey = config.session.key;
  
  console.log(`[i] Connecting to ${url}`);
  console.log(`[i] Session: ${sessionKey}`);
  console.log(`[i] Output: ${LINKS_DIR}`);
  
  startReplyQueueWatcher();
  
  const ws = new WebSocket(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  
  ws.on('open', () => {
    console.log('[i] Connected, initializing...');
    reconnectAttempts = 0;
    startHeartbeat();
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
    stopHeartbeat();
    const delay = getReconnectDelay();
    reconnectAttempts++;
    console.log(`[!] Disconnected, reconnecting in ${Math.round(delay/1000)}s... (attempt ${reconnectAttempts})`);
    setTimeout(start, delay);
  });
  
  ws.on('pong', () => {
  });
}

start().catch(console.error);