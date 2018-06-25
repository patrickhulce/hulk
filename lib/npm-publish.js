const fs = require('fs')
const path = require('path')
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
const PACKAGES = path.join(CWD, 'packages')
const NPMRC_HOME = path.join(HOME, '.npmrc')
const NPMRC_LOCAL = path.join(CWD, '.npmrc')

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

  if (shelljs.exec('npm whoami').code !== 0) bail('NPM not authenticated')
}

function checkGitHubCredentials(options) {
  const token = options.githubToken || process.env.HULK_GH_TOKEN || process.env.GH_TOKEN
  if (token) bail('GitHub not authenticated')
  options.githubToken = token
}

function getLastVersion(options) {
  // exclude prerelease tags if this is a real release
  const prereleaseFilter = options.prerelease ? '' : `--exclude='*-*'`
  // Get the latest tag that describes HEAD
  const {stdout, code} = exec(`git describe --tags --abbrev=0 ${prereleaseFilter}`)
  if (code === 0) {
    const tag = stdout.trim()
    const hash = exec(`git rev-parse --short ${tag}`).stdout.trim()
    return {hash, tag, parsed: semver.parse(tag)}
  }

  const hash = exec('git rev-list --max-parents=0 HEAD').stdout.trim()
  return {hash, tag: hash, parsed: semver.parse('0.0.1')}
}

function getNextVersion(options, {lastVersion, releaseType, forceMajor}) {
  const hash = exec('git rev-parse --short HEAD').stdout.trim()
  const lastRealVersion = getLastVersion({prerelease: false})

  const releaseIncrements = ['patch', 'minor', 'major']
  let releaseIncrement = releaseIncrements[releaseType]
  // treat 0.x major bumps as minor version bumps
  if (lastVersion.parsed.major === 0 && releaseIncrement === 'major') releaseIncrement = 'minor'
  // force a major increment is told to
  if (forceMajor) releaseIncrement = 'major'

  if (options.prerelease) {
    if (!lastVersion.parsed.prerelease) {
      // this is the first prerelease, do premajor if we're breaking, preminor everything else
      releaseIncrement = releaseIncrement === 'major' ? 'premajor' : 'preminor'
    } else if (
      lastVersion.parsed.major === lastRealVersion.parsed.major &&
      releaseIncrement === 'major'
    ) {
      // last release was a prelease for the same major, but now we're breaking, force a premajor
      releaseIncrement = 'premajor'
    } else {
      // we're just going to increment our current prerelease counter
      releaseIncrement = 'prerelease'
    }
  }

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

function findRepository(options) {
  if (options.lerna) {
    const packages = fs.readdirSync(PACKAGES)
    for (const packageName of packages) {
      const packageJsonPath = path.join(PACKAGES, packageName, 'package.json')
      if (!fs.existsSync(packageJsonPath)) continue
      const pkg = require(packageJsonPath)
      if (!pkg.repository) continue
      return parseGitURL(pkg.repository.url)
    }
  } else {
    const pkg = require(PACKAGE_JSON)
    return parseGitURL(pkg.repository.url)
  }
}

function publishPackageToNPM(options, {nextVersion}) {
  let publishCode

  const npmTag = options.prerelease ? 'next' : 'latest'
  if (options.lerna) {
    const lernaArgs = [
      '--skip-git',
      `--repo-version=${nextVersion.parsed.version}`,
      `--npm-tag=${npmTag}`,
      '--yes',
    ]
    publishCode = shelljs.exec(`lerna publish ${lernaArgs.join(' ')}`).code
  } else {
    const TMP_PATH = PACKAGE_JSON + '.orig'
    const pkg = require(PACKAGE_JSON)
    shelljs.mv(PACKAGE_JSON, TMP_PATH)
    pkg.version = nextVersion.parsed.version
    fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2))
    publishCode = shelljs.exec(`npm publish --tag ${npmTag}`).code
    shelljs.mv(TMP_PATH, PACKAGE_JSON)
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
    prerelease: Boolean(nextVersion.parsed.prerelease),
  })
}

function fillDefaultOptions(options) {
  options.lerna = typeof options.lerna === 'boolean' ? options.lerna : fs.existsSync(LERNA_JSON)
}

module.exports = async function npmPublish(options) {
  fillDefaultOptions(options)
  checkPublishConditions(options)
  console.log('Publish conditions look good!')

  checkNPMCredentials(options)
  console.log('NPM credentials look good!')

  checkGitHubCredentials(options)
  console.log('GitHub credentials look good!')

  const repository = findRepository(options)
  console.log('Repository is', repository.full_name)

  const lastVersion = getLastVersion(options)
  console.log('Current version is', lastVersion.parsed.version)

  const {releaseType, commits} = getCommitsAndReleaseType(lastVersion)
  console.log('Release type is', displayNameForReleaseType(releaseType))

  let forceMajor = Boolean(process.env.FORCE_MAJOR)
  let nextVersion = getNextVersion(options, {lastVersion, releaseType, forceMajor})
  console.log('Next version will be', nextVersion.parsed.version)

  if (!options.yes) {
    const answers = await inquirer.prompt(
      [
        lastVersion.parsed.major === 0
          ? {
              type: 'confirm',
              name: 'forceMajor',
              message: 'Do you want to force a major version bump?',
              default: false,
            }
          : null,
        {type: 'confirm', message: 'Are you sure you want to publish?', name: 'continue'},
      ].filter(Boolean),
    )

    if (!answers.continue) {
      bail('Exiting without publish')
    }

    if (answers.forceMajor) {
      forceMajor = true
      nextVersion = getNextVersion(options, {lastVersion, releaseType, forceMajor})
    }
  }

  await publishPackageToNPM(options, {nextVersion})
  await publishReleaseToGitHub(options, {repository, commits, lastVersion, nextVersion})
}
