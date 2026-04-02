FROM node:18-alpine
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
