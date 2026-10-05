# ---- build stage: install everything, typecheck, build the React bundle ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run typecheck && npm run build

# ---- runtime stage: production deps + built client + server source ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_FILE=/data/apptrack.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY --from=build /app/dist ./dist
# SQLite file lives on a volume so data survives container restarts.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server/index.ts"]
