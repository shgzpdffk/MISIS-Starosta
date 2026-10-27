import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });
console.log('Static preview built: dist/');
