import {spawn} from 'child_process';

export function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        // We add 'shell: true' for better compatibility on Windows
        const child = spawn(command, args, {
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: true
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${errorOutput}`));
            } else {
                resolve(output.trim());
            }
        });
    });
}