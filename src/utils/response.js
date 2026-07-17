/**
 * Helpers for reading SitePack API responses and turning failures into
 * something a developer can act on in the terminal.
 */

/**
 * Reads the released version number from a publish response.
 *
 * The publish endpoint reports the version as "version", and additionally as
 * "new_theme_version"/"new_app_version". Accept all three so the CLI keeps
 * reporting the version against older servers.
 *
 * @param {any} data - the publish response body
 * @returns {number|null}
 */
export function readPublishedVersion(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const candidates = [data.version, data.new_theme_version, data.new_app_version];

    for (const candidate of candidates) {
        const version = Number(candidate);
        if (Number.isInteger(version) && version > 0) {
            return version;
        }
    }

    return null;
}

/**
 * Turns an axios error into a readable one-line message.
 *
 * A server error used to surface as a bare "Request failed with status code
 * 500": the response body is only mined for a message when it is JSON, so an
 * HTML error page left the user with nothing but the status code.
 *
 * @param {any} error - the rejected axios error
 * @returns {string}
 */
export function describeApiError(error) {
    const response = error?.response;

    if (!response) {
        return error?.message || 'Unknown error';
    }

    const message = extractMessage(response.data);
    const status = response.status;

    if (message) {
        return message;
    }

    if (status >= 500) {
        return `the server returned an error (HTTP ${status}). Please try again, and contact support@sitepack.nl if it keeps happening.`;
    }

    return `the server rejected the request (HTTP ${status}).`;
}

/**
 * @param {any} data - a response body of any shape
 * @returns {string|null}
 */
function extractMessage(data) {
    if (typeof data === 'string') {
        const trimmed = data.trim();

        // An HTML error page carries no message worth showing.
        if (trimmed === '' || trimmed.startsWith('<')) {
            return null;
        }

        return trimmed;
    }

    if (!data || typeof data !== 'object') {
        return null;
    }

    const candidates = [data.message, data.error_description, data.error];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            return candidate.trim();
        }
    }

    return null;
}

/**
 * Normalizes the scopes of a token response into an array.
 *
 * The OAuth token endpoint returns a space-separated "scope" string; reading
 * "scopes" meant the CLI stored an empty list for every login.
 *
 * @param {any} data - the token response body
 * @returns {string[]}
 */
export function readScopes(data) {
    if (Array.isArray(data?.scopes)) {
        return data.scopes;
    }

    const scope = data?.scope ?? data?.scopes;

    if (typeof scope !== 'string' || scope.trim() === '') {
        return [];
    }

    return scope.trim().split(/\s+/);
}
