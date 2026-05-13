import chalk from 'chalk';
import { selectPartner } from '../utils/partners.js';

export default async function partnerChangeCommand() {
    try {
        await selectPartner();
    } catch (err) {
        console.error(chalk.red(err.message));
    }
}
