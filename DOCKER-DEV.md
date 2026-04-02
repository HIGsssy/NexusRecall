# Local Development with Docker

## Prerequisites

- Docker and Docker Compose (v2)
- API keys for your chosen LLM/embedding provider

## Quick Start

```bash
# 1. Create .env from the Docker template
cp .env.docker .env
# Edit .env — add your real API keys

# 2. Start everything
docker compose up --build
```

## Services

| Service            | Internal Host          | Exposed Port | Purpose                  |
|--------------------|------------------------|--------------|--------------------------|
| postgres           | postgres:5432          | 5432         | pgvector database        |
| redis              | redis:6379             | 6379         | Cache + queue            |
| nexus-recall-api   | nexus-recall-api:3200  | 3200         | Memory API               |
| harness            | harness:3100 / :5173   | 3100, 5173   | Harness backend + Vite   |

**Open the harness UI:** http://localhost:5173

## Environment Variables

The `docker-compose.yaml` overrides these automatically so containers talk to each other by hostname:

- `DATABASE_URL` → `postgresql://nexus:nexus@postgres:5432/nexusrecall`
- `REDIS_URL` → `redis://redis:6379`
- `NEXUS_RECALL_URL` → `http://nexus-recall-api:3200`

You only need to set API keys and provider config in `.env`.

## Verify Health

```bash
# Nexus Recall API
curl http://localhost:3200/api/health

# Harness backend
curl http://localhost:3100/api/health
```

Both should return `{"status":"ok","timestamp":"..."}`.

## Useful Commands

```bash
# Rebuild after code changes
docker compose up --build

# Stop everything
docker compose down

# Stop and delete Postgres data
docker compose down -v

# View logs for one service
docker compose logs -f nexus-recall-api
```

## Database

The migration (`db/migrations/001_initial_schema.sql`) runs automatically on first Postgres start via the `docker-entrypoint-initdb.d` mount. To re-run it, delete the volume:

```bash
docker compose down -v
docker compose up --build
```

## Troubleshooting

**API says "Missing required environment variable"**
→ Check your `.env` file has all required keys. Compare against `.env.docker`.

**Connection refused to Redis/Postgres**
→ Make sure `DATABASE_URL` and `REDIS_URL` are NOT set in `.env` — the compose file sets them.

**Vite not accessible from browser**
→ Vite runs with `--host 0.0.0.0` inside the container. Access http://localhost:5173.
