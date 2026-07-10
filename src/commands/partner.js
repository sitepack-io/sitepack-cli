import partnerListCommand from './partner-list.js';
import partnerChangeCommand from './partner-change.js';
import partnerCreateCommand from './partner-create.js';
import partnerSitesCommand from './partner-sites.js';

export default function partnerCommands(program) {
    program
        .command('partner:organisations')
        .description('List all organizations you have access to')
        .action(partnerListCommand);

    program
        .command('partner:change-organisation')
        .description('Select a different organization to work with')
        .action(partnerChangeCommand);

    program
        .command('partner:create-organisation')
        .description('Open the browser to create a new organization')
        .action(partnerCreateCommand);

    program
        .command('partner:sites')
        .description('List the sites linked to the selected organization')
        .action(partnerSitesCommand);
}
