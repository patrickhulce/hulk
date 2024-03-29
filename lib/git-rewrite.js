// See https://github.com/prettier/prettier/issues/187
/* eslint-disable no-mixed-operators */
const shelljs = require('shelljs')

function envFilter(hashDates) {
  let filter = ''
  for (const [hash, date] of hashDates) {
    filter += `
      if test "$GIT_COMMIT" = "${hash}"
      then
        export GIT_AUTHOR_DATE="${date}"
        export GIT_COMMITTER_DATE="${date}"
      fi
    `
  }

  return filter
}

function updateTime(hashes, options) {
  if (!options.hours) {
    return
  }

  const hashDates = []
  for (const hash of hashes) {
    const dateString = shelljs
      .exec(`git show -s --format=%ci ${hash}`, {silent: true})
      .stdout.trim()
    const movedDate = new Date(dateString).getTime() + options.hours * 60 * 60 * 1000
    hashDates.push([hash, new Date(movedDate).toString()])
  }

  if (options.dryRun) {
    console.log('Rewrite would affect...', hashDates)
  } else {
    shelljs.exec(
      `git filter-branch -f --env-filter '${envFilter(hashDates)}' HEAD~${options.number}...HEAD`,
      {env: {...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1'}},
    )
  }
}

module.exports = function gitRewrite(options) {
  const hashes = shelljs
    .exec(`git rev-list HEAD~${options.number}...HEAD`, {silent: true})
    .stdout.split('\n')
    .filter(Boolean)
  updateTime(hashes, options)
}
