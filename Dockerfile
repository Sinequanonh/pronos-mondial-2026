# Image portable : Railway, Fly.io, VPS, home-server…
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=3026
EXPOSE 3026
# le SQLite + la clé admin vivent ici : à monter en volume persistant
VOLUME /app/data
CMD ["node", "server.js"]
