openssl genrsa -out key.pem 1024
openssl req -new -key key.pem -out csr.pem
openssl x509 -req -in csr.pem -signkey key.pem -out cert.pem
#openssl pkcs12 -export -in cert.pem -inkey key.pem \
#	-certfile ca-cert.pem -out agent5.pfx