import chalk from 'chalk';
import { getPartners } from '../utils/partners.js';
import { getSelectedPartner } from '../utils/auth.js';

export default async function partnerListCommand() {
    try {
        const partners = await getPartners();
        const selectedPartnerUuid = await getSelectedPartner();

        if (partners.length === 0) {
            console.log(chalk.yellow('No organizations found.'));
            return;
        }

        console.log(chalk.bold('\nYour organizations:'));
        partners.forEach(partner => {
            const isSelected = partner.uuid === selectedPartnerUuid;
            const prefix = isSelected ? chalk.green('● ') : '  ';
            const name = isSelected ? chalk.green(partner.company_name || partner.name) : (partner.company_name || partner.name);
            console.log(`${prefix}${name} ${chalk.gray(`(${partner.uuid})`)}`);
        });
        console.log('');
    } catch (err) {
        console.error(chalk.red(err.message));
    }
}
