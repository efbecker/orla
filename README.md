# Orla

Painel de controle web para Nginx (Reverse Proxy & Edge Manager), inspirado na
experiência da Cloudflare. Monólito em Node.js + React com PostgreSQL, instalado
nativamente no Debian 13.

A arquitetura completa está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

Entrega iterativa em 5 etapas:

- [x] **Etapa 1:** arquitetura, `schema.prisma`, `nginx.conf` base, instalação no Debian 13
- [x] **Etapa 2:** motor de templates, executor transacional e sanitização
- [x] **Etapa 3:** API (Fastify, JWT, ACME, coletor de logs)
- [ ] **Etapa 4:** frontend base (layout, domínios, dashboard, proxy hosts)
- [ ] **Etapa 5:** SSL/TLS, regras, segurança, cache e live logs

## Instalação (Debian 13)

```bash
git clone https://github.com/efbecker/orla.git && cd orla
sudo ./deploy/install.sh
```

O instalador configura Nginx, PostgreSQL 17, o usuário `orla`, `/etc/orla/orla.env`
e as unidades systemd, compila a API e sobe o `orla.service`. A senha inicial do
administrador aparece no fim da instalação (e fica em `/etc/orla/orla.env`).

Para atualizar: `git pull && sudo ./deploy/install.sh`.

Até a Etapa 4 o painel ainda não tem interface: a API responde em
`http://<servidor>:81/api` (por exemplo, `curl http://127.0.0.1:81/api/health`).
Antes de emitir certificados ACME, defina o e-mail em `PUT /api/settings`
(`acmeEmail`) ou em `ORLA_ACME_EMAIL`.

Portas: `80/tcp`, `443/tcp`, `443/udp` (HTTP/3) e o painel em `81`.

## Desenvolvimento

```bash
npm install
export DATABASE_URL=postgresql://orla:senha@127.0.0.1:5432/orla?schema=public
npm run prisma:migrate:dev
npm run dev          # API com recarga automática
npm test             # testes (vitest)
npm run typecheck
```
