const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const shelljs = require('shelljs')
const {bail} = require('./shared/utils')

const DEST_ESLINT = path.join(process.cwd(), '.eslintrc')
const DEST_PRETTIER = path.join(process.cwd(), '.prettierrc')
const PRETTIER = require('./conf/prettier.json')
const ESLINT_DEFAULT = require('./conf/eslint.json')
const ESLINT_REACT = require('./conf/eslint-react.json')

function prettify() {
  const prettierPath = path.join(process.cwd(), 'node_modules/.bin/prettier')
  if (fs.existsSync(prettierPath)) {
    shelljs.exec(`${prettierPath} --write ${DEST_ESLINT} ${DEST_PRETTIER}`)
  }
}

module.exports = async function ejectLint(options) {
  if (options.typescript) {
    bail('not yet supported')
  }

  const config = _.cloneDeep(ESLINT_DEFAULT)

  if (options.react) {
    _.merge(config, _.cloneDeep(ESLINT_REACT))
    config.plugins = [...ESLINT_DEFAULT.plugins, ...ESLINT_REACT.plugins]
  }

  fs.writeFileSync(DEST_ESLINT, JSON.stringify(config))
  fs.writeFileSync(DEST_PRETTIER, JSON.stringify(PRETTIER))
  prettify()
}
