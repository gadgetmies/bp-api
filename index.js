const BPromise = require('bluebird')
const R = require('ramda')
const { init, initWithSession } = require('request-in-session')
const request = require('request-promise').defaults({ strictSSL: false, resolveWithFullResponse: true })

const beatportUri = 'https://www.beatport.com'
const loginUri = 'https://www.beatport.com/account/login'
const cookieUri = 'https://www.beatport.com/'
const csrfTokenKey = '_csrf_token'
const sessionCookieKey = 'session'

const handleErrorOrCallFn = R.curry((errorHandler, fn) => (err, res) => (err ? errorHandler(err) : fn(res)))

const scrapeJSON = R.curry((startString, stopString, string) => {
  const start = string.indexOf(startString) + startString.length
  const stop = string.indexOf(stopString, start) + stopString.length - (stopString.endsWith(';') ? 1 : 0)
  const text = string.substring(start, stop)
  try {
    return JSON.parse(text)
  } catch (e) {
    console.error(`Failed to scrape JSON`, text)
    throw e
  }
})

const getPlayables = pageSource => scrapeJSON('window.Playables = ', '};', pageSource)
const getPageTitle = pageSource => {
  const startString = '<title>'
  const start = pageSource.indexOf(startString) + startString.length
  const stop = pageSource('</title>')
  return pageSource.substring(start, stop)
}

const getArtistTracks = (artistId, page = 1, callback) => {
  const uri = `${beatportUri}/artist/_/${artistId}/tracks?per-page=50&page=${page}`
  request(
    uri,
    handleErrorOrCallFn(callback, res => {
      try {
        return callback(null, getPlayables(res.body))
      } catch (e) {
        console.error(`Failed fetching playables from ${uri}`)
      }
    })
  )
}

const getLabelTracks = (labelId, page = 1, callback) => {
  const uri = `${beatportUri}/label/_/${labelId}/tracks?per-page=50&page=${page}`
  request(
    uri,
    handleErrorOrCallFn(callback, res => {
      try {
        return callback(null, getPlayables(res.body))
      } catch (e) {
        console.error(`Failed fetching playables from ${uri}`)
      }
    })
  )
}

const getTracksOnPage = (uri, callback) => {
  request(
    uri,
    handleErrorOrCallFn(callback, res => {
      try {
        const tracks = getPlayables(res.body)
        const title = getPageTitle(res.body)
        return callback(null, { tracks, title })
      } catch (e) {
        console.error(`Failed fetching playables from ${uri}`)
      }
    })
  )
}

const getApi = session => {
  const getJsonAsync = BPromise.promisify(session.getJson)
  const api = {
    getMyBeatport: callback => session.getJson(`${beatportUri}/api/my-beatport`, callback),
    getMyBeatportTracks: (page, callback) =>
      session.get(
        `${beatportUri}/my-beatport?page=${page}&_pjax=%23pjax-inner-wrapper`,
        handleErrorOrCallFn(callback, res => {
          console.log(`${beatportUri}/my-beatport?page=${page}&_pjax=%23pjax-inner-wrapper`)
          console.log(res)
          return callback(null, getPlayables(res))
        })
      ),
    getItemsInCarts: callback =>
      session.getJson(
        `${beatportUri}/api/cart/cart`,
        handleErrorOrCallFn(callback, res => {
          BPromise.map(res.carts.map(R.prop('id')), cartId => getJsonAsync(`${beatportUri}/api/cart/${cartId}`))
            .map(({ items }) => R.pluck('id', items))
            .then(R.flatten)
            .tap(idsOfItemsInCart => callback(null, idsOfItemsInCart))
            .catch(err => callback(err))
        })
      ),
    getTrack: (trackId, callback) => session.getJson(`https://embed.beatport.com/track?id=${trackId}`, callback),
    getClip: (trackId, callback) =>
      api.getTrack(
        trackId,
        handleErrorOrCallFn(callback, res => callback(null, res.results.preview))
      ),
    addTrackToCart: (trackId, cartId, callback) =>
      session.postJson(
        `${beatportUri}/api/${cartId}`,
        {
          items: [{ type: 'track', id: trackId }]
        },
        handleErrorOrCallFn(callback, res => callback(null, res))
      ),
    removeTrackFromCart: (trackId, cartId, callback) =>
      session.deleteJson(
        `${beatportUri}/api/cart/${cartId}`,
        {
          items: [{ type: 'track', id: trackId }]
        },
        handleErrorOrCallFn(callback, res => callback(null, res))
      ),
    getAvailableDownloadIds: (page = 1, callback) =>
      session.get(
        `${beatportUri}/downloads/available?page=${page}&per-page=1000`,
        handleErrorOrCallFn(callback, res => callback(null, getPlayables(res)))
      ),
    getDownloadedTracks: (page = 1, callback) =>
      session.get(
        `${beatportUri}/downloads/downloaded?page=${page}&per-page=1000`,
        handleErrorOrCallFn(callback, res => callback(null, getPlayables(res)))
      ),
    downloadTrackWithId: (downloadId, callback) =>
      getJsonAsync(`${beatportUri}/api/downloads/purchase?downloadId=${downloadId}`)
        .then(R.prop('download_url'))
        .then(downloadUrl => session.getBlob(downloadUrl, callback))
        .catch(err => callback(err)),
    getArtistTracks,
    getLabelTracks
  }

  return api
}

const handleCreateSessionResponse = callback => (err, session) => {
  if (err) {
    return callback(err)
  }
  const api = getApi(session)
  const ensureLoginSuccessful = () =>
    api.getMyBeatport(err => {
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
    return init(
      cookieUri,
      loginUri,
      username,
      password,
      csrfTokenKey,
      sessionCookieKey,
      handleCreateSessionResponse(callback)
    )
  },
  initWithSession: (sessionCookieValue, csrfToken, callback) => {
    return initWithSession(
      { [sessionCookieKey]: sessionCookieValue, [csrfTokenKey]: csrfToken },
      cookieUri,
      handleCreateSessionResponse(callback)
    )
  },
  initAsync: (username, password) =>
    BPromise.promisify(initializers.init)(username, password).then(api => BPromise.promisifyAll(api)),
  initWithSessionAsync: (sessionCookieValue, csrfToken) =>
    BPromise.promisify(initializers.initWithSession)(sessionCookieValue, csrfToken).then(api =>
      BPromise.promisifyAll(api)
    )
}

const staticFns = {
  getArtistTracks,
  getLabelTracks,
  getTracksOnPage
}

module.exports = { ...initializers, staticFns }
