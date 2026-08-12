#!/usr/bin/env node

'use strict';

try {
  require('../lib/src/cli').main(process.argv.slice(2)).catch(reportError);
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND') {
    console.error('Compiled CLI not found. Run `npm install` or `npm run compile` first.');
    process.exitCode = 1;
  } else {
    reportError(error);
  }
}

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  if (process.env.DEBUG && error instanceof Error) console.error(error.stack);
  process.exitCode = 1;
}
