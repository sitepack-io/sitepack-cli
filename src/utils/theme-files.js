import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';

/** File types theme:publish and theme:watch upload, with the content type they send. */
export const THEME_FILE_TYPES = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
    'css': 'text/css', 'js': 'application/javascript', 'json': 'application/json',
    'pdf': 'application/pdf', 'woff': 'font/woff', 'woff2': 'font/woff2',
    'ttf': 'font/ttf', 'otf': 'font/otf', 'md': 'text/plain', 'twig': 'text/plain'
};

export const THEME_FOLDERS = ['assets', 'config', 'layouts', 'snippets', 'templates', 'translations'];

// The server only accepts these at the theme root. Uploading anything else there (a
// README, or this CLI's own sitepack.config.json) is rejected.
export const THEME_ROOT_FILES = ['theme.json', 'themes.json'];

/**
 * The .sitepackignore rules of a theme, plus what is never uploaded.
 *
 * @param {string} themeDir
 */
export async function loadThemeIgnore(themeDir) {
    const ig = ignore();
    ig.add(['.git', 'node_modules', '.sitepackignore']);

    const ignorePath = path.join(themeDir, '.sitepackignore');
    if (await fs.pathExists(ignorePath)) {
        ig.add(await fs.readFile(ignorePath, 'utf8'));
    }

    return ig;
}

/**
 * The files theme:publish uploads, as forward-slash paths relative to the theme root.
 *
 * @param {string} themeDir
 * @returns {Promise<string[]>}
 */
export async function listPublishableFiles(themeDir) {
    const ig = await loadThemeIgnore(themeDir);
    const files = await glob('**/*', {
        cwd: themeDir,
        nodir: true,
        dot: true,
        posix: true,
        ignore: ['node_modules/**', '.git/**'],
    });

    return files
        .map((file) => file.split(path.sep).join('/'))
        .filter((file) => {
            if (ig.ignores(file)) return false;
            if (!THEME_FILE_TYPES[path.extname(file).slice(1).toLowerCase()]) return false;
            const parts = file.split('/');
            if (parts.length === 1) return THEME_ROOT_FILES.includes(parts[0]);
            return THEME_FOLDERS.includes(parts[0]);
        })
        .sort();
}

/**
 * The sha256 of every file theme:publish would upload, the same way SitePack records
 * them, so the two can be compared.
 *
 * @param {string} themeDir
 * @returns {Promise<Record<string, string>>} relative path => sha256
 */
export async function hashThemeFiles(themeDir) {
    const hashes = {};
    for (const file of await listPublishableFiles(themeDir)) {
        const content = await fs.readFile(path.join(themeDir, file));
        hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
    }

    return hashes;
}

/**
 * One hash for a whole set of files: equal sets give equal hashes.
 *
 * @param {Record<string, string>} files relative path => sha256
 */
export function combinedHash(files) {
    const hash = crypto.createHash('sha256');
    for (const file of Object.keys(files).sort()) {
        hash.update(`${file}\0${files[file]}\n`);
    }

    return hash.digest('hex');
}

/**
 * What differs between two file sets.
 *
 * @param {Record<string, string>} local
 * @param {Record<string, string>} remote
 * @returns {{ changed: string[], added: string[], removed: string[] }}
 */
export function compareFiles(local, remote) {
    const changed = [];
    const added = [];
    for (const [file, sha] of Object.entries(local)) {
        if (!(file in remote)) added.push(file);
        else if (remote[file] !== sha) changed.push(file);
    }
    const removed = Object.keys(remote).filter((file) => !(file in local));

    return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}
