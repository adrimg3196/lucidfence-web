FROM nginxinc/nginx-unprivileged:1.27.4-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 index.html web.html web-core.js web-store.js web-cloud.js web-uem.js web-fleet.js web-app.js web-worker.js sw.js runtime.json manifest.webmanifest lucidfence-icon.svg .nojekyll /usr/share/nginx/html/
EXPOSE 8080
USER 101
