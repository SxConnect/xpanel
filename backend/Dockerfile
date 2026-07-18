FROM node:20-alpine

RUN apk add --no-cache git docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

RUN addgroup -S xpanel && adduser -S xpanel -G xpanel

EXPOSE 3000

CMD ["node", "src/app.js"]
