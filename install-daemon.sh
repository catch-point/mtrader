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

#
# Usage:
# sudo bash -c 'bash <(curl -sL https://raw.githubusercontent.com/jamesrdf/mtrader/master/install-daemon.sh)'
#

NAME=mtrader

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
  if [ -x "$(which apt-get)" -a -x "$(which curl)" -a "$(id -u)" = "0" ]; then
    curl -sL https://deb.nodesource.com/setup_8.x | bash -
    apt-get install -y nodejs
  fi
fi
if [ ! -x "$(which npm)" ]; then
  echo "node.js/npm is required to run this program" 1>&2
  exit 5
fi

# Check if unzip is installed
if [ ! -x "$(which unzip)" ]; then
  echo "unzip is not installed" 1>&2
  if [ -x "$(which apt-get)" -a -x "$(which curl)" -a "$(id -u)" = "0" ]; then
    apt-get install -y unzip
  fi
fi

# Check if libXtst.so.6 is installed
if ! ls /usr/lib/x86_64-linux-gnu/libXtst.so.6 >/dev/null 2>/dev/null ; then
  echo "libXtst.so.6 is not installed" 1>&2
  if [ -x "$(which apt-get)" -a -x "$(which curl)" -a "$(id -u)" = "0" ]; then
    apt-get install -y libxtst6
  fi
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
  sudo -iu "$DAEMON_USER" npm install jamesrdf/mtrader -g
  sudo -iu "$DAEMON_USER" npm --depth 9999 update jamesrdf/mtrader -g
elif [ "$(id -u)" = "0" ]; then
  npm install jamesrdf/mtrader -g
  npm --depth 9999 update jamesrdf/mtrader -g
elif [ ! -x "$(which mtrader)" ]; then
  PREFIX=$(npm prefix)
  npm install jamesrdf/mtrader
  npm --depth 9999 update jamesrdf/mtrader
fi

if [ ! -x "$PREFIX/bin/uninstall-$NAME" ]; then
  cp "$PREFIX/lib/node_modules/mtrader/uninstall-daemon.sh" "$PREFIX/bin/uninstall-$NAME"
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

# Check if IB Gateway is installed
if ls "$BASEDIR/Jts/ibgateway"/*/ibgateway > /dev/null 2>/dev/null; then
  IBG_LATEST=$(ls -t "$BASEDIR/Jts/ibgateway"/*/ibgateway |head -n 1)
  JAVA_LATEST="$(cat "$(dirname "$IBG_LATEST")/.install4j/inst_jre.cfg")/bin/java"
fi
if [ -x "$(which unzip)" ]; then
  if [ "`tty`" != "not a tty" ] && ls "$BASEDIR/Jts/ibgateway"/*/ibgateway > /dev/null 2>/dev/null; then
    read -p "Do you want to check for an update to IB Gateway $(basename "$(dirname "$IBG_LATEST")")? [y,N]:" INSTALL_IBG
  elif [ "`tty`" != "not a tty" ]; then
    read -p "Do you want to install IB Gateway? [y,N]:" INSTALL_IBG
  elif ls "$BASEDIR/Jts/ibgateway"/*/ibgateway > /dev/null 2>/dev/null; then
    INSTALL_IBG="Y"
  fi
fi
if [ "$INSTALL_IBG" = "Y" -o "$INSTALL_IBG" = "y" -o "$INSTALL_IBG" = "YES" -o "$INSTALL_IBG" = "yes" ]; then
  INSTALL_IBG="Y"
  IBG_URL="https://download2.interactivebrokers.com/installers/ibgateway/latest-standalone/ibgateway-latest-standalone-linux-x64.sh"
  IBG_INSTALLER="$PREFIX/bin/$(basename "$IBG_URL")"
  wget "$IBG_URL" -O "$IBG_INSTALLER"
  yes n|sudo -iu "$DAEMON_USER" sh "$IBG_INSTALLER" -c -q -overwrite
fi

if [ "$INSTALL_IBG" = "Y" ] && ls "$BASEDIR/Jts/ibgateway"/*/ibgateway > /dev/null 2>/dev/null; then
  IBG_EXE=$(ls -t "$BASEDIR/Jts/ibgateway"/*/ibgateway |head -n 1)
  if [ -n "$IBG_LATEST" -a "$IBG_LATEST" != "$IBG_EXE" ]; then
    if [ "`tty`" != "not a tty" ]; then
      read -p "Do you want to uninstall the previous version of IB Gateway $(basename "$(dirname "$IBG_LATEST")")? [Y,n]:" UNINSTALL_IBG
    fi
    if [ "$UNINSTALL_IBG" = "Y" -o "$UNINSTALL_IBG" = "y" -o "$UNINSTALL_IBG" = "YES" -o "$UNINSTALL_IBG" = "yes" -o -z "$UNINSTALL_IBG" ]; then
      IBG_PREVIOUS=$(basename "$(dirname "$IBG_LATEST")")
      yes |sudo -iu "$DAEMON_USER" sh $(dirname "$IBG_LATEST")/uninstall -c -q
    fi
  fi
  IBC_JAR="$PREFIX/lib/IBC.jar"
  if [ ! -e "$IBC_JAR" ]; then
    mkdir -p "$PREFIX/lib"
    IBC_URL="https://github.com/IbcAlpha/IBC/releases/download/3.8.1/IBCLinux-3.8.1.zip"
    wget "$IBC_URL" -O "/tmp/ibclinux.zip"
    unzip "/tmp/ibclinux.zip" $(basename "$IBC_JAR") -d $(dirname "$IBC_JAR")
    rm "/tmp/ibclinux.zip"
  fi
  IBG_NAME=$(grep Name "$(dirname "$IBG_EXE")"/*.desktop | awk -F= '{print $2}')
  IBG_VERSION=$(basename "$(dirname "$IBG_EXE")")
  JAVA_EXE="$(cat "$(dirname "$IBG_EXE")/.install4j/inst_jre.cfg")/bin/java"
  IBG_JARS="$(dirname "$IBG_EXE")/jars/*:$IBC_JAR"
  IBG_VMARGS_FILE="$IBG_EXE.vmoptions"
  IBC_ENTRY_POINT="ibcalpha.ibc.IbcGateway"
fi

# Setup configuration
if [ -z "$CONFIG_DIR" ]; then
  if [ "$PREFIX" = "$BASEDIR" ]; then
    CONFIG_DIR=$PREFIX/etc
    CACHE_DIR=$PREFIX/var/cache
    LIB_DIR=$PREFIX/var/lib
  elif [ "$PREFIX" = "/usr" ]; then
    CONFIG_DIR=/etc/$NAME
    CACHE_DIR=/var/cache/$NAME
    LIB_DIR=/var/lib/$NAME
  elif [ -d "$PREFIX/etc" -o -d "$PREFIX/var" ]; then
    CONFIG_DIR=$PREFIX/etc/$NAME
    CACHE_DIR=$PREFIX/var/cache/$NAME
    LIB_DIR=$PREFIX/var/lib/$NAME
  else
    CONFIG_DIR=$PREFIX/etc
    CACHE_DIR=$PREFIX/var/cache
    LIB_DIR=$PREFIX/var/lib
  fi
  mkdir -p "$PREFIX/etc" "$CONFIG_DIR" "$CACHE_DIR" "$LIB_DIR"
fi

if [ -z "$USERINFO" ]; then
  USERINFO=$(hostname -s):$(node -pe 'require("crypto").randomBytes(8).readUIntBE(0,4).toString(36)')
fi

if [ -z "$SECURE_OPTIONS" ]; then
  SECURE_OPTIONS=$(node -pe "require('constants').SSL_OP_NO_SSLv3 | require('constants').SSL_OP_NO_SSLv2")
fi

if [ -z "$DOMAINS" -a ! -f "$PREFIX/etc/mtrader.json" ]; then
  EXTERNAL_HOST=$(echo dig +short -x $(dig -4 TXT +short o-o.myaddr.l.google.com @ns1.google.com) |sh)
  DEFAULT_DOMAINS=$(node -pe "'$EXTERNAL_HOST'.replace(/\\.$/,'')")
  if [ -z "$DOMAINS" -a "`tty`" != "not a tty" ]; then
    read -p "Comma-separated list of domains [$DEFAULT_DOMAINS]:" DOMAINS
  fi
  if [ -z "$DOMAINS" ]; then
    DOMAINS=$DEFAULT_DOMAINS
  fi
fi

if [ -z "$AUTHORITY" -a ! -f "$PREFIX/etc/mtrader.json" ]; then
  AUTHORITY=$(node -pe "'$DOMAINS'.replace(/,.*/,'')")
fi

if [ -z "$HOST" -a ! -f "$PREFIX/etc/mtrader.json" ]; then
  if [ -z "$HOST" -a "`tty`" != "not a tty" ]; then
    read -p "Interface to listen on (leave blank for all) []:" HOST
  fi
fi

if [ -z "$TIMEZONE" -a ! -f "$PREFIX/etc/mtrader.json" ]; then
  DEFAULT_TIMEZONE=$(node -pe 'Intl.DateTimeFormat().resolvedOptions().timeZone')
  if [ -z "$TIMEZONE" -a "`tty`" != "not a tty" ]; then
    read -p "Default time zone (for date and time functions) [$DEFAULT_TIMEZONE]:" TIMEZONE
  fi
  if [ -z "$TIMEZONE" ]; then
    TIMEZONE=$DEFAULT_TIMEZONE
  fi
fi

if [ -f "$PREFIX/etc/mtrader.json" -a -z "$PORT" ]; then
  PORT=$(node -pe "((JSON.parse(require('fs').readFileSync('$PREFIX/etc/mtrader.json',{encoding:'utf-8'})).remote||{}).listen||'').replace(/.*:(\d+)([/]|$)/,'\$1').replace(/^wss:.*$|^https:.*$/,'443').replace(/^ws:.*$|^http:.*$/,'80')")
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

if [ "`tty`" = "not a tty" ]; then
  CERTBOT_OPTS="-n --agree-tos --register-unsafely-without-email"
fi

# Renew signed certificate
if [ -f "/etc/letsencrypt/live/$NAME/privkey.pem" -a -n "$CERTBOT" ]; then
  $CERTBOT renew --standalone --cert-name "$NAME" --pre-hook "$PREFIX/bin/certbot-pre-$NAME" --post-hook "$PREFIX/bin/certbot-post-$NAME" $CERTBOT_OPTS
fi

# Request signed certificate
if [ ! -f "$PREFIX/etc/mtrader.json" -a -n "$CERTBOT" ] && [[ "$PORT" != *8* ]]; then
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
  cp "/etc/letsencrypt/live/$NAME/privkey.pem" "$PREFIX/etc/mtrader-privkey.pem"
  cp "/etc/letsencrypt/live/$NAME/fullchain.pem" "$PREFIX/etc/mtrader-fullchain.pem"
  chmod go-rwx "$PREFIX/etc/mtrader-privkey.pem"
  chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/mtrader-privkey.pem" "$PREFIX/etc/mtrader-fullchain.pem"
  if [ -f "/etc/systemd/system/$NAME.service" ]; then
    systemctl start $NAME
  fi
fi
EOF
    chmod a+x "$PREFIX/bin/certbot-post-$NAME"
  fi
  $CERTBOT certonly -d "$DOMAINS" --standalone --cert-name "$NAME" --pre-hook "$PREFIX/bin/certbot-pre-$NAME" --post-hook "$PREFIX/bin/certbot-post-$NAME" $CERTBOT_OPTS
  if [ -f "/etc/letsencrypt/live/$NAME/privkey.pem" ]; then
    if [ ! -f "$PREFIX/etc/mtrader-crt.pem" ] ; then
      touch "$PREFIX/etc/mtrader-crt.pem"
    fi
    if [ ! -f "$PREFIX/etc/mtrader-dh.pem" ]; then
      openssl dhparam -outform PEM -out "$PREFIX/etc/mtrader-dh.pem" 2048
    fi
    chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/mtrader-privkey.pem" "$PREFIX/etc/mtrader-fullchain.pem" "$PREFIX/etc/mtrader-crt.pem" "$PREFIX/etc/mtrader-dh.pem"
    echo "Add \"collect\":{\"remote\":{\"location\":[\"wss://$USERINFO@$AUTHORITY:$PORT\"]}} to client's etc/mtrader.json"
    cat > "$PREFIX/etc/mtrader.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "tz": "$TIMEZONE",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "lib_dir": "$LIB_DIR",
  "salt": "$RANDOM",
  "remote": {
    "listen": "wss://$USERINFO@$HOST:$PORT",
    "key_pem": "etc/mtrader-privkey.pem",
    "cert_pem": "etc/mtrader-fullchain.pem",
    "crt_pem": "etc/mtrader-crt.pem",
    "honorCipherOrder": true,
    "ecdhCurve": "prime256v1",
    "dhparam_pem": "etc/mtrader-dh.pem",
    "secureProtocol": "SSLv23_method",
    "secureOptions": $SECURE_OPTIONS,
    "handshakeTimeout": 10000,
    "timeout": 1800000,
    "requestCert": false,
    "rejectUnauthorized": true
  }
}
EOF
  fi
fi

# Self signed certificate
if [ ! -f "$PREFIX/etc/mtrader.json" ] && [[ "$PORT" != *8* ]]; then
  openssl genrsa -out "$PREFIX/etc/mtrader-privkey.pem" 2048
  if [ -f "$PREFIX/etc/mtrader-privkey.pem" ]; then
    if [ ! -f "$PREFIX/etc/mtrader-csr.pem" ] ; then
      openssl req -new -sha256 -subj "/CN=$AUTHORITY" -key "$PREFIX/etc/mtrader-privkey.pem" -out "$PREFIX/etc/mtrader-csr.pem"
    fi
    if [ ! -f "$PREFIX/etc/cert.pem" ] ; then
      openssl x509 -req -in "$PREFIX/etc/mtrader-csr.pem" -signkey "$PREFIX/etc/mtrader-privkey.pem" -out "$PREFIX/etc/mtrader-cert.pem"
    fi
    cat "$PREFIX/etc/mtrader-cert.pem" >> "$PREFIX/etc/mtrader-ca.pem"
    chmod go-rwx "$PREFIX/etc/mtrader-privkey.pem"
    if [ ! -f "$PREFIX/etc/mtrader-crt.pem" ] ; then
      touch "$PREFIX/etc/mtrader-crt.pem"
    fi
    if [ ! -f "$PREFIX/etc/mtrader-dh.pem" ]; then
      openssl dhparam -outform PEM -out "$PREFIX/etc/mtrader-dh.pem" 2048
    fi
    chown "$DAEMON_USER:$DAEMON_GROUP" "$PREFIX/etc/mtrader-privkey.pem" "$PREFIX/etc/mtrader-cert.pem" "$PREFIX/etc/mtrader-ca.pem" "$PREFIX/etc/mtrader-crt.pem" "$PREFIX/etc/mtrader-dh.pem"
    echo "Add \"collect\":{\"remote\":{\"location\":[\"wss://$USERINFO@$AUTHORITY:$PORT\"]}} to client's etc/mtrader.json"
    echo "Append etc/mtrader-cert.pem to client's etc/mtrader-ca.pem or set \"remote\": { \"rejectUnauthorized\": false } in client's etc/mtrader.json"
    cat > "$PREFIX/etc/mtrader.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "tz": "$TIMEZONE",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "lib_dir": "$LIB_DIR",
  "salt": "$RANDOM",
  "remote": {
    "listen": "wss://$USERINFO@$HOST:$PORT",
    "key_pem": "etc/mtrader-privkey.pem",
    "cert_pem": "etc/mtrader-cert.pem",
    "ca_pem": "etc/mtrader-ca.pem",
    "crt_pem": "etc/mtrader-crt.pem",
    "honorCipherOrder": true,
    "ecdhCurve": "prime256v1",
    "dhparam_pem": "etc/mtrader-dh.pem",
    "secureProtocol": "SSLv23_method",
    "secureOptions": $SECURE_OPTIONS,
    "handshakeTimeout": 10000,
    "timeout": 1800000,
    "requestCert": false,
    "rejectUnauthorized": true,
    "perMessageDeflate": true
  }
}
EOF
  fi
fi

# Unencrypted socket
if [ ! -f "$PREFIX/etc/mtrader.json" ]; then
  echo "Add \"collect\":{\"remote\":{\"location\":[\"ws://$USERINFO@$AUTHORITY:$PORT\"]}} to client etc/mtrader.json file"
  cat > "$PREFIX/etc/mtrader.json" << EOF
{
  "description": "Configuration file for $NAME generated on $(date)",
  "tz": "$TIMEZONE",
  "config_dir": "$CONFIG_DIR",
  "cache_dir": "$CACHE_DIR",
  "lib_dir": "$LIB_DIR",
  "salt": "$RANDOM",
  "remote": {
    "listen": "ws://$USERINFO@$HOST:$PORT"
  }
}
EOF
fi

# Update IB Gateway lanucher
if [ -n "$JAVA_EXE" -a -n "$IBG_JARS" -a -n "$IBG_VMARGS_FILE" -a -n "$IBC_ENTRY_POINT" ]; then
  node << EOF
    var fs = require('fs');
    var json = JSON.parse(fs.readFileSync('$PREFIX/etc/mtrader.json',{encoding:'utf-8'}));
    var vmargs = fs.readFileSync('$IBG_VMARGS_FILE',{encoding:'utf-8'})
      .split(/\s*(\r|\n)\s*/).filter(line => line.trim() && line.charAt(0) != '#');
    var clientId = '$RANDOM';
    var timeout = 300000;
    var ibg_version = '$IBG_VERSION';
    var ibg_name = '$IBG_NAME' || ibg_version;
    var ibg_previous = '$IBG_PREVIOUS';
    var installs = json.ibgateway_installs||[];
    var previous = installs.find(ibg => ibg.ibg_version == ibg_previous)||{};
    var existing = installs.find(ibg => ibg.ibg_version == ibg_version)||{};
    var pre_ibc_command = (existing.ibc_command || previous.ibc_command || []);
    var pre_java = pre_ibc_command.slice(0, pre_ibc_command.findIndex(cmd => ~cmd.indexOf('bin/java'))+1).slice(0,-1);
    var ibc_command = pre_java.concat(['$JAVA_EXE', '-cp', '$IBG_JARS'], vmargs, ['$IBC_ENTRY_POINT']);
    var broker_ibg = (((json||{}).broker||{}).ib||{}).ibg_version||'';
    if (broker_ibg == ibg_previous) {
      Object.assign(json, {
        broker: Object.assign((json||{}).broker||{}, {
          ib: Object.assign(((json||{}).broker||{}).ib||{clientId, timeout}, {ibg_name, ibg_version})
        })
      });
    }
    var fetch_ibg = (((json||{}).fetch||{}).ib||{}).ibg_version||'';
    if (fetch_ibg == ibg_previous) {
      Object.assign(json, {
        fetch: Object.assign((json||{}).fetch||{}, {
          ib: Object.assign(((json||{}).fetch||{}).ib||{clientId, timeout}, {ibg_name, ibg_version})
        })
      });
    }
    var ivolatility_ibg = ((((json||{}).fetch||{}).ivolatility||{}).ib||{}).ibg_version;
    if (ivolatility_ibg == ibg_previous) {
      Object.assign(json.fetch.ivolatility.ib, {ibg_name, ibg_version});
    }
    if (!existing.ibc_command || existing.ibc_command[0] == ibc_command[0]) {
      var default_ibgateway = existing.ibc_command ? existing : previous.ibc_command ? previous : {
        ibg_name,
        ibg_version,
        StoreSettingsOnServer: '',
        MinimizeMainWindow: 'no',
        ExistingSessionDetectedAction: 'manual',
        AcceptIncomingConnectionAction: 'manual',
        ReadOnlyLogin: 'no',
        ReadOnlyApi: '',
        AcceptNonBrokerageAccountWarning: 'yes',
        IbAutoClosedown: 'yes',
        AllowBlindTrading: 'no',
        DismissPasswordExpiryWarning: 'no',
        DismissNSEComplianceNotice: 'yes',
        BindAddress: '',
        CommandPrompt: '',
        SuppressInfoMessages: 'yes',
        LogComponents: 'never'
      };
      var ibgateway = {
        ...default_ibgateway,
        ibg_name,
        ibg_version,
        ibc_command
      };
      Object.assign(json, {
        ibgateway_installs: installs
          .filter(ibg => ibg.ibg_version != ibg_previous || ibg.ibc_command[0] != '$JAVA_LATEST')
          .filter(ibg => ibg.ibg_version != ibg_version).concat(ibgateway)
      });
    }
    fs.writeFileSync('$PREFIX/etc/mtrader.json', JSON.stringify(json, null, 2));
EOF
fi

if [ "$(id -u)" = "0" ]; then
  chown -R "$DAEMON_USER:$DAEMON_GROUP" "$CONFIG_DIR" "$CACHE_DIR" "$LIB_DIR" "$PREFIX/etc/mtrader.json"
fi

# install daemon
if [ ! -f "/etc/systemd/system/$NAME.service" -a -d "/etc/systemd/system/" -a "$(id -u)" = "0" ]; then
  cat > "/etc/systemd/system/$NAME.service" << EOF
[Unit]
Description=$NAME
After=network.target

[Service]
ExecStart=$PREFIX/bin/mtrader start
ExecReload=/bin/kill -HUP \$MAINPID
ExecStop=$PREFIX/bin/mtrader stop
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
  echo "Run '$PREFIX/bin/mtrader start' to start the service"
fi
