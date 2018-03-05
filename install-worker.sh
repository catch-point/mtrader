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

if [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" ]; then
  systemctl stop "$NAME"
fi

# Install/upgrade software
PREFIX=$(sudo -iu "$DAEMON_USER" npm prefix -g)
if [ "$PREFIX" = "$BASEDIR" ]; then
  sudo -iu "$DAEMON_USER" npm install ptrading/ptrading -g
  sudo -iu "$DAEMON_USER" npm --depth 9999 update ptrading/ptrading -g
elif [ "$(id -u)" = "0" ]; then
  npm install ptrading/ptrading -g
  npm --depth 9999 update ptrading/ptrading -g
elif [ ! -x "$(which ptrading)" ]; then
  PREFIX=$(npm prefix)
  npm install ptrading/ptrading
  npm --depth 9999 update ptrading/ptrading
fi

if [ ! -x "$PREFIX/bin/uninstall-$NAME" ]; then
  cp "$PREFIX/lib/node_modules/ptrading/uninstall-worker.sh" "$PREFIX/bin/uninstall-$NAME"
  chmod a+x "$PREFIX/bin/uninstall-$NAME"
fi

# Check if certbot is installed
if [ -z "$CERTBOT" -a "$(id -u)" = "0" ]; then
  if [ -x "$PREFIX/bin/certbot" ]; then
    CERTBOT="$PREFIX/bin/certbot"
  elif [ -x "$PREFIX/bin/certbot-auto" ]; then
    CERTBOT="$PREFIX/bin/certbot-auto"
  elif [ -x "$(which certbot)" ]; then
    CERTBOT="$(which certbot)"
  else
    if [ -x "$(which apt-get)" ]; then
      apt-get update
      apt-get install -y software-properties-common
      add-apt-repository -y ppa:certbot/certbot
      apt-get update
      apt-get install -y certbot
    fi
    if [ -x "$(which certbot)" ]; then
      CERTBOT="$(which certbot)"
    else
      echo "Installing certbot-auto" 1>&2
      CERTBOT="$PREFIX/bin/certbot-auto"
      wget "https://dl.eff.org/certbot-auto" -O "$CERTBOT"
      chmod a+x "$CERTBOT"
    fi
  fi
fi

# Setup configuration
if [ -z "$CONFIG_DIR" ]; then
  if [ "$PREFIX" = "$BASEDIR" ]; then
    CONFIG_DIR=$PREFIX/etc
    CACHE_DIR=$PREFIX/var/cache
  elif [ "$PREFIX" = "/usr" ]; then
    CONFIG_DIR=/etc/$NAME
    CACHE_DIR=/var/cache/$NAME
  elif [ -d "$PREFIX/etc" -o -d "$PREFIX/var" ]; then
    CONFIG_DIR=$PREFIX/etc/$NAME
    CACHE_DIR=$PREFIX/var/cache/$NAME
  else
    CONFIG_DIR=$PREFIX/etc
    CACHE_DIR=$PREFIX/var/cache
  fi
  mkdir -p "$PREFIX/etc" "$CONFIG_DIR" "$CACHE_DIR"
fi

if [ -z "$USERINFO" ]; then
  USERINFO=$(hostname -s):$(node -pe 'require("crypto").randomBytes(8).readUIntBE(0,4).toString(36)')
fi

if [ -z "$SECURE_OPTIONS" ]; then
  SECURE_OPTIONS=$(node -pe "require('constants').SSL_OP_NO_SSLv3 | require('constants').SSL_OP_NO_SSLv2")
fi

if [ -z "$DOMAINS" -a ! -f "$PREFIX/etc/ptrading.json" ]; then
  EXTERNAL_HOST=$(dig +short -x $(dig +short myip.opendns.com @resolver1.opendns.com))
  DEFAULT_DOMAINS=$(node -pe "'$EXTERNAL_HOST'.replace(/\\.$/,'')")
  if [ -z "$DOMAINS" -a "`tty`" != "not a tty" ]; then
    read -p "Comma-separated list of domains [$DEFAULT_DOMAINS]:" DOMAINS
  fi
  if [ -z "$DOMAINS" ]; then
    DOMAINS=$DEFAULT_DOMAINS
  fi
fi

if [ -z "$AUTHORITY" -a ! -f "$PREFIX/etc/ptrading.json" ]; then
  AUTHORITY=$(node -pe "'$DOMAINS'.replace(/,.*/,'')")
fi

if [ -z "$HOST" -a ! -f "$PREFIX/etc/ptrading.json" ]; then
  if [ -z "$HOST" -a "`tty`" != "not a tty" ]; then
    read -p "Interface to listen on (leave blank for all) []:" HOST
  fi
fi

if [ -f "$PREFIX/etc/ptrading.json" -a -z "$PORT" ]; then
  PORT=$(node -pe "JSON.parse(require('fs').readFileSync('$PREFIX/etc/ptrading.json',{encoding:'utf-8'})).listen.replace(/.*:(\d+)([/]|$)/,'\$1').replace(/^wss:.*$|^https:.*$/,'443').replace(/^ws:.*$|^http:.*$/,'80')")
elif [ -z "$PORT" ]; then
  if [ -z "$DEFAULT_PORT" -a "$(id -u)" = "0" ]; then
    DEFAULT_PORT=443
  elif [ -z "$DEFAULT_PORT" ]; then
    DEFAULT_PORT=1443
  fi
  if [ -z "$PORT" -a "`tty`" != "not a tty" ]; then
    read -p "Port (e.g. port to listen on) [$DEFAULT_PORT]:" PORT
  fi
  if [ -z "$PORT" ]; then
    PORT=$DEFAULT_PORT
  fi
fi

if [ "$(id -u)" = "0" -a "$PORT" -lt 1024 ]; then
  setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))
fi

if [ "`tty`" == "not a tty" ]; then
  CERTBOT_OPTS="-n --agree-tos --register-unsafely-without-email"
fi

# Renew signed certificate
if [ -f "/etc/letsencrypt/live/$NAME/privkey.pem" -a -n "$CERTBOT" ]; then
  $CERTBOT renew --standalone --cert-name "$NAME" --pre-hook "$PREFIX/bin/certbot-pre-$NAME" --post-hook "$PREFIX/bin/certbot-post-$NAME" $CERTBOT_OPTS
fi

# Request signed certificate
if [ ! -f "$PREFIX/etc/ptrading.json" -a -n "$CERTBOT" ] && [[ "$PORT" != *8* ]]; then
  if [ ! -f "$PREFIX/bin/certbot-pre-$NAME" ]; then
    cat > "$PREFIX/bin/certbot-pre-$NAME" << EOF
#!/bin/sh
# Generated on $(date) for $NAME
# Command to be run in a shell before obtaining any
# certificates. Intended primarily for renewal, where it
# can be used to temporarily shut down a webserver that
# might conflict with the standalone plugin. This will
# only be called if a certificate is actually to be
# obtained/renewed.

if [ -f "/etc/systemd/system/$NAME.service" ]; then
  systemctl stop $NAME
fi
EOF
    chmod a+x "$PREFIX/bin/certbot-pre-$NAME"
  fi
  if [ ! -f "$PREFIX/bin/certbot-post-$NAME" ]; then
    cat > "$PREFIX/bin/certbot-post-$NAME" << EOF
#!/bin/sh
# Generated on $(date) for $NAME
# Command to be run in a shell after attempting to
# obtain/renew certificates. Can be used to deploy
# renewed certificates, or to restart any servers that
# were stopped by --pre-hook. This is only run if an
# attempt was made to obtain/renew a certificate.

if [ -f "/etc/letsencrypt/live/$NAME/privkey.pem" ]; then
  umask 077
  cp "/etc/letsencrypt/live/$NAME/privkey.pem" "$PREFIX/etc/ptrading-privkey.pem"
  cp "/etc/letsencrypt/live/$NAME/fullchain.pem" "$PREFIX/etc/ptrading-fullchain.pem"
  chmod go-rwx "$PREFIX/etc/ptrading-privkey.pem"
  chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/ptrading-privkey.pem" "$PREFIX/etc/ptrading-fullchain.pem"
  if [ -f "/etc/systemd/system/$NAME.service" ]; then
    systemctl start $NAME
  fi
fi
EOF
    chmod a+x "$PREFIX/bin/certbot-post-$NAME"
  fi
  $CERTBOT certonly -d "$DOMAINS" --standalone --cert-name "$NAME" --pre-hook "$PREFIX/bin/certbot-pre-$NAME" --post-hook "$PREFIX/bin/certbot-post-$NAME" $CERTBOT_OPTS
  if [ -f "/etc/letsencrypt/live/$NAME/privkey.pem" ]; then
    if [ ! -f "$PREFIX/etc/ptrading-crt.pem" ] ; then
      touch "$PREFIX/etc/ptrading-crt.pem"
    fi
    if [ ! -f "$PREFIX/etc/ptrading-dh.pem" ]; then
      openssl dhparam -outform PEM -out "$PREFIX/etc/ptrading-dh.pem" 2048
    fi
    chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/ptrading-privkey.pem" "$PREFIX/etc/ptrading-fullchain.pem" "$PREFIX/etc/ptrading-crt.pem" "$PREFIX/etc/ptrading-dh.pem"
    echo "Add \"remote_workers\":[\"wss://$USERINFO@$AUTHORITY:$PORT\"] to client's etc/ptrading.json"
    cat > "$PREFIX/etc/ptrading.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "listen": "wss://$USERINFO@$HOST:$PORT",
  "tls": {
    "key_pem": "etc/ptrading-privkey.pem",
    "cert_pem": "etc/ptrading-fullchain.pem",
    "crt_pem": "etc/ptrading-crt.pem",
    "honorCipherOrder": true,
    "ecdhCurve": "prime256v1",
    "dhparam_pem": "etc/ptrading-dh.pem",
    "secureProtocol": "SSLv23_method",
    "secureOptions": $SECURE_OPTIONS,
    "handshakeTimeout": 10000,
    "timeout": 600000,
    "requestCert": false,
    "rejectUnauthorized": true
  }
}
EOF
  fi
fi

# Self signed certificate
if [ ! -f "$PREFIX/etc/ptrading.json" ] && [[ "$PORT" != *8* ]]; then
  openssl genrsa -out "$PREFIX/etc/ptrading-privkey.pem" 2048
  if [ -f "$PREFIX/etc/ptrading-privkey.pem" ]; then
    if [ ! -f "$PREFIX/etc/ptrading-csr.pem" ] ; then
      openssl req -new -sha256 -subj "/CN=$AUTHORITY" -key "$PREFIX/etc/ptrading-privkey.pem" -out "$PREFIX/etc/ptrading-csr.pem"
    fi
    if [ ! -f "$PREFIX/etc/cert.pem" ] ; then
      openssl x509 -req -in "$PREFIX/etc/ptrading-csr.pem" -signkey "$PREFIX/etc/ptrading-privkey.pem" -out "$PREFIX/etc/ptrading-cert.pem"
    fi
    cat "$PREFIX/etc/ptrading-cert.pem" >> "$PREFIX/etc/ptrading-ca.pem"
    chmod go-rwx "$PREFIX/etc/ptrading-privkey.pem"
    if [ ! -f "$PREFIX/etc/ptrading-crt.pem" ] ; then
      touch "$PREFIX/etc/ptrading-crt.pem"
    fi
    if [ ! -f "$PREFIX/etc/ptrading-dh.pem" ]; then
      openssl dhparam -outform PEM -out "$PREFIX/etc/ptrading-dh.pem" 2048
    fi
    chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/ptrading-privkey.pem" "$PREFIX/etc/ptrading-cert.pem" "$PREFIX/etc/ptrading-ca.pem" "$PREFIX/etc/ptrading-crt.pem" "$PREFIX/etc/ptrading-dh.pem"
    echo "Add \"remote_workers\":[\"wss://$USERINFO@$AUTHORITY:$PORT\"] to client's etc/ptrading.json"
    echo "Append etc/ptrading-cert.pem to client's etc/ptrading-ca.pem or set \"tls\": { \"rejectUnauthorized\": false } in client's etc/ptrading.json"
    cat > "$PREFIX/etc/ptrading.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "listen": "wss://$USERINFO@$HOST:$PORT",
  "tls": {
    "key_pem": "etc/ptrading-privkey.pem",
    "cert_pem": "etc/ptrading-cert.pem",
    "ca_pem": "etc/ptrading-ca.pem",
    "crt_pem": "etc/ptrading-crt.pem",
    "honorCipherOrder": true,
    "ecdhCurve": "prime256v1",
    "dhparam_pem": "etc/ptrading-dh.pem",
    "secureProtocol": "SSLv23_method",
    "secureOptions": $SECURE_OPTIONS,
    "handshakeTimeout": 10000,
    "timeout": 600000,
    "requestCert": false,
    "rejectUnauthorized": true,
    "perMessageDeflate": true
  }
}
EOF
  fi
fi

# Unencrypted socket
if [ ! -f "$PREFIX/etc/ptrading.json" ]; then
  echo "Add \"remote_workers\":[\"ws://$USERINFO@$AUTHORITY:$PORT\"] to client etc/ptrading.json file"
  cat > "$PREFIX/etc/ptrading.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "listen": "ws://$USERINFO@$HOST:$PORT"
}
EOF
fi

if [ "$(id -u)" = "0" ]; then
  chown -R "$DAEMON_USER:$DAEMON_GROUP" "$CONFIG_DIR" "$CACHE_DIR" "$PREFIX/etc/ptrading.json"
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
fi

if [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" -a "`tty`" != "not a tty" ]; then
  systemctl start "$NAME"
  systemctl status "$NAME"
elif [ -f "/etc/systemd/system/$NAME.service" -a "$(id -u)" = "0" ]; then
  systemctl start "$NAME"
elif [ "`tty`" != "not a tty" ]; then
  echo "Run '$PREFIX/bin/ptrading start' to start the service"
fi
