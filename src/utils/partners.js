import axios from 'axios';
import inquirer from 'inquirer';
import open from 'open';
import chalk from 'chalk';
import { getBaseUrl, getToken, saveSelectedPartner, getSelectedPartner } from './auth.js';

export async function getPartners() {
    const baseUrl = await getBaseUrl();
    const token = await getToken();

    if (!token || !token.access_token) {
        throw new Error('Not logged in. Use "sitepack login" to log in.');
    }

    const response = await axios.get(`${baseUrl}/api/console/partners`, {
        headers: {
            'X-SitePack-Access-Token': token.access_token
        }
    });

    const partners = response.data.partners || [];

    // Sort partners by company_name
    partners.sort((a, b) => (a.company_name || a.name || '').localeCompare(b.company_name || b.name || ''));

    return partners;
}

export async function ensurePartnerSelected() {
    const selectedPartnerUuid = await getSelectedPartner();
    if (selectedPartnerUuid) {
        return selectedPartnerUuid;
    }

    console.log(chalk.yellow('No organization selected. Please select one first.'));
    return await selectPartner();
}

export async function selectPartner() {
    const baseUrl = await getBaseUrl();
    const partners = await getPartners();

    const choices = [
        ...partners.map(p => ({
            name: p.company_name || p.name,
            value: p.uuid
        })),
        new inquirer.Separator(),
        {
            name: 'Create a new organization...',
            value: 'CREATE_NEW'
        }
    ];

    const { partnerUuid } = await inquirer.prompt([
        {
            type: 'list',
            name: 'partnerUuid',
            message: 'Select an organization (partner account):',
            choices: choices
        }
    ]);

    if (partnerUuid === 'CREATE_NEW') {
        const registerUrl = `${baseUrl}/partners/register`;
        console.log(`\nOpening your browser to create a new organization: ${registerUrl}`);
        await open(registerUrl);
        console.log('Once you have created the organization, please run this command again.');
        process.exit(0);
    }

    await saveSelectedPartner(partnerUuid);
    const selectedPartner = partners.find(p => p.uuid === partnerUuid);
    console.log(chalk.green(`Organization selected: ${selectedPartner.company_name || selectedPartner.name}`));

    return partnerUuid;
}
