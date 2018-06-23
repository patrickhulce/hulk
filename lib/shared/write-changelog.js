const fs = require('fs')
const getStream = require('get-stream')
const intoStream = require('into-stream')
const changelogWriter = require('conventional-changelog-writer')
const {bail} = require('./utils')

const COMMIT_TYPE_ORDER = {
  feat: 1,
  fix: 2,
  docs: 3,
  refactor: 4,
  tests: 5,
  test: 5,
  chore: 6,
  misc: 7,
}

function compareGroupSortOrder(groupA, groupB) {
  return (COMMIT_TYPE_ORDER[groupA.title] || 8) - (COMMIT_TYPE_ORDER[groupB.title] || 8)
}

function compareCommitSortOrder(commitA, commitB) {
  if (!commitA.scope) return -1
  if (!commitB.scope) return 1
  if (commitA.scope !== commitB.scope) return commitA.scope.localeCompare(commitB.scope)
  return new Date(commitB.date).getTime() - new Date(commitA.date).getTime()
}

module.exports = async function writeChangelog(
  options,
  {repository, lastVersion, nextVersion, commits},
) {
  const versionString = `v${nextVersion.parsed.version}`
  const writer = changelogWriter(
    {
      version: versionString,
      host: 'https://github.com',
      owner: repository.owner,
      repository: repository.name,
      previousTag: lastVersion.hash,
      currentTag: nextVersion.hash,
    },
    {
      groupBy: 'type',
      commitsSort: compareCommitSortOrder,
      commitGroupsSort: compareGroupSortOrder,
    },
  )

  const commitsForChangelog = commits
    .filter(commit => !commit.subject.includes('initial commit'))
    .map(commit => commit.parsed)
  const stream = intoStream.obj(commitsForChangelog).pipe(writer)
  const changelog = await getStream(stream)

  const changelogPath = 'CHANGELOG.md'
  let combinedLog = `<a name="${versionString}"></a>\n` + changelog.replace(/\n+$/, '\n\n')
  if (fs.existsSync(changelogPath)) {
    const existingLog = fs.readFileSync(changelogPath, 'utf8')
    if (existingLog.includes(`## ${versionString} `)) bail('Version already published in changelog')
    combinedLog += `\n---------------\n\n` + existingLog
  }

  fs.writeFileSync(changelogPath, combinedLog)
}
