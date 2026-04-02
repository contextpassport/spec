FROM node:18-alpine
RUN npm install -g serve
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["serve", ".", "--listen", "3000", "--no-clipboard"]
