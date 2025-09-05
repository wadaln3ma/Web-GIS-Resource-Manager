"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapboxDraw from "maplibre-gl-draw";
import * as Papa from "papaparse";

import { Spinner } from "@/src/components/Spinner";
import { Legend } from "@/src/components/Legend";
import { ResourceTable } from "@/src/components/ResourceTable";
import { WorkOrders, WorkOrder } from "@/src/components/WorkOrders";
import { getSupabaseIfReady } from "@/src/lib/supabaseClient";

/** Lazy proxy: forwards property access to the real client (only on the client).
 *  Avoids `'supabase' is possibly 'null'` while keeping SSR/prerender safe.
 */
const supabase = new Proxy({} as any, {
  get(_target, prop) {
    const c = getSupabaseIfReady();
    if (!c) {
      // This path only happens during SSR/prerender; effects/handlers won't run there.
      throw new Error("Supabase client not ready (SSR/prerender).");
    }
    return (c as any)[prop];
  }
});


type Feature = { type: "Feature"; id?: number; geometry: any; properties: Record<string, any> };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };
type ResourceType = "site" | "vehicle" | "equipment" | "crew" | "geofence" | "route";
type ResourceStatus = "active" | "maintenance" | "offline";
type CreateMode = "off" | "point" | "geofence" | "route";
type MovePointMode = "off" | "pick" | "drag";

type AttachmentRow = {
  id: number;
  resource_id: number;
  path: string;
  bucket: string;
  filename: string;
  content_type: string | null;
  size: number | null;
  created_at: string;
};

const TYPES: ResourceType[] = ["site", "vehicle", "equipment", "crew", "geofence", "route"];
const STATUSES: ResourceStatus[] = ["active", "maintenance", "offline"];

const BASESTYLES = [
  { id: "positron", label: "Posron (Light)", url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" },
  { id: "voyager", label: "Voyager", url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json" },
  { id: "dark", label: "Dark Matter", url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" },
  { id: "ml-basic", label: "MapLibre Basic", url: "https://demotiles.maplibre.org/style.json" }
];

// MapLibre-friendly draw styles (no dasharray expressions)
const DRAW_MINIMAL_STYLES: any[] = [
  { id: "gl-draw-polygon-fill-inactive", type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["!=", "active", "true"]],
    paint: { "fill-color": "#3bb2d0", "fill-opacity": 0.1 } },
  { id: "gl-draw-polygon-stroke-inactive", type: "line", filter: ["all", ["==", "$type", "Polygon"], ["!=", "active", "true"]],
    paint: { "line-color": "#3bb2d0", "line-width": 2 } },
  { id: "gl-draw-polygon-fill-active", type: "fill", filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
    paint: { "fill-color": "#f59e0b", "fill-opacity": 0.1 } },
  { id: "gl-draw-polygon-stroke-active", type: "line", filter: ["all", ["==", "$type", "Polygon"], ["==", "active", "true"]],
    paint: { "line-color": "#f59e0b", "line-width": 2 } },
  { id: "gl-draw-line-inactive", type: "line", filter: ["all", ["==", "$type", "LineString"], ["!=", "active", "true"]],
    paint: { "line-color": "#1f2937", "line-width": 3 } },
  { id: "gl-draw-line-active", type: "line", filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
    paint: { "line-color": "#f59e0b", "line-width": 3 } },
  { id: "gl-draw-vertex-inactive", type: "circle", filter: ["all", ["==", "meta", "vertex"], ["!=", "active", "true"]],
    paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#3bb2d0", "circle-stroke-width": 2 } },
  { id: "gl-draw-vertex-active", type: "circle", filter: ["all", ["==", "meta", "vertex"], ["==", "active", "true"]],
    paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#f59e0b", "circle-stroke-width": 2 } }
];

export default function HomePage() {
  const mapRef = useRef<Map | null>(null);
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const drawRef = useRef<any>(null);
  const dragMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [statusMsg, setStatusMsg] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedGeomType, setSelectedGeomType] = useState<"Point" | "LineString" | "Polygon" | null>(null);

  const [panelOpen, setPanelOpen] = useState<boolean>(true);
  const [panelTab, setPanelTab] = useState<"create" | "edit">("create");
  const [tableOpen, setTableOpen] = useState<boolean>(true);
  const [fabOpen, setFabOpen] = useState<boolean>(false);

  const [tableSize, setTableSize] = useState<"s" | "m" | "l">("s");
  const tableDims = useMemo(() => {
    if (tableSize === "s") return { w: "34vw", h: "30vh" };
    if (tableSize === "l") return { w: "54vw", h: "66vh" };
    return { w: "44vw", h: "48vh" };
  }, [tableSize]);

  const [sortBy, setSortBy] = useState<"id" | "name" | "rtype" | "status">("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [categoryBy, setCategoryBy] = useState<"none" | "rtype" | "status">("none");

  const [fc, setFc] = useState<FeatureCollection>({ type: "FeatureCollection", features: [] });

  // CREATE
  const [createMode, setCreateMode] = useState<CreateMode>("off");
  const [name, setName] = useState("");
  const [rtype, setRtype] = useState<ResourceType>("site");
  const [rstatus, setRstatus] = useState<ResourceStatus>("active");
  const [propsText, setPropsText] = useState<string>('{"source":"map"}');
  const [lon, setLon] = useState<string>("");
  const [lat, setLat] = useState<string>("");
  const [createFiles, setCreateFiles] = useState<File[]>([]); // staged images (create)

  // MOVE (points)
  const [movePointMode, setMovePointMode] = useState<MovePointMode>("off");
  const [stageLon, setStageLon] = useState<string>("");
  const [stageLat, setStageLat] = useState<string>("");

  const [baseStyle, setBaseStyle] = useState(BASESTYLES[0].url);

  // Editing lines/polygons
  const [editing, setEditing] = useState<{ resourceId: number; drawId: string } | null>(null);
  const editingRef = useRef<typeof editing>(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  // Filters/search
  const [fltType, setFltType] = useState<string>("all");
  const [fltStatus, setFltStatus] = useState<string>("all");
  const [q, setQ] = useState<string>("");

  // Attachments (edit)
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attBusy, setAttBusy] = useState<boolean>(false);
  const ATT_BUCKET = "attachments";
  const MAX_IMG_MB = 20;

  // Work Orders
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  // Validation
  const must = (v: string) => v.trim().length > 0;
  const isNum = (v: string) => !Number.isNaN(parseFloat(v));
  const formValid = must(name) && must(rstatus) && must(rtype) && isNum(lon) && isNum(lat);

  // State ref for guards
  const stateRef = useRef({ createMode, movePointMode, selectedId, selectedGeomType });
  useEffect(() => { stateRef.current = { createMode, movePointMode, selectedId, selectedGeomType }; },
    [createMode, movePointMode, selectedId, selectedGeomType]);

  // auto-tab
  useEffect(() => { setPanelTab(selectedId ? "edit" : "create"); }, [selectedId]);

  // Legend counts
  const countsByType = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const f of fc.features) {
      const t = (f.properties?.rtype as string) || "site";
      acc[t] = (acc[t] || 0) + 1;
    }
    return acc;
  }, [fc]);
  const countsByStatus = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const f of fc.features) {
      const s = (f.properties?.status as string) || "active";
      acc[s] = (acc[s] || 0) + 1;
    }
    return acc;
  }, [fc]);

  // Split FC for sources
  const pointsFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: fc.features.filter(f => f.geometry?.type === "Point")
  }), [fc]);
  const othersFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: fc.features.filter(f => f.geometry?.type !== "Point")
  }), [fc]);

  // Cursor in pick modes
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const pickCursor = stateRef.current.createMode === "point" || stateRef.current.movePointMode === "pick";
    map.getCanvas().style.cursor = pickCursor ? "crosshair" : "";
  }, [createMode, movePointMode]);

  // ESC cancels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFabOpen(false);
        if (createMode !== "off") { setCreateMode("off"); setStatusMsg("Create: canceled."); }
        if (movePointMode !== "off") { cancelMove(); }
        if (editingRef.current) { drawRef.current?.deleteAll(); setEditing(null); setStatusMsg("Geometry edit canceled."); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createMode, movePointMode]);

  // ===== Attachments (edit) =====
  async function loadAttachments(resourceId: number) {
    setAttBusy(true);
    const { data, error } = await supabase
      .from("resource_files")
      .select("*")
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: false });
    setAttBusy(false);
    if (error) { console.error(error); setStatusMsg("Load attachments failed: " + (error.message ?? "unknown")); return; }
    setAttachments((data as AttachmentRow[]) || []);
  }
  function isImageFile(f: File) { return f && f.type && f.type.startsWith("image/"); }
  async function uploadFilesForResource(resourceId: number, files: File[]) {
    if (!files.length) return;
    setAttBusy(true);
    try {
      for (const file of files) {
        if (!isImageFile(file)) { setStatusMsg("Skipped non-image: " + file.name); continue; }
        const mb = file.size / (1024 * 1024);
        if (mb > MAX_IMG_MB) { setStatusMsg(`Skipped ${file.name}: ${(mb).toFixed(1)} MB > ${MAX_IMG_MB}`); continue; }
        const path = `resource/${resourceId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from(ATT_BUCKET).upload(path, file, {
          contentType: file.type, upsert: false
        });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("resource_files").insert({
          resource_id: resourceId, path, bucket: ATT_BUCKET, filename: file.name,
          content_type: file.type, size: file.size
        });
        if (insErr) throw insErr;
      }
      setStatusMsg("Attachments uploaded.");
      await loadAttachments(resourceId);
    } catch (e: any) {
      console.error(e);
      setStatusMsg("Upload failed: " + (e?.message ?? "unknown"));
    } finally {
      setAttBusy(false);
    }
  }
  async function deleteAttachment(att: AttachmentRow) {
    if (!selectedId) return;
    setAttBusy(true);
    try {
      const { error: delSto } = await supabase.storage.from(att.bucket).remove([att.path]);
      if (delSto) throw delSto;
      const { error: delDb } = await supabase.from("resource_files").delete().eq("id", att.id);
      if (delDb) throw delDb;
      setStatusMsg("Attachment deleted.");
      await loadAttachments(selectedId);
    } catch (e: any) {
      console.error(e);
      setStatusMsg("Delete failed: " + (e?.message ?? "unknown"));
    } finally {
      setAttBusy(false);
    }
  }

  // ===== Refresh resources =====
  const refreshData = useCallback(async () => {
    let query = supabase.from("resources_geojson").select("*").order("id", { ascending: false });
    if (fltType !== "all") query = query.eq("rtype", fltType);
    if (fltStatus !== "all") query = query.eq("status", fltStatus);

    setBusy(true);
    const { data, error } = await query;
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Load failed: " + (error.message ?? "unknown")); return; }

    const filtered = (data || []).filter((row: any) => {
      if (!q.trim()) return true;
      const needle = q.toLowerCase();
      const hay = `${row.name} ${row.rtype} ${row.status} ${JSON.stringify(row.properties || {})}`.toLowerCase();
      return hay.includes(needle);
    });

    setFc({
      type: "FeatureCollection",
      features: filtered.map((row: any) => ({
        type: "Feature",
        id: row.id,
        geometry: row.geometry,
        properties: { id: row.id, name: row.name, rtype: row.rtype, status: row.status, ...(row.properties || {}) }
      }))
    });

    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      map.setFilter("point-selected", ["all", ["!", ["has","point_count"]], ["==", ["get","id"], selectedGeomType === "Point" ? (selectedId ?? -1) : -1]] as any);
      map.setFilter("route-selected", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get","id"], selectedGeomType === "LineString" ? (selectedId ?? -1) : -1]] as any);
      map.setFilter("geofence-selected-outline", ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get","id"], selectedGeomType === "Polygon" ? (selectedId ?? -1) : -1]] as any);
    }

    if (selectedId) await loadAttachments(selectedId);
  }, [fltType, fltStatus, q, selectedId, selectedGeomType]);

  // ===== Work Orders load + realtime =====
  const loadWorkOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("work_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { console.error(error); setStatusMsg("Load work orders failed: " + (error.message ?? "unknown")); return; }
    setWorkOrders((data as any[]) as WorkOrder[]);
  }, []);
  useEffect(() => { void loadWorkOrders(); }, [loadWorkOrders]);

  // ===== Sources & layers =====
  const ensureSourcesAndLayers = useCallback(async (map: Map) => {
    const ensureLayer = (id: string, layer: any) => { if (!map.getLayer(id)) map.addLayer(layer); };
    if (!map.getSource("res_points")) {
      map.addSource("res_points", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
    }
    if (!map.getSource("res_others")) {
      map.addSource("res_others", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }

    ensureLayer("clusters", {
      id: "clusters", type: "circle", source: "res_points", filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#A7F3D0", 10, "#60A5FA", 25, "#F59E0B"],
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 25, 25],
        "circle-stroke-color": "#fff", "circle-stroke-width": 2
      }
    });
    ensureLayer("cluster-count", {
      id: "cluster-count", type: "symbol", source: "res_points", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#111" }
    });
    ensureLayer("points", {
      id: "points", type: "circle", source: "res_points", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 6,
        "circle-color": ["match", ["get", "rtype"], "vehicle", "#16a34a", "equipment", "#9333ea", "crew", "#f43f5e", "site", "#1463FF", "#1463FF"],
        "circle-stroke-width": 2, "circle-stroke-color": "#ffffff"
      }
    });
    ensureLayer("point-icons", {
      id: "point-icons", type: "symbol", source: "res_points", filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": [
          "match", ["get","rtype"],
          "vehicle", "🚗", "equipment", "🧰", "crew", "👷", "site", "📍", "geofence", "▦", "route", "➝", "📍"
        ],
        "text-size": 14, "text-offset": [0, 1.2], "text-allow-overlap": true
      }
    });
    ensureLayer("point-selected", {
      id: "point-selected", type: "circle", source: "res_points",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], -1]],
      paint: { "circle-radius": 8, "circle-color": "#d97706", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }
    });

    ensureLayer("routes", {
      id: "routes", type: "line", source: "res_others", filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-width": 3, "line-color": "#1f2937" }
    });
    ensureLayer("route-selected", {
      id: "route-selected", type: "line", source: "res_others",
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "id"], -1]],
      paint: { "line-width": 5, "line-color": "#d97706" }
    });

    ensureLayer("geofences-fill", {
      id: "geofences-fill", type: "fill", source: "res_others", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#fde68a", "fill-opacity": 0.3 }
    });
    ensureLayer("geofences-outline", {
      id: "geofences-outline", type: "line", source: "res_others", filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": "#f59e0b", "line-width": 2 }
    });
    ensureLayer("geofence-selected-outline", {
      id: "geofence-selected-outline", type: "line", source: "res_others",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "id"], -1]],
      paint: { "line-color": "#d97706", "line-width": 3 }
    });

    (map.getSource("res_points") as GeoJSONSource | undefined)?.setData(pointsFc as any);
    (map.getSource("res_others") as GeoJSONSource | undefined)?.setData(othersFc as any);
  }, [pointsFc, othersFc]);

  // ===== INIT MAP =====
  useEffect(() => {
    if (mapRef.current || !mapDiv.current) return;

    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: baseStyle,
      center: [55.27, 25.2],
      zoom: 10
    });
    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, line_string: true, trash: true },
      styles: DRAW_MINIMAL_STYLES
    });
    drawRef.current = draw;
    map.addControl(draw, "top-left");

    map.on("load", async () => {
      await ensureSourcesAndLayers(map);
      bindLayerEvents(map);
      await refreshData();
      setStatusMsg("Realtime on • Use + to add, Draw to sketch, or click to edit.");
    });

    map.on("style.load", async () => {
      await ensureSourcesAndLayers(map);
      bindLayerEvents(map);
    });

    // Background click for create/move picking
    map.on("click", async (e: MapMouseEvent) => {
      const { createMode, movePointMode } = stateRef.current;
      if (createMode === "point") {
        setLon(e.lngLat.lng.toFixed(6));
        setLat(e.lngLat.lat.toFixed(6));
        setCreateMode("off");
        setStatusMsg("Coordinates filled. Click 'Add point' to create.");
        return;
      }
      if (movePointMode === "pick") {
        setStageLon(e.lngLat.lng.toFixed(6));
        setStageLat(e.lngLat.lat.toFixed(6));
        ensureDragMarker([e.lngLat.lng, e.lngLat.lat], false);
        setStatusMsg("Picked new coordinates — click ‘Apply move’."); 
        return;
      }
    });

    // Persist draw features (geofence/route)
    map.on("draw.create", async (e: any) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const g = feature.geometry as { type: "Polygon" | "LineString" };
      const displayName = name?.trim() || `${g.type === "Polygon" ? "geofence" : "route"} ${new Date().toISOString().slice(0,19)}`;
      let propsJson: any = null; try { propsJson = propsText?.trim() ? JSON.parse(propsText) : null; } catch {}

      setBusy(true); setStatusMsg(`Creating ${g.type === "Polygon" ? "geofence" : "route"}…`);
      const { data, error } = await supabase
        .from("resources")
        .insert([{ name: displayName, rtype: g.type === "Polygon" ? "geofence" : "route", status: rstatus, properties: propsJson, geometry: g }])
        .select("id")
        .single();
      setBusy(false);

      drawRef.current?.deleteAll?.();
      setCreateMode("off");

      if (error) { console.error(error); setStatusMsg("Create failed: " + (error.message ?? "unknown")); }
      else {
        const newId = data?.id as number;
        if (createFiles.length > 0 && newId) {
          await uploadFilesForResource(newId, createFiles);
          setCreateFiles([]);
        }
        setStatusMsg("Created."); await refreshData();
      }
    });

    return () => {
      if (dragMarkerRef.current) { dragMarkerRef.current.remove(); dragMarkerRef.current = null; }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap switch
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    map.setStyle(baseStyle);
    setStatusMsg("Basemap applied.");
  }, [baseStyle]);

  // Update sources on FC change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    (map.getSource("res_points") as GeoJSONSource | undefined)?.setData(pointsFc as any);
    (map.getSource("res_others") as GeoJSONSource | undefined)?.setData(othersFc as any);
  }, [pointsFc, othersFc]);

  // Realtime (resources)
  useEffect(() => {
    const ch = supabase
      .channel("resources-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "resources" }, () => { void refreshData(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fltType, fltStatus, q, refreshData]);

  // Realtime (work_orders)
  useEffect(() => {
    const ch = supabase
      .channel("wo-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => { void loadWorkOrders(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadWorkOrders]);

  // Selection
  async function selectById(id: number, geomType?: "Point"|"LineString"|"Polygon") {
    const map = mapRef.current; if (!map) return;
    const f = fc.features.find((x) => x.properties?.id === id);
    const gtype = (geomType || f?.geometry?.type || null) as any;

    setSelectedId(id);
    setSelectedGeomType(gtype);
    setPanelOpen(true);
    setPanelTab("edit");
    setFabOpen(false);

    if (f) {
      setName(String(f.properties?.name ?? ""));
      setRtype((f.properties?.rtype as ResourceType) ?? "site");
      setRstatus((f.properties?.status as ResourceStatus) ?? "active");
      const p = { ...f.properties }; delete (p as any).id; delete (p as any).name; delete (p as any).rtype; delete (p as any).status;
      setPropsText(JSON.stringify(p || {}, null, 2));

      if (gtype === "Point") {
        const [x, y] = f.geometry.coordinates;
        setStageLon(String(x.toFixed ? x.toFixed(6) : x));
        setStageLat(String(y.toFixed ? y.toFixed(6) : y));
      } else {
        setStageLon(""); setStageLat("");
      }
    }

    if (map.isStyleLoaded()) {
      map.setFilter("point-selected", ["all", ["!", ["has","point_count"]], ["==", ["get","id"], gtype === "Point" ? id : -1]] as any);
      map.setFilter("route-selected", ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get","id"], gtype === "LineString" ? id : -1]] as any);
      map.setFilter("geofence-selected-outline", ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get","id"], gtype === "Polygon" ? id : -1]] as any);
    }
    setStatusMsg(`Selected id=${id}`);
    await loadAttachments(id);
  }

  // Drag marker
  function ensureDragMarker(lngLat: [number, number], makeDraggable = true) {
    const map = mapRef.current; if (!map) return;
    if (!dragMarkerRef.current) {
      const m = new maplibregl.Marker({ draggable: makeDraggable })
        .setLngLat(lngLat)
        .addTo(map);
      if (makeDraggable) {
        m.on("dragend", () => {
          const p = m.getLngLat();
          setStageLon(p.lng.toFixed(6));
          setStageLat(p.lat.toFixed(6));
          setStatusMsg("Dragged — click ‘Apply move’ to save.");
        });
      }
      dragMarkerRef.current = m;
    } else {
      dragMarkerRef.current.setLngLat(lngLat);
      dragMarkerRef.current.setDraggable(makeDraggable);
    }
  }
  function clearDragMarker() {
    if (dragMarkerRef.current) { dragMarkerRef.current.remove(); dragMarkerRef.current = null; }
  }

  // Move apply/cancel
  const applyMove = useCallback(async () => {
    if (!selectedId || selectedGeomType !== "Point") return;
    if (!isNum(stageLon) || !isNum(stageLat)) { setStatusMsg("Invalid coordinates."); return; }
    const lo = parseFloat(stageLon), la = parseFloat(stageLat);

    setBusy(true); setStatusMsg("Applying move…");
    const { error } = await supabase.rpc("update_resource", {
      p_id: selectedId,
      p_geometry: { type: "Point", coordinates: [lo, la] }
    });
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Move failed: " + (error.message ?? "unknown")); return; }
    setStatusMsg("Point moved.");
    setMovePointMode("off");
    clearDragMarker();
    await refreshData();
  }, [selectedId, selectedGeomType, stageLon, stageLat, refreshData]);

  const cancelMove = useCallback(() => {
    setMovePointMode("off");
    clearDragMarker();
    const f = fc.features.find((x) => x.properties?.id === selectedId);
    if (f?.geometry?.type === "Point") {
      const [x, y] = f.geometry.coordinates;
      setStageLon(String(x.toFixed ? x.toFixed(6) : x));
      setStageLat(String(y.toFixed ? y.toFixed(6) : y));
    }
    setStatusMsg("Move canceled.");
  }, [fc, selectedId]);

  // Layer events
  const bindLayerEvents = useCallback((map: Map) => {
    const setPointer = (id: string) => {
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = stateRef.current.movePointMode === "pick" || stateRef.current.createMode === "point" ? "crosshair" : "pointer"; });
      map.on("mouseleave", id, () => {
        const pickCursor = stateRef.current.createMode === "point" || stateRef.current.movePointMode === "pick";
        map.getCanvas().style.cursor = pickCursor ? "crosshair" : "";
      });
    };
    ["points", "routes", "geofences-fill", "geofences-outline", "clusters"].forEach(setPointer);

    const selectPoint = async (e: any) => {
      if (stateRef.current.createMode !== "off") return;
      if (stateRef.current.movePointMode !== "off" && stateRef.current.movePointMode !== "pick") return;
      const f = e.features?.[0];
      if (f && typeof f.properties?.id === "number") {
        if (editingRef.current) { drawRef.current?.deleteAll(); setEditing(null); }
        selectById(f.properties.id, "Point");
      }
    };
    const selectRoute = (e: any) => {
      if (stateRef.current.createMode !== "off") return;
      if (stateRef.current.movePointMode !== "off") return;
      const f = e.features?.[0];
      if (f && typeof f.properties?.id === "number") {
        if (editingRef.current) { drawRef.current?.deleteAll(); setEditing(null); }
        selectById(f.properties.id, "LineString");
      }
    };
    const selectFence = (e: any) => {
      if (stateRef.current.createMode !== "off") return;
      if (stateRef.current.movePointMode !== "off") return;
      const f = e.features?.[0];
      if (f && typeof f.properties?.id === "number") {
        if (editingRef.current) { drawRef.current?.deleteAll(); setEditing(null); }
        selectById(f.properties.id, "Polygon");
      }
    };

    map.on("click", "points", selectPoint);
    map.on("click", "point-selected", selectPoint);
    map.on("click", "routes", selectRoute);
    map.on("click", "geofences-fill", selectFence);
    map.on("click", "geofences-outline", selectFence);

    map.on("click", "clusters", (e) => {
      if (stateRef.current.createMode !== "off") return;
      if (stateRef.current.movePointMode !== "off") return;
      const feature = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      const clusterId = feature?.properties?.cluster_id;
      const src = map.getSource("res_points") as any;
      if (clusterId && src?.getClusterExpansionZoom) {
        src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return;
          map.easeTo({ center: (feature.geometry as any).coordinates, zoom });
        });
      }
    });
  }, []);

  // Save non-geometry changes
  async function onSaveChanges() {
    if (!selectedId) return;
    let propsJson: any = null;
    try { propsJson = propsText?.trim() ? JSON.parse(propsText) : null; }
    catch { setStatusMsg("Save failed: Properties JSON invalid."); return; }
    setBusy(true); setStatusMsg("Saving…");
    const { error } = await supabase.rpc("update_resource", {
      p_id: selectedId, p_name: name?.trim() || null, p_rtype: rtype, p_status: rstatus, p_properties: propsJson, p_geometry: null
    });
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Save failed: " + (error.message ?? "unknown")); return; }
    setStatusMsg("Saved."); await refreshData();
  }

  async function onDeleteSelected() {
    if (!selectedId) return;
    if (editingRef.current) { drawRef.current?.deleteAll(); setEditing(null); }
    cancelMove();
    setBusy(true); setStatusMsg("Deleting…");
    const { error } = await supabase.rpc("delete_resource", { p_id: selectedId });
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Delete failed: " + (error.message ?? "unknown")); return; }
    setSelectedId(null); setSelectedGeomType(null);
    setPanelOpen(false); setStatusMsg("Deleted."); await refreshData();
  }

  // CREATE (point)
  async function createFromFormPoint() {
    if (!formValid) { setStatusMsg("Missing or invalid fields."); return; }
    let propsJson: any = null;
    try { propsJson = propsText?.trim() ? JSON.parse(propsText) : null; }
    catch { setStatusMsg("Properties JSON invalid."); return; }

    const lo = parseFloat(lon), la = parseFloat(lat);
    setBusy(true); setStatusMsg("Creating point…");
    const { data, error } = await supabase
      .from("resources")
      .insert([{ name: name.trim(), rtype, status: rstatus, properties: propsJson, geometry: { type: "Point", coordinates: [lo, la] } }])
      .select("id")
      .single();
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Create failed: " + (error.message ?? "unknown")); return; }

    const newId = data?.id as number;
    if (createFiles.length > 0 && newId) {
      await uploadFilesForResource(newId, createFiles);
      setCreateFiles([]);
    }
    setStatusMsg("Created.");
    setLon(""); setLat("");
    await refreshData();
  }
  function setLonLatFromMapCenter() {
    const map = mapRef.current; if (!map) return;
    const c = map.getCenter(); setLon(c.lng.toFixed(6)); setLat(c.lat.toFixed(6));
  }

  // Edit geometry (lines/polygons)
  function startEditGeometry() {
    if (!selectedId || selectedGeomType === "Point") return;
    const f = fc.features.find((x) => x.properties?.id === selectedId);
    if (!f) { setStatusMsg("No geometry to edit."); return; }
    const draw = drawRef.current as any; if (!draw) return;

    draw.changeMode("simple_select");
    draw.deleteAll();
    const drawId = draw.add({ type: "Feature", properties: {}, geometry: f.geometry });
    draw.changeMode("direct_select", { featureId: drawId });
    setEditing({ resourceId: selectedId, drawId });
    setCreateMode("off");
    setPanelOpen(true);
    setPanelTab("edit");
    setFabOpen(false);
    setStatusMsg("Editing geometry — drag vertices then Save.");
  }
  function cancelEditGeometry() {
    const draw = drawRef.current as any; if (draw) { draw.changeMode("simple_select"); draw.deleteAll(); }
    setEditing(null);
    setStatusMsg("Geometry edit canceled.");
  }
  async function saveEditGeometry() {
    if (!editingRef.current) return;
    const draw = drawRef.current as any;
    const fcDraw = draw?.getAll();
    const geom = fcDraw?.features?.[0]?.geometry;
    if (!geom) { setStatusMsg("Nothing to save."); return; }
    setBusy(true); setStatusMsg("Saving geometry…");
    const { error } = await supabase.rpc("update_resource", {
      p_id: editingRef.current.resourceId, p_geometry: geom
    });
    setBusy(false);
    if (error) { console.error(error); setStatusMsg("Save failed: " + (error.message ?? "unknown")); return; }
    draw.changeMode("simple_select");
    draw.deleteAll();
    setEditing(null);
    setStatusMsg("Geometry saved.");
    void refreshData();
  }

  // FAB actions
  function startCreate(mode: CreateMode) {
    const draw = drawRef.current as any;
    if (draw) { draw.changeMode("simple_select"); draw.deleteAll(); }
    cancelMove();
    setSelectedId(null);
    setSelectedGeomType(null);
    setPanelOpen(true);
    setPanelTab("create");
    setFabOpen(false);
    setCreateMode(mode);
    setStatusMsg(
      mode === "point" ? "Click the map to fill lon/lat, then 'Add point'." :
      mode === "geofence" ? "Draw a polygon with the toolbar." :
      "Draw a line with the toolbar."
    );
    if (mode === "geofence") drawRef.current?.changeMode("draw_polygon");
    if (mode === "route") drawRef.current?.changeMode("draw_line_string");
  }

  // CSV export
  function exportCSV() {
    const rows = fc.features.map((f) => {
      const base: any = {
        id: f.properties?.id, name: f.properties?.name, rtype: f.properties?.rtype, status: f.properties?.status,
        geometry_type: f.geometry?.type || null
      };
      if (f.geometry?.type === "Point") {
        base.lon = f.geometry.coordinates?.[0]; base.lat = f.geometry.coordinates?.[1];
      }
      for (const [k, v] of Object.entries(f.properties || {})) {
        if (["id","name","rtype","status"].includes(k)) continue;
        base[`prop.${k}`] = typeof v === "object" ? JSON.stringify(v) : v;
      }
      return base;
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "resources.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Zoom helper
  const zoomToResource = useCallback((id: number) => {
    const map = mapRef.current; if (!map) return;
    const f = fc.features.find(r => r.properties?.id === id); if (!f) return;
    const g = f.geometry;
    if (g.type === "Point") {
      const [x, y] = g.coordinates;
      map.easeTo({ center: [x, y], zoom: Math.max(map.getZoom(), 14) });
    } else {
      const bbox = bboxOf(g);
      map.fitBounds(bbox as any, { padding: 60 });
    }
  }, [fc]);

  // Work Orders handlers
  async function handleCreateWO(payload: Omit<WorkOrder, "id" | "created_at">) {
    const { error } = await supabase.from("work_orders").insert(payload);
    if (error) { console.error(error); setStatusMsg("Create WO failed: " + (error.message ?? "unknown")); }
    else { setStatusMsg("Work order created."); await loadWorkOrders(); }
  }
  async function handleUpdateWO(id: number, patch: Partial<WorkOrder>) {
    const { error } = await supabase.from("work_orders").update(patch).eq("id", id);
    if (error) { console.error(error); setStatusMsg("Update WO failed: " + (error.message ?? "unknown")); }
    else { setStatusMsg("Work order updated."); await loadWorkOrders(); }
  }
  async function handleDeleteWO(id: number) {
    const { error } = await supabase.from("work_orders").delete().eq("id", id);
    if (error) { console.error(error); setStatusMsg("Delete WO failed: " + (error.message ?? "unknown")); }
    else { setStatusMsg("Work order deleted."); await loadWorkOrders(); }
  }

  // Dim overlay only when not in interactive map modes
  const shouldShowDimOverlay =
    (createMode === "off" && movePointMode === "off" && !editing) &&
    (panelOpen || tableOpen || fabOpen);

  return (
    <main style={{ height: "100vh", position: "relative", display: "grid", gridTemplateRows: "56px 1fr" }}>
      {/* Top bar */}
      <header className="bar">
        <strong>Web GIS Resource Manager</strong>
        {busy && <Spinner />}
        <span className="muted">{statusMsg}</span>

        <div className="bar-right">
          <input value={q} onChange={(e) => { setQ(e.target.value); void refreshData(); }} placeholder="Search name/type/status" className="input" />
          <select value={fltType} onChange={(e) => { setFltType(e.target.value); void refreshData(); }} className="select">
            <option value="all">All types</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={fltStatus} onChange={(e) => { setFltStatus(e.target.value); void refreshData(); }} className="select">
            <option value="all">All status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={baseStyle} onChange={(e) => setBaseStyle(e.target.value)} title="Basemap" className="select">
            {BASESTYLES.map(s => <option key={s.id} value={s.url}>{s.label}</option>)}
          </select>
        </div>
      </header>

      {/* Map */}
      <div style={{ position: "relative" }}>
        <div ref={mapDiv} style={{ width: "100%", height: "100%" }} />

        {(createMode !== "off" || movePointMode !== "off") && (
          <div className="hint">
            {createMode === "point"      ? "Create: click the map to fill lon/lat (ESC cancels)" :
             createMode === "geofence"   ? "Create: draw a polygon (ESC cancels)" :
             createMode === "route"      ? "Create: draw a line (ESC cancels)" :
             movePointMode === "pick"    ? "Move: click the map to choose new coordinates (ESC cancels)" :
             "Move: drag the handle to new position (ESC cancels)"}
          </div>
        )}

        {busy && (
          <div className="overlay">
            <Spinner size={28} />
          </div>
        )}

        <Legend byType={countsByType} byStatus={countsByStatus} />

        {/* FAB (bottom-right) */}
        <div className="fab-wrap">
          {fabOpen && (
            <div className="fab-menu">
              <button onClick={() => startCreate("point")} className="btn menu blue">➕ New Point</button>
              <button onClick={() => startCreate("geofence")} className="btn menu">▦ New Geofence</button>
              <button onClick={() => startCreate("route")} className="btn menu">➝ New Route</button>
            </div>
          )}
          <button onClick={() => setFabOpen(v => !v)} aria-label="Add" className={`fab ${fabOpen ? "open" : ""}`}>
            +
          </button>
        </div>

        {/* Reopen Attribute Table pill */}
        {!tableOpen && (
          <button
            className="pill"
            onClick={() => { setTableOpen(true); setPanelOpen(false); setFabOpen(false); }}
            title="Show Attribute Table"
          >
            ▤ Table
          </button>
        )}
      </div>

      {/* Dim overlay */}
      {shouldShowDimOverlay && (
        <div
          onClick={() => {
            setFabOpen(false);
            if (panelOpen) setPanelOpen(false);
            if (tableOpen) setTableOpen(false);
          }}
          className="dim"
        />
      )}

      {/* Editor panel (right) */}
      <div className={`panel ${panelOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="seg">
            <button
              className={`seg-btn ${panelTab === "create" ? "on" : ""}`}
              onClick={() => { setPanelTab("create"); }}
            >
              Create
            </button>
            <button
              className={`seg-btn ${panelTab === "edit" ? "on" : ""}`}
              onClick={() => { if (selectedId) setPanelTab("edit"); }}
              disabled={!selectedId}
              title={!selectedId ? "Select a feature on the map" : ""}
            >
              Edit
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => { setPanelOpen(false); setCreateMode("off"); cancelMove(); }} title="Close" className="btn">Close</button>
        </div>

        <div className="panel-body">
          {/* Shared fields */}
          <label className="lbl">Name<span className="req">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Car A / Site 12"
                 className={`input ${must(name) ? "" : "err"}`} />

          <label className="lbl">Type<span className="req">*</span></label>
          <select value={rtype} onChange={(e) => setRtype(e.target.value as ResourceType)} className="select">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <label className="lbl">Status<span className="req">*</span></label>
          <select value={rstatus} onChange={(e) => setRstatus(e.target.value as ResourceStatus)} className="select">
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <label className="lbl">Properties (JSON)</label>
          <textarea rows={6} value={propsText} onChange={(e) => setPropsText(e.target.value)} className="textarea code" />

          {/* CREATE */}
          {panelTab === "create" && (
            <>
              <div className="row">
                <button
                  onClick={() => {
                    setCreateMode("point");
                    setStatusMsg("Click the map to fill lon/lat.");
                    drawRef.current?.changeMode?.("simple_select");
                  }}
                  className="btn blue"
                >
                  Pick on map
                </button>
                {createMode === "point" && (
                  <button onClick={() => { setCreateMode("off"); setStatusMsg("Pick canceled."); }} className="btn">
                    Cancel pick
                  </button>
                )}
              </div>

              <div className="row">
                <div className="col">
                  <label className="lbl">Lon<span className="req">*</span></label>
                  <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="lon"
                         className={`input ${isNum(lon) ? "" : "err"}`} />
                </div>
                <div className="col">
                  <label className="lbl">Lat<span className="req">*</span></label>
                  <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat"
                         className={`input ${isNum(lat) ? "" : "err"}`} />
                </div>
              </div>
              <div className="row">
                <button onClick={setLonLatFromMapCenter} className="btn">Use map center</button>
                <button onClick={createFromFormPoint} className="btn blue" disabled={!formValid}>Add point</button>
              </div>

              {/* Attachments (Create) */}
              <div className="section">
                <h4 className="section-title">Attachments for this new resource (images only)</h4>
                <div className="row wrap">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      const imgs = files.filter(isImageFile);
                      setCreateFiles((prev) => [...prev, ...imgs]);
                    }}
                  />
                  {createFiles.length > 0 && <span className="muted">{createFiles.length} file(s) staged</span>}
                  {createFiles.length > 0 && (
                    <button className="btn danger" onClick={() => setCreateFiles([])}>Clear</button>
                  )}
                </div>
                {createFiles.length > 0 && (
                  <div className="att-grid">
                    {createFiles.map((f, i) => (
                      <div key={i} className="att-card">
                        <div className="att-thumb"><span className="att-icon">🖼️</span></div>
                        <div className="att-meta">
                          <div className="att-name">{f.name}</div>
                          <div className="att-sub">{f.type || "image"} · {f.size} bytes</div>
                        </div>
                        <div>
                          <button className="btn danger" onClick={() => setCreateFiles(files => files.filter((_, j) => j !== i))}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* EDIT */}
          {panelTab === "edit" && selectedId ? (
            <>
              {selectedGeomType === "Point" && (
                <div className="section">
                  <h4 className="section-title">Move point</h4>
                  <div className="row">
                    <button
                      onClick={() => {
                        setMovePointMode("pick");
                        setStatusMsg("Move: click the map to choose new coordinates, then Apply.");
                        const f = fc.features.find((x) => x.properties?.id === selectedId);
                        if (f?.geometry?.type === "Point") ensureDragMarker(f.geometry.coordinates, false);
                      }}
                      className={`btn ${movePointMode === "pick" ? "blue" : ""}`}
                    >
                      Pick on map
                    </button>
                    <button
                      onClick={() => {
                        const f = fc.features.find((x) => x.properties?.id === selectedId);
                        if (f?.geometry?.type === "Point") {
                          ensureDragMarker(f.geometry.coordinates, true);
                          setMovePointMode("drag");
                          setStatusMsg("Move: drag the handle, then click Apply.");
                        }
                      }}
                      className={`btn ${movePointMode === "drag" ? "blue" : ""}`}
                    >
                      Drag handle
                    </button>
                    {movePointMode !== "off" && (
                      <button onClick={cancelMove} className="btn">Cancel move</button>
                    )}
                  </div>

                  <div className="row">
                    <div className="col">
                      <label className="lbl">Lon</label>
                      <input value={stageLon} onChange={(e) => setStageLon(e.target.value)} placeholder="lon"
                             className={`input ${isNum(stageLon) ? "" : "err"}`} />
                    </div>
                    <div className="col">
                      <label className="lbl">Lat</label>
                      <input value={stageLat} onChange={(e) => setStageLat(e.target.value)} placeholder="lat"
                             className={`input ${isNum(stageLat) ? "" : "err"}`} />
                    </div>
                  </div>
                  <div className="row">
                    <button onClick={applyMove} className="btn ok" disabled={!(isNum(stageLon) && isNum(stageLat))}>
                      Apply move
                    </button>
                  </div>
                </div>
              )}

              {selectedGeomType !== "Point" && !editing && (
                <button onClick={startEditGeometry} className="btn">Edit geometry</button>
              )}
              {editing ? (
                <div className="row">
                  <button onClick={saveEditGeometry} className="btn ok">Save geometry</button>
                  <button onClick={cancelEditGeometry} className="btn">Cancel</button>
                </div>
              ) : (
                <div className="row">
                  <button onClick={onSaveChanges} className="btn blue">Save changes</button>
                  <button onClick={onDeleteSelected} className="btn danger">Delete</button>
                </div>
              )}

              {/* Attachments (Edit) */}
              <div className="section">
                <h4 className="section-title">Attachments (images only)</h4>
                <div className="row wrap">
                  <input type="file" accept="image/*" onChange={(e) => uploadFilesForResource(selectedId!, Array.from(e.target.files || []))} />
                  {attBusy && <Spinner />}
                  <button onClick={() => loadAttachments(selectedId!)} className="btn">Refresh</button>
                </div>

                <div className="att-grid">
                  {attachments.length === 0 && <div className="muted">No files yet.</div>}
                  {attachments.map(att => {
                    const publicUrl = supabase.storage.from(att.bucket).getPublicUrl(att.path).data.publicUrl;
                    const isImg = (att.content_type || "").startsWith("image/");
                    return (
                      <div key={att.id} className="att-card">
                        <div className="att-thumb">
                          {isImg && publicUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={publicUrl} alt={att.filename} />
                          ) : (
                            <span className="att-icon">📄</span>
                          )}
                        </div>
                        <div className="att-meta">
                          <div className="att-name">{att.filename}</div>
                          <div className="att-sub">{att.content_type || "binary"} · {(att.size ?? 0)} bytes</div>
                          {publicUrl && (
                            <div className="att-links">
                              <a href={publicUrl} target="_blank" rel="noreferrer">Open</a>
                            </div>
                          )}
                        </div>
                        <div>
                          <button onClick={() => deleteAttachment(att)} className="btn danger">Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Work Orders (per-resource view) */}
              <div className="section">
                <h4 className="section-title">Work Orders</h4>
                <WorkOrders
                  list={workOrders.filter(w => selectedId ? w.resource_id === selectedId : true)}
                  resourceOptions={fc.features.map(f => ({ id: f.properties.id, name: f.properties.name || `#${f.properties.id}` }))}
                  onCreate={handleCreateWO}
                  onUpdate={handleUpdateWO}
                  onDelete={handleDeleteWO}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Attribute Table — bottom-center */}
      <div
        className={`table ${tableOpen ? "open" : ""}`}
        style={{ width: tableOpen ? tableDims.w : 0, height: tableOpen ? tableDims.h : 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="table-head">
          <strong>Attribute Table</strong>
          <div className="table-controls">
            <label className="lbl-sm">Sort</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="select-sm">
              <option value="id">id</option>
              <option value="name">name</option>
              <option value="rtype">type</option>
              <option value="status">status</option>
            </select>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)} className="select-sm">
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
            <label className="lbl-sm">Category</label>
            <select value={categoryBy} onChange={(e) => setCategoryBy(e.target.value as any)} className="select-sm">
              <option value="none">none</option>
              <option value="rtype">type</option>
              <option value="status">status</option>
            </select>
            <button onClick={exportCSV} className="btn-sm">CSV</button>
            <button onClick={() => setTableSize("s")} className="btn-sm">S</button>
            <button onClick={() => setTableSize("m")} className="btn-sm">M</button>
            <button onClick={() => setTableSize("l")} className="btn-sm">L</button>
            <button title="Hide Table" onClick={() => setTableOpen(false)} className="btn-sm ghost" aria-label="Hide Attribute Table">≡ Hide</button>
          </div>
        </div>
        <div className="table-body">
          {tableOpen && (
            categoryBy === "none" ? (
              <ResourceTable
                features={featuresSorted(fc, sortBy, sortDir)}
                onZoom={(id) => zoomToResource(id)}
                onEditCell={async (id, patch) => {
                  setBusy(true);
                  const { error } = await supabase.rpc("update_resource", { p_id: id, ...patch });
                  setBusy(false);
                  if (error) { console.error(error); setStatusMsg("Update failed: " + (error.message ?? "unknown")); }
                  else { setStatusMsg("Updated."); await refreshData(); }
                }}
                onDelete={async (id) => {
                  setBusy(true);
                  const { error } = await supabase.rpc("delete_resource", { p_id: id });
                  setBusy(false);
                  if (error) { console.error(error); setStatusMsg("Delete failed: " + (error.message ?? "unknown")); }
                  else { setStatusMsg("Deleted."); await refreshData(); }
                }}
                onSelect={(id) => selectById(id)}
              />
            ) : (
              (() => {
                const grouped = groupBy(featuresSorted(fc, sortBy, sortDir), categoryBy); // Record<string, Feature[]>
                return Object.keys(grouped).map((key) => {
                  const feats = grouped[key];
                  return (
                    <div key={key} className="group">
                      <div className="group-head">
                        {categoryBy === "rtype" ? "Type" : "Status"}: {key}  ·  {feats.length}
                      </div>
                      <div className="group-body">
                        <ResourceTable
                          features={feats}
                          onZoom={(id) => zoomToResource(id)}
                          onEditCell={async (id, patch) => {
                            setBusy(true);
                            const { error } = await supabase.rpc("update_resource", { p_id: id, ...patch });
                            setBusy(false);
                            if (error) { console.error(error); setStatusMsg("Update failed: " + (error.message ?? "unknown")); }
                            else { setStatusMsg("Updated."); await refreshData(); }
                          }}
                          onDelete={async (id) => {
                            setBusy(true);
                            const { error } = await supabase.rpc("delete_resource", { p_id: id });
                            setBusy(false);
                            if (error) { console.error(error); setStatusMsg("Delete failed: " + (error.message ?? "unknown")); }
                            else { setStatusMsg("Deleted."); await refreshData(); }
                          }}
                          onSelect={(id) => selectById(id)}
                        />
                      </div>
                    </div>
                  );
                });
              })()
            )
          )}
        </div>
      </div>

      {/* Styles */}
      <style jsx>{`
        .bar {
          display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #eee; background: #fff;
        }
        .bar-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
        .muted { color: #666; }

        .input, .select, .textarea {
          padding: 8px; border-radius: 10px; border: 1px solid #e5e7eb; transition: box-shadow .15s ease, transform .08s ease;
        }
        .input:focus, .select:focus, .textarea:focus { outline: none; box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
        .input.err { border-color: #ef4444; }
        .textarea.code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }

        .lbl { font-size: 12px; color: #666; }
        .lbl-sm { font-size: 12px; color: #666; margin-left: 6px; }
        .req { color: #ef4444; margin-left: 3px; }

        .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
        .wrap { flex-wrap: wrap; }
        .col { flex: 1; min-width: 160px; }

        .btn, .btn-sm {
          border: 1px solid #e5e7eb; background: #fff; border-radius: 10px; padding: 8px 12px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.05);
          transition: transform .08s ease, box-shadow .15s ease, background .2s ease;
          cursor: pointer;
        }
        .btn-sm { padding: 4px 8px; border-radius: 8px; font-size: 12px; }
        .btn:hover, .btn-sm:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(0,0,0,0.08); }
        .btn:active, .btn-sm:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .btn.blue { background: #eef6ff; }
        .btn.ok { background: #dcfce7; }
        .btn.danger { background: #fee2e2; }
        .btn-sm.ghost { background: #fafafa; }
        .menu { animation: fadeInUp .18s ease both; }

        .seg { display: inline-flex; background:#f3f4f6; border-radius: 999px; padding: 2px; }
        .seg-btn { padding:6px 10px; border-radius:999px; border:none; background:transparent; cursor:pointer; }
        .seg-btn.on { background:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
        .seg-btn:disabled { opacity:.5; cursor:not-allowed; }

        .hint {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
          background: #111; color: #fff; padding: 6px 10px; border-radius: 10px; font-size: 13px; z-index: 3;
          animation: pop .25s ease both;
        }
        .overlay {
          position: absolute; inset: 0; background: rgba(255,255,255,0.35);
          display: flex; align-items: center; justify-content: center; pointer-events: none;
        }

        .fab-wrap { position: absolute; right: 16px; bottom: 16px; z-index: 3; }
        .fab {
          width: 56px; height: 56px; border-radius: 50%; background: #2563eb; color: white; border: none;
          box-shadow: 0 18px 38px rgba(37,99,235,0.35); font-size: 28px; line-height: 56px;
          transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
          transform: rotate(0deg);
        }
        .fab.open { background: #1e40af; transform: rotate(45deg); }

        .fab-menu { margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }

        .pill {
          position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%);
          border: 1px solid #e5e7eb; background: #fff; border-radius: 999px; padding: 8px 12px;
          box-shadow: 0 8px 20px rgba(0,0,0,0.08); z-index: 3; animation: fadeInUp .18s ease both;
        }

        .dim { position: fixed; inset: 0; top: 56px; background: rgba(0,0,0,0.12); z-index: 2; }

        .panel {
          position: fixed; top: 56px; right: 0; bottom: 0; width: 460px; background: #fff;
          border-left: 1px solid #eee; box-shadow: 0 10px 30px rgba(0,0,0,0.06);
          transform: translateX(100%); transition: transform 220ms ease; padding: 12px; overflow-y: auto; z-index: 4;
        }
        .panel.open { transform: translateX(0); }
        .panel-head { display: flex; align-items: center; gap: 8px; }
        .panel-body { display: grid; gap: 8px; margin-top: 12px; }
        .section { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #e5e7eb; }
        .section-title { margin: 0 0 8px 0; }

        .att-grid { display: grid; gap: 8px; margin-top: 10px; }
        .att-card { display: grid; grid-template-columns: 72px 1fr auto; gap: 10px; align-items: center; border: 1px solid #eee; border-radius: 10px; padding: 8px; }
        .att-thumb { width: 72px; height: 48px; background: #f9fafb; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 8px; }
        .att-thumb img { max-width: 100%; max-height: 100%; transition: transform .2s ease; }
        .att-thumb img:hover { transform: scale(1.02); }
        .att-icon { font-size: 22px; }
        .att-name { font-weight: 600; }
        .att-sub { font-size: 12px; color: #666; }
        .att-links a { font-size: 12px; text-decoration: underline; }

        .table {
          position: fixed; left: 50%; bottom: 12px; transform: translate(-50%, 0);
          background: #fff; border: 1px solid #eee; border-radius: 12px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.12); overflow: hidden;
          transition: width 160ms ease, height 160ms ease, transform 160ms ease, box-shadow 160ms ease;
          z-index: 4;
        }
        .table.open { animation: fadeInUp .18s ease both; }
        .table-head {
          display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #eee; background: #fafafa; flex-wrap: wrap;
        }
        .table-controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-left: auto; }
        .select-sm, .btn-sm { font-size: 12px; }
        .table-body { height: calc(100% - 48px); overflow: auto; padding: 6px; }

        .group { margin-bottom: 12px; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
        .group-head { padding: 6px 10px; background: #f9fafb; border-bottom: 1px solid #eee; font-weight: 600; }
        .group-body { max-height: 280px; overflow: auto; }

        @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pop { from { transform: translateX(-50%) scale(.98); opacity: .9; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
      `}</style>
    </main>
  );
}

/* helpers */
function bboxOf(geom: any): [number, number, number, number] {
  const walk = (coords: any, bb: any): any => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y);
      bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y);
    } else { for (const c of coords) walk(c, bb); }
    return bb;
  };
  return walk(geom.coordinates, [Infinity, Infinity, -Infinity, -Infinity]);
}

function featuresSorted(fc: FeatureCollection, sortBy: "id"|"name"|"rtype"|"status", sortDir: "asc"|"desc") {
  const arr = [...fc.features];
  const get = (f: Feature) => {
    if (sortBy === "id") return Number(f.properties?.id ?? 0);
    if (sortBy === "name") return String(f.properties?.name ?? "");
    if (sortBy === "rtype") return String(f.properties?.rtype ?? "");
    if (sortBy === "status") return String(f.properties?.status ?? "");
    return 0;
  };
  arr.sort((a, b) => {
    const A = get(a), B = get(b);
    if (A < B) return sortDir === "asc" ? -1 : 1;
    if (A > B) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
  return arr;
}

function groupBy(arr: Feature[], by: "rtype" | "status"): Record<string, Feature[]> {
  const out: Record<string, Feature[]> = {};
  for (const f of arr) {
    const k = by === "rtype" ? String(f.properties?.rtype || "unknown")
                             : String(f.properties?.status || "unknown");
    if (!out[k]) out[k] = [];
    out[k].push(f);
  }
  return out;
}
