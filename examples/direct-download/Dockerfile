# Caddy with the Cloudflare DNS plugin, so the certificate is issued over DNS
# and the download port never has to answer on 80. Use another caddy-dns
# plugin for another DNS provider.
FROM caddy:2.10.2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare@v0.2.4
FROM caddy:2.10.2
COPY --from=build /usr/bin/caddy /usr/bin/caddy
