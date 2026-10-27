import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "@/lib/api";

/**
 * Copies field-level issues from a 400 response onto the form. `mapPath`
 * translates API paths ("domains.0") to form fields; unknown paths are skipped.
 * Returns true when at least one issue was attached to a field.
 */
export function applyServerIssues<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  mapPath: (apiPath: string) => Path<T> | null,
): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const issue of error.issues) {
    const field = mapPath(issue.path);
    if (!field) continue;
    setError(field, { type: "server", message: issue.message });
    applied = true;
  }
  return applied;
}
