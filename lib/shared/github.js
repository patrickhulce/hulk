/* eslint-disable camelcase */
const fetch = require('isomorphic-fetch')

const GH_API = 'https://api.github.com'

module.exports = {
  async createRelease(token, {owner, name}, {hash, tag, prerelease, changelog}) {
    const url = `${GH_API}/repos/${owner}/${name}/releases`
    const body = {
      tag_name: tag,
      target_commitish: hash,
      name: tag,
      body: changelog,
      prerelease: Boolean(prerelease),
    }

    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        Authorization: `token ${token}`,
      },
    })

    if (response.status >= 300) {
      throw new Error(`GitHub request failed (${response.status}): ${await response.text()}`)
    }
  },
}
