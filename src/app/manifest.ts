import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TT Alarms - Table tennis match reminders",
    short_name: "TT Alarms",
    description: "Turn screenshots of table tennis matches into scheduled reminders.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0e14",
    theme_color: "#0a0e14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
