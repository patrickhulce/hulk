const execFileSync = require('child_process').execFileSync
const chalk = require('chalk')
const shelljs = require('shelljs')
const inquirer = require('inquirer')
const conf = require('./shared/conf')
const {bail} = require('./shared/utils')

module.exports = async function addTokens() {
  let GH_TOKEN = conf.get('BUILD_GH_TOKEN')
  if (!GH_TOKEN) {
    console.log('Visit', chalk.bold('https://github.com/settings/tokens'))
    console.log('Create a token with', chalk.bold('admin:repo_hook, read:org, repo, user'))
    const answers = await inquirer.prompt([
      {type: 'input', message: 'Enter your GitHub token', name: 'token'},
    ])

    GH_TOKEN = answers.token
    conf.set('BUILD_GH_TOKEN', GH_TOKEN)
  }

  if (!GH_TOKEN) bail('Need a GitHub token to continue')

  let NPM_TOKEN = conf.get('BUILD_NPM_TOKEN')
  if (!NPM_TOKEN) {
    const {create} = await inquirer.prompt([
      {type: 'confirm', message: 'Create a new NPM token?', name: 'create'},
    ])

    if (create) {
      execFileSync('npm', ['token', 'create'], {stdio: 'inherit'})
    }

    const answers = await inquirer.prompt([
      {type: 'input', message: 'Enter the NPM token', name: 'token'},
    ])

    NPM_TOKEN = answers.token
    conf.set('BUILD_NPM_TOKEN', NPM_TOKEN)
  }

  shelljs.exec(`travis env set GH_TOKEN ${GH_TOKEN}`)
  shelljs.exec(`travis env set NPM_TOKEN ${NPM_TOKEN}`)
}
