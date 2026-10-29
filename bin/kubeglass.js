#!/usr/bin/env node
import open from 'open';
import { startServer } from '../server/index.js';

const DEFAULT_PORT = 7878;
const HELP = `kubeglass - a local Kubernetes dashboard

Usage: kubeglass [options]

Options:
  --port <n>    Preferred port (default ${DEFAULT_PORT}; the next free port is used if busy)
  --no-open     Do not open the browser
  --dev         Development mode with hot reload
  -h, --help    Show this help

Reads your kubeconfig from $KUBECONFIG or ~/.kube/config.`;

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : DEFAULT_PORT;

const app = await startServer({ port, dev: args.includes('--dev') });
console.log(`\n  kubeglass is running at ${app.url}`);
console.log(`  Open this link to log in: ${app.loginUrl}\n`);
console.log('  Press Ctrl+C to stop.\n');
if (!args.includes('--no-open')) await open(app.loginUrl);

const shutdown = () => {
  app.close();
  process.exit(0);
};
// A single broken stream (pod gone, network blip) must not take down the whole UI.
process.on('uncaughtException', (err) => console.error('kubeglass: unexpected error:', err));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
