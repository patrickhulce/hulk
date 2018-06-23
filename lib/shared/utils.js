module.exports = {
  bail(msg) {
    console.error(`FATAL ERROR: ${msg}`)
    process.exit(1)
  },
}
