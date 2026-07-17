import { describe, it, expect } from 'vitest';
import { readPublishedVersion, describeApiError, readScopes } from '../src/utils/response.js';

describe('readPublishedVersion', () => {
    it('reads the version field', () => {
        expect(readPublishedVersion({ status: 'ok', version: 4 })).toBe(4);
    });

    it('falls back to new_theme_version', () => {
        expect(readPublishedVersion({ status: 'ok', new_theme_version: 12 })).toBe(12);
    });

    it('falls back to new_app_version', () => {
        expect(readPublishedVersion({ status: 'ok', new_app_version: 3 })).toBe(3);
    });

    it('prefers version when several are present', () => {
        expect(readPublishedVersion({ version: 9, new_theme_version: 8 })).toBe(9);
    });

    it('accepts a numeric string', () => {
        expect(readPublishedVersion({ version: '7' })).toBe(7);
    });

    it.each([
        ['an empty body', null],
        ['a body without a version', { status: 'ok' }],
        ['a non-numeric version', { version: 'abc' }],
        ['a zero version', { version: 0 }],
        ['a string body', 'ok'],
    ])('returns null for %s', (_label, data) => {
        expect(readPublishedVersion(data)).toBeNull();
    });
});

describe('describeApiError', () => {
    it('uses the message field of a json error', () => {
        const error = { response: { status: 400, data: { status: 'error', message: 'Please set a theme uuid!' } } };
        expect(describeApiError(error)).toBe('Please set a theme uuid!');
    });

    it('uses the error field devcdn returns', () => {
        const error = { response: { status: 400, data: { error: 'No files have been uploaded for this theme yet' } } };
        expect(describeApiError(error)).toBe('No files have been uploaded for this theme yet');
    });

    it('prefers error_description over the error code', () => {
        const error = {
            response: { status: 400, data: { error: 'access_denied', error_description: 'The user denied the request.' } },
        };
        expect(describeApiError(error)).toBe('The user denied the request.');
    });

    it('explains a server error that returns an html page', () => {
        const error = {
            message: 'Request failed with status code 500',
            response: { status: 500, data: '<!DOCTYPE html><html><body>Server Error</body></html>' },
        };

        const description = describeApiError(error);

        expect(description).toContain('HTTP 500');
        expect(description).not.toContain('<');
    });

    it('explains a server error with an empty body', () => {
        const error = { message: 'Request failed with status code 502', response: { status: 502, data: '' } };
        expect(describeApiError(error)).toContain('HTTP 502');
    });

    it('describes a client error without a usable body', () => {
        const error = { message: 'Request failed with status code 403', response: { status: 403, data: {} } };
        expect(describeApiError(error)).toContain('HTTP 403');
    });

    it('falls back to the transport error when there is no response', () => {
        expect(describeApiError({ message: 'connect ECONNREFUSED' })).toBe('connect ECONNREFUSED');
    });

    it('handles a plain text body', () => {
        const error = { response: { status: 400, data: 'Something went wrong' } };
        expect(describeApiError(error)).toBe('Something went wrong');
    });
});

describe('readScopes', () => {
    it('splits the space separated scope string the token endpoint returns', () => {
        expect(readScopes({ scope: 'console:access sites:list themes:manage' }))
            .toEqual(['console:access', 'sites:list', 'themes:manage']);
    });

    it('passes an array through untouched', () => {
        expect(readScopes({ scopes: ['a', 'b'] })).toEqual(['a', 'b']);
    });

    it('returns an empty list when there are no scopes', () => {
        expect(readScopes({})).toEqual([]);
        expect(readScopes({ scope: '' })).toEqual([]);
        expect(readScopes(null)).toEqual([]);
    });
});
