# 22, not latest: @tensorflow/tfjs-node (face match) doesn't support Node 23+
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080
CMD ["node", "--import", "tsx", "server.ts"]
