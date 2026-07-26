FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

# better-sqlite3 sa inštaluje z predkompilovaných balíkov, ale ak by pre danú
# platformu chýbali, potrebuje toolchain na preklad.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY public ./public

# Databáza žije mimo image, aby prežila nové nasadenie.
# Priečinok musí patriť používateľovi node, inak doň server nezapíše.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 3000

USER node
CMD ["node", "server/index.js"]
