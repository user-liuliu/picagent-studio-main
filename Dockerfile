FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001
EXPOSE 9464

CMD ["npx", "tsx", "server/index.ts"]
