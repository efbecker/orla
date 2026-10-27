-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProxyHost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "edgeProtectionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceTitle" TEXT,
    "maintenanceMessage" TEXT,
    "maintenanceHtml" TEXT,
    "upstreamPoolId" INTEGER,
    "websocketEnabled" BOOLEAN NOT NULL DEFAULT false,
    "http2Enabled" BOOLEAN NOT NULL DEFAULT true,
    "http3Enabled" BOOLEAN NOT NULL DEFAULT false,
    "sslMode" TEXT NOT NULL DEFAULT 'OFF',
    "certificateId" INTEGER,
    "forceHttps" BOOLEAN NOT NULL DEFAULT false,
    "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hstsMaxAge" INTEGER NOT NULL DEFAULT 31536000,
    "hstsIncludeSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "hstsPreload" BOOLEAN NOT NULL DEFAULT false,
    "minTlsVersion" TEXT NOT NULL DEFAULT 'TLS_1_2',
    "originServerName" TEXT,
    "originTrustedCaPem" TEXT,
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cacheMode" TEXT NOT NULL DEFAULT 'STATIC_ONLY',
    "cacheDefaultTtlSeconds" INTEGER NOT NULL DEFAULT 3600,
    "cacheRespectOriginHeaders" BOOLEAN NOT NULL DEFAULT true,
    "cacheServeStaleOnError" BOOLEAN NOT NULL DEFAULT true,
    "cacheLastPurgedAt" DATETIME,
    "gzipEnabled" BOOLEAN NOT NULL DEFAULT true,
    "brotliEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientMaxBodySizeMb" INTEGER NOT NULL DEFAULT 10,
    "proxyConnectTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "proxyReadTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "proxySendTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "proxyBufferingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "securityHeadersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contentSecurityPolicy" TEXT,
    "blockBadBotsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "authMode" TEXT NOT NULL DEFAULT 'NONE',
    "basicAuthRealmId" INTEGER,
    "externalAuthUrl" TEXT,
    "customDirectives" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProxyHost_upstreamPoolId_fkey" FOREIGN KEY ("upstreamPoolId") REFERENCES "UpstreamPool" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProxyHost_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProxyHost_basicAuthRealmId_fkey" FOREIGN KEY ("basicAuthRealmId") REFERENCES "BasicAuthRealm" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HostDomain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HostDomain_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UpstreamPool" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheme" TEXT NOT NULL DEFAULT 'HTTP',
    "algorithm" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "keepaliveConnections" INTEGER NOT NULL DEFAULT 32,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UpstreamServer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "poolId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxFails" INTEGER NOT NULL DEFAULT 3,
    "failTimeoutSeconds" INTEGER NOT NULL DEFAULT 10,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "isDown" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UpstreamServer_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "UpstreamPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Location" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'PREFIX',
    "upstreamPoolId" INTEGER,
    "rewritePath" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "websocketEnabled" BOOLEAN,
    "cacheEnabled" BOOLEAN,
    "clientMaxBodySizeMb" INTEGER,
    "authMode" TEXT,
    "basicAuthRealmId" INTEGER,
    "externalAuthUrl" TEXT,
    "customDirectives" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Location_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Location_upstreamPoolId_fkey" FOREIGN KEY ("upstreamPoolId") REFERENCES "UpstreamPool" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Location_basicAuthRealmId_fkey" FOREIGN KEY ("basicAuthRealmId") REFERENCES "BasicAuthRealm" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "acmeAccountId" INTEGER,
    "challengeType" TEXT,
    "dnsProviderId" INTEGER,
    "certificatePem" TEXT,
    "chainPem" TEXT,
    "privateKeyEncrypted" TEXT,
    "issuer" TEXT,
    "serialNumber" TEXT,
    "fingerprint" TEXT,
    "notBefore" DATETIME,
    "notAfter" DATETIME,
    "lastRenewAttemptAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Certificate_acmeAccountId_fkey" FOREIGN KEY ("acmeAccountId") REFERENCES "AcmeAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Certificate_dnsProviderId_fkey" FOREIGN KEY ("dnsProviderId") REFERENCES "DnsProvider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CertificateDomain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "certificateId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    CONSTRAINT "CertificateDomain_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcmeAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "directoryUrl" TEXT NOT NULL,
    "accountUrl" TEXT,
    "accountKeyEncrypted" TEXT NOT NULL,
    "eabKeyId" TEXT,
    "eabHmacKeyEncrypted" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DnsProvider" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "credentialsEncrypted" TEXT,
    "propagationSeconds" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RedirectRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchType" TEXT NOT NULL DEFAULT 'PREFIX',
    "sourcePath" TEXT NOT NULL DEFAULT '/',
    "targetUrl" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL DEFAULT 'MOVED_PERMANENTLY_301',
    "preservePath" BOOLEAN NOT NULL DEFAULT true,
    "preserveQuery" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RedirectRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HeaderRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "phase" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "headerName" TEXT NOT NULL,
    "headerValue" TEXT,
    "always" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HeaderRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HeaderRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimitRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "key" TEXT NOT NULL DEFAULT 'IP',
    "requests" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'SECOND',
    "burst" INTEGER NOT NULL DEFAULT 0,
    "nodelay" BOOLEAN NOT NULL DEFAULT true,
    "zoneSizeMb" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RateLimitRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RateLimitRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IpList" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IpListEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ipListId" INTEGER NOT NULL,
    "cidr" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IpListEntry_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HostIpList" (
    "hostId" INTEGER NOT NULL,
    "ipListId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("hostId", "ipListId"),
    CONSTRAINT "HostIpList_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HostIpList_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocationIpList" (
    "locationId" INTEGER NOT NULL,
    "ipListId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("locationId", "ipListId"),
    CONSTRAINT "LocationIpList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LocationIpList_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BasicAuthRealm" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL DEFAULT 'Área restrita',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BasicAuthUser" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "realmId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'BCRYPT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BasicAuthUser_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "BasicAuthRealm" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'USER',
    "triggeredById" INTEGER,
    "summary" TEXT NOT NULL,
    "fileHashes" JSONB,
    "nginxTestOutput" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Deployment_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrafficBucket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bytesSent" BIGINT NOT NULL DEFAULT 0,
    "bytesReceived" BIGINT NOT NULL DEFAULT 0,
    "status1xx" INTEGER NOT NULL DEFAULT 0,
    "status2xx" INTEGER NOT NULL DEFAULT 0,
    "status3xx" INTEGER NOT NULL DEFAULT 0,
    "status4xx" INTEGER NOT NULL DEFAULT 0,
    "status5xx" INTEGER NOT NULL DEFAULT 0,
    "cacheHit" INTEGER NOT NULL DEFAULT 0,
    "cacheMiss" INTEGER NOT NULL DEFAULT 0,
    "cacheBypass" INTEGER NOT NULL DEFAULT 0,
    "cacheExpired" INTEGER NOT NULL DEFAULT 0,
    "cacheOther" INTEGER NOT NULL DEFAULT 0,
    "requestTimeSumMs" BIGINT NOT NULL DEFAULT 0,
    "upstreamTimeSumMs" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "TrafficTopEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bytesSent" BIGINT NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "ProxyHost_upstreamPoolId_idx" ON "ProxyHost"("upstreamPoolId");

-- CreateIndex
CREATE INDEX "ProxyHost_certificateId_idx" ON "ProxyHost"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "HostDomain_domain_key" ON "HostDomain"("domain");

-- CreateIndex
CREATE INDEX "HostDomain_hostId_idx" ON "HostDomain"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamPool_name_key" ON "UpstreamPool"("name");

-- CreateIndex
CREATE INDEX "UpstreamServer_poolId_idx" ON "UpstreamServer"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamServer_poolId_address_port_key" ON "UpstreamServer"("poolId", "address", "port");

-- CreateIndex
CREATE INDEX "Location_hostId_idx" ON "Location"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_hostId_matchType_path_key" ON "Location"("hostId", "matchType", "path");

-- CreateIndex
CREATE INDEX "Certificate_status_idx" ON "Certificate"("status");

-- CreateIndex
CREATE INDEX "Certificate_notAfter_idx" ON "Certificate"("notAfter");

-- CreateIndex
CREATE INDEX "CertificateDomain_domain_idx" ON "CertificateDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateDomain_certificateId_domain_key" ON "CertificateDomain"("certificateId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "AcmeAccount_provider_email_key" ON "AcmeAccount"("provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "DnsProvider_name_key" ON "DnsProvider"("name");

-- CreateIndex
CREATE INDEX "RedirectRule_hostId_idx" ON "RedirectRule"("hostId");

-- CreateIndex
CREATE INDEX "HeaderRule_hostId_idx" ON "HeaderRule"("hostId");

-- CreateIndex
CREATE INDEX "HeaderRule_locationId_idx" ON "HeaderRule"("locationId");

-- CreateIndex
CREATE INDEX "RateLimitRule_hostId_idx" ON "RateLimitRule"("hostId");

-- CreateIndex
CREATE INDEX "RateLimitRule_locationId_idx" ON "RateLimitRule"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "IpList_name_key" ON "IpList"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IpListEntry_ipListId_cidr_key" ON "IpListEntry"("ipListId", "cidr");

-- CreateIndex
CREATE INDEX "HostIpList_ipListId_idx" ON "HostIpList"("ipListId");

-- CreateIndex
CREATE INDEX "LocationIpList_ipListId_idx" ON "LocationIpList"("ipListId");

-- CreateIndex
CREATE UNIQUE INDEX "BasicAuthRealm_name_key" ON "BasicAuthRealm"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BasicAuthUser_realmId_username_key" ON "BasicAuthUser"("realmId", "username");

-- CreateIndex
CREATE INDEX "Deployment_startedAt_idx" ON "Deployment"("startedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "TrafficBucket_bucketStart_idx" ON "TrafficBucket"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficBucket_hostId_bucketStart_key" ON "TrafficBucket"("hostId", "bucketStart");

-- CreateIndex
CREATE INDEX "TrafficTopEntry_bucketStart_idx" ON "TrafficTopEntry"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficTopEntry_hostId_bucketStart_kind_value_key" ON "TrafficTopEntry"("hostId", "bucketStart", "kind", "value");
