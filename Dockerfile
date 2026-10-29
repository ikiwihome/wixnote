FROM node:24.22.1-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@12.3.4 --no-audit --no-fund
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN pnpm run build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM node:24.22.1-bookworm-slim AS production
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/reset-password.js ./scripts/reset-password.js
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
