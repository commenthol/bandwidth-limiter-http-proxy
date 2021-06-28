#!/usr/bin/env node

'use strict'

/*!
 * bandwidth-limiter-http-proxy
 * Copyright (c) 2012 <commenthol@gmail.de>
 * MIT Licensed
 */
const http = require('http')
const net = require('net')
const url = require('url')

/*
 * settings
 */
const port = 8080 // port under which proxy is available
let bandwidthDown = 64000 // in bps
let bandwidthUp = 32000 // in bps
let latency = 150 // in ms

/*
The below stated values are an approximation of what we like to test.
It is obsolete to state that in different propagation situations like
pedestrian, car at high speed, things definitely get worse.
This proxy does *not* consider any packet-loss, retransmission, etc.
On the other hand a propagation model with one user in a cell, right
next to the antenna, things should be far better.

Never use raw bandwidths as given below as packet overhead on radio-link,
mac-layer and tcp needs to be considered as well.

From http://publik.tuwien.ac.at/files/pub-et_12521.pdf

Table 1. Measured ping times (32 bytes)
Technology   Bandwidth (down/up) Mean   Std
GPRS      80/40 kbit/s   488 ms    146 ms
EDGE    240/120 kbit/s   504 ms     89 ms
UMTS    384/128 kbit/s   142 ms     58 ms
HSDPA  1800/384 kbit/s    91 ms     43 ms
ADSL   1000/256 kbit/s  10.9 ms    0.8 ms
*/

const settingspage = '<!doctype html><html><head><meta charset="utf-8" /><title>Proxy Settings</title><style type="text/css"> *{margin:0px;padding:3px;font-family:Sans-Serif}body{margin:0px auto;max-width:320px}ul{list-style:none}li{clear:both}section{margin:7px;border:1px solid #ccc}.r{float:right}</style></head><body><h1>Proxy Settings</h1><section><h2>Current</h2><ul><li>Bandwidth Download: <span class="r">#bandwidthDown# bps</span></li><li>Bandwidth Upload: <span class="r">#bandwidthUp# bps</span></li><li>Latency: <span class="r">#latency# ms</span></li></ul></section><section><h2>Profile</h2><ul><li><a href="/?dn=64000&up=32000&la=200">GPRS</a></li><li><a href="/?dn=128000&up=64000&la=200">EDGE</a></li><li><a href="/?dn=256000&up=96000&la=90">UMTS</a></li><li><a href="/?dn=1200000&up=256000&la=60">HSDPA</a></li><li><a href="/?dn=1200000&up=1200000&la=25">LTE 4G</a></li><li><a href="/?dn=33600&up=33600&la=100">V.34 33kbps modem</a></li><li><a href="/?dn=56000&up=48000&la=100">V.92 56kbps modem</a></li><li><a href="/?dn=64000&up=64000&la=25">ISDN</a></li><li><a href="/?dn=128000&up=128000&la=25">ISDN (2 channels)</a></li><li><a href="/?dn=384000&up=64000&la=25">DSL light</a></li><li><a href="/?dn=900000&up=256000&la=25">ADSL</a></li></ul></section><section><h2>Custom</h2><form method="get" action="/"><ul><li><label for="dn">Bandwidth Download (&gt;1000 bps)</label><br/><input name="dn" value="#bandwidthDown#"/></li><li><label for="up">Bandwidth Upload (&gt;1000 bps)</label><br/><input name="up" value="#bandwidthUp#"/></li><li><label for="la">Latency (&lt;1000 ms)</label><br/><input name="la" value="#latency#"/></li><li><input type="submit"/></li></ul></form></section></body></html>'
// settingspage = require('fs').readFileSync(__dirname + '/p.html') + '';

/**
 * simple logger
 */
const log = {
  level: 'info',
  conv: function (str, depth) {
    let s = ''
    depth = depth || 0
    switch (typeof (str)) {
      case 'number':
        return str
      case 'string':
        return "'" + str + "'"
      case 'object':
        if (depth > 3) {
          return "'[Object]'"
        }
        s += '{'
        for (const i in str) {
          // s += "\n";
          s += " '" + i + "': " + this.conv(str[i], depth + 1)
          if (s[s.length - 1] !== ',') {
            s += ','
          }
        }
        if (s[s.length - 1] === ',') {
          s = s.substring(0, s.length - 1)
        }
        s += ' },'
        return s
      default:
    }
  },
  log: function (str) {
    console.log(this.conv(str))
  },
  debug: function (str) {
    if (this.level === 'debug') {
      this.log({ time: Date.now(), debug: str })
    }
  },
  info: function (str) {
    if (this.level === 'debug' ||
    this.level === 'info') {
      this.log({ time: Date.now(), info: str })
    }
  },
  warn: function (str) {
    if (this.level === 'debug' ||
    this.level === 'info' ||
    this.level === 'warn') {
      this.log({ time: Date.now(), warn: str })
    }
  },
  error: function (str) {
    this.log({ time: Date.now(), error: str })
  }
}

/**
 * calculate the delay based on bandwith
 *
 * @param length {number}, length of chunk
 * @param bandwidth {number}, bandwidth in bit per second
 * @returns {number}, delay in milliseconds required to transfer the
 *   `length` bytes over a network with a given `bandwidth`.
 */
function calcDelay (length, bandwidth) {
  return parseInt(0.5 + length * 8 * 1000 / bandwidth, 10)
}

/**
 * calculate the length of the http header
 *
 * @param headers {object}, contains http headers
 * @returns {number}, length in bytes used for the headers
 */
function calcHeaderLength (headers) {
  let
    reslen = 15 // approx "HTTP/1.1 200 OK"

  if (headers) {
    for (const i in headers) {
      reslen += i.length + headers[i].length + 4 // 4 ": " + "\r\n"
    }
  }
  return reslen
}

/**
 * proxy connection to connection2
 * delay the connection by a given latency and bandwidth
 *
 * @param options {object},
 *   bandwidth {number}, bandwidth in bit per second
 *   delay {number}, initial delay in milliseconds (use to add latency)
 *   type {string} optional, used for debugging, defaults to ''
 * @param connection {object}, connection with is proxied
 *   Can be either a http req, res object or a socket
 * @param connection2 {object}, proxied connection
 *   Can be either a http req, res object or a socket
 */
function proxy (options, connection, connection2) {
  let delay = 0 // single delay of one packet
  const quene = [] // array to store timestamps to measure the jitter
  let timeref = 0 // correct the time jitter between packets
  const type = options.type || ''
  let bytes = options.bytes || 0
  let next

  // print out some info on throughput
  function transfer (bytes, timeref) {
    let
      d = 0
    let bw = 0
    d = Date.now() - timeref
    if (d !== 0 && bytes > 0) {
      bw = parseInt(bytes * 8 * 1000 / d, 10)
      log.info({
        type: type,
        duration: d,
        bytes: bytes,
        bandwidth: bw,
        url: options.url
      })
    }
  }

  // process quene
  function procQuene (quene) {
    const now = Date.now()
    let jitter

    const qo = quene.shift(1) || {}

    if (qo.chunk !== undefined) {
      jitter = parseInt(qo.time - now, 10)
      log.debug({
        type: type,
        jitter: jitter,
        now: now,
        packetlength: qo.chunk.length
      })
      connection2.write(qo.chunk, 'binary')
    } else {
      log.debug({ type: type, msg: 'event end - connection.end' })
      connection2.end()
    }
    if (quene.length === 0) {
      transfer(bytes, timeref)
    }
  }

  // get next timestamp
  function timestamp (quene, delay) {
    let timeout
    let next = 0

    if (quene[quene.length - 1] && quene[quene.length - 1].time) {
      next = quene[quene.length - 1].time
    }
    next += delay
    timeout = next - Date.now()
    if (timeout < 0) {
      timeout = delay
      next = Date.now() + delay
    }
    return { time: next, timeout: timeout }
  }

  // data received
  connection.on('data', function (chunk) {
    if (timeref === 0) {
      timeref = Date.now()
      delay = options.delay || 0 // consider initial delay
      log.debug({ type: type, timeref: timeref })
    } else {
      delay = 0
    }
    // calc the latency
    delay += calcDelay(chunk.length, options.bandwidth)
    bytes += chunk.length

    // add timestamp to quene
    next = timestamp(quene, delay)
    quene.push({ time: next.time, chunk: chunk })

    log.debug({
      type: type,
      data: chunk.length,
      next: next.time,
      delay: delay
    })

    setTimeout(function () {
      procQuene(quene)
    }, next.timeout)
  })

  // connection ends
  connection.on('end', function () {
    delay = options.delay || 0
    if (timeref === 0) {
      timeref = Date.now()
    }
    next = timestamp(quene, delay)
    quene.push({ time: next.time })

    setTimeout(function () {
      procQuene(quene)
    }, next.timeout)
  })
}

/**
 * the proxy stuff
 */
const server = http.createServer(/* options, */)

// http proxy
server.on('request', function (request, response) {
  let options = {} // options object for the http proxy request
  let headers = {} // headers object for the http proxy request
  let bytes
  let delay

  /*
  // this will not work if the request is made to local servers
  // therefore use url parsing and set the request
  options = {
  host: request.headers['host'],
  };
  */
  const _url = url.parse(request.url)

  // log.info({url: request.url});

  headers = request.headers
  headers && log.debug(headers)

  options = {
    hostname: _url.hostname || 'localhost',
    port: _url.port || 80,
    method: request.method,
    path: _url.path || '/',
    headers: headers
  }

  // proxy settings page
  if (request.headers.host === ('localhost:' + port)) {
    if (_url.pathname === '/') {
      let q, qq, v, i

      // change settings
      if (_url.query) {
        q = _url.query.split('&')
        for (i in q) {
          qq = q[i].split('=')
          if (qq[1]) {
            v = parseInt(qq[1], 10)
            if (typeof (v) === 'number') {
              switch (qq[0]) {
                case 'dn':
                  if (v > 1000) {
                    bandwidthDown = v
                  }
                  break
                case 'up':
                  if (v > 1000) {
                    bandwidthUp = v
                  }
                  break
                case 'la':
                  if (qq[1] < 1000) {
                    latency = v
                  }
                  break
              }
            }
          }
        }
        log.info({
          'new settings': {
            bandwidthDown: bandwidthDown,
            bandwidthUp: bandwidthUp,
            latency: latency
          }
        })
        response.writeHead('302', { Location: '/' })
        response.end()
        return
      }

      const p = settingspage
        .replace(/#bandwidthDown#/g, bandwidthDown)
        .replace(/#bandwidthUp#/g, bandwidthUp)
        .replace(/#latency#/g, latency)
      response.writeHead('200', { 'Content-Type': 'text/html', 'Content-Length': p.length })
      response.end(p)
    } else {
      response.end('404')
    }
  } else {
    // handle proxy requests

    const proxyRequest = http.request(options, function (proxyResponse) {
      // calc the http headers length as this influences throughput on low speed networks
      // length of the response header bytes is initial delay
      const bytes = calcHeaderLength(proxyResponse.headers)
      const delay = calcDelay(bytes, bandwidthDown) + latency

      response.writeHead(proxyResponse.statusCode, proxyResponse.headers)
      proxy({
        url: request.url,
        type: 'http-res',
        delay: delay,
        bytes: bytes,
        bandwidth: bandwidthDown
      },
      proxyResponse, response)
    })

    proxyRequest.on('error', function (e) {
      log.error('problem with request: ' + e.message)
      response.writeHead(500, { 'content-type': 'text/html' })
      response.write(e.message, 'utf-8')
      response.end()
    })
    proxyRequest.on('timeout', function (e) {
      log.error('problem with request: ' + e.message)
      response.writeHead(408, { 'content-type': 'text/html' })
      response.write(e.message, 'utf-8')
      response.end()
    })

    // calc the http headers length as this influences throughput on low speed networks
    bytes = calcHeaderLength(request.headers)
    delay = calcDelay(bytes, bandwidthUp) + latency
    proxy({
      url: request.url,
      type: 'http-req',
      delay: delay,
      bytes: bytes,
      bandwidth: bandwidthUp
    },
    request, proxyRequest)

    log.debug('-------')
  }
})

// ssl tunneling http proxy
// References
// http://www.w3.org/Protocols/rfc2616/rfc2616-sec9
// http://muffin.doit.org/docs/rfc/tunneling_ssl.html
server.on('connect', function (request, socket, head) {
  let host
  let options = {} // options object for client

  if (request.url) {
    host = request.url.match(/^(.*):(\d+$)/)
    if (host.length === 3) {
      options = {
        host: host[1],
        port: host[2]
      }
    } else {
      socket.destroy()
      return
    }
    // log.info({url: request.url, protocol: 'https'});
  }

  // Return SSL-proxy greeting header.
  socket.write('HTTP/' + request.httpVersion + ' 200 Connection established\r\n\r\n')

  // Now forward SSL packets in both directions until done.
  const client = net.connect(options,
    function () { // 'connect' listener
      log.debug('client connected')
    })

  // handle stream from origin
  proxy({
    url: request.url,
    type: 'https-req',
    delay: latency,
    bandwidth: bandwidthUp
  },
  socket, client)
  socket.on('error', function () {
    log.debug('socket error')
    client.end()
  })
  socket.on('timeout', function () {
    log.debug('socket timeout')
    client.end()
  })
  socket.on('close', function () {
    log.debug('socket close')
    client.end()
  })

  // handle stream to target
  proxy({
    url: request.url,
    type: 'https-res',
    delay: latency,
    bandwidth: bandwidthDown
  },
  client, socket)
  client.on('error', function () {
    log.debug('client error')
    socket.end()
  })
  client.on('timeout', function () {
    log.debug('client timeout')
    socket.end()
  })
  client.on('close', function () {
    log.debug('client close')
    socket.end()
  })

  log.debug('-------')
})

module.exports = server

if (module === require.main) {
  server.listen(port)
  log.info('Proxy runs on port ' + port)
  log.info('Download bandwidth is ' + bandwidthDown + ' bps')
  log.info('Upload bandwidth is ' + bandwidthUp + ' bps')
  log.info('Latency is ' + latency + ' ms')
}
