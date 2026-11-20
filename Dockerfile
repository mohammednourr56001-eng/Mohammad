# ==============================================================================
# منصة UST للمحاضرات — Multi-Stage Production Dockerfile
# Stateless Node.js + Vite SPA bundle suitable for Cloud Run, ECS, & Kubernetes
# ==============================================================================

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S ust && adduser -S ust -G ust

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/src/utils ./src/utils
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

RUN mkdir -p /app/uploads/ust-storage && chown -R ust:ust /app/uploads
USER ust

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/liveness || exit 1

CMD ["npx", "tsx", "server.ts"]
