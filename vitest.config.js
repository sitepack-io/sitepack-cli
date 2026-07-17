import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js'],
        restoreMocks: true,
        coverage: {
            include: ['src/**/*.js'],
            reporter: ['text', 'lcov'],
        },
    },
});
