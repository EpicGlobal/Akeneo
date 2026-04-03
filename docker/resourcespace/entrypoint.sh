#!/bin/bash

set -eu

php /opt/coppermind/bootstrap-local.php
service cron start
chmod +x /etc/cron.daily/*
apachectl -D FOREGROUND
