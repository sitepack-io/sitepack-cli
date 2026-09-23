import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { z } from 'zod';
import { AppApiError } from './api.js';

/**
 * The tools the MCP server offers, in one place.
 *
 * Two rules shape this list.
 *
 * First, a tool answers a question an agent actually has, rather than mirroring an
 * endpoint. `site_context` is one call because "where am I, can I write staging, what can
 * this theme render" is one question; splitting it over three endpoints only invites two
 * of them to be skipped.
 *
 * Second, every write answers with what to look at next. A page that was created returns
 * its staging URL, and `check_page_render` fetches it - so an agent can see that what it
 * built renders, instead of reporting success because an API returned 201.
 */

/**
 * @param {object} deps
 * @param {import('./api.js').AppApi} deps.api
 * @param {object} deps.session
 * @returns {Array<{name: string, config: object, handler: Function}>}
 */
export function buildTools({ api, session }) {
    const themeDir = session.theme_dir;

    /**
     * The theme.json in the developer's working copy.
     *
     * The server knows the theme it was last streamed; the working copy is what the
     * developer has open right now. A template added a minute ago and not yet saved to a
     * watched file exists here and nowhere else, which is exactly the sort of thing an
     * agent otherwise reports as "that template does not exist".
     */
    const localTheme = async () => {
        if (!themeDir) {
            return null;
        }

        const file = path.join(themeDir, 'theme.json');

        if (!(await fs.pathExists(file))) {
            return null;
        }

        try {
            return await fs.readJson(file);
        } catch (err) {
            return { error: `theme.json in ${themeDir} is not valid JSON: ${err.message}` };
        }
    };

    const stagingUrl = (slug) => {
        const staging = session.site && session.site.staging;

        if (!staging || !staging.url) {
            return null;
        }

        return `${staging.url.replace(/\/+$/, '')}/${String(slug || '').replace(/^\/+/, '')}`;
    };

    return [
        {
            name: 'site_context',
            config: {
                title: 'Site context',
                description:
                    'Where this development session points and what it may do: the site, the '
                    + 'staging URL, the scopes this session holds, and the theme.json in the '
                    + 'working copy. Call this before building anything. Pages default to staging '
                    + '(invisible to visitors, served by staging-<domain>); publishing is possible '
                    + 'but should be a person\'s decision, asked for per page.',
                inputSchema: {},
            },
            handler: async () => {
                const [site, local] = await Promise.all([
                    api.get('/site'),
                    localTheme(),
                ]);

                return {
                    site: site.site,
                    staging_url: (session.site && session.site.staging && session.site.staging.url) || null,
                    scopes: session.scopes,
                    session_expires: session.expires,
                    theme: {
                        uuid: session.theme_uuid,
                        name: session.theme_name,
                        directory: themeDir || null,
                        // Straight from the working copy: newer than anything the server has
                        // if the developer is mid-edit.
                        local_config: local,
                    },
                };
            },
        },

        {
            name: 'list_pages',
            config: {
                title: 'List pages',
                description:
                    'The pages of this site. Filter by `status: "staging"` to see only what this '
                    + 'session has built.',
                inputSchema: {
                    status: z.enum(['published', 'draft', 'staging']).optional(),
                    search: z.string().optional().describe('Free text over title and slug'),
                    limit: z.number().int().min(1).max(100).optional(),
                },
            },
            handler: async ({ status, search, limit }) => {
                const response = await api.get('/content', {
                    status,
                    q: search,
                    limit: limit ?? 100,
                });

                return {
                    total: response.pagination && response.pagination.totalRecords,
                    pages: response.items,
                };
            },
        },

        {
            name: 'get_page',
            config: {
                title: 'Get a page',
                description: 'One page with its element tree, template fields and SEO metadata.',
                inputSchema: {
                    uuid: z.string().describe('The page uuid'),
                },
            },
            handler: async ({ uuid }) => {
                const response = await api.get(`/content/${uuid}`);

                return {
                    page: response.content,
                    staging_url: stagingUrl(response.content.slug),
                };
            },
        },

        {
            name: 'create_page',
            config: {
                title: 'Create a page',
                description:
                    'Create a page on the site. It defaults to `staging` - served only by '
                    + 'staging-<domain> and invisible to visitors, which is the safe way to build '
                    + 'on a live site. Pass `status: "published"` to put it live straight away, or '
                    + '`"draft"` to keep it out of both. Bind it to a theme template with '
                    + '`template_key` and fill that template through `template_fields`, or build '
                    + 'it from blocks with `elements`.',
                inputSchema: {
                    title: z.string().describe('The page title'),
                    status: z
                        .enum(['staging', 'published', 'draft'])
                        .optional()
                        .describe('Defaults to "staging". "published" makes it live; ask a person before doing that.'),
                    slug: z.string().optional().describe('URL segment; derived from the title when left out'),
                    parent_uuid: z.string().optional().describe('Nest the page under another page'),
                    template_key: z.string().optional().describe('A template from site_context'),
                    template_fields: z
                        .record(z.string(), z.union([z.string(), z.array(z.string())]))
                        .optional()
                        .describe('Values for that template\'s own fields, keyed by field key'),
                    elements: z
                        .array(z.record(z.string(), z.any()))
                        .optional()
                        .describe('The element tree, for a page that is not template-driven'),
                    seo: z
                        .object({
                            custom_title: z.string().optional(),
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                            no_index: z.boolean().optional(),
                        })
                        .optional(),
                },
            },
            handler: async ({ status, ...input }) => {
                const response = await api.post('/content', { ...input, status: status || 'staging' });

                return {
                    page: response.content,
                    staging_url: stagingUrl(response.content.slug),
                    next: 'Call check_page_render with this uuid to see whether it actually renders.',
                };
            },
        },

        {
            name: 'update_page',
            config: {
                title: 'Update a page',
                description:
                    'Change a page: its title, slug, parent, template binding, template fields, '
                    + 'SEO or status. Only the fields you send are written. Pass '
                    + '`status: "published"` to take a staging page live, or `"staging"` to pull a '
                    + 'live page back to staging - a person should decide when a page goes live.',
                inputSchema: {
                    uuid: z.string(),
                    title: z.string().optional(),
                    status: z.enum(['staging', 'published', 'draft']).optional(),
                    slug: z.string().optional(),
                    parent_uuid: z.string().nullable().optional(),
                    template_key: z.string().optional(),
                    template_fields: z
                        .record(z.string(), z.union([z.string(), z.array(z.string())]))
                        .optional(),
                    seo: z
                        .object({
                            custom_title: z.string().optional(),
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                            no_index: z.boolean().optional(),
                        })
                        .optional(),
                },
            },
            handler: async ({ uuid, ...changes }) => {
                const response = await api.patch(`/content/${uuid}`, changes);

                return {
                    page: response.content,
                    staging_url: stagingUrl(response.content.slug),
                };
            },
        },

        {
            name: 'set_page_elements',
            config: {
                title: 'Replace page elements',
                description:
                    'Replace a page\'s whole element tree, in render order. Sending an empty array '
                    + 'empties the page. Use list_element_types first: inline `style=` attributes '
                    + 'are stripped and scripting removed, and settings keys that do not exist are '
                    + 'silently ignored at render time.',
                inputSchema: {
                    uuid: z.string(),
                    elements: z.array(z.record(z.string(), z.any())),
                },
            },
            handler: async ({ uuid, elements }) => {
                const response = await api.put(`/content/${uuid}/elements`, { elements });

                return { uuid: response.uuid, elements: response.elements };
            },
        },

        {
            name: 'check_slug',
            config: {
                title: 'Check a slug is free',
                description:
                    'Whether a slug is still available. Slugs are unique per parent page, not per '
                    + 'site, so pass `parent_uuid` when the page will be nested.',
                inputSchema: {
                    slug: z.string(),
                    parent_uuid: z.string().optional(),
                },
            },
            handler: ({ slug, parent_uuid }) =>
                api.get('/content/validate-slug', { slug, parent_uuid }),
        },

        {
            name: 'delete_page',
            config: {
                title: 'Delete a page',
                description: 'Remove a page and its revisions from the site.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                await api.delete(`/content/${uuid}`);

                return { deleted: uuid };
            },
        },

        {
            name: 'list_navigation',
            config: {
                title: 'List navigation',
                description:
                    'The menus of this site and their items. Leave `section` out for the list of '
                    + 'menus; pass one (e.g. "main") for its items, each with its parent and the '
                    + 'page or category it points at.',
                inputSchema: {
                    section: z.string().optional().describe('e.g. "main" or "footer"'),
                },
            },
            handler: async ({ section }) => {
                if (!section) {
                    return api.get('/navigations');
                }

                return api.get(`/navigations/${section}/items`);
            },
        },

        {
            name: 'add_navigation_item',
            config: {
                title: 'Add a navigation item',
                description:
                    'Add an entry to a menu, optionally nested under another with `parent_uuid`. '
                    + 'Point it at a page with `content_uuid`: an item that leads to a staging page '
                    + 'is hidden on the live site until that page is published, so a menu entry for '
                    + 'a page you are still building never reaches visitors early.',
                inputSchema: {
                    section: z.string().describe('The menu, e.g. "main"'),
                    label: z.string(),
                    url: z.string().describe('Path or absolute URL, e.g. "/prijzen"'),
                    content_uuid: z.string().optional().describe('The page this item points at'),
                    parent_uuid: z.string().optional().describe('Nest under another item'),
                    sort_order: z.number().int().optional(),
                    display_as_button: z.boolean().optional(),
                },
            },
            handler: async ({ section, ...item }) => {
                const response = await api.post(`/navigations/${section}/items`, item);

                return { item: response.item };
            },
        },

        {
            name: 'update_navigation_item',
            config: {
                title: 'Update a navigation item',
                description: 'Change a menu item\'s label, URL, position or parent.',
                inputSchema: {
                    uuid: z.string(),
                    label: z.string().optional(),
                    url: z.string().optional(),
                    sort_order: z.number().int().optional(),
                    parent_uuid: z.string().nullable().optional(),
                    display_as_button: z.boolean().optional(),
                },
            },
            handler: async ({ uuid, ...changes }) => {
                const response = await api.patch(`/navigations/items/${uuid}`, changes);

                return { item: response.item };
            },
        },

        {
            name: 'remove_navigation_item',
            config: {
                title: 'Remove a navigation item',
                description: 'Delete one item from a menu.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                await api.delete(`/navigations/items/${uuid}`);

                return { deleted: uuid };
            },
        },

        {
            name: 'list_media',
            config: {
                title: 'List media',
                description:
                    'The site\'s media library, so a page can reference an image that exists '
                    + 'rather than a URL that does not.',
                inputSchema: {
                    search: z.string().optional(),
                    limit: z.number().int().min(1).max(100).optional(),
                },
            },
            handler: async ({ search, limit }) => {
                const response = await api.get('/media', { q: search, limit: limit ?? 50 });

                return { total: response.pagination && response.pagination.totalRecords, media: response.items };
            },
        },

        {
            name: 'list_categories',
            config: {
                title: 'List categories',
                description:
                    'The categories of this site. Product categories organise the online store; '
                    + 'filter with `type: "product"` for those, or `type: "blog"` for blog '
                    + 'categories.',
                inputSchema: {
                    type: z.enum(['product', 'blog']).optional(),
                    search: z.string().optional().describe('Free text over the category name'),
                    limit: z.number().int().min(1).max(100).optional(),
                },
            },
            handler: async ({ type, search, limit }) => {
                const response = await api.get('/categories', { type, q: search, limit: limit ?? 100 });

                return {
                    total: response.pagination && response.pagination.totalRecords,
                    categories: response.items,
                };
            },
        },

        {
            name: 'get_category',
            config: {
                title: 'Get a category',
                description: 'One category with its name, slug, type and SEO metadata.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                const response = await api.get(`/categories/${uuid}`);

                return { category: response.category };
            },
        },

        {
            name: 'create_category',
            config: {
                title: 'Create a category',
                description:
                    'Create an online-store category. Defaults to a product category; pass '
                    + '`type: "blog"` for a blog category. Nest it under another with '
                    + '`parent_uuid`. Unlike pages, categories are live straight away - there is '
                    + 'no staging for the store, so only create ones that are meant to be seen.',
                inputSchema: {
                    name: z.string().describe('The category name'),
                    slug: z.string().optional().describe('URL segment; derived from the name when left out'),
                    type: z.enum(['product', 'blog']).optional().describe('Defaults to "product"'),
                    parent_uuid: z.string().optional().describe('Nest under another category'),
                    seo: z
                        .object({
                            custom_title: z.string().optional(),
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                        })
                        .optional(),
                },
            },
            handler: async ({ type, ...input }) => {
                const response = await api.post('/categories', { ...input, type: type || 'product' });

                return { category: response.category };
            },
        },

        {
            name: 'update_category',
            config: {
                title: 'Update a category',
                description:
                    'Change a category: its name, slug, parent or SEO. Only the fields you send '
                    + 'are written.',
                inputSchema: {
                    uuid: z.string(),
                    name: z.string().optional(),
                    slug: z.string().optional(),
                    parent_uuid: z.string().nullable().optional(),
                    seo: z
                        .object({
                            custom_title: z.string().optional(),
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                        })
                        .optional(),
                },
            },
            handler: async ({ uuid, ...changes }) => {
                const response = await api.patch(`/categories/${uuid}`, changes);

                return { category: response.category };
            },
        },

        {
            name: 'delete_category',
            config: {
                title: 'Delete a category',
                description: 'Remove a category from the site.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                await api.delete(`/categories/${uuid}`);

                return { deleted: uuid };
            },
        },

        {
            name: 'list_products',
            config: {
                title: 'List products',
                description:
                    'The products of this site\'s online store. Filter by free text, sku or '
                    + 'barcode.',
                inputSchema: {
                    search: z.string().optional().describe('Free text over the product name'),
                    sku: z.string().optional(),
                    barcode: z.string().optional(),
                    limit: z.number().int().min(1).max(100).optional(),
                },
            },
            handler: async ({ search, sku, barcode, limit }) => {
                const response = await api.get('/products', { q: search, sku, barcode, limit: limit ?? 100 });

                return {
                    total: response.pagination && response.pagination.totalRecords,
                    products: response.items,
                };
            },
        },

        {
            name: 'get_product',
            config: {
                title: 'Get a product',
                description: 'One product with its price, stock, identifiers and SEO metadata.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                const response = await api.get(`/products/${uuid}`);

                return { product: response.product };
            },
        },

        {
            name: 'create_product',
            config: {
                title: 'Create a product',
                description:
                    'Create a product in the online store. Prices are in cents (EUR), so €19.95 '
                    + 'is `1995`. Like categories, products are live straight away - there is no '
                    + 'staging for the store.',
                inputSchema: {
                    name: z.string().describe('The product name'),
                    price_cents: z.number().int().min(0).describe('Price in cents, e.g. 1995 for €19.95'),
                    slug: z.string().optional(),
                    stock: z.number().int().optional().describe('Defaults to 0'),
                    sku: z.string().optional(),
                    barcode: z.string().optional(),
                    brand: z.string().optional(),
                    model: z.string().optional(),
                    description: z.string().optional(),
                    price_promo_cents: z.number().int().min(0).optional().describe('Sale price in cents'),
                    archived: z.boolean().optional(),
                    seo: z
                        .object({
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                        })
                        .optional(),
                },
            },
            handler: async (input) => {
                const response = await api.post('/products', input);

                return { product: response.product };
            },
        },

        {
            name: 'update_product',
            config: {
                title: 'Update a product',
                description:
                    'Change a product: name, price, stock, identifiers, description or SEO. Only '
                    + 'the fields you send are written. Prices are in cents.',
                inputSchema: {
                    uuid: z.string(),
                    name: z.string().optional(),
                    price_cents: z.number().int().min(0).optional(),
                    slug: z.string().optional(),
                    stock: z.number().int().optional(),
                    sku: z.string().optional(),
                    barcode: z.string().optional(),
                    brand: z.string().optional(),
                    model: z.string().optional(),
                    description: z.string().optional(),
                    price_promo_cents: z.number().int().min(0).optional(),
                    archived: z.boolean().optional(),
                    seo: z
                        .object({
                            meta_description: z.string().optional(),
                            focus_keyword: z.string().optional(),
                        })
                        .optional(),
                },
            },
            handler: async ({ uuid, ...changes }) => {
                const response = await api.patch(`/products/${uuid}`, changes);

                return { product: response.product };
            },
        },

        {
            name: 'delete_product',
            config: {
                title: 'Delete a product',
                description: 'Remove a product from the store.',
                inputSchema: { uuid: z.string() },
            },
            handler: async ({ uuid }) => {
                await api.delete(`/products/${uuid}`);

                return { deleted: uuid };
            },
        },

        {
            name: 'check_page_render',
            config: {
                title: 'Check a page renders',
                description:
                    'Fetch a staging page over HTTP and report what came back: status, size, page '
                    + 'title, and any twig or PHP error visible in the response. This is the '
                    + 'difference between "the API accepted it" and "the page works" - worth '
                    + 'calling after building one.',
                inputSchema: {
                    uuid: z.string().optional().describe('The page to check'),
                    path: z.string().optional().describe('Or a path on the staging site, e.g. "/prijzen"'),
                },
            },
            handler: async ({ uuid, path: requestedPath }) => {
                let url = requestedPath ? stagingUrl(requestedPath) : null;
                let page = null;

                if (!url) {
                    if (!uuid) {
                        return { error: 'Pass either a page uuid or a path.' };
                    }

                    const response = await api.get(`/content/${uuid}`);
                    page = response.content;
                    url = stagingUrl(page.slug);
                }

                if (!url) {
                    return { error: 'This site has no staging URL; is a theme being watched?' };
                }

                const started = Date.now();
                const response = await axios.get(url, {
                    validateStatus: () => true,
                    timeout: 30000,
                    headers: { 'User-Agent': 'sitepack-cli/mcp' },
                });

                const html = typeof response.data === 'string' ? response.data : '';
                const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

                // Twig and PHP failures come back as a 200 with the error in the body just
                // as often as they come back as a 500, so the body is what is checked.
                const failures = [
                    /Twig\\Error\\[A-Za-z]+/,
                    /Unknown "[^"]+" (?:function|filter|tag)/,
                    /Fatal error:/,
                    /Uncaught \w*Exception/,
                ]
                    .map(pattern => (html.match(pattern) || [])[0])
                    .filter(Boolean);

                return {
                    url,
                    status: response.status,
                    ok: response.status === 200 && failures.length === 0,
                    duration_ms: Date.now() - started,
                    bytes: html.length,
                    title: title ? title.trim() : null,
                    errors: failures,
                    page: page ? { uuid: page.uuid, title: page.title, status: page.status } : undefined,
                    hint:
                        response.status === 404
                            ? 'A 404 on staging usually means the page is not staging, or the watch is not running.'
                            : undefined,
                };
            },
        },
    ];
}

/**
 * Turn a handler result into an MCP tool response.
 *
 * Errors come back as content with `isError`, not as a thrown exception: a tool that
 * throws tells the agent nothing except that something went wrong, while the API's own
 * error code plus what to do about it is usually enough for it to fix the call itself.
 */
export async function runTool(handler, input) {
    try {
        const result = await handler(input || {});

        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    } catch (err) {
        const message = err instanceof AppApiError ? err.describe() : err.message;

        return {
            isError: true,
            content: [{ type: 'text', text: message }],
        };
    }
}
