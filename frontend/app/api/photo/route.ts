// Photo API — returns a real photograph for a given place query.
//
// Priority:
//   1. Curated, hand-picked, verified shot for top destinations (best "feel").
//   2. Unsplash API, if UNSPLASH_ACCESS_KEY is set (high quality, any city).
//   3. Wikipedia page image (place-accurate, any city, no key).
//   4. LoremFlickr keyword photo (last-resort, no key).
//
// Response: { url, color, credit, creditUrl, source }

interface PhotoPayload {
  url: string;
  color: string;
  credit?: string;
  creditUrl?: string;
  source: "curated" | "unsplash" | "wikipedia" | "fallback";
}

const UA = "NaviroBot/1.0 (https://naviro.app)";

// Hand-picked, verified (1280px Wikimedia) shots for headline destinations.
const CURATED: Record<string, { url: string; color: string; credit: string }> = {
  goa:       { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Palolem_Beach%2C_South_Goa.jpg/1280px-Palolem_Beach%2C_South_Goa.jpg", color: "#2f7d8a", credit: "Wikimedia Commons" },
  jaipur:    { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/East_facade_Hawa_Mahal_Jaipur_from_ground_level_%28July_2022%29_-_img_01.jpg/1280px-East_facade_Hawa_Mahal_Jaipur_from_ground_level_%28July_2022%29_-_img_01.jpg", color: "#b9546a", credit: "Wikimedia Commons" },
  varanasi:  { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Dasaswamedh_ghat-varanasi_india-andres_larin.jpg/1280px-Dasaswamedh_ghat-varanasi_india-andres_larin.jpg", color: "#b06a3a", credit: "Wikimedia Commons" },
  manali:    { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Manali_City.jpg/1280px-Manali_City.jpg", color: "#5b779a", credit: "Wikimedia Commons" },
  udaipur:   { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Evening_view%2C_City_Palace%2C_Udaipur.jpg/1280px-Evening_view%2C_City_Palace%2C_Udaipur.jpg", color: "#7a6f9a", credit: "Wikimedia Commons" },
  hampi:     { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Wide_angle_of_Galigopuram_of_Virupaksha_Temple%2C_Hampi_%2804%29_%28cropped%29.jpg/1280px-Wide_angle_of_Galigopuram_of_Virupaksha_Temple%2C_Hampi_%2804%29_%28cropped%29.jpg", color: "#a8704a", credit: "Wikimedia Commons" },
  coorg:     { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Tadiandamol_Valley%2C_Western_Ghats.jpg/1280px-Tadiandamol_Valley%2C_Western_Ghats.jpg", color: "#3f6e4a", credit: "Wikimedia Commons" },
  rishikesh: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Trayambakeshwar_Temple_VK.jpg/1280px-Trayambakeshwar_Temple_VK.jpg", color: "#4a7a8a", credit: "Wikimedia Commons" },
};

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/[^a-z\s]/g, "").split(/\s+/)[0] || "";
}

function fallbackUrl(q: string): string {
  const keywords = encodeURIComponent(`${q || "india"},india,travel,landscape`);
  let hash = 0;
  for (let i = 0; i < q.length; i++) hash = (hash * 31 + q.charCodeAt(i)) & 0xffff;
  return `https://loremflickr.com/1600/900/${keywords}?lock=${hash}`;
}

async function fromUnsplash(q: string, key: string): Promise<PhotoPayload | null> {
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q + " india travel")}&orientation=landscape&per_page=8&content_filter=high`,
      { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    let hash = 0;
    for (let i = 0; i < q.length; i++) hash = (hash * 31 + q.charCodeAt(i)) & 0x7fffffff;
    const pick = results[hash % results.length];
    return {
      url: `${pick.urls.raw}&w=1600&q=80&auto=format&fit=crop`,
      color: pick.color || "#1a1a1a",
      credit: pick.user?.name,
      creditUrl: pick.links?.html,
      source: "unsplash",
    };
  } catch {
    return null;
  }
}

async function fromWikipedia(q: string): Promise<PhotoPayload | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=1600&redirects=1&titles=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0] as { thumbnail?: { source?: string } };
    const src = page?.thumbnail?.source;
    if (!src) return null;
    return { url: src, color: "#141414", credit: "Wikimedia Commons", creditUrl: "https://commons.wikimedia.org", source: "wikipedia" };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("q") || "").trim();
  const q = raw || "India travel";
  const slug = normalize(raw);

  const key = process.env.UNSPLASH_ACCESS_KEY;
  let payload: PhotoPayload;

  const curated = CURATED[slug];
  if (curated) {
    payload = { ...curated, source: "curated", creditUrl: "https://commons.wikimedia.org" };
  } else if (key) {
    payload =
      (await fromUnsplash(q, key)) ??
      (await fromWikipedia(q)) ??
      { url: fallbackUrl(slug), color: "#141414", source: "fallback" };
  } else {
    payload =
      (await fromWikipedia(q)) ??
      { url: fallbackUrl(slug), color: "#141414", source: "fallback" };
  }

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
