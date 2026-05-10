import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JIBUXIA_ROOT = join(__dirname, '..', '..');

function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, ...args], {
      cwd: JIBUXIA_ROOT,
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Exit code ${code}`));
      }
    });
  });
}

const server = new Server(
  {
    name: 'jibuxia-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    return {
      tools: [
        {
          name: 'jibuxia_ingest',
          description: 'Ingest a URL into the Jibuxia knowledge base. Fetches content, compiles it to wiki, and updates the search index.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to ingest'
              },
              force: {
                type: 'boolean',
                description: 'Force re-ingest even if already processed',
                default: false
              }
            },
            required: ['url']
          }
        },
        {
          name: 'jibuxia_ask',
          description: 'Ask a question against the Jibuxia knowledge base using semantic search.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The question to ask'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'jibuxia_status',
          description: 'Get the current status of the Jibuxia knowledge base.',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    };
  }
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'jibuxia_ingest') {
        const url = args.url;
        const force = args.force ? '--force' : '';
        
        const output = await runScript('scripts/ingest.js', [url, '--json', force].filter(Boolean));
        
        let result;
        try {
          result = JSON.parse(output);
        } catch {
          result = { status: 'ok', raw: output };
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      if (name === 'jibuxia_ask') {
        const output = await runScript('scripts/ask.js', [args.query]);
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      if (name === 'jibuxia_status') {
        const output = await runScript('scripts/status.js');
        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[jibuxia-mcp] MCP server started');
}

main().catch(console.error);
