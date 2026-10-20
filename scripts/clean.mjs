// Removes the tsc output so that deleted sources leave no stale modules behind.
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await rm(join(root, 'public', 'app'), { recursive: true, force: true });
await rm(join(root, 'build'), { recursive: true, force: true });
await rm(join(root, 'public', 'sw.js'), { force: true });
