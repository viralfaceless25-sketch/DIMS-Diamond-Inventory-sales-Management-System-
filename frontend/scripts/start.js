const { spawn } = require('child_process');

const nextCli = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextCli, 'start', '-H', '0.0.0.0', '-p', process.env.PORT || '3000'], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code || 0));
