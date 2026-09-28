# content-os-worker — se construye desde la RAÍZ del repo (necesita worker/ y shared/):
#   docker build -f worker/Dockerfile .
FROM node:24-alpine

# ffmpeg/ffprobe: fotogramas para la IA (Fase 1) y edición de video (Fase 2B).
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund

COPY worker/src ./worker/src
# Tipografías y logos de las plantillas de marca (overlay.ts).
COPY worker/assets ./worker/assets
COPY shared ./shared

ENV NODE_ENV=production
USER node
EXPOSE 3651
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3651/ >/dev/null || exit 1

CMD ["node", "worker/src/main.ts"]
