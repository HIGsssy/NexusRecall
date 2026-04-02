# Nexus Recall API — dev image
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY db/ db/

EXPOSE 3200

CMD ["npx", "tsx", "src/api/server.ts"]
