# Harness — dev image (backend + frontend via concurrently)
FROM node:22-slim

WORKDIR /app

# Install all deps (server + client in one package.json)
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY server/ server/
COPY client/ client/

EXPOSE 3100 5173

CMD ["sh", "-c", "npx concurrently 'npx tsx server/index.ts' 'cd client && npx vite --host 0.0.0.0'"]
