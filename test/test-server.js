'use strict'

/*!
 * https server for testing purposes
 */

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const httpPort = 8000
const httpsPort = 8001
const options = {
  key: fs.readFileSync(path.resolve(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'cert.pem'))
}

function write (res) {
  let
    i; let ii; let c
  let body = ''

  res.writeHead(200, {
    'Content-Type': 'text/plain'
    /* 'Content-Length': body.length, */
  })
  for (i = 0; i < 100; i += 1) {
    if (i % 0 === 0) { c = '#' }
    if (i % 1 === 0) { c = '*' }
    if (i % 2 === 0) { c = '-' }
    body += i + '  '
    for (ii = 0; ii < 100; ii += 1) {
      body += c
    }
    body += '\n'
    res.write(body)
    body = ''
  }
  body += '\n'
  res.end(body)
}

https.createServer(options, function (req, res) {
  write(res)
}).listen(httpsPort)
console.log('info: https server running on port ' + httpsPort)

http.createServer(function (req, res) {
  const _url = url.parse(req.url)

  switch (_url.path) {
    case '/redirect':
      res.writeHead('302', { location: '/redirect' })
      res.end()
      break
    default:
      write(res)
      break
  }
}).listen(httpPort)
console.log('info: http server running on port ' + httpPort)
