import fs from 'fs-extra';
import chalk from 'chalk';

/**
 * Validates a JSON file.
 * @param {string} filePath - Path to the JSON file.
 * @returns {Promise<{isValid: boolean, error?: string}>}
 */
export async function validateJsonFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        JSON.parse(content);
        return { isValid: true };
    } catch (err) {
        return { isValid: false, error: err.message };
    }
}
