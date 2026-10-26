# Examples

[English](#english) | [한국어](#한국어) | [日本語](#日本語) | [简体中文](#简体中文)

| Folder | What it is |
|---|---|
| [`compose-with-caddy/`](compose-with-caddy/) | The library and Caddy in one stack, with HTTPS from Let's Encrypt |
| [`reverse-proxy/`](reverse-proxy/) | Caddy, nginx or a Cloudflare Tunnel on the host, in front of the library on port 9080 |
| [`direct-download/`](direct-download/) | The optional download-only address: Caddy with a DNS certificate, and DDNS |

## English

Every example uses `library.example.org` for the library and `dl.example.org:8443` for the direct download address. Replace them with your own names, and keep your real `.env` files out of version control.

- **One stack with HTTPS:** `compose-with-caddy/`. Ports 80 and 443 must reach the machine. Set `COOK_TRUST_PROXY=uniquelocal` in `.env`.
- **A proxy you already run:** `reverse-proxy/`. The library stays on port 9080 from the main `docker-compose.yml`. Set `COOK_TRUST_PROXY=loopback, uniquelocal` in `.env`.
- **Direct downloads:** `direct-download/`. It runs on the same machine as the library, and its `COOK_DIRECT_EDGE_SECRET` must match the library's. The steps are at the top of its `compose.yaml`.

## 한국어

모든 예시는 라이브러리 주소로 `library.example.org`, 직접 다운로드 주소로 `dl.example.org:8443` 을 씁니다. 자기 이름으로 바꾸고, 실제 `.env` 파일은 버전 관리에 넣지 않습니다.

- **HTTPS 까지 한 번에:** `compose-with-caddy/`. 80, 443 포트가 이 기기로 들어와야 합니다. `.env` 에 `COOK_TRUST_PROXY=uniquelocal` 을 넣습니다.
- **이미 쓰는 프록시가 있을 때:** `reverse-proxy/`. 라이브러리는 기본 `docker-compose.yml` 그대로 9080 포트에 둡니다. `.env` 에 `COOK_TRUST_PROXY=loopback, uniquelocal` 을 넣습니다.
- **직접 다운로드 주소:** `direct-download/`. 라이브러리와 같은 기기에서 돌려야 하고, `COOK_DIRECT_EDGE_SECRET` 이 라이브러리의 값과 같아야 합니다. 순서는 그 폴더 `compose.yaml` 맨 위에 있습니다.

## 日本語

すべての例で、ライブラリのアドレスに `library.example.org`、直接ダウンロードのアドレスに `dl.example.org:8443` を使っています。ご自身の名前に置き換え、実際の `.env` ファイルはバージョン管理に入れないでください。

- **HTTPS までまとめて:** `compose-with-caddy/`。80 と 443 番ポートがこのマシンに届く必要があります。`.env` に `COOK_TRUST_PROXY=uniquelocal` を設定します。
- **すでにプロキシがある場合:** `reverse-proxy/`。ライブラリは標準の `docker-compose.yml` のまま 9080 番ポートで動かします。`.env` に `COOK_TRUST_PROXY=loopback, uniquelocal` を設定します。
- **直接ダウンロード:** `direct-download/`。ライブラリと同じマシンで動かし、`COOK_DIRECT_EDGE_SECRET` をライブラリと同じ値にします。手順はそのフォルダの `compose.yaml` の先頭にあります。

## 简体中文

所有示例都用 `library.example.org` 作为游戏库地址，用 `dl.example.org:8443` 作为直接下载地址。请换成自己的名称，并且不要把真实的 `.env` 文件放进版本控制。

- **一次配好 HTTPS：** `compose-with-caddy/`。80 和 443 端口需要能到达这台机器。在 `.env` 中设置 `COOK_TRUST_PROXY=uniquelocal`。
- **已有反向代理：** `reverse-proxy/`。游戏库按默认的 `docker-compose.yml` 运行在 9080 端口。在 `.env` 中设置 `COOK_TRUST_PROXY=loopback, uniquelocal`。
- **直接下载：** `direct-download/`。它必须和游戏库运行在同一台机器上，`COOK_DIRECT_EDGE_SECRET` 必须与游戏库的值相同。步骤写在该文件夹 `compose.yaml` 的开头。
