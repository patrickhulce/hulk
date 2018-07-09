const fs = require('fs')
const path = require('path')
const chalk = require('chalk')

module.exports = {
  bail(msg) {
    console.error(chalk.red(`\n\n☠️  FATAL ERROR: ${msg}`))
    process.exit(1) // eslint-disable-line unicorn/no-process-exit
  },
  getCacheFolder() {
    const folder = path.join(__dirname, '../../.tmp')
    if (!fs.existsSync(folder)) fs.mkdirSync(folder)
    return folder
  },
}
