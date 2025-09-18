# syntax=docker/dockerfile:1

FROM nginx:alpine

# Copy the static landing page into the default nginx html directory
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
