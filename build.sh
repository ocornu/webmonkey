#!/bin/sh

# Set up variables
NAME=webmonkey
VERSION=`grep "<em:version>" src/install.rdf | sed -r "s/^\s*<em:version>(.+)<\/em:version>\s*$/\\1/"`
BUILD=$VERSION
if [ "$1" != "-r" ]; then
	DATE=`date +"%Y%m%d"`
	BUILD="$BUILD.$DATE.${1-0}"
fi
XPI="$NAME-$BUILD.xpi"

# Copy base structure to a temporary build directory and change to it
echo "Creating working directory ..."
rm -rf build
mkdir build
cd src
cp -r chrome.manifest install.rdf license.txt \
	defaults components content locale modules \
	../build/
cd ../build

echo "Gathering all locales into chrome.manifest ..."
LOCALES=\"en-US\"
for entry in locale/*; do
  entry=`basename $entry`
  if [ $entry != en-US ]; then
    echo "locale  $NAME  $entry  locale/$entry/" >> chrome.manifest
    LOCALES=$LOCALES,\ \"$entry\"
  fi
done

echo "Patching install.rdf version ..."
sed "s!<em:version>.*</em:version>!<em:version>$BUILD</em:version>!" \
  install.rdf > install.rdf.tmp
mv install.rdf.tmp install.rdf

echo "Cleaning up unwanted files ..."
find . -depth -name '.svn' -exec rm -rf "{}" \;
find . -depth -name '*~' -exec rm -rf "{}" \;
find . -depth -name '#*' -exec rm -rf "{}" \;

echo "Creating $XPI ..."
zip -qr9X "../$XPI" *

echo "Cleaning up temporary files ..."
cd ..
rm -rf build
