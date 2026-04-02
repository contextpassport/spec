FROM node:18-alpine
RUN npm install -g serve
WORKDIR /app
COPY . .
CMD ["sh", "-c", "serve . --listen ${PORT:-3000} --no-clipboard"]
