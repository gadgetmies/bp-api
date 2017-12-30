const BPromise = require('bluebird')
const R = require('ramda')
const { init } = require('request-in-session')

const loginUri = 'https://www.beatport.com/account/login'
const cookieUri = 'https://www.beatport.com/'

const api = {
  init: (username, password, callback) => {
    return init(cookieUri, loginUri, username, password, '_csrf_token', 'session', (err, session) => {
      if (err) {
        return callback(err)
      }

      const api = {
        getMyBeatport: callback => session.getJson('https://www.beatport.com/api/my-beatport', callback),
        getMyBeatportTracks: (page, callback) => 
          session.get(`https://www.beatport.com/my-beatport?page=${page}&_pjax=%23pjax-inner-wrapper`, (err, res) => {
            if (err) {
              return callback(err)
            }
          
            const startString = 'window.Playables = '
            const start = res.indexOf('window.Playables = ') + startString.length
            const stop = res.indexOf(';', start)
            callback(null, JSON.parse(res.substring(start, stop)))
          }),
        getItemsInCarts: (callback) => session.getJson('https://www.beatport.com/api/cart/cart', (err, res) => {
          if (err) {
            return callback(err)
          }

          const getJsonAsync = BPromise.promisify(session.getJson)
          BPromise.map(res.carts.map(R.prop('id')), 
            cartId => getJsonAsync(`https://www.beatport.com/api/cart/${cartId}`))
            .map(({items}) => R.pluck('id', items))
            .then(R.flatten)
            .tap(idsOfItemsInCart => callback(null, idsOfItemsInCart))
            .catch(err => callback(err))
        }),
        getTrack: (trackId, callback) => session.getJson(`https://embed.beatport.com/track?id=${trackId}`, callback),
        getClip: (trackId, callback) => api.getTrack(trackId, (err, res) =>
          err ? callback(err) : callback(null, res.results.preview)),
        addTrackToCart: (trackId, cartId, callback) => session.postJson(`https://www.beatport.com/api/${cartId}`, {
          'items': [{ 'type': 'track', 'id': trackId }]
          // , "trackingData": { "type": "product", "id": "9915168", "name": "Contradictions", "position": "1", "brand": "Shogun Audio", "category": "Tracks", "variant": "track", "list": "Track Detail", "price": "1.56", "dimension1": "Alix Perez", "dimension2": null, "dimension3": "Drum & Bass", "dimension4": null, "dimension12": null } 
        }, (err, res) => err ? callback(err) : callback(null, res))
      }
      return callback(null, api)
    })
  },
  initAsync: (username, password) =>
    BPromise.promisify(api.init)(username, password)
      .then(api => BPromise.promisifyAll(api))
}

module.exports = api
