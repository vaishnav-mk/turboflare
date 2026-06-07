import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export const GENERATED_DIRECTORIES = new Set([".next", ".turbo", "dist", "node_modules"]);

export async function removeGeneratedDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (!entry.isDirectory()) {
        return;
      }

      if (GENERATED_DIRECTORIES.has(entry.name)) {
        await rm(path, { force: true, recursive: true });
        return;
      }

      await removeGeneratedDirectories(path);
    }),
  );
}
