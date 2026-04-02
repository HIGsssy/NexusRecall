import express from 'express';
import cors from 'cors';
import { harnessConfig } from './config';
import { checkHealth } from './nexus-client';
import chatRouter from './routes/chat';
import sessionRouter from './routes/session';
import diagnosticsRouter from './routes/diagnostics';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', chatRouter);
app.use('/api', sessionRouter);
app.use('/api', diagnosticsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = harnessConfig.harnessPort;
app.listen(port, async () => {
  console.log(`[Harness] listening on port ${port}`);
  const nexusOk = await checkHealth();
  if (nexusOk) {
    console.log(`[Harness] Nexus Recall API reachable at ${harnessConfig.nexusRecallUrl}`);
  } else {
    console.warn(
      `[Harness] WARNING: Nexus Recall API at ${harnessConfig.nexusRecallUrl} is not reachable`
    );
  }
});
