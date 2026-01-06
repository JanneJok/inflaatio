FROM nginx:alpine

# Copy static files
COPY *.html /usr/share/nginx/html/
COPY *.css /usr/share/nginx/html/
COPY *.js /usr/share/nginx/html/
COPY image/ /usr/share/nginx/html/image/
COPY sitemap.xml /usr/share/nginx/html/ 2>/dev/null || true
COPY robots.txt /usr/share/nginx/html/ 2>/dev/null || true

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
