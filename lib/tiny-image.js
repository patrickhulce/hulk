const fs = require('fs')
const Jimp = require('jimp')

module.exports = async function tinyImage(options) {
  const file = options._[1]
  if (!file) throw new Error('Must provide input file')
  const outputFilename = options.output || file.replace(/\.(png|jpg|jpeg)$/, '-tiny.jpg')

  console.error('Reading file:', file)
  const image = await Jimp.read(
    fs.existsSync(outputFilename) && !options.force ? outputFilename : file,
  )

  console.error('Scaling down file...')
  image.scaleToFit(32, 32).quality(80)

  const buffer = await new Promise((resolve, reject) =>
    image.getBuffer(Jimp.MIME_JPEG, (err, data) => (err ? reject(err) : resolve(data))),
  )

  console.error('Writing output to disk...', outputFilename)
  fs.writeFileSync(outputFilename, buffer)
  console.error('Dumping base64 to stdout...')
  process.stdout.write(buffer.toString('base64'))
}
