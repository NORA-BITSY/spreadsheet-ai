import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            refresh: true,
        }),
        react(),
        tailwindcss(),
    ],
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: 'glide',
                            test: /node_modules[\\/]@glideapps/,
                            priority: 20,
                        },
                        {
                            name: 'react-vendor',
                            test: /node_modules[\\/](react|react-dom|scheduler)/,
                            priority: 15,
                        },
                        {
                            name: 'query-vendor',
                            test: /node_modules[\\/]@tanstack/,
                            priority: 10,
                        },
                        {
                            name: 'vendor',
                            test: /node_modules/,
                            priority: 5,
                        },
                    ],
                },
            },
        },
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
