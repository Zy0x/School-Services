FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages packages
RUN npm install
COPY apps/frontend apps/frontend
RUN npm run frontend:build

FROM nginx:1.27-alpine
COPY --from=build /app/Output/web-app /usr/share/nginx/html
EXPOSE 80
