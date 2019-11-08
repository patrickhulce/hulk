const fs = require('fs')
const path = require('path')
const chalk = require('chalk')
const shelljs = require('shelljs')
const semver = require('semver')
const inquirer = require('inquirer')
const parseGitURL = require('git-url-parse')
const parseCommit = require('conventional-commits-parser').sync
const changelogLib = require('./shared/changelog')
const githubLib = require('./shared/github')
const {bail} = require('./shared/utils')

const CWD = process.cwd()
const HOME = process.env.HOME
const LERNA_JSON = path.join(CWD, 'lerna.json')
const PACKAGE_JSON = path.join(CWD, 'package.json')
const TMP_PACKAGE_JSON = `${PACKAGE_JSON}.orig`
const PACKAGES = path.join(CWD, 'packages')
const NPMRC_HOME = path.join(HOME, '.npmrc')
const NPMRC_LOCAL = path.join(CWD, '.npmrc')
const PKGFILES_BIN = path.join(path.dirname(require.resolve('pkgfiles')), 'bin/pkgfiles.js')

const RELEASE_TYPE = {
  MAJOR: 2,
  MINOR: 1,
  PATCH: 0,
}

const exec = cmd => shelljs.exec(cmd, {silent: true})

const displayNameForReleaseType = type =>
  Object.keys(RELEASE_TYPE).find(key => type === RELEASE_TYPE[key])

const GIT_BODY_DELIMITER = '______MARK_THE_BODY______'
const GIT_BODY = `${GIT_BODY_DELIMITER}"%B"${GIT_BODY_DELIMITER}`
const GIT_LOG_JSON_FORMAT = `{"hash": "%H", "date": "%aI", "subject": "%s", "body": ${GIT_BODY}}`

function checkPublishConditions(options) {
  const {branch, nodeVersion} = options
  const {CI, TRAVIS_BRANCH, TRAVIS_NODE_VERSION} = process.env

  if (!CI) return
  if (TRAVIS_BRANCH !== branch) bail(`Can only publish from ${branch}`)
  if (TRAVIS_NODE_VERSION !== nodeVersion) bail(`Can only publish from Node ${nodeVersion}`)
}

function hasNPMCredentialsAlready() {
  const hasTokenFn = file => fs.readFileSync(file, 'utf8').includes('Token')
  const localHasToken = fs.existsSync(NPMRC_LOCAL) && hasTokenFn(NPMRC_LOCAL)
  const homeHasToken = fs.existsSync(NPMRC_HOME) && hasTokenFn(NPMRC_HOME)
  return localHasToken || homeHasToken
}

function checkNPMCredentials() {
  if (!hasNPMCredentialsAlready()) {
    if (!process.env.NPM_TOKEN) bail('No NPM Token set!')

    console.log('Creating .npmrc file in local directory...')
    const contents = [
      '//registry.npmjs.org/:username=patrickhulce',
      '//registry.npmjs.org/:email=patrick.hulce@gmail.com',
      `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}`,
    ]

    fs.writeFileSync(NPMRC_LOCAL, contents.join('\n'))
  }

  const whoami = exec('npm whoami')
  if (whoami.code !== 0) bail('NPM not authenticated')
  console.log('ℹ️   Will publish to NPM as', chalk.bold(whoami.stdout.trim()))
}

function checkGitHubCredentials(options) {
  const token = options.githubToken || process.env.HULK_GH_TOKEN || process.env.GH_TOKEN
  if (!token) bail('GitHub not authenticated')
  options.githubToken = token
}

function getLastVersion(options) {
  // exclude prerelease tags if this is a real release
  const prereleaseFilter = options.prerelease ? '' : `--exclude='*-*'`
  // Get the latest tag that describes HEAD
  const {stdout, code} = exec(`git describe --tags --abbrev=0 ${prereleaseFilter}`)
  if (code === 0) {
    const tag = stdout.trim()
    const hash = exec(`git rev-parse ${tag}`).stdout.trim()
    return {hash, tag, parsed: semver.parse(tag)}
  }

  if (process.env.CI) return bail('First publish cannot be in CI')

  const hash = exec('git rev-list --max-parents=0 HEAD').stdout.trim()
  return {hash, tag: hash, parsed: semver.parse('0.0.1')}
}

function getNextVersion(options, {lastVersion, releaseType, forceMajor}) {
  const hash = exec('git rev-parse HEAD').stdout.trim()
  const lastRealVersion = getLastVersion({prerelease: false})

  const releaseIncrements = ['patch', 'minor', 'major']
  let releaseIncrement = releaseIncrements[releaseType]

  const is0DotX = lastVersion.parsed.major === 0
  const lastVersionEffectiveMajor = lastVersion.parsed.major || lastVersion.parsed.minor
  const lastRealVersionEffectiveMajor = lastRealVersion.parsed.major || lastRealVersion.parsed.minor

  if (options.prerelease) {
    if (!lastVersion.parsed.prerelease) {
      // this is the first prerelease, do premajor if we're breaking, preminor everything else
      releaseIncrement = releaseIncrement === 'major' ? 'premajor' : 'preminor'
    } else if (
      lastVersionEffectiveMajor === lastRealVersionEffectiveMajor &&
      releaseIncrement === 'major'
    ) {
      // last release was a prelease for the same major, but now we're breaking, force a premajor
      releaseIncrement = 'premajor'
    } else {
      // we're just going to increment our current prerelease counter
      releaseIncrement = 'prerelease'
    }
  }

  // treat 0.x major bumps as minor version bumps
  if (is0DotX && releaseIncrement === 'major') releaseIncrement = 'minor'
  if (is0DotX && releaseIncrement === 'premajor') releaseIncrement = 'preminor'
  // force a major increment when told to
  if (forceMajor) releaseIncrement = 'major'

  const raw = semver.inc(lastVersion.parsed, releaseIncrement, 'alpha')
  const parsed = semver.parse(raw)
  return {hash, parsed}
}

function getCommitsAndReleaseType(lastVersion) {
  const commitRange = `${lastVersion.tag}...HEAD`
  const flags = `--pretty=format:'${GIT_LOG_JSON_FORMAT}' --no-merges`
  const command = `git log ${commitRange} ${flags}`
  let logs = exec(command).stdout
  // Replace all the newlines in the body so it's valid JSON
  const regex = new RegExp(`${GIT_BODY_DELIMITER}"((.|[\n\r\f])*?)"${GIT_BODY_DELIMITER}}`, 'gim')
  logs = logs.replace(regex, (s, body) => `"${body.replace(/\r?\n/g, '\\n')}"}`)

  const commits = logs
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l)
      } catch (err) {
        console.error('Unable to parse message:', l)
        return undefined
      }
    })
    .filter(Boolean)
    .map(commit => {
      const parsed = parseCommit(commit.body)
      parsed.hash = commit.hash
      parsed.date = commit.date

      let releaseType = RELEASE_TYPE.PATCH
      if (parsed.type === 'feat') releaseType = RELEASE_TYPE.MINOR
      if (commit.body.includes('BREAKING CHANGE')) releaseType = RELEASE_TYPE.MAJOR

      return {...commit, releaseType, parsed}
    })

  const releaseType = commits.reduce(
    (type, commit) => Math.max(type, commit.releaseType),
    RELEASE_TYPE.PATCH,
  )

  return {releaseType, commits}
}

function checkCommitHasBeenPushed() {
  const head = exec('git rev-parse HEAD').stdout.trim()
  const hashInRevList = exec(`git rev-list origin/master | grep ${head}`)
  if (hashInRevList.code !== 0) bail('HEAD could not be found at origin, git push needed')
}

function findPackageJSONs(options) {
  const pkgs = []

  if (options.lerna) {
    const packages = fs.readdirSync(PACKAGES)
    for (const packageName of packages) {
      const packageJsonPath = path.join(PACKAGES, packageName, 'package.json')
      if (!fs.existsSync(packageJsonPath)) continue
      pkgs.push(require(packageJsonPath))
    }
  } else {
    pkgs.push(require(PACKAGE_JSON))
  }

  return pkgs
}

function findRepository(options) {
  const pkgs = findPackageJSONs(options)
  const pkgWithRepository = pkgs.find(pkg => pkg.repository)
  if (!pkgWithRepository) throw new Error('No "repository" field found in package.json')
  return parseGitURL(pkgWithRepository.repository.url)
}

function runPublishTests() {
  if (process.env.SKIP_TESTS || process.env.CI) return

  const tests = shelljs.exec('npm test', {silent: true})
  if (tests.code === 0) {
    console.log('✅  Tests passed')
  } else {
    console.log(tests.stdout)
    bail('Cannot publish broken package')
  }
}

function publishPackageToNPM(options, {nextVersion}) {
  let publishCode

  const npmTag = options.prerelease ? 'next' : 'latest'
  if (options.lerna) {
    const lernaArgs = [
      '"--force-publish=*"',
      '--exact',
      '--skip-git',
      `--repo-version=${nextVersion.parsed.version}`,
      `--npm-tag=${npmTag}`,
      '--yes',
    ]
    publishCode = shelljs.exec(`lerna publish ${lernaArgs.join(' ')}`).code
  } else {
    const pkg = require(PACKAGE_JSON)
    shelljs.mv(PACKAGE_JSON, TMP_PACKAGE_JSON)
    pkg.version = nextVersion.parsed.version
    fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2))
    publishCode = shelljs.exec(`npm publish --tag ${npmTag}`).code
    shelljs.mv(TMP_PACKAGE_JSON, PACKAGE_JSON)
  }

  if (publishCode !== 0) bail('Publishing failed')
}

async function publishReleaseToGitHub(options, data) {
  const {nextVersion, repository} = data
  const tag = `v${nextVersion.parsed.version}`
  const changelog = await changelogLib.get(options, {...data, tag})
  await githubLib.createRelease(options.githubToken, repository, {
    hash: nextVersion.hash,
    tag,
    changelog,
    prerelease: nextVersion.parsed.prerelease && nextVersion.parsed.prerelease.length,
  })

  if (!process.env.CI) {
    shelljs.exec('git fetch --tags')
  }
}

function fillDefaultOptions(options) {
  options.lerna = typeof options.lerna === 'boolean' ? options.lerna : fs.existsSync(LERNA_JSON)
}

module.exports = async function npmPublish(options) {
  fillDefaultOptions(options)
  checkPublishConditions(options)
  console.log(chalk.bold('✅  Publish conditions look good!'))

  checkNPMCredentials(options)
  console.log(chalk.bold('✅  NPM credentials look good!'))

  checkGitHubCredentials(options)
  console.log(chalk.bold('✅  GitHub credentials look good!'))

  checkCommitHasBeenPushed(options)
  console.log(chalk.bold('✅  Commit found at origin!'), '\n')

  const pkgs = findPackageJSONs(options)
  const repository = findRepository(options)
  console.log('ℹ️   Repository is', chalk.bold(repository.full_name))
  console.log('ℹ️   Package is', chalk.bold(pkgs.map(pkg => pkg.name).join(', ')))

  const lastVersion = getLastVersion(options)
  console.log('ℹ️   Current version is', chalk.bold(lastVersion.parsed.version))

  const {releaseType, commits} = getCommitsAndReleaseType(lastVersion)
  console.log('ℹ️   Release type is', chalk.bold(displayNameForReleaseType(releaseType)))

  let forceMajor = Boolean(process.env.FORCE_MAJOR)
  let nextVersion = getNextVersion(options, {lastVersion, releaseType, forceMajor})
  console.log('ℹ️   Next version will be', chalk.bold(nextVersion.parsed.version), '\n')

  if (!options.lerna) {
    console.log('ℹ️   About to publish the following files...')
    shelljs.exec(PKGFILES_BIN)
  }

  if (!options.yes) {
    if (lastVersion.parsed.major === 0) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'forceMajor',
          message: 'Do you want to force a major version bump?',
          default: false,
        },
      ])

      if (answers.forceMajor) {
        forceMajor = true
        nextVersion = getNextVersion(options, {lastVersion, releaseType, forceMajor})
        console.log('ℹ️   Next version will be', chalk.bold(nextVersion.parsed.version), '\n')
      }
    }

    const answers = await inquirer.prompt([
      {type: 'confirm', message: 'Are you sure you want to publish?', name: 'continue'},
    ])

    if (!answers.continue) {
      bail('Exiting without publish')
    }
  }

  console.log('\nTesting...')
  await runPublishTests(options)

  console.log('\nPublishing...')
  await publishPackageToNPM(options, {nextVersion})
  console.log(chalk.bold('✅  Published to NPM!'))

  console.log('\nReleasing...')
  await publishReleaseToGitHub(options, {repository, commits, lastVersion, nextVersion})
  console.log(chalk.bold('✅  Published to GitHub!'))
}
