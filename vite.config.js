import path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
    plugins: [
        dts({
            insertTypesEntry: true,
        }),
    ],
    build: {
        sourcemap: true,
        outDir: './browser',
        lib: {
            entry: path.resolve(__dirname, 'src/index.ts'),
            name: 'JsonCrawl',
            formats: ['es', 'umd'],
            fileName: (format) => `json-crawl.${format}.js`,
        },
    },
});