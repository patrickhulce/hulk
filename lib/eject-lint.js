const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const shelljs = require('shelljs')

const DEST_TSLINT = path.join(process.cwd(), 'tslint.json')
const DEST_ESLINT = path.join(process.cwd(), '.eslintrc')
const DEST_PRETTIER = path.join(process.cwd(), '.prettierrc')
const PRETTIER = require('./conf/prettier.json')
const TSLINT_DEFAULT = require.resolve('./conf/tslint.json')
const ESLINT_DEFAULT = require('./conf/eslint.json')
const ESLINT_REACT = require('./conf/eslint-react.json')

function prettify(options) {
  const prettierPath = path.join(process.cwd(), 'node_modules/.bin/prettier')
  if (fs.existsSync(prettierPath)) {
    const destLint = options.typescript ? DEST_TSLINT : DEST_ESLINT
    shelljs.exec(`${prettierPath} --write ${destLint} ${DEST_PRETTIER}`)
  }
}

module.exports = async function ejectLint(options) {
  fs.writeFileSync(DEST_PRETTIER, JSON.stringify(PRETTIER))

  if (options.typescript) {
    fs.copyFileSync(TSLINT_DEFAULT, DEST_TSLINT)
  } else {
    const config = _.cloneDeep(ESLINT_DEFAULT)

    if (options.react) {
      _.merge(config, _.cloneDeep(ESLINT_REACT))
      config.plugins = [...ESLINT_DEFAULT.plugins, ...ESLINT_REACT.plugins]
    }

    fs.writeFileSync(DEST_ESLINT, JSON.stringify(config))
  }

  prettify(options)
}
