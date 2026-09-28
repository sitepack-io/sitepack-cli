import axios from 'axios';

/**
 * A client for the SitePack app API, scoped to one development session.
 *
 * Deliberately thin: the tools are what have opinions, this only knows how to send a
 * request with the session token and how to turn a failure into something an agent can act
 * on. The API answers with a machine-readable `error.code`, so that is what is passed back
 * rather than an HTTP status an agent would have to interpret.
 */
export class AppApi {
    /**
     * @param {string} baseUrl
     * @param {string} accessToken
     */
    constructor(baseUrl, accessToken) {
        this.baseUrl = String(baseUrl).replace(/\/+$/, '');
        this.accessToken = accessToken;
    }

    /**
     * @param {string} method
     * @param {string} path  path under /api/public/v1, e.g. "/content"
     * @param {{query?: object, body?: object}} options
     */
    async request(method, path, { query, body } = {}) {
        try {
            const response = await axios({
                method,
                url: `${this.baseUrl}/api/public/v1${path}`,
                params: query,
                data: body,
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                // Errors are read, not thrown: an agent needs the body of a 422 far more
                // than it needs an exception.
                validateStatus: () => true,
                timeout: 30000,
            });

            if (response.status >= 200 && response.status < 300) {
                return response.data;
            }

            throw new AppApiError(response.status, response.data);
        } catch (err) {
            if (err instanceof AppApiError) {
                throw err;
            }

            throw new AppApiError(0, {
                error: {
                    code: 'unreachable',
                    message: `Could not reach ${this.baseUrl}: ${err.message}`,
                },
            });
        }
    }

    get(path, query) {
        return this.request('get', path, { query });
    }

    post(path, body) {
        return this.request('post', path, { body: body ?? {} });
    }

    patch(path, body) {
        return this.request('patch', path, { body });
    }

    put(path, body) {
        return this.request('put', path, { body });
    }

    delete(path) {
        return this.request('delete', path);
    }
}

export class AppApiError extends Error {
    constructor(status, data) {
        const error = (data && data.error) || {};
        super(error.message || `The app API answered ${status}.`);

        this.status = status;
        this.code = error.code || 'error';
        this.field = error.field;
        this.scope = error.scope;
        this.data = data;
    }

    /**
     * What the agent is told. The advice matters more than the message: `no_watch_theme`
     * is not a retryable failure, it means somebody has to start a watch.
     */
    describe() {
        const advice = {
            no_watch_theme:
                'Staging content needs `sitepack theme:watch` running against this site. '
                + 'Start it, then try again.',
            template_is_staging_only:
                'That template only exists in the theme being watched, so a page using it can '
                + 'only be staging until the theme is released.',
            scope_required:
                `This development session does not hold \`${this.scope}\`. `
                + 'It is scoped to staging content on purpose, so publishing and changes to live '
                + 'pages have to be done by a person in the admin.',
            slug_taken: 'That slug is already used on this site. Pick another or update the existing page.',
            unreachable: 'The SitePack API could not be reached. Check the connection and the base URL.',
        }[this.code];

        return advice ? `${this.message}\n\n${advice}` : this.message;
    }
}
