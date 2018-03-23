#!/usr/bin/env node

const yargs = require('yargs')
const gitRewrite = require('../lib/git-rewrite')

const options = yargs
  .command('git-rewrite', 'rewrite git dates', {
    number: {alias: 'n', required: true},
    hours: {alias: 'h'},
    message: {alias: 'm'},
    'dry-run': {default: true},
  })
  .demand(1).argv


switch (options._[0]) {
  case 'git-rewrite':
    gitRewrite(options)
    break
  default:
    throw new Error('Invalid command')
}
