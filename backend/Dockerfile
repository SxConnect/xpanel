FROM node:18-alpine
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN addgroup -S xpanel && adduser -S xpanel -G xpanel
USER xpanel

EXPOSE 3000

CMD ["npm", "start"]