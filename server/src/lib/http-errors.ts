/** Error with an HTTP status and a PT-BR message safe to show in the UI. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Autenticação necessária.") => new HttpError(401, message);
export const forbidden = (message = "Você não tem permissão para esta ação.") => new HttpError(403, message);
export const notFound = (message = "Registro não encontrado.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
