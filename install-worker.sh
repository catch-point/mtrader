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
# Usage:
# sudo bash -c 'bash <(curl -sL https://raw.githubusercontent.com/ptrading/ptrading/master/install-worker.sh)'
#

NAME=ptrading-worker

# Read configuration variable file if it is present
[ -r "/etc/default/$NAME" ] && . "/etc/default/$NAME"

# Load the VERBOSE setting and other rcS variables
[ -r /lib/init/vars.sh ] && . /lib/init/vars.sh

if [ "`tty`" != "not a tty" ]; then
  VERBOSE="yes"
fi

# Check if npm is installed
if [ ! -x "$(which npm)" ]; then
  echo "node.js/npm is not installed" 1>&2
  if [ -x "$(which apt-get)" -a "$(id -u)" = "0" ]; then
    curl -sL https://deb.nodesource.com/setup_8.x | bash -
    apt-get install -y nodejs
  fi
fi
if [ ! -x "$(which npm)" ]; then
  echo "node.js/npm is required to run this program" 1>&2
  exit 5
fi

# install daemon user/group
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
  if ! grep -q "$DAEMON_GROUP" /etc/group ; then
      groupadd -r "$DAEMON_GROUP"
  fi
  if ! id "$DAEMON_USER" >/dev/null 2>&1 ; then
    BASEDIR=/opt/$NAME
    useradd -d "$BASEDIR" -g "$DAEMON_GROUP" -r "$DAEMON_USER"
    mkdir -p "$BASEDIR"
    echo 'prefix=${HOME}' > "$BASEDIR/.npmrc"
    chown "$DAEMON_USER:$DAEMON_GROUP" "$BASEDIR" "$BASEDIR/.npmrc"
  else
    BASEDIR=$(eval echo ~$DAEMON_USER)
  fi
fi

# Install/upgrade software
PREFIX=$(sudo -iu "$DAEMON_USER" npm prefix -g)
if [ "$PREFIX" = "$BASEDIR" ]; then
  sudo -iu "$DAEMON_USER" npm install ptrading/ptrading -g
elif [ "$(id -u)" = "0" ]; then
  npm install ptrading/ptrading -g
elif [ ! -x "$(which ptrading)" ]; then
  PREFIX=$(npm prefix)
  npm install ptrading/ptrading
fi

# Setup configuration
if [ ! -f "$PREFIX/etc/ptrading.json" ]; then
  if [ "$PREFIX" = "$BASEDIR" ]; then
    CONFIG_DIR=etc
    DATA_DIR=var
  elif [ "$PREFIX" = "/usr" ]; then
    CONFIG_DIR=../etc/$NAME
    DATA_DIR=../var/cache/$NAME
  elif [ -d "$PREFIX/etc" -o -d "$PREFIX/var" ]; then
    CONFIG_DIR=etc/$NAME
    DATA_DIR=var/cache/$NAME
  else
    CONFIG_DIR=etc
    DATA_DIR=var
  fi
  mkdir -p "$PREFIX/etc" "$PREFIX/$CONFIG_DIR" "$PREFIX/$DATA_DIR"
  if [ -z "$USERINFO" ]; then
    USERINFO=$(nodejs -pe '[require("crypto").randomBytes(4)].map(rnd=>rnd.readUIntBE(0,2).toString(36)+":"+rnd.readUIntBE(2,2).toString(36)).toString()')
  fi
  if [ -z "$DEFAULT_PORT" -a "$(id -u)" = "0" -a -x "$(which openssl)" -a "`tty`" != "not a tty" ]; then
    DEFAULT_PORT=443
  elif [ -z "$DEFAULT_PORT" -a -x "$(which openssl)" -a "`tty`" != "not a tty" ]; then
    DEFAULT_PORT=1443
  elif [ -z "$DEFAULT_PORT" -a "$(id -u)" = "0" ]; then
    DEFAULT_PORT=80
  elif [ -z "$DEFAULT_PORT" ]; then
    DEFAULT_PORT=1880
  fi
  if [ -z "$PORT" -a "`tty`" != "not a tty" ]; then
    read -p "Port (e.g. port to listen on) [$DEFAULT_PORT]:" PORT
  fi
  if [ -z "$PORT" ]; then
    PORT=$DEFAULT_PORT
  fi
  # generate certificates
  if [ -x "$(which openssl)" -a "`tty`" != "not a tty" -a "$PORT" != 80 -a "$PORT" != 1880 ]; then
    if [ ! -f "$PREFIX/etc/ptrading-key.pem" ] ; then
      echo -e "\x1b[1m\x1b[33m*** Use FQDN as the Common Name below for direct clients ***\x1b[0m" 1>&2
      openssl genrsa -out "$PREFIX/etc/ptrading-key.pem" 2048
      chmod go-rwx "$PREFIX/etc/ptrading-key.pem"
      chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/ptrading-key.pem"
    fi
    if [ ! -f "$PREFIX/etc/ptrading-csr.pem" ] ; then
      openssl req -new -sha256 -key "$PREFIX/etc/ptrading-key.pem" -out "$PREFIX/etc/ptrading-csr.pem"
    fi
    if [ ! -f "$PREFIX/etc/cert.pem" ] ; then
      openssl x509 -req -in "$PREFIX/etc/ptrading-csr.pem" -signkey "$PREFIX/etc/ptrading-key.pem" -out "$PREFIX/etc/ptrading-cert.pem"
    fi
    AUTHORITY=$(openssl x509 -inform PEM -in "$PREFIX/etc/ptrading-cert.pem" -text |grep Subject |grep CN= |sed 's/.*CN=//')
    if [ -z "$HOST" ]; then
      read -p "Hostname (e.g. interface to listen on) [$AUTHORITY]:" HOST
      if [ -z "$HOST" ]; then
        HOST=$AUTHORITY
      fi
    fi
    echo "Add \"remote_workers\":[\"wss://$USERINFO@$AUTHORITY:$PORT\"] to client etc/ptrading.json file"
    cat > "$PREFIX/etc/ptrading.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "config_dir": "$CONFIG_DIR",
  "data_dir": "$DATA_DIR",
  "listen": "wss://$USERINFO@$HOST:$PORT",
  "tls": {
    "key_pem": "etc/ptrading-key.pem",
    "cert_pem": "etc/ptrading-cert.pem",
    "ca_pem": "etc/ptrading-cert.pem",
    "request_cert": false,
    "reject_unauthorized": false
  }
}
EOF
  else
    if [ -z "$HOST" ]; then
      read -p "Hostname (e.g. interface to listen on) [$(hostname -f |tr '[A-Z]' '[a-z]')]:" HOST
      if [ -z "$HOST" ]; then
        HOST=$(hostname -f |tr '[A-Z]' '[a-z]')
      fi
    fi
    echo "Add \"remote_workers\":[\"ws://$USERINFO@$HOST:$PORT\"] to client etc/ptrading.json file"
    cat > "$PREFIX/etc/ptrading.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "config_dir": "$CONFIG_DIR",
  "data_dir": "$DATA_DIR",
  "listen": "ws://$USERINFO@$HOST:$PORT",
  "tls": {
    "request_cert": false,
    "reject_unauthorized": false
  }
}
EOF
  fi
  chown -R "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/$CONFIG_DIR" "$PREFIX/$DATA_DIR"
elif [ -z "$PORT" ]; then
  PORT=$(nodejs -pe "JSON.parse(require('fs').readFileSync('$PREFIX/etc/ptrading.json',{encoding:'utf-8'})).listen.replace(/.*:(\d+)([/]|$)/,'\$1').replace(/^wss:.*$|^https:.*$/,'443').replace(/^ws:.*$|^http:.*$/,'80')")
fi

if [ "$(id -u)" = "0" -a "$PORT" -lt 1024 ]; then
  setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))
fi

# install daemon
if [ ! -f "/etc/systemd/system/$NAME.service" -a -d "/etc/systemd/system/" -a "$(id -u)" = "0" ]; then
  cat > "/etc/systemd/system/$NAME.service" << EOF
[Unit]
Description=$NAME
After=network.target

[Service]
ExecStart=$PREFIX/bin/ptrading start
ExecReload=/bin/kill -HUP $MAINPID
ExecStop=$PREFIX/bin/ptrading stop
Restart=always
User=$DAEMON_USER
Group=$DAEMON_GROUP
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NODE_ENV=production
WorkingDirectory=$BASEDIR

[Install]
WantedBy=multi-user.target
EOF
  systemctl enable "$NAME"
  systemctl start "$NAME"
elif [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" ]; then
  systemctl restart "$NAME"
fi

if [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" -a "`tty`" != "not a tty" ]; then
  systemctl status "$NAME"
elif [ "`tty`" != "not a tty" ]; then
  echo "Run '$PREFIX/bin/ptrading start' to start the service"
fi
