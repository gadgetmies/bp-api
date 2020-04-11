const BPromise = require('bluebird')
const R = require('ramda')
const { init, initWithSession } = require('request-in-session')

const loginUri = 'https://www.beatport.com/account/login'
const cookieUri = 'https://www.beatport.com/'
const csrfTokenKey = '_csrf_token'
const sessionCookieKey = 'session'

const handleErrorOrCallFn = R.curry((errorHandler, fn) => (err, res) => err ? errorHandler(err) : fn(res))

const scrapeJSON = R.curry((startString, stopString, string) => {
  const start = string.indexOf(startString) + startString.length
  const stop = string.indexOf(stopString, start)
  return JSON.parse(string.substring(start, stop))
})

const getPlayables = pageSource => scrapeJSON('window.Playables = ', ';', pageSource)

const getApi = session => {
  const getJsonAsync = BPromise.promisify(session.getJson)
  const beatportUri = 'https://www.beatport.com'
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
    }, handleErrorOrCallFn(callback, res => callback(null, res))),
    removeTrackFromCart: (trackId, cartId, callback) => session.deleteJson(`${beatportUri}/api/cart/${cartId}`, {
      'items': [{ 'type': 'track', 'id': trackId }]
    }, handleErrorOrCallFn(callback, res => callback(null, res))),
    getAvailableDownloadIds: (page = 1, callback) => 
      session.get(`${beatportUri}/downloads/available?page=${page}&per-page=1000`,
      handleErrorOrCallFn(callback, res => callback(null, getPlayables(res)))),
    getDownloadedTracks: (page = 1, callback) => session.get(
      `${beatportUri}/downloads/downloaded?page=${page}&per-page=1000`,
      handleErrorOrCallFn(callback, res => callback(null, getPlayables(res)))),
    downloadTrackWithId: (downloadId, callback) =>
      getJsonAsync(`${beatportUri}/api/downloads/purchase?downloadId=${downloadId}`)
        .then(R.prop('download_url'))
        .then(downloadUrl => session.getBlob(downloadUrl, callback))
        .catch(err => callback(err))
  }

  return api
}

const handleCreateSessionResponse = callback => (err, session) => {
  if (err) {
    return callback(err)
  }
  const api = getApi(session)
  const ensureLoginSuccessful = () => api.getMyBeatport(err => {
    if (err) {
      callback(err)
    } else {
      callback(null, api)
    }
  })

  return ensureLoginSuccessful()
}

const initializers = {
  init: (username, password, callback) => {
    return init(cookieUri, loginUri, username, password, csrfTokenKey, sessionCookieKey, handleCreateSessionResponse(callback))
  },
  initWithSession: (sessionCookieValue, csrfToken, callback) => {
    return initWithSession(sessionCookieKey, sessionCookieValue, cookieUri, csrfTokenKey, csrfToken, handleCreateSessionResponse(callback))
  },
  initAsync: (username, password) =>
    BPromise.promisify(initializers.init)(username, password)
      .then(api => BPromise.promisifyAll(api)),
  initWithSessionAsync: (sessionCookieValue, csrfToken) =>
    BPromise.promisify(initializers.initWithSession)(sessionCookieValue, csrfToken)
      .then(api => BPromise.promisifyAll(api))
}

module.exports = initializers
