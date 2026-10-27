import { Prisma } from "@prisma/client";
import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-errors.js";
import { ConfigValidationError, NginxReloadError, NginxTestError } from "../nginx/errors.js";

const HTTP_ERROR_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

/** Maps domain errors to JSON responses: { error, message, details? }. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: HTTP_ERROR_CODES[error.statusCode] ?? "REQUEST_ERROR",
        message: error.message,
        details: error.details,
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    if (error instanceof ConfigValidationError) {
      return reply.status(422).send({ error: "CONFIG_INVALID", message: error.message, details: { field: error.field } });
    }
    if (error instanceof NginxTestError) {
      return reply.status(422).send({
        error: "NGINX_TEST_FAILED",
        message: error.message,
        details: { diagnostics: error.diagnostics, output: error.output },
      });
    }
    if (error instanceof NginxReloadError) {
      return reply.status(500).send({ error: "NGINX_RELOAD_FAILED", message: error.message, details: { output: error.output } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = (error.meta?.target as string[] | undefined)?.join(", ");
        return reply.status(409).send({ error: "CONFLICT", message: `Já existe um registro com este valor${target ? ` (${target})` : ""}.` });
      }
      if (error.code === "P2025") {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Registro não encontrado." });
      }
      if (error.code === "P2003") {
        return reply.status(409).send({ error: "CONFLICT", message: "O registro está em uso por outro item." });
      }
    }
    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "unhandled error");
      return reply.status(statusCode).send({ error: "INTERNAL_ERROR", message: "Erro interno no servidor." });
    }
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH") {
      return reply.status(400).send({ error: "BAD_REQUEST", message: "O corpo da requisição não é um JSON válido." });
    }
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({ error: "PAYLOAD_TOO_LARGE", message: "O corpo da requisição é grande demais." });
    }
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply.status(415).send({ error: "UNSUPPORTED_MEDIA_TYPE", message: "Envie o corpo da requisição como JSON." });
    }
    if (statusCode === 429) {
      return reply.status(429).send({ error: "RATE_LIMITED", message: "Muitas tentativas. Aguarde um minuto e tente de novo." });
    }
    return reply.status(statusCode).send({ error: "REQUEST_ERROR", message: error.message });
  });
}
