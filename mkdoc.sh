#!/bin/bash
SRC=$PWD/src
DOC=$PWD/doc
echo Build doc in $DOC

rm -rf $DOC
cd utils/jsdoc-toolkit

make() {
	java -jar jsrun.jar app/run.js -a -t=templates/webmonkey -d=$DOC \
		-x=js,jsm \
		$SRC/modules/lib \
		$SRC/modules/script \
		$SRC/modules \
		$SRC/content/lib \
		$SRC/content/*.js \
		$SRC/components
}

if [ "$1" == "-v" ]; then
	make
else
	# remove warnings
	make | grep -v -e "^>> WARNING:"
fi
