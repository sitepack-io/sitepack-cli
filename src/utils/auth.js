import open from 'open';
import axios from 'axios';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { describeApiError, readScopes } from './response.js';

/**
 * Resolved on use rather than at import time, so the CLI always follows the
 * current home directory.
 *
 * @returns {string} the path of the global config file
 */
function getConfigPath() {
    return path.join(os.homedir(), '.sitepackconfig');
}

async function getConfig() {
    let currentDir = process.cwd();
    let config = {};

    // 1. Check current and parent directories for sitepack.config.json
    while (true) {
        const configPath = path.join(currentDir, 'sitepack.config.json');
        if (await fs.pathExists(configPath)) {
            try {
                const localConfig = await fs.readJson(configPath);
                config = { ...localConfig, ...config };
                // If we found a base_url or access_token, we can stop or keep going?
                // For now, let's keep the "closest wins" but also allow merging from parents if properties are missing
                if (config.base_url || config.access_token) {
                    break;
                }
            } catch (err) {
                // If it's invalid JSON, keep looking up
            }
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    // 2. Check ~/.sitepackconfig and merge it (global config)
    if (await fs.pathExists(getConfigPath())) {
        try {
            const globalConfig = await fs.readJson(getConfigPath());
            config = { ...globalConfig, ...config };
        } catch (err) {
            // Ignore broken global config
        }
    }

    return config;
}

export async function getBaseUrl() {
    const config = await getConfig();
    return config.base_url || config.baseUrl || 'https://admin.sitepack.eu';
}

export async function getThemeCdnUrl() {
    const config = await getConfig();
    return config.theme_cdn_url || 'https://sync.sitepack.dev/themes';
}

export async function getAppCdnUrl() {
    const config = await getConfig();
    return config.app_cdn_url || 'https://sync.sitepack.dev/apps';
}

export async function getCdnUrl() {
    const config = await getConfig();
    return config.cdn_url || 'https://cdn.sitepack.dev';
}

export async function saveToken(tokenData) {
    let config = {};
    if (await fs.pathExists(getConfigPath())) {
        try {
            config = await fs.readJson(getConfigPath());
        } catch (err) {
            // Ignore broken config
        }
    }
    
    // Merge new token data with existing config
    const newConfig = { ...config, ...tokenData };
    
    // Ensure the token data is saved securely (file permissions)
    await fs.writeJson(getConfigPath(), newConfig, { mode: 0o600 });
}

export async function getSelectedPartner() {
    const config = await getConfig();
    return config.selected_partner_uuid || null;
}

export async function saveSelectedPartner(partnerUuid) {
    let config = {};
    if (await fs.pathExists(getConfigPath())) {
        try {
            config = await fs.readJson(getConfigPath());
        } catch (err) {
            // Ignore broken config
        }
    }
    config.selected_partner_uuid = partnerUuid;
    await fs.writeJson(getConfigPath(), config, { mode: 0o600 });
}

export async function getToken() {
    const config = await getConfig();
    if (config && config.access_token) {
        return config;
    }
    return null;
}

/**
 * Whether the server turned the request down because of the access token.
 *
 * Core answers an unknown or expired token on the console endpoints with a
 * 400 ("Access token not found" / "Access token has expired") rather than a
 * 401, so only looking at the status code never triggered a refresh.
 *
 * @param {any} error - the rejected axios error
 * @returns {boolean}
 */
export function isRejectedToken(error) {
    const response = error?.response;
    if (!response) {
        return false;
    }

    if (response.status === 401) {
        return true;
    }

    let data = response.data;
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        // A download (responseType arraybuffer) hands the JSON error over as bytes.
        try {
            data = JSON.parse(Buffer.from(data).toString('utf8'));
        } catch {
            data = null;
        }
    }

    const message = data?.message;

    return response.status === 400
        && typeof message === 'string'
        && /access token (not found|has expired)/i.test(message);
}

/**
 * Refresh this long before the local expiry, so a request is not sent with a
 * token that runs out while it is under way.
 */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** How long to wait for another CLI process that is busy refreshing. */
const REFRESH_LOCK_TIMEOUT_MS = 15 * 1000;

/** The refresh that is under way in this process, shared by every caller. */
let refreshInFlight = null;

function isAboutToExpire(token) {
    return !!token.expires_at && Date.now() > token.expires_at - EXPIRY_MARGIN_MS;
}

/**
 * Perform an API call, refreshing the access token when it is (about to be)
 * expired or when the server rejects it, and retrying the request once.
 *
 * Pass a function returning the config when the request body is single-use
 * (a FormData with a read stream): it is called again for the retry, so the
 * retry does not send an already consumed stream.
 *
 * @param {import('axios').AxiosRequestConfig | (() => import('axios').AxiosRequestConfig)} configOrFactory
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export async function callApi(configOrFactory) {
    let token = await getToken();
    if (!token) {
        throw new Error('Not logged in. Run "sitepack login" first.');
    }

    if (token.refresh_token && isAboutToExpire(token)) {
        token = (await refreshAccessToken(token.access_token)) || token;
    }

    const buildConfig = (t) => {
        const axiosConfig = typeof configOrFactory === 'function' ? configOrFactory() : configOrFactory;
        axiosConfig.headers = axiosConfig.headers || {};

        if (axiosConfig.headers['Authorization'] && !axiosConfig.headers['X-SitePack-Access-Token']) {
            axiosConfig.headers['Authorization'] = `Bearer ${t.access_token}`;
        } else {
            axiosConfig.headers['X-SitePack-Access-Token'] = t.access_token;
        }

        return axiosConfig;
    };

    try {
        return await axios(buildConfig(token));
    } catch (error) {
        if (!isRejectedToken(error)) {
            throw error;
        }

        const newToken = await refreshAccessToken(token.access_token);
        if (!newToken) {
            throw error;
        }

        return await axios(buildConfig(newToken));
    }
}

/**
 * Replaces a rejected access token, making sure only one refresh runs at a
 * time: Core rotates the refresh token on every use, so a second refresh with
 * the same refresh token fails and would log the user out.
 *
 * Parallel requests in this process share one refresh, and a lock file keeps
 * a second CLI process (e.g. a running theme:watch) from refreshing at the
 * same moment. When the token on disk already differs from the rejected one,
 * someone else refreshed it and that token is used as is.
 *
 * @param {string} rejectedAccessToken - the access token that was turned down
 * @returns {Promise<object|null>} the new token data, or null when the session is gone
 */
async function refreshAccessToken(rejectedAccessToken) {
    if (!refreshInFlight) {
        refreshInFlight = withRefreshLock(async () => {
            const current = await getToken();
            if (current && current.access_token && current.access_token !== rejectedAccessToken) {
                return current;
            }

            return await refreshToken();
        }).finally(() => {
            refreshInFlight = null;
        });
    }

    return await refreshInFlight;
}

async function withRefreshLock(callback) {
    const lockPath = `${getConfigPath()}.lock`;
    const deadline = Date.now() + REFRESH_LOCK_TIMEOUT_MS;
    let handle = null;

    while (handle === null) {
        try {
            handle = await fs.open(lockPath, 'wx', 0o600);
        } catch (error) {
            if (error.code !== 'EEXIST') {
                // No lock possible (e.g. read-only home): refresh unguarded.
                return await callback();
            }

            if (Date.now() > deadline) {
                // A crashed process left its lock behind.
                await fs.remove(lockPath);
                continue;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    try {
        return await callback();
    } finally {
        await fs.close(handle);
        await fs.remove(lockPath);
    }
}

/**
 * Exchanges the stored refresh token for a new access token and stores it.
 * @returns {Promise<object|null>} the new token data, or null when the refresh failed
 */
export async function refreshToken() {
    const token = await getToken();
    if (!token || !token.refresh_token) {
        return null;
    }

    const baseUrl = await getBaseUrl();
    try {
        const response = await axios.post(`${baseUrl}/api/authentication/oauth/token`, {
            grant_type: 'refresh_token',
            client_id: token.client_id,
            refresh_token: token.refresh_token
        });

        if (response.data.access_token) {
            const refreshedScopes = readScopes(response.data);
            const tokenData = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || token.refresh_token, // keep old one if new one not provided
                client_id: token.client_id,
                scopes: refreshedScopes.length > 0 ? refreshedScopes : (token.scopes || []),
                expires_at: response.data.expires_in ? Date.now() + (response.data.expires_in * 1000) : null
            };
            await saveToken(tokenData);
            return tokenData;
        }
    } catch (error) {
        // The refresh token is expired or already used: the user has to log in again.
        return null;
    }
    return null;
}

export async function isTokenValid() {
    const token = await getToken();
    if (!token || !token.access_token) {
        return false;
    }
    
    if (token.expires_at && Date.now() > token.expires_at) {
        if (token.refresh_token) {
            const newToken = await refreshAccessToken(token.access_token);
            return !!(newToken && newToken.access_token);
        }
        return false;
    }
    
    return true;
}

export async function whoami() {
    try {
        const baseUrl = await getBaseUrl();
        const response = await callApi({
            method: 'get',
            url: `${baseUrl}/api/authentication/oauth/whoami`
        });
        return response.data;
    } catch (error) {
        return null;
    }
}

export async function logout() {
    const token = await getToken();
    if (token && token.access_token) {
        const baseUrl = await getBaseUrl();
        try {
            await axios.post(`${baseUrl}/api/authentication/oauth/revoke`, {
                token: token.access_token
            });
        } catch (error) {
            // Log it or ignore if the token is already invalid? 
            // Usually we proceed to delete local token anyway
            console.error('Error revoking token on server:', error.message);
        }
    }
    
    if (await fs.pathExists(getConfigPath())) {
        try {
            const config = await fs.readJson(getConfigPath());
            const tokenKeys = ['access_token', 'refresh_token', 'expires_at', 'scopes', 'client_id'];
            tokenKeys.forEach(key => delete config[key]);
            
            if (Object.keys(config).length === 0) {
                await fs.remove(getConfigPath());
            } else {
                await fs.writeJson(getConfigPath(), config, { mode: 0o600 });
            }
        } catch (err) {
            // If it's broken, just remove it
            await fs.remove(getConfigPath());
        }
    }
}

export async function performLogin(apiUrl) {
    const baseUrl = apiUrl || await getBaseUrl();
    const clientId = `sitepack-cli-${crypto.randomUUID()}`;
    try {
        // 1. Request a Device Code from the SitePack API
        const response = await axios.post(`${baseUrl}/api/authentication/oauth/device/code`, {
            client_id: clientId,
            scope: 'console:access sites:list apps:manage themes:manage'
        });

        const { device_code, user_code, verification_uri, expires_in, interval: pollInterval, client_id: responseClientId } = response.data;
        const finalClientId = responseClientId || clientId;

        console.log(`\nPlease open this URL to log in: ${verification_uri}`);
        console.log(`Enter this code: ${user_code}\n`);

        // 2. Automatically open the browser
        await open(verification_uri);

        // 3. Polling: the CLI keeps asking the API if the user has approved the request
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(async () => {
                try {
                    // Check if the device code has expired locally as a fallback
                    if (Date.now() - startTime > expires_in * 1000) {
                        clearInterval(interval);
                        reject(new Error('Device code expired. Please try again.'));
                        return;
                    }

                    const tokenResponse = await axios.post(`${baseUrl}/api/authentication/oauth/token`, {
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                        client_id: finalClientId,
                        device_code: device_code
                    });

                    if (tokenResponse.data.access_token) {
                        clearInterval(interval);
                        const tokenData = {
                            access_token: tokenResponse.data.access_token,
                            refresh_token: tokenResponse.data.refresh_token || null,
                            client_id: finalClientId,
                            scopes: readScopes(tokenResponse.data),
                            expires_at: tokenResponse.data.expires_in ? Date.now() + (tokenResponse.data.expires_in * 1000) : null
                        };
                        await saveToken(tokenData);
                        resolve(tokenData);
                    }
                } catch (error) {
                    if (error.response && error.response.data && error.response.data.error) {
                        const errorCode = error.response.data.error;
                        if (errorCode === 'authorization_pending') {
                            // Continue polling
                            return;
                        } else if (errorCode === 'expired_token') {
                            clearInterval(interval);
                            reject(new Error('The device code has expired.'));
                        } else if (errorCode === 'access_denied') {
                            clearInterval(interval);
                            reject(new Error('The user denied the request.'));
                        } else {
                            clearInterval(interval);
                            reject(new Error(`Authentication failed: ${error.response.data.error_description || errorCode}`));
                        }
                    } else {
                        clearInterval(interval);
                        reject(new Error(`Authentication failed: ${describeApiError(error)}`));
                    }
                }
            }, (pollInterval || 5) * 1000);
        });
    } catch (error) {
        throw new Error(`Failed to initiate login: ${describeApiError(error)}`);
    }
}
