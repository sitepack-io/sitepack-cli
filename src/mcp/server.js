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
                'Build and translate pages on a SitePack site that a developer is currently '
                + 'watching a theme onto.\n\n'
                + 'Start with `site_context`: it says which site this is, whether staging is live, '
                + 'and which templates the theme declares. Everything written here is *staging* - '
                + 'served by staging-<domain> and invisible to visitors - and this session cannot '
                + 'publish, so a person still decides what goes live.\n\n'
                + 'Before writing an element tree, read `list_element_types`: settings keys that do '
                + 'not exist are accepted and then ignored at render time, so a wrong guess produces '
                + 'a page that is quietly wrong. After building a page, call `check_page_render` - '
                + 'a 201 from the API is not the same as a page that renders.',
        }
    );

    for (const tool of buildTools({ api, session })) {
        server.registerTool(tool.name, tool.config, input => runTool(tool.handler, input));
    }

    await server.connect(new StdioServerTransport());

    return server;
}
