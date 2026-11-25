#!/bin/sh
# Numeric health/memory evidence only; never expand container environment or request logs.
set -eu
umask 077
cd /opt/aoa-tv
{
  date -u +%FT%TZ
  docker inspect --format 'OOMKilled={{.State.OOMKilled}} restarts={{.RestartCount}} memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}}' aoa-tv-app-1
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
  docker exec aoa-tv-app-1 sh -c 'cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events'
  free -m
  curl --fail --silent --max-time 15 http://127.0.0.1:3001/health
  curl --fail --silent --max-time 15 http://127.0.0.1:3001/ready
} > memory-review.txt 2>&1
