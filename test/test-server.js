"use strict";

/*!
 * https server for testing purposes
 */
 
var 
	https = require('https'),
	http = require('http'),
	fs = require('fs'),
	url = require('url');

var 
	http_port  = 8000,
	https_port = 8001,
	options = {
		key: fs.readFileSync(__dirname + '/key.pem'),
		cert: fs.readFileSync(__dirname + '/cert.pem')
	},
	server;

function write(res) {
	var 
		i, ii, c,
		body = '';
	
  res.writeHead(200, { 
			'Content-Type': 'text/plain', 
			/*'Content-Length': body.length,*/
		});
  for (i=0; i<100; i+=1) {
		if (i % 0 === 0) { c = "#"; }
		if (i % 1 === 0) { c = "*"; }
		if (i % 2 === 0) { c = "-"; }
		body += i + "  ";
		for (ii=0; ii<100; ii+=1) {
			body += c;
		} 
		body += '\n'
		res.write(body);
		body = '';
	}
	body += '\n';
  res.end(body);
}

https.createServer(options, function (req, res) {
	write(res);
}).listen(https_port);
console.log('info: https server running on port ' + https_port);

http.createServer(function (req, res) {
	var 
		_url;
		
	_url = url.parse(req.url);
	
	switch (_url.path) {
		case '/redirect':
			res.writeHead('302', { location: '/redirect' });
			res.end();
			break;
		default:
			write(res);
			break;
		}
}).listen(http_port);
console.log('info: http server running on port ' + http_port);

