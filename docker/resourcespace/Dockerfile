# Based on the official ResourceSpace Docker build:
# https://github.com/resourcespace/docker/tree/v10.7
FROM ubuntu:24.04

LABEL org.opencontainers.image.authors="Montala Ltd"
LABEL org.opencontainers.image.source="https://github.com/resourcespace/docker"

ARG RESOURCE_SPACE_VERSION=10.7
ENV DEBIAN_FRONTEND="noninteractive"

RUN apt-get update && apt-get install -y \
    nano \
    imagemagick \
    apache2 \
    subversion \
    ghostscript \
    antiword \
    poppler-utils \
    libimage-exiftool-perl \
    cron \
    postfix \
    wget \
    php \
    php-apcu \
    php-curl \
    php-dev \
    php-gd \
    php-intl \
    php-mysqlnd \
    php-mbstring \
    php-zip \
    libapache2-mod-php \
    ffmpeg \
    libopencv-dev \
    python3-opencv \
    python3 \
    python3-pip \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

RUN sed -i -e "s/upload_max_filesize\\s*=\\s*2M/upload_max_filesize = 100M/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/post_max_size\\s*=\\s*8M/post_max_size = 100M/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/max_execution_time\\s*=\\s*30/max_execution_time = 300/g" /etc/php/8.3/apache2/php.ini \
 && sed -i -e "s/memory_limit\\s*=\\s*128M/memory_limit = 1G/g" /etc/php/8.3/apache2/php.ini

RUN printf '<Directory /var/www/>\n\tOptions FollowSymLinks\n</Directory>\n' >> /etc/apache2/sites-enabled/000-default.conf

ADD cronjob /etc/cron.daily/resourcespace

WORKDIR /var/www/html

RUN rm -f index.html \
 && svn co -q https://svn.resourcespace.com/svn/rs/releases/${RESOURCE_SPACE_VERSION} . \
 && mkdir -p filestore \
 && chmod 777 filestore \
 && chmod -R 777 include/

COPY entrypoint.sh /entrypoint.sh
COPY bootstrap-local.php /opt/coppermind/bootstrap-local.php
COPY seed-smoke-resource.php /opt/coppermind/seed-smoke-resource.php
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
