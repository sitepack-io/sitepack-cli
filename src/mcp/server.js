import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppApi } from './api.js';
import { buildTools, runTool } from './tools.js';

/**
 * The MCP server behind `sitepack mcp`.
 *
 * It speaks stdio, so an editor starts it and talks to it over the pipe; nothing is
 * listening on a port and no token leaves the machine. Everything it can do goes through
 * the app API with the development session's token, which means the server-side scope
 * check is the real boundary - this process is a convenience, not a privilege.
 */
export async function startMcpServer(session, { version }) {
    const api = new AppApi(session.base_url, session.access_token);

    const server = new McpServer(
        { name: 'sitepack', version },
        {
            instructions:
                'Build pages, menus and the online store on a SitePack site that a developer is '
                + 'currently watching a theme onto.\n\n'
                + 'Start with `site_context`: it says which site this is, the staging URL and the '
                + 'scopes this session holds. Pages default to *staging* - served by '
                + 'staging-<domain> and invisible to visitors - which is the safe way to build on '
                + 'a live site. You can publish a page (status "published"), but that puts it in '
                + 'front of real visitors, so ask the person first rather than deciding to go live '
                + 'yourself. Categories and products have no staging: those are written to the '
                + 'live store straight away.\n\n'
                + 'After building a page, call `check_page_render` - a 201 from the API is not the '
                + 'same as a page that renders.',
        }
    );

    for (const tool of buildTools({ api, session })) {
        server.registerTool(tool.name, tool.config, input => runTool(tool.handler, input));
    }

    await server.connect(new StdioServerTransport());

    return server;
}
