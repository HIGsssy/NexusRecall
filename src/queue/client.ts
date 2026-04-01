// ============================================================
// queue/client — BullMQ queue setup
// Nexus Recall Phase 1 — S03
// ============================================================

import { Queue } from 'bullmq';
import { config } from '../config';

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  const opts: {
    host: string;
    port: number;
    password?: string;
    username?: string;
    db?: number;
    tls?: object;
    maxRetriesPerRequest: null;
  } = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
  };
  if (parsed.password) opts.password = decodeURIComponent(parsed.password);
  if (parsed.username) opts.username = decodeURIComponent(parsed.username);
  if (parsed.pathname && parsed.pathname.length > 1) {
    opts.db = parseInt(parsed.pathname.slice(1), 10);
  }
  if (parsed.protocol === 'rediss:') opts.tls = {};
  return opts;
}

export const redisConnection = parseRedisUrl(config.redisUrl);

export const ingestionQueue = new Queue('memory-ingestion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});
