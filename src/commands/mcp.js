import fs from 'fs-extra';
import path from 'path';
import { createRequire } from 'module';
import { getSession, listSessions } from '../mcp/session.js';
import { startMcpServer } from '../mcp/server.js';

const require = createRequire(import.meta.url);

/**
 * Everything this command says goes to stderr.
 *
 * stdout is the MCP transport: one stray line of chalk on it and the client sees a
 * protocol error rather than a message.
 */
const say = (message) => process.stderr.write(`${message}\n`);

export default function(program) {
    program
        .command('mcp')
        .description('Run the MCP server for the theme being watched (for AI editors)')
        .option('--theme <uuid>', 'Which watch session to use, when several are running')
        .action(async (options) => {
            const session = await resolveSession(options.theme);

            if (!session) {
                say(
                    'No development session found.\n\n'
                    + 'The MCP server works with the session that "sitepack theme:watch" opens: it '
                    + 'is what knows which site you are building on and holds the token for it.\n\n'
                    + 'Run "sitepack theme:watch" in your theme directory, then start this again.'
                );
                process.exitCode = 1;

                return;
            }

            const pkg = require('../../package.json');

            say(`SitePack MCP server ready — ${session.site?.name || session.site?.uuid} (staging)`);

            await startMcpServer(session, { version: pkg.version });
        });
}

/**
 * Which session this server is for.
 *
 * The theme in the current directory wins: an editor starts this from the project it has
 * open, and that is the project the developer means. Only when that yields nothing does it
 * fall back to the most recent session, which is what makes the command work when the
 * editor's working directory is somewhere else entirely.
 *
 * @param {string|undefined} requestedTheme
 */
async function resolveSession(requestedTheme) {
    if (requestedTheme) {
        return getSession(requestedTheme);
    }

    const themeJsonPath = path.resolve(process.cwd(), 'theme.json');

    if (await fs.pathExists(themeJsonPath)) {
        try {
            const { uuid } = await fs.readJson(themeJsonPath);

            if (uuid) {
                const session = await getSession(uuid);

                if (session) {
                    return session;
                }

                say(`No live watch session for the theme in this directory (${uuid}).`);
            }
        } catch (err) {
            say(`theme.json here could not be read: ${err.message}`);
        }
    }

    const sessions = await listSessions();

    if (sessions.length === 0) {
        return null;
    }

    if (sessions.length > 1) {
        say(
            `${sessions.length} watch sessions are running; using the most recent `
            + `(${sessions[0].theme_name || sessions[0].theme_uuid}). `
            + 'Pass --theme <uuid> to pick another.'
        );
    }

    return sessions[0];
}
