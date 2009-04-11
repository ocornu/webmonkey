#!/bin/bash
SRC=$PWD/src
DOC=$PWD/doc
rm -rf $DOC
cd utils/jsdoc-toolkit
java -jar jsrun.jar app/run.js -a -t=templates/jsdoc -d=$DOC \
	$SRC/modules/lib/*.js \
	$SRC/modules/*.js \
	$SRC/chrome/content/lib/*.js \
	$SRC/chrome/content/*.js \
	$SRC/components/*.js
