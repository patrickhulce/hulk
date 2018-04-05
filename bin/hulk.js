#!/usr/bin/env node

const yargs = require('yargs')
const gitRewrite = require('../lib/git-rewrite')
const tinyImage = require('../lib/tiny-image')

const options = yargs
  .command('git-rewrite', 'rewrite git dates', {
    number: {alias: 'n', required: true},
    hours: {alias: 'h'},
    message: {alias: 'm'},
    'dry-run': {default: true},
  })
  .command('tiny-image', 'shrink image to inlineable size', {
    output: {alias: 'o'},
    force: {alias: 'f'},
  })
  .demand(1).argv

async function go() {
  switch (options._[0]) {
    case 'git-rewrite':
      await gitRewrite(options)
      break
    case 'tiny-image':
      await tinyImage(options)
      break
    default:
      throw new Error('Invalid command')
  }
}

go().catch(e => {
  console.error(e)
  process.exit(1)
})
