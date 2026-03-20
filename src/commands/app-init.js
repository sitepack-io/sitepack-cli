import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { runCommand } from '../utils/command.js';

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

export default function(program) {
    program
        .command('app:init')
        .description('Bootstrap a new SitePack app project')
        .action(async () => {
            console.log(chalk.cyan(welcomeArt));
            console.log(chalk.cyan.bold('\n🚀 SitePack App Builder\n'));

            const answers = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'App name:', default: 'my-app' },
                { type: 'confirm', name: 'git', message: 'Initialize Git repository?', default: true }
            ]);

            const targetDir = path.join(process.cwd(), answers.name);

            if (fs.existsSync(targetDir)) {
                console.log(chalk.red(`Error: Directory ${answers.name} already exists.`));
                return;
            }

            // Create directory structure for an app
            const structure = ['src', 'public', 'tests', 'config'];
            for (const folder of structure) {
                await fs.ensureDir(path.join(targetDir, folder));
            }

            // Base app.json or package.json
            await fs.writeJson(path.join(targetDir, 'package.json'), {
                name: answers.name,
                version: "1.0.0",
                description: "SitePack App",
                main: "src/index.js",
                type: "module",
                scripts: {
                    "dev": "sitepack app:dev",
                    "build": "sitepack app:build"
                },
                sitepack: {
                    version: "2026.1"
                }
            }, { spaces: 2 });

            // Basic src/index.js
            await fs.writeFile(path.join(targetDir, 'src/index.js'), "// SitePack App Entry Point\nconsole.log('Hello SitePack!');\n");

            console.log(chalk.yellow('🛠 Files created...'));

            // Use runCommand for Git init
            if (answers.git) {
                try {
                    process.chdir(targetDir);
                    await runCommand('git', ['init']);
                    console.log(chalk.green('✅ Git initialized.'));
                } catch (e) {
                    console.log(chalk.red('⚠ Could not initialize Git. Is Git installed?'));
                }
            }

            console.log(chalk.green.bold(`\nDone! Your app is in: ${targetDir}\n`));
        });
}
