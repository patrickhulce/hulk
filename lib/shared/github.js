/* eslint-disable camelcase */
const fetch = require('isomorphic-fetch')

const GH_API = 'https://api.github.com'

async function fetchOrFail({url, body, token, method = 'POST'}) {
  const response = await fetch(url, {
    method,
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      Authorization: `token ${token}`,
    },
  })

  if (response.status >= 300) {
    throw new Error(`GitHub request failed (${response.status}): ${await response.text()}`)
  }
}

module.exports = {
  async createRelease(token, {owner, name}, {hash, tag, prerelease, changelog}) {
    await fetchOrFail({
      url: `${GH_API}/repos/${owner}/${name}/git/tags`,
      body: {
        tag,
        message: tag,
        object: hash,
        type: 'commit',
      },
      token,
    })
    await fetchOrFail({
      url: `${GH_API}/repos/${owner}/${name}/git/refs`,
      body: {ref: `refs/tags/${tag}`, sha: hash},
      token,
    })
    await fetchOrFail({
      url: `${GH_API}/repos/${owner}/${name}/releases`,
      body: {
        tag_name: tag,
        target_commitish: hash,
        name: tag,
        body: changelog,
        prerelease: Boolean(prerelease),
      },
      token,
    })
  },
}
