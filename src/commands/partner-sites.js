import chalk from 'chalk';
import { ensurePartnerSelected } from '../utils/partners.js';
import { getSites } from '../utils/sites.js';

export default async function partnerSitesCommand() {
    try {
        const partnerUuid = await ensurePartnerSelected();
        const sites = await getSites(partnerUuid);

        if (sites.length === 0) {
            console.log(chalk.yellow('No sites found for this organization.'));
            return;
        }

        console.log(chalk.bold('\nSites:'));
        sites.forEach(site => {
            console.log(`  ${site.name} ${chalk.gray(`(${site.domain})`)} ${chalk.gray(site.uuid)}`);
        });
        console.log('');
    } catch (err) {
        console.error(chalk.red(err.message));
    }
}
