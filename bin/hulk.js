#!/usr/bin/env node

const yargs = require('yargs')
const npmPublish = require('../lib/npm-publish')
const gitRewrite = require('../lib/git-rewrite')
const tinyImage = require('../lib/tiny-image')

const options = yargs
  .command('npm-publish', 'publish to npm and GitHub and such', {
    lerna: {},
    prerelease: {type: 'boolean'},
    branch: {alias: 'b', default: 'master'},
    'node-version': {default: 'v8'},
    'dry-run': {type: 'boolean'},
  })
  .command('git-rewrite', 'rewrite git metadata', {
    number: {alias: 'n', required: true, type: 'number'},
    hours: {alias: 'h', type: 'number'},
    message: {alias: 'm'},
    'dry-run': {type: 'boolean'},
  })
  .command('tiny-image', 'shrink image to inlineable size', {
    output: {alias: 'o'},
    force: {alias: 'f'},
  })
  .demand(1).argv

async function go() {
  switch (options._[0]) {
    case 'npm-publish':
      await npmPublish(options)
      break
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

go().catch(err => {
  console.error(err)
  process.exit(1)
})
