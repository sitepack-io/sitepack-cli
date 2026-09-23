import fs from 'fs-extra';
import os from 'os';
import path from 'path';

/**
 * The development session `theme:watch` leaves behind for the MCP server to pick up.
 *
 * The two processes cannot talk directly - the editor starts the MCP server, not the
 * developer - so the watch writes what it learned (which site, which token, until when)
 * and the MCP server reads it. Keyed by theme uuid, because a developer may well be
 * watching two themes in two terminals and each one is a session of its own.
 *
 * The file holds an access token, so it is written 0600 and lives in the home directory
 * rather than in the theme, where it would be one `git add .` away from a public repo.
 */
const SESSION_FILE = () => path.join(os.homedir(), '.sitepack', 'dev-sessions.json');

async function readAll() {
    const file = SESSION_FILE();

    if (!(await fs.pathExists(file))) {
        return {};
    }

    try {
        const sessions = await fs.readJson(file);

        return sessions && typeof sessions === 'object' ? sessions : {};
    } catch (err) {
        // A corrupted store is not worth an error: the watch that owns the session will
        // write a fresh one within seconds.
        return {};
    }
}

/**
 * Record the session a watch just opened.
 *
 * @param {string} themeUuid
 * @param {{access_token: string, expires: string, scopes: string[], site: object, base_url: string, theme_name?: string, theme_dir: string}} session
 */
export async function saveSession(themeUuid, session) {
    const file = SESSION_FILE();
    await fs.ensureDir(path.dirname(file));

    const sessions = await readAll();
    sessions[themeUuid] = { ...session, saved_at: new Date().toISOString() };

    await fs.writeJson(file, sessions, { mode: 0o600, spaces: 2 });
    await fs.chmod(file, 0o600);
}

/**
 * Forget a session. Called when a watch stops: the token stays valid server-side until it
 * expires, but nothing on this machine should keep offering it.
 *
 * @param {string} themeUuid
 */
export async function clearSession(themeUuid) {
    const file = SESSION_FILE();

    if (!(await fs.pathExists(file))) {
        return;
    }

    const sessions = await readAll();

    if (sessions[themeUuid] === undefined) {
        return;
    }

    delete sessions[themeUuid];

    await fs.writeJson(file, sessions, { mode: 0o600, spaces: 2 });
}

/**
 * The session for a theme, or null when there is none that is still usable.
 *
 * An expired session is treated as absent rather than returned with a flag: every caller
 * would have to check the flag, and the one that forgot would produce a 401 the agent
 * cannot act on. "No session" it can act on - it means start the watch.
 *
 * @param {string} themeUuid
 * @returns {Promise<object|null>}
 */
export async function getSession(themeUuid) {
    const sessions = await readAll();
    const session = sessions[themeUuid];

    if (!session || !session.access_token) {
        return null;
    }

    if (session.expires && new Date(session.expires).getTime() <= Date.now()) {
        return null;
    }

    return session;
}

/**
 * Every live session, newest first. Used when the MCP server was started outside a theme
 * directory and has to work out which one it is for.
 *
 * @returns {Promise<Array<{theme_uuid: string} & object>>}
 */
export async function listSessions() {
    const sessions = await readAll();

    return Object.entries(sessions)
        .map(([themeUuid, session]) => ({ theme_uuid: themeUuid, ...session }))
        .filter(session => !session.expires || new Date(session.expires).getTime() > Date.now())
        .sort((a, b) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')));
}
