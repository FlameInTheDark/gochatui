# syntax=docker/dockerfile:1

# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Allow overriding public env vars (used at build-time for the static output)
ARG PUBLIC_BASE_PATH=""
ARG PUBLIC_API_BASE_URL=""
ARG PUBLIC_WS_URL=""
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
ENV PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}
ENV PUBLIC_WS_URL=${PUBLIC_WS_URL}

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/html/app \
    && mv /usr/share/nginx/html/app.html /usr/share/nginx/html/app/index.html \
    && cp -r /usr/share/nginx/html/_app /usr/share/nginx/html/app/_app
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
