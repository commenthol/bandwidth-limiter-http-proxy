"use strict";

/*!
 * bandwidth-limiter-http-proxy
 * Copyright (c) 2012 <commenthol@gmail.de>
 * MIT Licensed
 */
var 
	https = require('https'),
	http = require('http'),
	net = require('net'),
	url = require('url');

/*
 * settings
 */
var
	port = 8080,				// port under which proxy is available
	bandwidth_down = 64000,	// in bps
	bandwidth_up   = 32000,	// in bps
	latency        = 150;		// in ms

/*
The below stated values are an approximation of what we like to test.
It is obsolete to state that in different propagation situations like 
pedestrian, car at high speed, things definitely get worse. 
This proxy does *not* consider any packet-loss, retransmission, etc.
On the other hand a propagation model with one user in a cell, right 
next to the antenna, things should be far better.

GPRS
	bandwidth_down = 64000,	// in bps
	bandwidth_up   = 32000,	// in bps
	latency        = 150;		// in ms
EDGE
	bandwidth_down = 128000,	// in bps
	bandwidth_up   = 64000,		// in bps
	latency        = 90;			// in ms
UMTS
	bandwidth_down = 256000,	// in bps
	bandwidth_up   = 96000,		// in bps
	latency        = 60;			// in ms

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

/**
 * simple logger 
 */
var log = {
	level: 'info',
	conv: function(str, depth) {
		var s = '';
		depth = depth || 0;
		switch (typeof(str)) {
			case 'number':
				return str;
			case 'string':
				return "'" + str + "'";
			case 'object':
				if (depth > 2) {
					return "'[Object]'";
				}
				s += "{";
				for (var i in str) {
					s += " '"+ i +"': " + this.conv(str[i], depth+1);
					if (s[s.length-1] !== ',') {
						s += ',';
					}
				}
				if (s[s.length-1] === ',') {
					s = s.substring (0, s.length-1);
				}
				s += " },";
				return s;
			default:
				return;
		}
	},
	log: function (str) {
		console.log(this.conv(str));
	},
	debug: function(str) {
		if (this.level === 'debug') {
			this.log({time: Date.now(), debug: str});
		}
	},
	info: function(str) {
		if (this.level === 'debug' || 
				this.level === 'info') {
			this.log({time: Date.now(), info: str});
		}
	}, 
	warn: function(str) {
		if (this.level === 'debug' || 
				this.level === 'info' ||
				this.level === 'warn') {
			this.log({time: Date.now(), warn: str});
		}
	}, 
	error: function(str) {
		this.log({time: Date.now(), error: str});
	} 
};

/**
 * calculate the delay based on bandwith
 * 
 * @param length {number}, length of chunk
 * @param bandwidth {number}, bandwidth in bit per second
 * @returns {number}, delay in milliseconds required to transfer the 
 *   `length` bytes over a network with a given `bandwidth`.
 */
function calcDelay(length, bandwidth) {
	return parseInt(0.5 + length * 8 * 1000 / bandwidth, 10);
}

/**
 * calculate the length of the http header
 * 
 * @param headers {object}, contains http headers
 * @returns {number}, length in bytes used for the headers
 */
function calcHeaderLength(headers) {
	var
		reslen = 15;	// approx "HTTP/1.1 200 OK"
		
	if (headers) {
		for (var i in headers) {
			reslen += i.length + headers[i].length + 4; // 4 ": " + "\r\n"
		}
	}
	return reslen;
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
function proxy(options, connection, connection2) {
	var 
		delay = 0,								// single delay of one packet
		quene = [],								// array to store timestamps to measure the jitter
		timeref = 0,							// correct the time jitter between packets
		type = options.type || '',
		bytes = options.bytes || 0,
		next;

	// print out some info on throughput
	function transfer(bytes, timeref) {
		var 
			d = 0, 
			bw = 0;
		d = Date.now() - timeref;
		if (d !== 0 && bytes > 0) { 
			bw = parseInt(bytes * 8 * 1000 / d, 10);
			log.info({type: type, duration: d, bytes: bytes, bandwidth: bw, 
				url: options.url});
		}
	}
	
	// process quene
	function procQuene(quene) {
		var 
			now = Date.now(),
			jitter, 
			qo;
		
		qo = quene.shift(1) || {};
				
		if (qo.chunk !== undefined) {
			jitter = parseInt(qo.time - now, 10);
			log.debug({type: type, jitter: jitter, now: now, 
				packetlength: qo.chunk.length});
			connection2.write(qo.chunk, 'binary');
		}
		else {
			log.debug({type: type, msg: 'event end - connection.end'});
			connection2.end();
		}
		if (quene.length === 0) {
			transfer(bytes, timeref);
		}
	}

	// get next timestamp
	function timestamp(quene, delay) {
		var
			timeout,
			next = 0;
			
		if (quene[quene.length-1] && quene[quene.length-1].time) {
			next = quene[quene.length-1].time;
		}
		next += delay;
		timeout = next - Date.now();
		if (timeout < 0) {
			timeout = delay;
			next = Date.now() + delay;
		}
		return { time: next, timeout: timeout };
	}

	// data received
	connection.on('data', function (chunk) {
		if (timeref === 0) {
			timeref = Date.now();
			delay = options.delay || 0; // consider initial delay
			log.debug({type: type, timeref: timeref});
		} else {
			delay = 0;
		}
		// calc the latency
		delay += calcDelay(chunk.length, options.bandwidth);
		bytes += chunk.length;
		
		// add timestamp to quene
		next = timestamp(quene, delay);
		quene.push({time: next.time, chunk: chunk});
		
		log.debug({type: type, data: chunk.length, next: next.time, 
			delay: delay});

		setTimeout(function() { 
			procQuene(quene); 
		}, next.timeout);
	});
	
	// connection ends
	connection.on('end',	function() {
		delay = options.delay || 0;
		if (timeref === 0) {
			timeref = Date.now();
		}
		next = timestamp(quene, delay);
		quene.push({time: next.time});
		
		setTimeout(function() { 
			procQuene(quene); 
		}, next.timeout);
	});
}

/**
 * the proxy stuff
 */
var server = http.createServer( /*options,*/ );

server.listen(port);

// http proxy
server.on('request', function(request, response) {
	var
		options = {},			// options object for the http proxy request
		headers = {},			// headers object for the http proxy request
		_url,							// url parsing
		bytes,
		delay;

	/*
	// this will not work if the request is made to local servers
	// therefore use url parsing and set the request
	options = {
		host: request.headers['host'],
	};
	*/
	_url = url.parse(request.url);
	
	//log.info({url: request.url});

	headers = request.headers;
	headers && log.debug(headers);

	options = {
		hostname: _url.hostname || "localhost",
		port: _url.port || 80,
		method: request.method,
		path: _url.path || "/",
		headers: headers
	};

	var proxyRequest = http.request(options, function(proxyResponse) {
		var 
			bytes,
			delay;
			
		// calc the http headers length as this influences throughput on low speed networks
		// length of the response header bytes is initial delay
		bytes = calcHeaderLength(proxyResponse.headers);
		delay = calcDelay(bytes, bandwidth_down) + latency;

		response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
		proxy({
				url: request.url, 
				type: 'http-res', 
				delay: delay, 
				bytes: bytes,
				bandwidth: bandwidth_down }, 
			proxyResponse, response);
	});

	proxyRequest.on('error', function(e) {
		log.error('problem with request: ' + e.message);
		response.writeHead(500, { 'content-type': 'text/html' });
		response.write(e.message, 'utf-8');
		response.end();
  });
	proxyRequest.on('timeout', function(e) {
		log.error('problem with request: ' + e.message);
		response.writeHead(408, { 'content-type': 'text/html' });
		response.write(e.message, 'utf-8');
		response.end();
  });

	// calc the http headers length as this influences throughput on low speed networks
	bytes = calcHeaderLength(request.headers);
	delay = calcDelay(bytes, bandwidth_up) + latency;
	proxy({
			url: request.url, 
			type: 'http-req', 
			delay: delay, 
			bytes: bytes,
			bandwidth: bandwidth_up }, 
		request, proxyRequest);
	
	log.debug('-------');

});

// ssl tunneling http proxy
// References
// http://www.w3.org/Protocols/rfc2616/rfc2616-sec9
// http://muffin.doit.org/docs/rfc/tunneling_ssl.html
server.on('connect', function(request, socket, head){
	var 
		client,						// client socket for SSL
		host,
		options = {};			// options object for client 
	
	if (request.url) {
		host = request.url.match(/^(.*):(\d+$)/);
		if (host.length === 3) {
			options = { 
				host: host[1],
				port: host[2]
			};
		} else {
			socket.destroy();
			return; 
		}
		//log.info({url: request.url, protocol: 'https'});
	}
	
	// Return SSL-proxy greeting header.
	socket.write('HTTP/' + request.httpVersion + ' 200 Connection established\r\n\r\n');
	
	// Now forward SSL packets in both directions until done.
	client = net.connect(options, 
			function() { //'connect' listener
		log.debug('client connected');
	});

	// handle stream from origin
	proxy({
			url: request.url,
			type: 'https-req', 
			delay: latency, 
			bandwidth: bandwidth_up }, 
		socket, client);
	socket.on('error', function() {
		log.debug('socket error');
		client.end();
	});
	socket.on('timeout', function() {
		log.debug('socket timeout');
		client.end();
	});
	socket.on('close', function() {
		log.debug('socket close');
		client.end();
	});

	// handle stream to target
	proxy({
			url: request.url,
			type: 'https-res', 
			delay: latency, 
			bandwidth: bandwidth_down }, 
		client, socket);
	client.on('error', function() {
		log.debug('client error');
		socket.end();
	});
	client.on('timeout', function() {
		log.debug('client timeout');
		socket.end();
	});
	client.on('close', function() {
		log.debug('client close');
		socket.end();
	});

	log.debug('-------');
	
});

log.info("Proxy runs on port "+ port);
log.info("Download bandwidth is " + bandwidth_down + ' bps');
log.info("Upload bandwidth is " + bandwidth_up + ' bps');
log.info("Latency is " + latency + ' ms');
