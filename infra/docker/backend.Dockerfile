FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages packages
RUN npm install --omit=dev
COPY apps/backend apps/backend

EXPOSE 8080
CMD ["npm", "--workspace", "@erapor/backend", "run", "start"]
