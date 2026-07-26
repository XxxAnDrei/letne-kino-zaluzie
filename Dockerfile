FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server ./server
COPY scripts ./scripts
COPY public ./public

# GSAP sa skopíruje z node_modules do public/vendor.
RUN node scripts/prepare-static.mjs

# Databáza žije mimo image, aby prežila nové nasadenie.
# Priečinok musí patriť používateľovi node, inak doň server nezapíše.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 3000

USER node
CMD ["node", "server/index.js"]
