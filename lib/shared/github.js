/* eslint-disable camelcase */
const fetch = require('isomorphic-fetch')

const GH_API = 'https://api.github.com'

module.exports = {
  async createRelease(token, {owner, name}, {hash, tag, prerelease, changelog}) {
    const response = await fetch(`${GH_API}/repos/${owner}/${name}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: hash,
        name: tag,
        body: changelog,
        prerelease: Boolean(prerelease),
      }),
      headers: {
        'content-type': 'application/json',
        Authorization: `token ${token}`,
      },
    })

    if (response.status >= 300) {
      throw new Error(`GitHub request failed: ${await response.text()}`)
    }
  },
}
