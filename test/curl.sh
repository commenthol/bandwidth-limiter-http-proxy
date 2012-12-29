#!/bin/bash

_measure() {
start=`date +%s%N`
$1 >> o
end=`date +%s%N`
# calc time in ms
echo "( $end - $start ) / 1000000" | bc 
echo -e "\n\n" >> o
}

echo > o

_measure "curl -vk -x localhost:8080 http://localhost:8000"
_measure "curl -vk -x localhost:8080 https://localhost:8001"
_measure "curl -v -x localhost:8080 http://localhost:8000/redirect"


