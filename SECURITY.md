# Security policy

CookingFoil guards a game library with accounts, device keys and an admin page,
so security reports are welcome.

## Reporting

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/jshsakura/oc-cookingfoil/security/advisories/new),
not in a public issue. Include the version (`/api/shop/info` shows it), how to
reproduce, and what an attacker gains. You will get a reply within a week.

## Scope

In scope: authentication and lockouts, the admin page (TOTP, admin password,
sessions), device pairing and access keys, path handling for downloads,
uploads and user patches, and anything that exposes files or credentials.

Out of scope: the content of game files you serve, and setups that expose the
server without any account (`COOK_AUTH_USERS` empty and pairing off).

## Hardening a deployment

- Always set accounts (`COOK_AUTH_USERS` or the admin page) and long passwords.
- Put it behind HTTPS (a reverse proxy or tunnel) when it leaves your LAN, and
  set `COOK_TRUST_PROXY` so lockouts apply per client.
- Mount `prod.keys` read-only and never commit it; the repository's pre-commit
  hook refuses it.
