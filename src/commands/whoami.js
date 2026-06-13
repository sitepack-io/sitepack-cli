import chalk from 'chalk';
import { getToken, isTokenValid, whoami, getSelectedPartner } from '../utils/auth.js';
import { getPartners } from '../utils/partners.js';

export default function(program) {
    program
        .command('whoami')
        .description('Show the currently logged in user and active organization')
        .action(async () => {
            const token = await getToken();
            if (!token) {
                console.log(chalk.yellow('Not logged in. Use: sitepack login'));
                return;
            }

            const isValid = await isTokenValid();
            if (!isValid) {
                console.log(chalk.red(`Your session has expired. Please run "sitepack login" to re-authorize.`));
                return;
            }

            try {
                const userInfo = await whoami();
                if (userInfo) {
                    console.log(chalk.cyan.bold('\n👤 SitePack User Profile\n'));
                    console.log(`${chalk.gray('Name:')} ${chalk.white(userInfo.first_name || 'N/A')} ${chalk.white(userInfo.last_name || 'N/A')}`);
                    console.log(`${chalk.gray('Email:')} ${chalk.white(userInfo.email || 'N/A')}`);
                    
                    if (userInfo.organization) {
                        console.log(`${chalk.gray('Personal Organization:')} ${chalk.white(userInfo.organization)}`);
                    }

                    // Active Organization Info
                    const selectedPartnerUuid = await getSelectedPartner();
                    if (selectedPartnerUuid) {
                        try {
                            const partners = await getPartners();
                            const partner = partners.find(p => p.uuid === selectedPartnerUuid);
                            
                            console.log(chalk.cyan.bold('\n🏢 Active Organization\n'));
                            if (partner) {
                                console.log(`${chalk.gray('Name:')} ${chalk.white(partner.company_name || partner.name)}`);
                                console.log(`${chalk.gray('UUID:')} ${chalk.white(partner.uuid)}`);
                                if (partner.role) {
                                    console.log(`${chalk.gray('Your Role:')} ${chalk.white(partner.role)}`);
                                }
                                if (partner.vat_number) {
                                    console.log(`${chalk.gray('VAT Number:')} ${chalk.white(partner.vat_number)}`);
                                }
                                if (partner.website) {
                                    console.log(`${chalk.gray('Website:')} ${chalk.white(partner.website)}`);
                                }
                            } else {
                                console.log(`${chalk.gray('UUID:')} ${chalk.white(selectedPartnerUuid)} (Details not found)`);
                            }
                        } catch (e) {
                            console.log(chalk.cyan.bold('\n🏢 Active Organization\n'));
                            console.log(`${chalk.gray('UUID:')} ${chalk.white(selectedPartnerUuid)}`);
                        }
                    } else {
                        console.log(chalk.yellow('\n🏢 No active organization selected.'));
                        console.log(chalk.gray('Use "sitepack partner:change-organisation" to select one.'));
                    }
                    
                    console.log('');
                } else {
                    console.log(chalk.red('Could not retrieve user information from the server.'));
                }
            } catch (err) {
                console.error(chalk.red('Error retrieving user info: ' + err.message));
            }
        });
}
