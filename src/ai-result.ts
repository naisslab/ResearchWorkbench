import type { AIResult } from "./types";

export async function unwrap<T>(promise: Promise<AIResult<T>>) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
