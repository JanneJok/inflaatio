FROM nginx:alpine

# Copy all files to temp location
COPY . /tmp/build/

# Copy static files
RUN cp /tmp/build/*.html /usr/share/nginx/html/ && \
    cp /tmp/build/*.css /usr/share/nginx/html/ && \
    cp /tmp/build/*.js /usr/share/nginx/html/ && \
    cp -r /tmp/build/image /usr/share/nginx/html/ && \
    (cp /tmp/build/sitemap.xml /usr/share/nginx/html/ || true) && \
    (cp /tmp/build/robots.txt /usr/share/nginx/html/ || true) && \
    rm -rf /tmp/build

# Create custom nginx config
RUN echo 'server { \
    listen 8080; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Security headers \
    add_header X-Frame-Options "SAMEORIGIN" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-XSS-Protection "1; mode=block" always; \
    \
    # Caching for static assets \
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|webp)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # HTML files - short cache \
    location ~* \.html$ { \
        expires 1h; \
        add_header Cache-Control "public, must-revalidate"; \
    } \
    \
    # Redirect /index.html to / \
    if ($request_uri = /index.html) { \
        return 301 /; \
    } \
    \
    # SPA fallback \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
