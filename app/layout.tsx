import "maplibre-gl/dist/maplibre-gl.css";
import "maplibre-gl-draw/dist/mapbox-gl-draw.css";

export const metadata = { title: "Web GIS Resource Manager v2", description: "Next.js + Supabase (PostGIS)" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin:0, fontFamily: "ui-sans-serif, system-ui, -apple-system" }}>
        {children}
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </body>
    </html>
  );
}
