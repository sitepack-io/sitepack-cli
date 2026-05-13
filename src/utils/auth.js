import open from 'open';
import axios from 'axios';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const CONFIG_PATH = path.join(os.homedir(), '.sitepackconfig');

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
    if (await fs.pathExists(CONFIG_PATH)) {
        try {
            const globalConfig = await fs.readJson(CONFIG_PATH);
            config = { ...globalConfig, ...config };
        } catch (err) {
            // Ignore broken global config
        }
    }

    return config;
}

export async function getBaseUrl() {
    const config = await getConfig();
    return config.base_url || config.baseUrl || 'https://admin.sitepack.nl';
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
    if (await fs.pathExists(CONFIG_PATH)) {
        try {
            config = await fs.readJson(CONFIG_PATH);
        } catch (err) {
            // Ignore broken config
        }
    }
    
    // Merge new token data with existing config
    const newConfig = { ...config, ...tokenData };
    
    // Ensure the token data is saved securely (file permissions)
    await fs.writeJson(CONFIG_PATH, newConfig, { mode: 0o600 });
}

export async function getSelectedPartner() {
    const config = await getConfig();
    return config.selected_partner_uuid || null;
}

export async function saveSelectedPartner(partnerUuid) {
    let config = {};
    if (await fs.pathExists(CONFIG_PATH)) {
        try {
            config = await fs.readJson(CONFIG_PATH);
        } catch (err) {
            // Ignore broken config
        }
    }
    config.selected_partner_uuid = partnerUuid;
    await fs.writeJson(CONFIG_PATH, config, { mode: 0o600 });
}

export async function getToken() {
    const config = await getConfig();
    if (config.access_token) {
        return config;
    }
    return null;
}

/**
 * Checks if the current access token is present and not locally expired.
 * @returns {Promise<boolean>}
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
            const tokenData = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || token.refresh_token, // keep old one if new one not provided
                client_id: token.client_id,
                scopes: response.data.scopes || token.scopes || [],
                expires_at: response.data.expires_in ? Date.now() + (response.data.expires_in * 1000) : null
            };
            await saveToken(tokenData);
            return tokenData;
        }
    } catch (error) {
        // If refresh fails, we might want to clear the token or just return null
        // For now, let's just return null so the user is prompted to login again
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
            const newToken = await refreshToken();
            return !!(newToken && newToken.access_token);
        }
        return false;
    }
    
    return true;
}

export async function whoami() {
    const token = await getToken();
    if (!token || !token.access_token) {
        return null;
    }

    const baseUrl = await getBaseUrl();
    try {
        const response = await axios.get(`${baseUrl}/api/authentication/oauth/whoami`, {
            headers: {
                'X-SitePack-Access-Token': token.access_token
            }
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
    
    if (await fs.pathExists(CONFIG_PATH)) {
        try {
            const config = await fs.readJson(CONFIG_PATH);
            const tokenKeys = ['access_token', 'refresh_token', 'expires_at', 'scopes', 'client_id'];
            tokenKeys.forEach(key => delete config[key]);
            
            if (Object.keys(config).length === 0) {
                await fs.remove(CONFIG_PATH);
            } else {
                await fs.writeJson(CONFIG_PATH, config, { mode: 0o600 });
            }
        } catch (err) {
            // If it's broken, just remove it
            await fs.remove(CONFIG_PATH);
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
                            scopes: tokenResponse.data.scopes || [],
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
                        reject(new Error(`Authentication failed: ${error.message}`));
                    }
                }
            }, (pollInterval || 5) * 1000);
        });
    } catch (error) {
        throw new Error(`Failed to initiate login: ${error.response?.data?.message || error.message}`);
    }
}
