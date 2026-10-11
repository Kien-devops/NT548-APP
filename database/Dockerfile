FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY init.js ./
COPY migrations ./migrations

USER node
CMD ["node", "init.js"]
