// ============================================================
// queue/worker — BullMQ worker bootstrap and job routing
// Nexus Recall Phase 1 — S03
// ============================================================

import { Worker } from 'bullmq';
import { redisConnection } from './client';
import { processJob } from '../memory/ingestion';

const worker = new Worker(
  'memory-ingestion',
  async (job) => {
    await processJob(job);
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on('failed', (job, err) => {
  if (job) {
    const maxAttempts = job.opts?.attempts ?? 4;
    if (job.attemptsMade >= maxAttempts) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'job_dead_letter',
          jobType: job.name,
          jobId: job.id,
          error: err.message,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
});

export { worker };
