import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from '../config';
import healthRouter from './routes/health';
import retrieveRouter from './routes/retrieve';
import ingestRouter from './routes/ingest';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', retrieveRouter);
app.use('/api', ingestRouter);

const port = config.apiPort;

app.listen(port, () => {
  console.log(`[NexusRecall API] listening on port ${port}`);
});
