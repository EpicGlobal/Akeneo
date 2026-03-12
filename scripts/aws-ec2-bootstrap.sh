#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: bash scripts/aws-ec2-bootstrap.sh <public-ip-or-url>" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  usage
fi

TARGET="$1"
PROJECT_DIR="${PROJECT_DIR:-$HOME/akeneo-pim}"
REPO_URL="${REPO_URL:-https://github.com/EpicGlobal/Akeneo.git}"

sudo apt-get update
sudo apt-get install -y ca-certificates curl git make

if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc

  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  git clone "$REPO_URL" "$PROJECT_DIR"
fi

git -C "$PROJECT_DIR" fetch origin master
git -C "$PROJECT_DIR" checkout master
git -C "$PROJECT_DIR" pull --ff-only origin master

sg docker -c "cd '$PROJECT_DIR' && bash scripts/aws-first-run.sh '$TARGET'"
