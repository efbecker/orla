import type { CompiledFile } from "../types.js";
import { comment, render, type ConfigNode } from "../builder.js";
import { FILE_MODE, type FileRef } from "./files.js";

export const MANAGED_HEADER = "Managed by Orla. Do not edit: this file is regenerated from the database.";

export function configFile(ref: FileRef, nodes: ConfigNode[], description: string): CompiledFile {
  return {
    ...ref,
    content: render([comment(MANAGED_HEADER), comment(description), { kind: "blank" }, ...nodes]),
    mode: FILE_MODE,
  };
}

export function textFile(ref: FileRef, content: string, mode = FILE_MODE): CompiledFile {
  return { ...ref, content, mode };
}

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
