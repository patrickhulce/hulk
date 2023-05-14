#!/usr/bin/env node

const yargs = require('yargs')
const ejectLint = require('../lib/eject-lint')
const npmPublish = require('../lib/npm-publish')
const gitRewrite = require('../lib/git-rewrite')
const tinyImage = require('../lib/tiny-image')
const seamlessLoop = require('../lib/seamless-loop')

const options = yargs
  .command('npm-publish', 'publish to npm and GitHub and such', {
    lerna: {},
    prerelease: {type: 'boolean'},
    branch: {alias: 'b', default: 'master'},
    'node-version': {default: 'v8'},
    yes: {type: 'boolean'},
  })
  .command('eject-lint', 'write lint configurations to files', {
    typescript: {type: 'boolean'},
    react: {type: 'boolean'},
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
  .command('seamless-loop', 'shrink image to inlineable size', {
    output: {alias: 'o'},
    force: {alias: 'f'},
    'target-duration': {alias: 's'},
  })
  .demand(1).argv

async function go() {
  switch (options._[0]) {
    case 'eject-lint':
      await ejectLint(options)
      break
    case 'npm-publish':
      await npmPublish(options)
      break
    case 'git-rewrite':
      await gitRewrite(options)
      break
    case 'tiny-image':
      await tinyImage(options)
      break
    case 'seamless-loop':
      await seamlessLoop(options)
      break
    default:
      throw new Error('Invalid command')
  }
}

go().catch(err => {
  console.error(err)
  process.exit(1)
})
