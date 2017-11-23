#!/bin/sh
#
# Portions Copyright (c) 2017 James Leigh, Some Rights Reserved
#
#  Redistribution and use in source and binary forms, with or without
#  modification, are permitted provided that the following conditions are met:
#
#  1. Redistributions of source code must retain the above copyright notice,
#  this list of conditions and the following disclaimer.
#
#  2. Redistributions in binary form must reproduce the above copyright
#  notice, this list of conditions and the following disclaimer in the
#  documentation and/or other materials provided with the distribution.
#
#  3. Neither the name of the copyright holder nor the names of its
#  contributors may be used to endorse or promote products derived from this
#  software without specific prior written permission.
#
#  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
#  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
#  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
#  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
#  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
#  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
#  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
#  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
#  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
#  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
#  POSSIBILITY OF SUCH DAMAGE.
#

#
# Usage: bash <(curl -sL https://raw.githubusercontent.com/ptrading/ptrading/master/uninstall-worker.sh)
#

NAME=ptrading-worker

# Read configuration variable file if it is present
[ -r "/etc/default/$NAME" ] && . "/etc/default/$NAME"

# Load the VERBOSE setting and other rcS variables
[ -r /lib/init/vars.sh ] && . /lib/init/vars.sh

if [ "`tty`" != "not a tty" ]; then
  VERBOSE="yes"
fi

# uninstall daemon
if [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" ]; then
  systemctl stop "$NAME"
  rm "/etc/systemd/system/$NAME.service"
  systemctl daemon-reload
fi

# check daemon user/group
if [ "$(id -u)" != "0" ]; then
  BASEDIR=$HOME
  DAEMON_USER=$(id -un)
  DAEMON_GROUP=$(id -un)
else
  if [ -z "$DAEMON_USER" ] ; then
    DAEMON_USER=$NAME
  fi
  if [ -z "$DAEMON_GROUP" ] ; then
    DAEMON_GROUP=$NAME
  fi
  BASEDIR=$(eval echo ~$DAEMON_USER)
fi

# uninstall/upgrade software
PREFIX=$(sudo -iu "$DAEMON_USER" npm prefix -g)
if [ "$PREFIX" = "$BASEDIR" ]; then
  sudo -iu "$DAEMON_USER" npm uninstall ptrading -g
elif [ "$(id -u)" = "0" ]; then
  npm uninstall ptrading -g
elif [ ! -x "$(which ptrading)" ]; then
  PREFIX=$(npm prefix)
  npm uninstall ptrading
fi

# Remove configuration
if [ -f "$PREFIX/etc/ptrading.json" ]; then
  if [ "$PREFIX" = "$BASEDIR" ]; then
    CONFIG_DIR=etc
    DATA_DIR=var
  elif [ "$PREFIX" = "/usr" ]; then
    CONFIG_DIR=../etc/$NAME
    DATA_DIR=../var/cache/$NAME
  elif [ -d "$PREFIX/etc/$NAME" -o -d "$PREFIX/var/cache/$NAME" ]; then
    CONFIG_DIR=etc/$NAME
    DATA_DIR=var/cache/$NAME
  else
    CONFIG_DIR=etc
    DATA_DIR=var
  fi
  rm "$PREFIX/etc/ptrading.json"
  # remove generated certificates
  if [ -x "$(which openssl)" ]; then
    rm "$PREFIX/etc/ptrading-key.pem" "$PREFIX/etc/ptrading-csr.pem" "$PREFIX/etc/ptrading-cert.pem"
  fi
  rm -rf "$PREFIX/$DATA_DIR"
  rmdir "$PREFIX/$CONFIG_DIR"
fi

# uninstall daemon user/group
if [ "$(id -u)" = "0" ]; then
  if id "$DAEMON_USER" >/dev/null 2>&1 ; then
    deluser --remove-home "$DAEMON_USER"
  fi
  if grep -q "$DAEMON_GROUP" /etc/group ; then
      delgroup "$DAEMON_GROUP"
  fi
fi
