import chalk from 'chalk';
import open from 'open';
import { getBaseUrl } from '../utils/auth.js';

export default async function partnerCreateCommand() {
    try {
        const baseUrl = await getBaseUrl();
        const registerUrl = `${baseUrl}/partners/register`;
        
        console.log(`\nOpening your browser to create a new organization: ${registerUrl}`);
        await open(registerUrl);
        console.log('Once you have created the organization, you can select it using "sitepack partner:change-organisation".');
    } catch (err) {
        console.error(chalk.red('Failed to open browser: ' + err.message));
    }
}
