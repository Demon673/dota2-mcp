import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/** Resolve existing ancestors too, so new files cannot escape through a link. */
function physicalPath(target: string): string {
  let ancestor = target;
  for (;;) {
    try { lstatSync(ancestor); }
    catch (e: any) {
      if (e.code !== "ENOENT" || path.dirname(ancestor) === ancestor) throw e;
      ancestor = path.dirname(ancestor);
      continue;
    }
    return path.resolve(realpathSync(ancestor), path.relative(ancestor, target));
  }
}

function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/** An addon/output root may itself be linked; descendants must stay in it. */
export function isPathWithin(root: string, target: string): boolean {
  root = path.resolve(root);
  target = path.resolve(target);
  return contains(root, target) && contains(physicalPath(root), physicalPath(target));
}
