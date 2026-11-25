#!/bin/sh
# Idempotent safeguards for the existing small VM. Run as root before Compose.
set -eu
if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then
  if [ ! -e /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  chmod 600 /swapfile
  swapon /swapfile
fi
if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-aoa-tv-memory.conf
sysctl -p /etc/sysctl.d/90-aoa-tv-memory.conf
free -m
