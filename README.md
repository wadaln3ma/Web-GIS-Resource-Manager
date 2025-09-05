[![CI](https://github.com/wadaln3ma/web-gis-resource-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/wadaln3ma/web-gis-resource-manager/actions/workflows/ci.yml)

# Web GIS Resource Manager

A modern, map-first asset manager for teams that track **sites, vehicles, equipment, crews, geofences, and routes**.  
Built with **Next.js + MapLibre GL + Supabase** (Postgres + Realtime + Storage). Drag, pick-on-map, draw geometries, attach photos, and edit attributes in a spreadsheet-like panel.

---

## Features

- 🗺️ **Interactive map** (MapLibre): clusters, icons by type, selected feature highlight
- ➕ **Create resources**: pick-on-map, use map center, or draw lines/polygons
- ✏️ **Edit**: update attributes, **move points** (pick/drag/manual), edit vertices for lines/polygons
- 📎 **Attachments (images)**: upload/delete per resource (public bucket)
- 🧾 **Attribute table**: sort, group by type/status, inline edit & delete, CSV export
- ⚡ **Realtime**: auto-refresh on database changes
- 🎛️ **Nice UX**: sliding panel, floating action button (rotates on open), status toasts/hints

---

## Tech Stack

- **Frontend**: Next.js (App Router), TypeScript, MapLibre GL, maplibre-gl-draw
- **Backend**: Supabase (Postgres, RPC, RLS), Storage (public bucket), Realtime
- **CI**: GitHub Actions (lint, typecheck, build)

---

## Quickstart (Local)

```bash
# 1) Install
npm install

# 2) Env vars
cp .env.example .env.local
# Edit .env.local with your Supabase project values:
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# 3) Dev
npm run dev
# open http://localhost:3000
