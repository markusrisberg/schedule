import { vitePlugin } from '@remcovaes/web-test-runner-vite-plugin';

export default {
    files: 'src/**/*.spec.ts',
    plugins: [
        vitePlugin(),
    ],
};
