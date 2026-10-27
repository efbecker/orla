-- AlterEnum
BEGIN;
CREATE TYPE "DnsProviderType_new" AS ENUM ('CLOUDFLARE', 'DIGITALOCEAN', 'HETZNER');
ALTER TABLE "DnsProvider" ALTER COLUMN "type" TYPE "DnsProviderType_new" USING ("type"::text::"DnsProviderType_new");
ALTER TYPE "DnsProviderType" RENAME TO "DnsProviderType_old";
ALTER TYPE "DnsProviderType_new" RENAME TO "DnsProviderType";
DROP TYPE "public"."DnsProviderType_old";
COMMIT;

