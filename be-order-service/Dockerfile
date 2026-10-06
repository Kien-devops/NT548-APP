FROM node:20-alpine

RUN apk update && apk upgrade --no-cache && (apk del openssl || true)

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./

ENV NODE_ENV=production
USER node
EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5003/health || exit 1

CMD ["node", "server.js"]
