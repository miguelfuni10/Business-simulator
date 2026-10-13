FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
ENV PORT=3000 DATA_FILE=/data/games.json
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
