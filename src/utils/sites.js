import inquirer from 'inquirer';
import { getBaseUrl, getToken, callApi } from './auth.js';

export async function getSites(partnerUuid) {
    const baseUrl = await getBaseUrl();
    const token = await getToken();

    if (!token || !token.access_token) {
        throw new Error('Not logged in. Use "sitepack login" to log in.');
    }

    const response = await callApi({
        method: 'get',
        url: `${baseUrl}/api/console/sites`,
        params: { partner: partnerUuid }
    });

    return response.data.sites || [];
}

export async function selectSite(sites) {
    const { siteUuid } = await inquirer.prompt([
        {
            type: 'list',
            name: 'siteUuid',
            message: 'Select a site to preview this theme on:',
            choices: sites.map(s => ({
                name: `${s.name} (${s.domain})`,
                value: s.uuid
            }))
        }
    ]);

    return siteUuid;
}
