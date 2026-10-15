FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health || exit 1

# Apply the (idempotent) schema on every start, then run the API.
CMD ["sh", "-c", "node src/db/init.js && node src/db/bootstrap-admin.js; node src/server.js"]
