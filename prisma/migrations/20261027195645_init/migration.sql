-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "UpstreamScheme" AS ENUM ('HTTP', 'HTTPS');

-- CreateEnum
CREATE TYPE "LoadBalancingAlgorithm" AS ENUM ('ROUND_ROBIN', 'LEAST_CONN', 'IP_HASH');

-- CreateEnum
CREATE TYPE "SslMode" AS ENUM ('OFF', 'FLEXIBLE', 'FULL', 'FULL_STRICT');

-- CreateEnum
CREATE TYPE "TlsVersion" AS ENUM ('TLS_1_2', 'TLS_1_3');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('ACME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING', 'VALID', 'EXPIRED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "AcmeProvider" AS ENUM ('LETSENCRYPT', 'LETSENCRYPT_STAGING', 'ZEROSSL');

-- CreateEnum
CREATE TYPE "AcmeChallengeType" AS ENUM ('HTTP_01', 'DNS_01');

-- CreateEnum
CREATE TYPE "DnsProviderType" AS ENUM ('CLOUDFLARE', 'DIGITALOCEAN', 'ROUTE53', 'HETZNER', 'MANUAL');

-- CreateEnum
CREATE TYPE "PathMatchType" AS ENUM ('EXACT', 'PREFIX', 'WILDCARD', 'REGEX', 'REGEX_CASE_INSENSITIVE');

-- CreateEnum
CREATE TYPE "RedirectStatusCode" AS ENUM ('MOVED_PERMANENTLY_301', 'FOUND_302', 'TEMPORARY_REDIRECT_307', 'PERMANENT_REDIRECT_308');

-- CreateEnum
CREATE TYPE "HeaderPhase" AS ENUM ('REQUEST', 'RESPONSE');

-- CreateEnum
CREATE TYPE "HeaderOperation" AS ENUM ('SET', 'ADD', 'REMOVE');

-- CreateEnum
CREATE TYPE "RateLimitPeriod" AS ENUM ('SECOND', 'MINUTE');

-- CreateEnum
CREATE TYPE "RateLimitKey" AS ENUM ('IP', 'IP_AND_PATH');

-- CreateEnum
CREATE TYPE "IpListType" AS ENUM ('ALLOWLIST', 'BLOCKLIST');

-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('NONE', 'BASIC', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PasswordHashAlgorithm" AS ENUM ('BCRYPT', 'APR1');

-- CreateEnum
CREATE TYPE "CacheMode" AS ENUM ('STATIC_ONLY', 'ALL');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('USER', 'BOOT', 'CERTIFICATE_RENEWAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'TOGGLE', 'APPLY', 'PURGE_CACHE', 'ISSUE_CERTIFICATE', 'RENEW_CERTIFICATE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT');

-- CreateEnum
CREATE TYPE "TrafficTopKind" AS ENUM ('IP', 'PATH');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ProxyHost" (
    "id" SERIAL NOT NULL,
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
    "sslMode" "SslMode" NOT NULL DEFAULT 'OFF',
    "certificateId" INTEGER,
    "forceHttps" BOOLEAN NOT NULL DEFAULT false,
    "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "hstsMaxAge" INTEGER NOT NULL DEFAULT 31536000,
    "hstsIncludeSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "hstsPreload" BOOLEAN NOT NULL DEFAULT false,
    "minTlsVersion" "TlsVersion" NOT NULL DEFAULT 'TLS_1_2',
    "originServerName" TEXT,
    "originTrustedCaPem" TEXT,
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cacheMode" "CacheMode" NOT NULL DEFAULT 'STATIC_ONLY',
    "cacheDefaultTtlSeconds" INTEGER NOT NULL DEFAULT 3600,
    "cacheRespectOriginHeaders" BOOLEAN NOT NULL DEFAULT true,
    "cacheServeStaleOnError" BOOLEAN NOT NULL DEFAULT true,
    "cacheLastPurgedAt" TIMESTAMP(3),
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
    "authMode" "AuthMode" NOT NULL DEFAULT 'NONE',
    "basicAuthRealmId" INTEGER,
    "externalAuthUrl" TEXT,
    "customDirectives" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostDomain" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamPool" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scheme" "UpstreamScheme" NOT NULL DEFAULT 'HTTP',
    "algorithm" "LoadBalancingAlgorithm" NOT NULL DEFAULT 'ROUND_ROBIN',
    "keepaliveConnections" INTEGER NOT NULL DEFAULT 32,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpstreamServer" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxFails" INTEGER NOT NULL DEFAULT 3,
    "failTimeoutSeconds" INTEGER NOT NULL DEFAULT 10,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "isDown" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpstreamServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "matchType" "PathMatchType" NOT NULL DEFAULT 'PREFIX',
    "upstreamPoolId" INTEGER,
    "rewritePath" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "websocketEnabled" BOOLEAN,
    "cacheEnabled" BOOLEAN,
    "clientMaxBodySizeMb" INTEGER,
    "authMode" "AuthMode",
    "basicAuthRealmId" INTEGER,
    "externalAuthUrl" TEXT,
    "customDirectives" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "acmeAccountId" INTEGER,
    "challengeType" "AcmeChallengeType",
    "dnsProviderId" INTEGER,
    "certificatePem" TEXT,
    "chainPem" TEXT,
    "privateKeyEncrypted" TEXT,
    "issuer" TEXT,
    "serialNumber" TEXT,
    "fingerprint" TEXT,
    "notBefore" TIMESTAMP(3),
    "notAfter" TIMESTAMP(3),
    "lastRenewAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateDomain" (
    "id" SERIAL NOT NULL,
    "certificateId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,

    CONSTRAINT "CertificateDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcmeAccount" (
    "id" SERIAL NOT NULL,
    "provider" "AcmeProvider" NOT NULL,
    "email" TEXT NOT NULL,
    "directoryUrl" TEXT NOT NULL,
    "accountUrl" TEXT,
    "accountKeyEncrypted" TEXT NOT NULL,
    "eabKeyId" TEXT,
    "eabHmacKeyEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcmeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsProvider" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DnsProviderType" NOT NULL,
    "credentialsEncrypted" TEXT,
    "propagationSeconds" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectRule" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchType" "PathMatchType" NOT NULL DEFAULT 'PREFIX',
    "sourcePath" TEXT NOT NULL DEFAULT '/',
    "targetUrl" TEXT NOT NULL,
    "statusCode" "RedirectStatusCode" NOT NULL DEFAULT 'MOVED_PERMANENTLY_301',
    "preservePath" BOOLEAN NOT NULL DEFAULT true,
    "preserveQuery" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedirectRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeaderRule" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "phase" "HeaderPhase" NOT NULL,
    "operation" "HeaderOperation" NOT NULL,
    "headerName" TEXT NOT NULL,
    "headerValue" TEXT,
    "always" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeaderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitRule" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "key" "RateLimitKey" NOT NULL DEFAULT 'IP',
    "requests" INTEGER NOT NULL,
    "period" "RateLimitPeriod" NOT NULL DEFAULT 'SECOND',
    "burst" INTEGER NOT NULL DEFAULT 0,
    "nodelay" BOOLEAN NOT NULL DEFAULT true,
    "zoneSizeMb" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpList" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "IpListType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpListEntry" (
    "id" SERIAL NOT NULL,
    "ipListId" INTEGER NOT NULL,
    "cidr" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostIpList" (
    "hostId" INTEGER NOT NULL,
    "ipListId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HostIpList_pkey" PRIMARY KEY ("hostId","ipListId")
);

-- CreateTable
CREATE TABLE "LocationIpList" (
    "locationId" INTEGER NOT NULL,
    "ipListId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocationIpList_pkey" PRIMARY KEY ("locationId","ipListId")
);

-- CreateTable
CREATE TABLE "BasicAuthRealm" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL DEFAULT 'Área restrita',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasicAuthRealm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasicAuthUser" (
    "id" SERIAL NOT NULL,
    "realmId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "hashAlgorithm" "PasswordHashAlgorithm" NOT NULL DEFAULT 'BCRYPT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasicAuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" SERIAL NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "DeploymentTrigger" NOT NULL DEFAULT 'USER',
    "triggeredById" INTEGER,
    "summary" TEXT NOT NULL,
    "fileHashes" JSONB,
    "nginxTestOutput" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "actorEmail" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficBucket" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
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
    "upstreamTimeSumMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficTopEntry" (
    "id" SERIAL NOT NULL,
    "hostId" INTEGER NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "kind" "TrafficTopKind" NOT NULL,
    "value" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bytesSent" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TrafficTopEntry_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyHost" ADD CONSTRAINT "ProxyHost_upstreamPoolId_fkey" FOREIGN KEY ("upstreamPoolId") REFERENCES "UpstreamPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyHost" ADD CONSTRAINT "ProxyHost_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyHost" ADD CONSTRAINT "ProxyHost_basicAuthRealmId_fkey" FOREIGN KEY ("basicAuthRealmId") REFERENCES "BasicAuthRealm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostDomain" ADD CONSTRAINT "HostDomain_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpstreamServer" ADD CONSTRAINT "UpstreamServer_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "UpstreamPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_upstreamPoolId_fkey" FOREIGN KEY ("upstreamPoolId") REFERENCES "UpstreamPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_basicAuthRealmId_fkey" FOREIGN KEY ("basicAuthRealmId") REFERENCES "BasicAuthRealm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_acmeAccountId_fkey" FOREIGN KEY ("acmeAccountId") REFERENCES "AcmeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_dnsProviderId_fkey" FOREIGN KEY ("dnsProviderId") REFERENCES "DnsProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateDomain" ADD CONSTRAINT "CertificateDomain_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedirectRule" ADD CONSTRAINT "RedirectRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeaderRule" ADD CONSTRAINT "HeaderRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeaderRule" ADD CONSTRAINT "HeaderRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitRule" ADD CONSTRAINT "RateLimitRule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitRule" ADD CONSTRAINT "RateLimitRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpListEntry" ADD CONSTRAINT "IpListEntry_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostIpList" ADD CONSTRAINT "HostIpList_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ProxyHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostIpList" ADD CONSTRAINT "HostIpList_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationIpList" ADD CONSTRAINT "LocationIpList_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationIpList" ADD CONSTRAINT "LocationIpList_ipListId_fkey" FOREIGN KEY ("ipListId") REFERENCES "IpList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasicAuthUser" ADD CONSTRAINT "BasicAuthUser_realmId_fkey" FOREIGN KEY ("realmId") REFERENCES "BasicAuthRealm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
