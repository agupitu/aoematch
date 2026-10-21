# Imagen única: compila la web y sirve API + estáticos desde el mismo proceso.
# Node 24 porque node:sqlite ya viene sin flag experimental.
FROM node:24-slim

WORKDIR /app

# Las imágenes de civs y mapas se bajan en el build (no están versionadas).
COPY package*.json ./
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm install

COPY . .
RUN npm run assets && npm run build

ENV NODE_ENV=production
ENV API_PORT=3001
ENV SEED_DEMO=1
EXPOSE 3001

CMD ["npm", "start"]
