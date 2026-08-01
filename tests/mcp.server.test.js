import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppApi } from '../src/mcp/api.js';
import { buildTools, runTool } from '../src/mcp/tools.js';

/**
 * The MCP server, driven the way an editor drives it: over the protocol, against an app
 * API that answers like the real one.
 *
 * A stub server rather than mocked axios, because what is worth testing here is the whole
 * path - the request the tool builds, the token it sends, the error it turns a 409 into.
 * Mocking the HTTP client would leave exactly those untested.
 */
describe('sitepack mcp', () => {
    let api;
    let baseUrl;
    /** @type {Array<{method: string, url: string, body: any, auth: string|undefined}>} */
    let calls;
    /** Per-path canned answers, so a test can decide what the API says. */
    let answers;

    beforeAll(async () => {
        api = http.createServer((req, res) => {
            let raw = '';
            req.on('data', chunk => { raw += chunk; });
            req.on('end', () => {
                const url = new URL(req.url, 'http://localhost');
                const key = `${req.method} ${url.pathname}`;

                calls.push({
                    method: req.method,
                    url: req.url,
                    body: raw ? JSON.parse(raw) : null,
                    auth: req.headers.authorization,
                });

                const answer = answers[key];

                if (!answer) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', error: { code: 'not_found', message: `No stub for ${key}` } }));

                    return;
                }

                res.writeHead(answer.status || 200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(answer.body));
            });
        });

        await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${api.address().port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => api.close(resolve));
    });

    const session = () => ({
        base_url: baseUrl,
        access_token: 'test-session-token',
        theme_uuid: '019f0000-0000-7000-8000-000000000001',
        theme_name: 'Website',
        theme_dir: null,
        scopes: ['content:staging', 'navigation:write'],
        site: {
            uuid: '019f0000-0000-7000-8000-000000000002',
            name: 'SitePack',
            domain: 'en-sitepack-bv.sitepack.app',
            staging: {
                host: 'staging-en-sitepack-bv.sitepack.app',
                url: 'https://staging-en-sitepack-bv.sitepack.app',
            },
        },
    });

    /** A connected MCP client talking to the real server over an in-memory pipe. */
    const connect = async () => {
        calls = [];

        const server = new McpServer({ name: 'sitepack', version: 'test' });

        for (const tool of buildTools({ api: new AppApi(baseUrl, 'test-session-token'), session: session() })) {
            server.registerTool(tool.name, tool.config, input => runTool(tool.handler, input));
        }

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test', version: 'test' });

        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

        return client;
    };

    /** The JSON a tool answered with. */
    const resultOf = (response) => JSON.parse(response.content[0].text);

    beforeAll(() => {
        answers = {};
    });

    it('offers the tools an agent needs to build a page, each described', async () => {
        const client = await connect();
        const { tools } = await client.listTools();
        const names = tools.map(tool => tool.name);

        expect(names).toContain('site_context');
        expect(names).toContain('list_element_types');
        expect(names).toContain('create_staging_page');
        expect(names).toContain('check_page_render');

        for (const tool of tools) {
            expect(tool.description, `${tool.name} has no description`).toBeTruthy();
        }
    });

    it('answers site_context from the site and the theme templates at once', async () => {
        answers = {
            'GET /api/public/v1/site': {
                body: {
                    status: 'success',
                    site: { uuid: 'site-uuid', name: 'SitePack', staging: { available: true, url: 'https://staging-x' } },
                },
            },
            'GET /api/public/v1/theme/templates': {
                body: {
                    status: 'success',
                    watching: true,
                    templates: [{ key: 'pricing', name: 'Pricing', staging: true, fields: [] }],
                },
            },
        };

        const client = await connect();
        const result = resultOf(await client.callTool({ name: 'site_context', arguments: {} }));

        expect(result.site.staging.available).toBe(true);
        expect(result.watching).toBe(true);
        expect(result.templates[0].key).toBe('pricing');
        expect(result.theme.name).toBe('Website');

        // The session token, on every call, as a bearer token.
        expect(calls.every(call => call.auth === 'Bearer test-session-token')).toBe(true);
    });

    it('creates pages as staging and hands back where to look at them', async () => {
        answers = {
            'POST /api/public/v1/content': {
                status: 201,
                body: {
                    status: 'success',
                    content: { uuid: 'page-uuid', title: 'Prijzen', slug: 'prijzen', status: 'staging' },
                },
            },
        };

        const client = await connect();
        const result = resultOf(await client.callTool({
            name: 'create_staging_page',
            arguments: { title: 'Prijzen', slug: 'prijzen', template_key: 'pricing' },
        }));

        // Never the caller's choice: the tool writes staging or it writes nothing.
        expect(calls[0].body.status).toBe('staging');
        expect(calls[0].body.template_key).toBe('pricing');
        expect(result.staging_url).toBe('https://staging-en-sitepack-bv.sitepack.app/prijzen');
        expect(result.next).toContain('check_page_render');
    });

    it('turns an API refusal into something the agent can act on', async () => {
        answers = {
            'POST /api/public/v1/content': {
                status: 409,
                body: {
                    status: 'error',
                    error: {
                        code: 'no_watch_theme',
                        message: 'Staging content needs a theme in watch mode on this site.',
                    },
                },
            },
        };

        const client = await connect();
        const response = await client.callTool({ name: 'create_staging_page', arguments: { title: 'Prijzen' } });

        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain('theme:watch');
    });

    it('adds menu entries as staging, so the live menu never gains a broken link', async () => {
        answers = {
            'POST /api/public/v1/navigations/main/items': {
                status: 201,
                body: { status: 'success', item: { uuid: 'item-uuid', label: 'Prijzen', staging: true } },
            },
        };

        const client = await connect();

        const added = resultOf(await client.callTool({
            name: 'add_navigation_item',
            arguments: { section: 'main', label: 'Prijzen', url: '/prijzen', content_uuid: 'page-uuid' },
        }));

        // Not the caller's choice, for the same reason pages are not: a menu is shared with
        // production, so an entry for a page that only exists on staging belongs there too.
        expect(calls[0].body.staging).toBe(true);
        expect(added.item.uuid).toBe('item-uuid');
    });

    it('reports a page that renders as broken when the response carries a twig error', async () => {
        const site = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><title>Oops</title>Twig\\Error\\SyntaxError: Unknown "pricing_plans" function</html>');
        });

        await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));

        const stagingUrl = `http://127.0.0.1:${site.address().port}`;

        const server = new McpServer({ name: 'sitepack', version: 'test' });
        const themeSession = { ...session(), site: { ...session().site, staging: { url: stagingUrl } } };

        for (const tool of buildTools({ api: new AppApi(baseUrl, 'test-session-token'), session: themeSession })) {
            server.registerTool(tool.name, tool.config, input => runTool(tool.handler, input));
        }

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test', version: 'test' });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

        calls = [];
        const result = resultOf(await client.callTool({ name: 'check_page_render', arguments: { path: '/prijzen' } }));

        // A 200 is not the same as a page that works, which is the entire point of the tool.
        expect(result.status).toBe(200);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);

        await new Promise(resolve => site.close(resolve));
    });
});
