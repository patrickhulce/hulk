const fs = require('fs')
const path = require('path')
const shelljs = require('shelljs')
const Jimp = require('jimp')
const {bail, getCacheFolder} = require('./shared/utils')

/* eslint-disable max-len */

const MIN_DURATION = 5
const MAX_DURATION = 20

const CACHE_DIR = getCacheFolder()
const CACHED_HASHES_PATH = path.join(CACHE_DIR, 'hashes.json')
const LAST_PROCESSED_PATH = path.join(CACHE_DIR, 'last-processed.txt')
const TMP_VIDEO_1_PATH = path.join(CACHE_DIR, 'half-1.mp4')
const TMP_VIDEO_2_PATH = path.join(CACHE_DIR, 'half-2.mp4')

function cleanCacheIfNecessary(inputFile, options) {
  try {
    fs.unlinkSync(TMP_VIDEO_1_PATH)
    fs.unlinkSync(TMP_VIDEO_2_PATH)
  } catch (err) {}

  if (!options.force && fs.existsSync(LAST_PROCESSED_PATH)) {
    const [lastProcessedFile, lastAnalysisDuration] = fs
      .readFileSync(LAST_PROCESSED_PATH, 'utf8')
      .trim()
      .split('@@@@')
    if (
      lastProcessedFile === inputFile &&
      Number(lastAnalysisDuration) === options.analysisDuration
    ) {
      console.log('Re-using cached files!')
      return
    }
  }

  for (const file of fs.readdirSync(CACHE_DIR)) {
    fs.unlinkSync(path.join(CACHE_DIR, file))
  }
}

function hammingDistance(hashA, hashB) {
  let distance = 0
  for (let i = 0; i < hashA.length; i++) {
    if (hashA.charAt(i) !== hashB.charAt(i)) distance++
  }

  return distance
}

function createImages(inputFile, options) {
  if (fs.existsSync(path.join(CACHE_DIR, 'frames-1.png'))) {
    return
  }

  const fps = Math.ceil(1 / options.analysisDuration)
  // From https://trac.ffmpeg.org/wiki/Create%20a%20thumbnail%20image%20every%20X%20seconds%20of%20the%20video
  // also https://stackoverflow.com/questions/14551102/with-ffmpeg-create-thumbnails-proportional-to-the-videos-ratio
  shelljs.exec(`ffmpeg -i ${inputFile} -vf fps=${fps},scale=280:-1 ${CACHE_DIR}/frames-%d.png`, {
    silent: true,
  })
}

async function computeHashes(inputFile, options) {
  if (fs.existsSync(CACHED_HASHES_PATH)) {
    return JSON.parse(fs.readFileSync(CACHED_HASHES_PATH))
  }

  const imageHashes = {}
  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.png')) continue

    const imgPath = path.join(CACHE_DIR, file)
    console.log('hashing', file, '...')
    const img = await Jimp.read(imgPath) // eslint-disable-line no-await-in-loop
    const n = Number(file.match(/frames-(\d+)/)[1])
    imageHashes[file] = {
      file,
      path: imgPath,
      hash: img.hash(2),
      n,
      timestamp: (n - 1) / options.analysisFramesPerSecond,
    }
    console.log('hash was', imageHashes[file].hash)
  }

  fs.writeFileSync(LAST_PROCESSED_PATH, `${inputFile}@@@@${options.analysisDuration}`)
  fs.writeFileSync(CACHED_HASHES_PATH, JSON.stringify(imageHashes, null, 2))
  return imageHashes
}

function computeTopHashPairsPass1(imageHashes, {crossfadeDuration}) {
  const pairs = []
  for (const fileA of Object.keys(imageHashes)) {
    for (const fileB of Object.keys(imageHashes)) {
      const startFrame = imageHashes[fileA]
      const endFrame = imageHashes[fileB]

      if (startFrame.timestamp >= endFrame.timestamp) continue
      if (startFrame.timestamp <= crossfadeDuration) continue

      const duration = Math.abs(startFrame.timestamp - endFrame.timestamp)
      if (duration < MIN_DURATION || duration > MAX_DURATION) continue

      const hashDistance = hammingDistance(startFrame.hash, endFrame.hash)
      pairs.push({hashDistance, duration, startFrame, endFrame})
    }
  }

  return pairs.sort((a, b) => a.hashDistance - b.hashDistance)
}

function computeTopHashPairsPass2(imageHashes, pairs, {numberOfAnalysisFrames}) {
  for (const pair of pairs) {
    const {startFrame, endFrame} = pair
    if (startFrame.n <= numberOfAnalysisFrames) {
      pair.totalDistance = Infinity
      continue
    }

    const distances = []
    let totalDistance = 0
    for (let i = numberOfAnalysisFrames; i >= 0; i--) {
      const prevA = imageHashes[`frames-${startFrame.n - i}.png`]
      const prevB = imageHashes[`frames-${endFrame.n - i}.png`]
      const hashDistance = hammingDistance(prevA.hash, prevB.hash)
      // Discount the frames farthest from 50/50 fade frame the most
      // i.e. it's OK if the frames that aren't that mixed look different
      const discountFactor = Math.pow(0.5, Math.abs(i - numberOfAnalysisFrames / 2)) // eslint-disable-line no-mixed-operators
      totalDistance += hashDistance * hashDistance * discountFactor
      distances.push(hashDistance)
    }

    pair.distances = distances
    pair.totalDistance = totalDistance
  }

  return pairs.slice().sort((a, b) => a.totalDistance - b.totalDistance)
}

function exportTwoVideoComponents({inputFile, startAt, duration, crossfadeDuration}) {
  // From https://superuser.com/questions/138331/using-ffmpeg-to-cut-up-video
  // Copy the video for `duration` seconds starting at the timestamp of startFrame
  shelljs.exec(`ffmpeg -ss ${startAt} -i ${inputFile} -c copy -t ${duration} ${TMP_VIDEO_1_PATH}`, {
    silent: true,
  })

  // Copy the duration of the crossfade **that preceeded** the startFrame
  const startB = startAt - crossfadeDuration
  const durationB = crossfadeDuration
  shelljs.exec(`ffmpeg -ss ${startB} -i ${inputFile} -c copy -t ${durationB} ${TMP_VIDEO_2_PATH}`, {
    silent: true,
  })
}

function exportFinalVideo({outputFile, duration, crossfadeDuration}) {
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
  const startFadingAt = duration - crossfadeDuration

  // From https://superuser.com/questions/778762/crossfade-between-2-videos-using-ffmpeg
  const fadeFilter = `fade=t=in:st=0:d=${crossfadeDuration}:alpha=1`
  const timelineShiftFilter = `setpts=PTS-STARTPTS+${startFadingAt}/TB`
  const filters = [
    // Video filters
    `[1:v]format=pix_fmts=yuva420p,${fadeFilter},${timelineShiftFilter}[loopTransition]`,
    `[0:v][loopTransition]overlay=format=yuv420[outv]`,
    // Audio filters - makes it stuttery :/
    // `[0:a]afade=t=in:st=0:d=${crossfadeDuration}[primaryAudioWithFadeIn]`,
    // `[1:a]afade=t=in:st=0:d=${crossfadeDuration}[loopTransitionAudio]`,
    // `aevalsrc=0:d=${startFadingAt}[silence]`,
    // `[silence][loopTransitionAudio]concat=n=2:v=0:a=1[loopAudioTrack]`,
    // `[primaryAudioWithFadeIn]afade=t=out:st=${startFadingAt}:d=${crossfadeDuration}[primaryAudio]`,
    // `[primaryAudio][loopAudioTrack]amix[mixedAudio]`,
    // `[mixedAudio]atrim=duration=${duration}[outa]`,
  ].join('; ')

  const command = [
    'ffmpeg',
    `-i ${TMP_VIDEO_1_PATH}`,
    `-i ${TMP_VIDEO_2_PATH}`,
    `-filter_complex "${filters}"`,
    `-vcodec libx264`,
    `-map [outv]`,
    // `-map [outa]`,
    outputFile,
  ].join(' ')

  shelljs.exec(command, {silent: true})
}

module.exports = async function seamlessLoop(yargsOptions) {
  const file = path.resolve(process.cwd(), yargsOptions._[1])
  if (!fs.existsSync(file)) bail('Must provide input file')
  if (shelljs.exec('which ffmpeg', {silent: true}).code !== 0) bail('FFMPEG not installed!')

  const analysisDuration = 0.25
  const crossfadeDuration = 0.75
  const analysisFramesPerSecond = 1 / analysisDuration
  const numberOfAnalysisFrames = crossfadeDuration / analysisDuration
  const outputFile = yargsOptions.output || file.replace(/\.(mov|mp4|webm)$/, '-looped.mp4')
  const options = {
    ...yargsOptions,
    analysisDuration,
    crossfadeDuration,
    numberOfAnalysisFrames,
    analysisFramesPerSecond,
    outputFile,
  }

  cleanCacheIfNecessary(file, options)

  console.log('Splitting movie into images for processing...')
  createImages(file, options)

  console.log('Analyzing frames for similarity...')
  const imageHashes = await computeHashes(file, options)
  const pairs = computeTopHashPairsPass1(imageHashes, options)
  const bestPairs = computeTopHashPairsPass2(imageHashes, pairs, options)
  const {startFrame, duration} = bestPairs[0]
  console.log(`Frames analyzed! Loop will be ${duration}s starting at ${startFrame.timestamp}s`)

  console.log('Exporting 2 videos for crossfade...')
  exportTwoVideoComponents({
    inputFile: file,
    startAt: startFrame.timestamp,
    duration,
    crossfadeDuration,
  })

  console.log('Exporting final video...')
  exportFinalVideo({...options, duration})
  console.log('Done!', outputFile)
}
