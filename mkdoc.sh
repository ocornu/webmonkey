#!/bin/bash
SRC=$PWD/src
DOC=$PWD/doc
echo Build doc in $DOC

rm -rf $DOC
cd utils/jsdoc-toolkit

make() {
	java -jar jsrun.jar app/run.js -a -t=templates/webmonkey -d=$DOC \
		$SRC/modules/lib/*.js \
		$SRC/modules/*.js \
		$SRC/content/lib/*.js \
		$SRC/content/*.js \
		$SRC/components/*.js
}

if [ "$1" == "-v" ]; then
	make
else
	# remove warnings
	make | grep -v -e "^>> WARNING:"
fi
