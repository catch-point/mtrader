#!/bin/sh
#
# Portions Copyright (c) 2017-2018 James Leigh, Some Rights Reserved
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

NAME=mtrader

# Read configuration variable file if it is present
[ -r "/etc/default/$NAME" ] && . "/etc/default/$NAME"

# Load the VERBOSE setting and other rcS variables
[ -r /lib/init/vars.sh ] && . /lib/init/vars.sh

if [ "`tty`" != "not a tty" ]; then
  VERBOSE="yes"
fi

# resolve links - $0 may be a softlink
PRG="$0"

while [ -h "$PRG" ] ; do
  ls=`ls -ld "$PRG"`
  link=`expr "$ls" : '.*-> \(.*\)$'`
  if expr "$link" : '/.*' > /dev/null; then
    PRG="$link"
  else
    PRG=`dirname "$PRG"`/"$link"
  fi
done

PRGDIR=$(cd `dirname "$PRG"`;pwd)

# uninstall daemon
if [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" ]; then
  systemctl stop "$NAME"
  journalctl -n 2 -u "$NAME"
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

if [ -z "$PREFIX" -a -x "$PRGDIR/mtrader" ]; then
  PREFIX="$PRGDIR/.."
elif [ -z "$PREFIX" ]; then
  PREFIX=$(sudo -iu "$DAEMON_USER" npm prefix -g)
fi

if [ -z "$CONFIG_DIR" ]; then
  if [ "$PREFIX" = "$BASEDIR" ]; then
    CONFIG_DIR=etc
    CACHE_DIR=var/cache
  elif [ "$PREFIX" = "/usr" ]; then
    CONFIG_DIR=../etc/$NAME
    CACHE_DIR=../var/cache/$NAME
  elif [ -d "$PREFIX/etc" -o -d "$PREFIX/var" ]; then
    CONFIG_DIR=etc/$NAME
    CACHE_DIR=var/cache/$NAME
  else
    CONFIG_DIR=etc
    CACHE_DIR=var/cache
  fi
fi

# Check if IB Gateway is installed
if ls "$BASEDIR/Jts/ibgateway"/*/ibgateway > /dev/null 2>/dev/null; then
  IBG_LATEST=$(ls -t "$BASEDIR/Jts/ibgateway"/*/ibgateway |head -n 1)
  if [ "`tty`" != "not a tty" ]; then
    read -p "Do you want to uninstall IB Gateway $(basename "$(dirname "$IBG_LATEST")")? [Y,n]:" UNINSTALL_IBG
  fi
  if [ "$UNINSTALL_IBG" = "Y" -o "$UNINSTALL_IBG" = "y" -o "$UNINSTALL_IBG" = "YES" -o "$UNINSTALL_IBG" = "yes" -o -z "$UNINSTALL_IBG" ]; then
    yes |sudo -iu "$DAEMON_USER" sh $(dirname "$IBG_LATEST")/uninstall -c -q
  fi
fi
IBC_JAR="$PREFIX/lib/IBC.jar"
if [ -e "$IBC_JAR" ]; then
  rm "$IBC_JAR"
fi

# Check if certbot was installed
if [ -z "$CERTBOT" -a "$(id -u)" = "0" ]; then
  if [ -x "$PREFIX/bin/certbot" ]; then
    CERTBOT="$PREFIX/bin/certbot"
  elif [ -x "$PREFIX/bin/certbot-auto" ]; then
    CERTBOT="$PREFIX/bin/certbot-auto"
  elif [ -x "$(which certbot)" ]; then
    CERTBOT="$(which certbot)"
  elif [ -x "$(which certbot)" ]; then
    CERTBOT="$(which certbot)"
  fi
fi
if [ -z "$CERTBOT" ]; then
  $CERTBOT delete --cert-name "$NAME"
fi
if [ -x "$PREFIX/bin/certbot-auto" ]; then
  rm "$PREFIX/bin/certbot-auto"
fi

# uninstall/upgrade software
if [ "$PREFIX" = "$BASEDIR" ]; then
  sudo -iu "$DAEMON_USER" npm uninstall mtrader -g
elif [ "$(id -u)" = "0" ]; then
  npm uninstall mtrader -g
elif [ ! -x "$(which mtrader)" ]; then
  PREFIX=$(npm prefix)
  npm uninstall mtrader
fi

# Remove configuration
if [ -f "$PREFIX/etc/mtrader.json" ]; then
  rm -f "$PREFIX/etc/mtrader.json" "$PREFIX/bin/certbot-pre-$NAME" "$PREFIX/bin/certbot-post-$NAME" "$PREFIX/bin/uninstall-$NAME"
  # remove generated certificates
  rm -f "$PREFIX/etc/mtrader-privkey.pem" "$PREFIX/etc/mtrader-fullchain.pem" "$PREFIX/etc/mtrader-crt.pem" "$PREFIX/etc/mtrader-dh.pem" "$PREFIX/etc/mtrader-cert.pem" "$PREFIX/etc/mtrader-ca.pem" "$PREFIX/etc/mtrader-csr.pem"
  rm -rf "$PREFIX/$CACHE_DIR"
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
