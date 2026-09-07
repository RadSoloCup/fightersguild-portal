FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations
COPY public ./public

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
