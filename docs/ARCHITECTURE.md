# Orla: arquitetura

Orla é um painel web para gerenciar o Nginx como proxy reverso e camada de borda,
com UX inspirada no dashboard da Cloudflare.

- **Monólito:** um único processo Node.js (API REST + SPA + jobs em segundo plano).
  Sem microsserviços e sem contêineres.
- **Instalação nativa no Debian 13 (trixie)**, usando apenas pacotes do Debian:
  `nginx` (+ módulos brotli e headers-more), `nodejs` e `postgresql` (17).
- **PostgreSQL** como banco, via Prisma.

## Princípios

1. **Banco de dados como fonte única da verdade.** Nenhum `.conf` existente é lido
   para reconstruir estado. Toda alteração parte do banco e é compilada para
   arquivos limpos e determinísticos.
2. **Pipeline transacional com rollback.** snapshot → escrita → `nginx -t` →
   reload, ou restauração do snapshot com o erro exato do Nginx. Comandos sempre
   via `execFile`, nunca via shell.
3. **Defesa contra config injection.** Todo valor que chega a um template passa por
   Zod + regex restritiva; `;`, `{`, `}`, `\n`, `$`, aspas e afins são rejeitados
   na borda da API e novamente no compilador.
4. **Privilégio mínimo.** O painel roda como o usuário de sistema `orla`. O único
   acesso privilegiado é via sudoers com argumentos fixos:
   `sudo -n /usr/sbin/nginx -t`, `sudo -n /usr/bin/systemctl reload nginx.service` e
   `sudo -n /usr/lib/orla/bin/orla-cache-purge <id-do-host|all>` (o helper valida o
   argumento).

## Processos (systemd)

| Unidade | Usuário | Função |
|---|---|---|
| `nginx.service` (do Debian) | master root, workers `www-data` | borda: proxy, TLS, cache, rate limit |
| `orla.service` | `orla` | painel: API + SPA + jobs (ACME, coletor de logs, retenção) |
| `postgresql.service` (do Debian) | `postgres` | banco de dados |

O painel e o Nginx são independentes: se o painel cair, o Nginx continua servindo a
última configuração válida, e o systemd reinicia o painel em 2 s.

`/etc/systemd/system/nginx.service.d/orla.conf` adiciona `orla-nginx-prepare`
antes do `nginx -t` padrão do Debian. A cada start do Nginx ele:

1. garante os diretórios compartilhados com os donos e permissões corretos;
2. gera um certificado autoassinado de fallback (usado só pelo listener QUIC
   padrão, já que o TCP recusa o handshake com `ssl_reject_handshake`);
3. inspeciona o build do Nginx e o kernel e grava em `/etc/nginx/orla/runtime/`:
   - `listen-default-http.conf` / `listen-default-https.conf` (IPv6 e QUIC só se
     suportados);
   - `capabilities.json` (`http3`, `ipv6`, `brotli`, `headersMore`, versão), lido
     pelo motor de templates para nunca gerar diretivas que o binário não suporta;
4. roda `nginx -t`; se os arquivos gerados persistidos estiverem inválidos, move-os
   para `/var/lib/orla/quarantine/<timestamp>/` e o Nginx sobe só com os servidores
   padrão. O painel recompila tudo a partir do banco ao iniciar.

## Instalação

```bash
git clone https://github.com/efbecker/orla.git && cd orla
sudo ./deploy/install.sh
```

O `deploy/install.sh` é idempotente (rodar de novo atualiza) e:

1. instala os pacotes do Debian;
2. cria o usuário `orla` e adiciona `www-data` ao grupo `orla`;
3. cria a role e o banco `orla` no PostgreSQL com senha aleatória;
4. gera `/etc/orla/orla.env` com `DATABASE_URL`, segredos JWT, chave de criptografia
   e a senha inicial do administrador;
5. instala o `nginx.conf`, os servidores padrão e os snippets;
6. instala `orla-nginx-prepare`, `orla-cache-purge`, as unidades systemd, o sudoers e o logrotate;
7. copia o código para `/opt/orla`, faz o build e aplica as migrações;
8. reinicia o Nginx e habilita o `orla.service`.

## Arquivos no servidor

```
/etc/nginx/
├── nginx.conf                       instalado: log JSON, zonas globais, defaults
├── modules-enabled/                 módulos Debian (brotli, headers-more)
├── conf.d/                          root:orla 2775, gerado pelo painel
│   └── host-{id}.conf               um arquivo por Proxy Host (upstreams + servers)
└── orla/
    ├── default.d/00-default.conf    instalado: servidores padrão 80/443 (ACME + 444)
    ├── snippets/                    instalado: acme-challenge, block-bad-bots,
    │                                edge-protection
    ├── runtime/                     gerado pelo orla-nginx-prepare
    └── generated/                   orla, gerado pelo painel
        ├── http.d/                  limit_req_zone por regra de rate limit
        ├── ip-lists/list-{id}.conf  allow/deny reutilizáveis
        ├── htpasswd/realm-{id}      Basic Auth (bcrypt/apr1)
        ├── certs/{id}/              fullchain.pem + privkey.pem (diretório 0700)
        └── www/                     páginas de manutenção (503) por host

/etc/orla/orla.env                   root:orla 0640, variáveis do painel
/opt/orla/                           código e build do painel (root, somente leitura)
/usr/lib/orla/bin/orla-nginx-prepare
/var/lib/orla/                       webroot ACME, snapshots do pipeline, quarentena
/var/log/orla/nginx/                 access.json (JSON) e error.log, com logrotate diário
/var/cache/orla/nginx/proxy/         proxy_cache
```

Variáveis globais definidas em `nginx.conf` e usadas pelos templates:

| Variável | Uso |
|---|---|
| `$orla_host_id` | definida com `set` em cada `server`; vai para o log JSON e permite atribuir tráfego ao host (0 = servidor padrão) |
| `$orla_upstream_connection` | `Connection` enviado ao upstream (keepalive ou `upgrade`) |
| `$orla_cache_status` | status do cache normalizado (`HIT`, `MISS`, `BYPASS`, `EXPIRED`, ..., `NONE`) |
| `$orla_cache_bypass_client`, `$orla_cache_bypass_auth` | `proxy_cache_bypass`/`proxy_no_cache` |
| `$orla_is_static` | detecção de estáticos para o modo de cache `STATIC_ONLY` |
| `$orla_bad_bot` | User-Agents de scanners conhecidos |

Zonas globais: `orla_global_req` (50 r/s por IP, usada pela proteção de borda),
`orla_global_conn`, `orla_ssl` (cache de sessão TLS) e `orla_cache` (proxy cache de
até 10 GB).

## Estrutura de pastas do repositório

Um único pacote npm. Os números indicam a etapa em que cada parte é entregue.

```
orla/
├── package.json                     [1] um único pacote (server + web)
├── docs/ARCHITECTURE.md             [1]
├── prisma/
│   ├── schema.prisma                [1] PostgreSQL
│   └── migrations/                  [1] migração inicial
├── deploy/                          [1] instalação nativa no Debian 13
│   ├── install.sh
│   ├── bin/{orla-nginx-prepare,orla-cache-purge}
│   ├── env/orla.env.example
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── orla/{default.d,snippets}
│   ├── systemd/
│   │   ├── orla.service
│   │   └── nginx.service.d/orla.conf
│   ├── sudoers/orla
│   └── logrotate/orla
├── server/                          [2][3]
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 bootstrap (admin inicial, sync no boot, jobs, shutdown)
│       ├── app.ts                   Fastify: erros, auth, rotas em /api
│       ├── context.ts               dependências compartilhadas (prisma, executor, serviços)
│       ├── config/env.ts            variáveis de ambiente validadas com Zod
│       ├── lib/                     crypto (AES-256-GCM), senhas (bcrypt/apr1), erros HTTP
│       ├── plugins/                 auth (JWT + refresh cookie + papéis) e mapa de erros
│       ├── nginx/                   [2] motor de configuração
│       │   ├── sanitize.ts          validadores anti-injection (domínio, IP/CIDR, path, header)
│       │   ├── capabilities.ts      leitura de runtime/capabilities.json
│       │   ├── builder.ts           builder tipado de diretivas (escape e indentação)
│       │   ├── templates/           host (proxy, ssl, redirects, headers, cache, acesso),
│       │   │                        upstreams, rate limits, listas de IP, htpasswd, manutenção
│       │   ├── loader.ts            banco → snapshot tipado
│       │   ├── compiler.ts          snapshot → conjunto de arquivos (determinístico)
│       │   └── executor.ts          snapshot, escrita atômica, nginx -t, reload, rollback
│       ├── services/                [3] config (transação banco + nginx), ACME, DNS-01,
│       │                            certificados, auditoria, configurações, logs, purge
│       ├── modules/                 [3] rotas REST: auth, users, hosts, host-rules,
│       │                            upstreams, ip-lists, auth-realms, certificates,
│       │                            dns-providers, analytics, logs, system
│       └── jobs/                    coletor de log JSON, renovação de certificados, retenção
└── web/                             [4][5] painel (React + Vite + Tailwind + shadcn/ui)
    ├── index.html  vite.config.ts  tailwind.config.ts
    └── src/
        ├── main.tsx  app/router.tsx
        ├── components/ui/           componentes shadcn/ui (Radix)
        ├── components/layout/       barra superior, seletor de sites, menu lateral por site, tema
        ├── components/              cabeçalhos, estados vazios/erro, visualizador de .conf, erros do nginx -t
        ├── lib/                     cliente da API (token em memória + refresh), auth, TanStack Query, formatação
        └── features/
            ├── auth/  dashboard/  hosts/  upstreams/                      [4]
            └── ssl/  rules/  security/  caching/  logs/  audit/  settings/   [5]
```

## Modelo de dados (resumo)

| Área (aba) | Modelos |
|---|---|
| Painel | `User`, `Session`, `Setting` |
| Tráfego / DNS | `ProxyHost`, `HostDomain`, `UpstreamPool`, `UpstreamServer`, `Location` |
| SSL/TLS | `Certificate`, `CertificateDomain`, `AcmeAccount`, `DnsProvider` (campos de SSL ficam no `ProxyHost`) |
| Rules / Redirects | `RedirectRule`, `HeaderRule` |
| Security | `RateLimitRule`, `IpList`, `IpListEntry`, `HostIpList`, `LocationIpList`, `BasicAuthRealm`, `BasicAuthUser` |
| Caching & Speed | campos `cache*`, `gzip*`, `brotli*`, `clientMaxBodySizeMb` no `ProxyHost` |
| Analytics & Logs | `TrafficBucket` (por minuto), `TrafficTopEntry` (top IPs/paths por hora) |
| Auditoria | `AuditLog`, `Deployment` (histórico do pipeline) |

Decisões relevantes:

- IDs inteiros autoincrementais, porque nomeiam os arquivos (`host-{id}.conf`,
  `orla_pool_{id}`, `orla_rl_{id}`).
- Chaves privadas e credenciais de DNS são cifradas em repouso (AES-256-GCM com
  `ORLA_ENCRYPTION_KEY`) e só existem em claro no diretório de certificados do Nginx.
- Métricas usam `hostId` sem chave estrangeira para sobreviver à exclusão do host e
  contabilizar o servidor padrão (0).

## Modos de SSL

| Modo | Cliente → Nginx | Nginx → origem |
|---|---|---|
| Off | HTTP | conforme o pool |
| Flexible | HTTPS | HTTP |
| Full | HTTPS | HTTPS, `proxy_ssl_verify off` |
| Full (Strict) | HTTPS | HTTPS, `proxy_ssl_verify on` + `proxy_ssl_trusted_certificate` + SNI |

## API (Etapa 3)

Todas as rotas ficam em `/api`, respondem JSON e exigem `Authorization: Bearer
<token>` (exceto `/api/health` e o login). Papéis: `VIEWER` lê, `EDITOR` altera,
`ADMIN` gerencia usuários, configurações, diretivas customizadas e purge global.

| Área | Rotas |
|---|---|
| Sessão | `POST /auth/login`, `POST /auth/refresh` (cookie `orla_refresh`), `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Usuários | `GET/POST /users`, `PATCH/DELETE /users/:id` |
| Proxy hosts | `GET/POST /hosts`, `GET/PATCH/DELETE /hosts/:id`, `PATCH /hosts/:id/toggles`, `PUT /hosts/:id/ip-lists`, `GET /hosts/:id/config`, `POST /hosts/preview`, `POST /hosts/:id/cache/purge` |
| Regras por host | `/hosts/:id/{locations,redirects,header-rules,rate-limits}[/:ruleId]` |
| Upstreams | `GET/POST /upstream-pools`, `GET/PUT/DELETE /upstream-pools/:id`, `PATCH /upstream-pools/:id/servers/:serverId` |
| Segurança | `/ip-lists[/:id]` (+ `/entries`), `/auth-realms[/:id]` (+ `/users`) |
| SSL/TLS | `GET /certificates[/:id]`, `POST /certificates/acme`, `POST /certificates/custom`, `POST /certificates/:id/renew`, `PATCH/DELETE /certificates/:id`, `/dns-providers[/:id]` |
| Analytics e logs | `GET /analytics/{summary,timeseries,top}`, `GET /logs/recent`, `GET /logs/stream` (SSE, `?access_token=`) |
| Sistema | `GET /health`, `GET /system/info`, `POST /system/{apply,validate,cache/purge}`, `GET /deployments`, `GET /audit-logs`, `GET/PUT /settings` |

Toda alteração que afeta o Nginx roda em uma transação do banco: grava, recompila
tudo a partir da transação, aplica com `nginx -t` e reload e só então faz o commit.
Se o Nginx recusar, o banco volta ao estado anterior e a API responde `422
NGINX_TEST_FAILED` com arquivo, linha e trecho do erro. Cada aplicação fica em
`/deployments` e cada ação em `/audit-logs`.

## Painel (Etapa 4)

O build do Vite vai para `dist/web` e o próprio Fastify serve os arquivos na porta
do painel, com fallback para `index.html` nas rotas do SPA. As respostas levam CSP
(`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY` e
`nosniff`; os assets com hash têm cache de 1 ano e o `index.html` não é cacheado.

O token de acesso fica só na memória do navegador. Ao abrir o painel, o cookie
`orla_refresh` (httpOnly, `SameSite=Strict`, restrito a `/api/auth`) gera um novo
token; um 401 dispara uma renovação única e repete a requisição.

Telas da Etapa 4: login, visão geral (tráfego, códigos de resposta, recursos do
Nginx, sites e IPs com mais tráfego), lista de sites com busca e liga/desliga,
criação de site com prévia do `.conf`, página do site (tráfego, ajustes rápidos,
origem e desempenho, configuração Nginx com diretivas personalizadas para admin)
e pools de upstream.

## Segurança de rede do painel

O painel escuta em `ORLA_PANEL_HOST:ORLA_PANEL_PORT` (padrão `0.0.0.0:81`, porta
liberada via `AmbientCapabilities=CAP_NET_BIND_SERVICE`). Em produção, use
`127.0.0.1` ou um IP de VPN, ou exponha o painel através de um Proxy Host do
próprio Orla com Basic Auth e lista de IPs.
