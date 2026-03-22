import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a path segment case-insensitively within a directory.
 * Returns the actual filesystem entry name or null if not found.
 */
function findEntryInsensitive(dir: string, name: string): string | null {
    const exact = path.join(dir, name);
    try {
        fs.accessSync(exact);
        // On case-insensitive FS this succeeds even with wrong casing.
        // Use readdirSync to get the canonical casing.
        const entries = fs.readdirSync(dir);
        const match = entries.find(e => e.toLowerCase() === name.toLowerCase());
        return match ?? name;
    } catch {
        try {
            const entries = fs.readdirSync(dir);
            const match = entries.find(e => e.toLowerCase() === name.toLowerCase());
            return match ?? null;
        } catch {
            return null;
        }
    }
}

/**
 * Resolve a relative path against a base directory, performing
 * case-insensitive matching on each segment. Returns the resolved
 * path using the actual filesystem casing, or null if any segment
 * cannot be found.
 */
export function resolvePathInsensitive(baseDir: string, relative: string): string | null {
    const parts = relative.split(/[\\/]/);
    let current = baseDir;
    for (const part of parts) {
        if (part === '..' || part === '.') {
            current = path.resolve(current, part);
            continue;
        }
        const entry = findEntryInsensitive(current, part);
        if (!entry) return null;
        current = path.join(current, entry);
    }
    return fs.existsSync(current) ? current : null;
}

/**
 * Check if a file or directory exists case-insensitively within a
 * base directory. Returns the canonically-cased path or null.
 */
export function existsInsensitive(baseDir: string, name: string): string | null {
    return resolvePathInsensitive(baseDir, name);
}
