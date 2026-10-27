import { z } from "zod";
import { badRequest } from "./http-errors.js";

/** Parses input with Zod, turning failures into a 400 with field-level issues. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    throw badRequest("Dados inválidos.", issues);
  }
  return result.data;
}

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginate(query: z.infer<typeof paginationQuery>) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** Converts BigInt fields (traffic counters) to numbers for JSON responses. */
export function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? Number(item) : item))) as T;
}
