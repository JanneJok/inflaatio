# syntax=docker/dockerfile:1
#
# Inflaatio.fi production image (Fly.io, see fly.toml and docs/OPERATIONS.md).
#
# Stage 1 (build): install the exact dependencies from package-lock.json and run
#   the static build with the COMMITTED data/*.json. There is deliberately no
#   network fetch here: data changes arrive as "data: …" commits from
#   .github/workflows/update-data.yml, so an image is always reproducible from
#   its commit.
# Stage 2 (runtime): nginx serves only dist/ on port 8080 as a non-root user,
#   configured by deploy/nginx.conf and the security header files.
#
# Local test:
#   docker build -t inflaatio-local .
#   docker run --rm -p 8108:8080 inflaatio-local    # http://localhost:8108/

FROM node:24-alpine AS build
WORKDIR /app
ENV CI=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Dependencies first (cached layer while package*.json stay the same).
# --ignore-scripts: no install scripts from the dependency tree run here
# (esbuild finds its platform binary without its postinstall step).
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY scripts ./scripts
COPY src ./src
COPY data ./data
# The build checks that the CSP (script-src) allows the inline theme script.
COPY deploy ./deploy

# Build into dist/, then precompress text files for nginx gzip_static
# (foo.css → foo.css.gz, originals kept; files under 256 bytes are left alone).
RUN npm run build \
    && find dist -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.json' \
        -o -name '*.xml' -o -name '*.svg' -o -name '*.txt' -o -name '*.csv' -o -name '*.webmanifest' \
        -o -name '*.ico' \) -size +255c -exec gzip -9 -k -n {} +


# nginx stable branch (even minor). Patch releases arrive with every rebuild;
# move to the next stable minor (1.32 in April 2027) by hand – see docs/OPERATIONS.md.
FROM nginx:1.30-alpine

# Run as the unprivileged "nginx" user: drop the user directive, move the pid
# file to a writable place and give the user the cache/temp directories. The
# image's example site and its welcome/50x pages are removed (otherwise "/"
# would show "Welcome to nginx!" whenever dist/ has no index.html).
RUN rm -f /etc/nginx/conf.d/default.conf \
    && rm -rf /usr/share/nginx/html \
    && sed -i -e '/^user /d' -e 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
    && mkdir -p /etc/nginx/inflaatio \
    && chown -R nginx:nginx /var/cache/nginx

COPY deploy/security-headers.conf deploy/security-headers-embed.conf /etc/nginx/inflaatio/
COPY deploy/nginx.conf /etc/nginx/conf.d/inflaatio.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx

# Fail the image build on a broken configuration.
RUN nginx -t

EXPOSE 8080
# Fly.io uses the [[http_service.checks]] in fly.toml; this is for docker run.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
