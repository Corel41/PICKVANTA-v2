import { createFileRoute, redirect } from "@tanstack/react-router";

// The PICKVANTA vanilla HTML/JS multi-page site lives unchanged in /public.
// "/" simply forwards to its own index.html.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: "/index.html" });
  },
  head: () => ({
    meta: [
      { title: "PickVanta" },
      { name: "description", content: "PickVanta — compare, discover and find deals (demo catalogue)." },
      { property: "og:title", content: "PickVanta" },
      { property: "og:description", content: "PickVanta — compare, discover and find deals (demo catalogue)." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
