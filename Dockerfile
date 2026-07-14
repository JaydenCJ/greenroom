# Greenroom server image.
# docker-cli + compose plugin control per-PR environments through the host
# Docker socket; git fetches PR head refs.
FROM node:22.17.0-alpine

RUN apk add --no-cache docker-cli docker-cli-compose git

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund \
  && npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force

ENV NODE_ENV=production
EXPOSE 8811

CMD ["node", "dist/src/index.js"]
