const BPromise = require('bluebird')
const R = require('ramda')
const { init } = require('request-in-session')

const loginUri = 'https://www.beatport.com/account/login'
const cookieUri = 'https://www.beatport.com/'

const handleErrorOrCallFn = R.curry((errorHandler, fn) => (err, res) => err ? errorHandler(err) : fn(res))

const scrapeJSON = R.curry((startString, stopString, string) => {
  const start = string.indexOf(startString) + startString.length
  const stop = string.indexOf(stopString, start)
  return JSON.parse(string.substring(start, stop))
})

const getPlayables = pageSource => scrapeJSON('window.Playables = ', ';', pageSource)

const api = {
  init: (username, password, callback) => {
    return init(cookieUri, loginUri, username, password, '_csrf_token', 'session', (err, session) => {
      if (err) {
        return callback(err)
      }

      const getJsonAsync = BPromise.promisify(session.getJson)
      const beatportUri = `https://www.beatport.com`
      const api = {
        getMyBeatport: callback => session.getJson(`${beatportUri}/api/my-beatport`, callback),
        getMyBeatportTracks: (page, callback) =>
          session.get(`${beatportUri}/my-beatport?page=${page}&_pjax=%23pjax-inner-wrapper`,
            handleErrorOrCallFn(callback, res => callback(null, getPlayables(res)))),
        getItemsInCarts: (callback) => session.getJson(`${beatportUri}/api/cart/cart`,
          handleErrorOrCallFn(callback, res => {
            BPromise.map(res.carts.map(R.prop('id')),
              cartId => getJsonAsync(`${beatportUri}/api/cart/${cartId}`))
              .map(({ items }) => R.pluck('id', items))
              .then(R.flatten)
              .tap(idsOfItemsInCart => callback(null, idsOfItemsInCart))
              .catch(err => callback(err))
          })),
        getTrack: (trackId, callback) => session.getJson(`https://embed.beatport.com/track?id=${trackId}`, callback),
        getClip: (trackId, callback) => api.getTrack(trackId,
          handleErrorOrCallFn(callback, res => callback(null, res.results.preview))),
        addTrackToCart: (trackId, cartId, callback) => session.postJson(`${beatportUri}/api/${cartId}`, {
          'items': [{ 'type': 'track', 'id': trackId }]
          // , "trackingData": { "type": "product", "id": "9915168", "name": "Contradictions", "position": "1", "brand": "Shogun Audio", "category": "Tracks", "variant": "track", "list": "Track Detail", "price": "1.56", "dimension1": "Alix Perez", "dimension2": null, "dimension3": "Drum & Bass", "dimension4": null, "dimension12": null }
        },
          handleErrorOrCallFn(callback, res => callback(null, res))),
        getAvailableDownloadIds: callback => session.get('https://www.beatport.com/downloads/available',
          handleErrorOrCallFn(callback, res => {
            return BPromise.resolve(res)
              .then(getPlayables)
              .then(R.prop('tracks'))
              .then(R.pluck('downloadId'))
              .tap(downloadIds => callback(null, downloadIds))
              .catch(err => callback(err))
          })
        ),
        downloadTrackWithId: (downloadId, callback) =>
          getJsonAsync(`${beatportUri}/api/downloads/purchase?downloadId=${downloadId}`)
            .then(R.prop('download_url'))
            .then(downloadUrl => session.getBlob(downloadUrl, callback))
            .catch(err => callback(err))
      }

      const ensureLoginSuccessful = () => api.getMyBeatport(err => {
        if (err) {
          callback(err)
        } else {
          callback(null, api)
        }
      })

      return ensureLoginSuccessful()
    })
  },
  initAsync: (username, password) =>
    BPromise.promisify(api.init)(username, password)
      .then(api => BPromise.promisifyAll(api))
}

module.exports = api
