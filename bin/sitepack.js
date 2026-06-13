#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { isTokenValid, whoami, getSelectedPartner } from '../src/utils/auth.js';
import loginCommand from '../src/commands/login.js';
import logoutCommand from '../src/commands/logout.js';
import whoamiCommand from '../src/commands/whoami.js';
import appInitCommand from '../src/commands/app-init.js';
import appPublishCommand from '../src/commands/app-publish.js';
import appCheckoutCommand from '../src/commands/app-checkout.js';
import themeInitCommand from '../src/commands/theme-init.js';
import themeWatchCommand from '../src/commands/theme-watch.js';
import themePublishCommand from '../src/commands/theme-publish.js';
import partnerCommands from '../src/commands/partner.js';
import { ensurePartnerSelected, getPartners } from '../src/utils/partners.js';

const program = new Command();

const welcomeArt = `
                                                           
                                                           
        @@@@@@                                @@@@@        
        @@@@@@@@@@@   @@@@@@@@@@@@@@@@  @@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        
         @@@@@@@          @@@@@@@          @@@@@@@         
         @@@@@    @@@@@@    @@@    @@@@@@    @@@@@         
         @@@@   @@@@@@@@@@   @   @@@@@@@@@@   @@@@         
        @@@@@  @@@@@@  @@@@     @@@@@@   @@@   @@@@        
        @@@@   @@@ @    @@@@    @@@ @@    @@@  @@@@        
        @@@@   @@@      @@@@    @@@@     @@@   @@@@        
        @@@@@   @@@@@@@@@@@@@@@@@@@@@@@@@@@@  @@@@@        
         @@@@@    @@@@@@@  @@@@@@  @@@@@@@    @@@@@        
         @@@@@@            @@@@             @@@@@@         
          @@@@@@@@@    @@@@@@@@@@@@@     @@@@@@@@          
            @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@            
              @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@              
 @@@@@        @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        @@@@@ 
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  
   @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@   
     @@@@@@@@@ @@@@@@@@@@@@@@@@@@@@@@@@@@@@@  @@@@@@@@     
               @@@@@@@@@@@@@@@@@@@@@@@@@@@@@               
                @@@@@@@@@@@@@@@@@@@@@@@@@@@                
                 @@@@@@@@@@@@@@@@@@@@@@@@@                 
                   @@@@@@@@@@@@@@@@@@@@@@                  
                      @@@@@@@@@@@@@@@@                     
                         @@@@@@@@@                         
                             @                             
                                                           
`;

async function getWelcomeMessage() {
    let message = welcomeArt;
    
    if (await isTokenValid()) {
        try {
            const user = await whoami();
            if (user) {
                const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
                message += chalk.cyan(`  Logged in as: ${chalk.bold(userName)} (${user.email})\n`);
                
                const selectedPartnerUuid = await getSelectedPartner();
                if (selectedPartnerUuid) {
                    try {
                        const partners = await getPartners();
                        const partner = partners.find(p => p.uuid === selectedPartnerUuid);
                        if (partner) {
                            message += chalk.cyan(`  Active organization: ${chalk.bold(partner.company_name || partner.name)}\n`);
                        } else {
                            message += chalk.cyan(`  Active organization: ${chalk.bold(selectedPartnerUuid)}\n`);
                        }
                    } catch (e) {
                        message += chalk.cyan(`  Active organization: ${chalk.bold(selectedPartnerUuid)}\n`);
                    }
                } else {
                    message += chalk.yellow(`  No organization selected. Use "sitepack partner:change-organisation" to select one.\n`);
                }
                message += '\n';
            }
        } catch (err) {
            // Ignore errors in welcome message
        }
    } else {
        message += chalk.yellow(`  Status: ${chalk.bold('Not logged in')}\n`);
        message += chalk.gray(`  Run "sitepack login" to connect your account.\n\n`);
    }
    
    return message;
}

program
    .name('sitepack')
    .description('SitePack Official CLI - Build your ecosystem\n\nDocumentation & Examples: https://sitepack.dev/')
    .version('1.1.0');

// We will add the help text dynamically before parsing
const welcomeMessage = await getWelcomeMessage();
program.addHelpText('before', welcomeMessage);

program.helpInformation = function() {
    return `
Usage: sitepack [command]

${chalk.bold('apps')}
    ${chalk.cyan('app:init')}      - Start a new SitePack app project
    ${chalk.cyan('app:publish')}   - Publish the app to SitePack (full sync and release)
    ${chalk.cyan('app:checkout')}  - Pull an app from SitePack to edit files locally

${chalk.bold('themes')}
    ${chalk.cyan('theme:init')}    - Start a new SitePack theme project
    ${chalk.cyan('theme:watch')}   - Watch for changes in the theme directory and sync to SitePack
    ${chalk.cyan('theme:publish')} - Publish the theme to SitePack (full sync and release)

${chalk.bold('partners')}
    ${chalk.cyan('partner:organisations')}        - List all organizations you have access to
    ${chalk.cyan('partner:change-organisation')} - Select a different organization to work with
    ${chalk.cyan('partner:create-organisation')} - Open the browser to create a new organization

${chalk.bold('account')}
    ${chalk.cyan('login')}       - Connect the CLI interface with your SitePack account
    ${chalk.cyan('logout')}      - Disconnect the CLI from your SitePack account
    ${chalk.cyan('whoami')}      - Show the currently logged in user

Documentation & Examples: https://sitepack.dev/

Options:
    -V, --version   output the version number
    -h, --help      display help for command
`;
};

// Register Commands
loginCommand(program);
logoutCommand(program);
whoamiCommand(program);
appInitCommand(program);
appPublishCommand(program);
appCheckoutCommand(program);
themeInitCommand(program);
themeWatchCommand(program);
themePublishCommand(program);
partnerCommands(program);

// Check for authentication and show warning if not logged in
const skipValidationCommands = [undefined, 'login', 'help', '--help', '-h', '--version', '-V', 'whoami', 'partner:organisations', 'partner:change-organisation'];
const currentCommand = process.argv[2];

if (!skipValidationCommands.includes(currentCommand)) {
    const isValid = await isTokenValid();
    if (!isValid) {
        console.log(chalk.yellow('⚠ Warning: No active connection found or your session has expired. Please run "sitepack login" to authorize this CLI.\n'));
    } else {
        // If logged in, check if a partner is selected for app and theme commands
        if (currentCommand.startsWith('app:') || currentCommand.startsWith('theme:')) {
            try {
                await ensurePartnerSelected();
            } catch (err) {
                console.error(chalk.red(`\nError: ${err.message}`));
                process.exit(1);
            }
        }
    }
}

program.parse(process.argv);
