/**
 * Simple test runner for unit tests
 */

import * as path from 'path';
import Mocha from 'mocha';
import * as fs from 'fs';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '.');

    return new Promise<void>((c, e) => {
        // Find all test files recursively
        const findTestFiles = (dir: string, files: string[] = []): string[] => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    findTestFiles(fullPath, files);
                } else if (entry.name.endsWith('.test.js')) {
                    files.push(fullPath);
                }
            }
            return files;
        };

        try {
            const files = findTestFiles(testsRoot);

            // Add files to the test suite
            files.forEach(f => mocha.addFile(f));

            // Run the mocha test
            mocha.run((failures) => {
                if (failures && failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        } catch (err) {
            console.error(err);
            e(err);
        }
    });
}

// Run the tests if this file is executed directly
if (require.main === module) {
    run().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
