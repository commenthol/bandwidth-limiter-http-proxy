# bandwidth-limiter-http-proxy

Simple HTTP/HTTPS proxy to simulate slow network conditions.
The proxy adds an additional latency and delay in accordance with the set bandwidth.
No simulation of packetloss, retransmission, etc. is made.

## Usage

```
npm i -g bandwidth-limiter-http-proxy

bandwidth-limiter-http-proxy
```

## Settings

Open http://localhost:8080 in your browser and change the settings.
A list of preconfigured profiles for typical modem, mobile and fixnet networks exists.
Changes are applied instantly to the proxy.

The following profiles are available:
* GPRS, EDGE, UMTS, HSDPA, LTE 4G,
* V.34 33kbps modem, V.92 56kbps modem, ISDN, ISDN (2 channels)
* DSL light, ADSL

![Proxy Settings Image](https://raw.githubusercontent.com/commenthol/bandwidth-limiter-http-proxy/master/docs/proxy-settings.png)

## Browser confguration

In your favourite browser set up a proxy connection to `localhost:8080`.

Firefox:
  1. (Menu)Edit >Preferences >(Tab)Advanced >(Tab)Network >(Section)Connection >(Button)Settings...
  2. (Radio)Manual Proxy Configuration
    * HTTP-Proxy: localhost:8080
    * SSL-Proxy: localhost:8080

Chrome:
  1. Download and install extension (e.g. Proxxy)


### License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
