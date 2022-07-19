#!/usr/bin/env bash
# BUILD-INDEX: build index.html files iteravily for public/data folder
set -euo pipefail

export ZIPFOLDER=~/public-svn/shared/sample-data/sfcta

cd dist
rm $ZIPFOLDER/sfcta.zip
zip -r $ZIPFOLDER/sfcta.zip *
cd $ZIPFOLDER
svn commit -m :

