#!/usr/bin/env bash
# Download AI-generated building models (Higgsfield image-to-3D) into public/models/.
# Generated 16.7.2026 from the real ArchDaily project photos.
set -e
cd "$(dirname "$0")/.."
mkdir -p public/models

# Podun — Bratislava (job 22420efd-1b50-4927-abef-540c96ca219f)
curl -L "https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/50747a04-18ff-4662-a076-e6d76b267d98.glb" \
  -o public/models/podun.glb

echo "Done:"
ls -lh public/models/
