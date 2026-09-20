import type { ViewId } from "./types.js";

export function viewIdKey(id: ViewId): string {
  return `${id.path.join("/")}#${id.irId}`;
}
