const chalk = require('chalk')

module.exports = {
  bail(msg) {
    console.error(chalk.red(`\n\n☠️  FATAL ERROR: ${msg}`))
    process.exit(1) // eslint-disable-line unicorn/no-process-exit
  },
}
