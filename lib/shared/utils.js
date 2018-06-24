module.exports = {
  bail(msg) {
    console.error(`FATAL ERROR: ${msg}`)
    process.exit(1) // eslint-disable-line unicorn/no-process-exit
  },
}
