import pino from 'pino';

export const logger = pino({
  level: process.env.JIBUXIA_QUIET === '1' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  transport: {
    target: 'pino/file',
    options: { destination: 2, mkdir: false }
  }
});
