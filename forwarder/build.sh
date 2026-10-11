#!/bin/sh
# Builds the home-screen forwarder's exefs (forwarder/exefs/main, main.npdm).
#
# The forwarder is switchbrew's nx-hbloader (ISC) with hbloader-romfs.patch:
# it starts the NRO named in romfs:/nextNroPath with romfs:/nextArgv, and
# returns to the home menu when that NRO exits. forwarder.json is hbloader's
# hbl.json as an application in the 05xx title range; the server builds one
# NSP per retro game around this exefs (src/retro/forwarder.js).
#
# Needs Docker. The output is committed, so the server image doesn't carry
# devkitPro; rerun this only when the patch, the json or the tag changes.
set -eu
HBLOADER_TAG=v2.4.5
here=$(cd "$(dirname "$0")" && pwd)
docker run --rm -v "$here:/fwd" devkitpro/devkita64:latest sh -euc "
  git clone -q --depth 1 --branch $HBLOADER_TAG https://github.com/switchbrew/nx-hbloader.git /tmp/hbl
  cd /tmp/hbl
  git apply /fwd/hbloader-romfs.patch
  cp /fwd/forwarder.json hbl.json
  make -s
  cp build/exefs/main build/exefs/main.npdm /fwd/exefs/
  chown $(id -u):$(id -g) /fwd/exefs/main /fwd/exefs/main.npdm
"
ls -l "$here/exefs"
