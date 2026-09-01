// Vercel Routing Middleware (file convention: must live at the project
// root, see https://vercel.com/docs/routing-middleware). Overrides the
// link-preview metadata (title, og:*) specifically for /reportCard/* URLs -
// the one page meant to be shared outside the app (text messages, group
// chats - see AppHeader's "Report Card" overflow-menu link).
//
// This is a plain client-rendered SPA: vercel.json rewrites every path to
// the same static index.html, so without this every shared link previews
// identically as bare "infinidraft". Link-preview bots (iMessage,
// SMS/RCS, etc.) fetch the raw HTML and read these tags directly - they
// don't run the app's JS - so this can't be fixed client-side. (See
// index.html's dev/local title-suffix <script> - that's the only place
// document.title is ever touched, and even that only affects real
// browsers, never a bot's HTML fetch.)
//
// Static text, not personalized per-league - fetching a league name from
// Convex at the edge would add a real dependency/failure mode for a
// "nice to have" personalization; revisit if that's ever wanted.
export const config = {
  matcher: "/reportCard/:leagueId",
};

const TITLE = "Draft Grades - InfiniDraft";
const DESCRIPTION =
  "See how every team's draft graded out - value surplus, VOR, and an AI-written recap.";

export default async function middleware(request: Request): Promise<Response> {
  // Deployment Protection applies to every request to a protected domain
  // (e.g. develop.infinidraft.com - Vercel's "Standard Protection" covers
  // every domain except production), including this internal fetch, which
  // is a brand-new request that doesn't automatically inherit the incoming
  // request's cookies. Without forwarding them explicitly, this fetch gets
  // blocked and returns Vercel's own login page HTML instead of the real
  // index.html - which this middleware would then unknowingly serve back
  // as if it were the app. Documented fix: https://vercel.com/docs/deployment-protection
  // ("For server-side requests... manually add request cookies").
  const cookie = request.headers.get("cookie");
  const indexResponse = await fetch(
    new URL("/index.html", request.url),
    cookie ? { headers: { cookie } } : undefined,
  );
  let html = await indexResponse.text();

  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${DESCRIPTION}" />`,
    )
    .replace(
      /<meta\s+property="og:title"[\s\S]*?\/>/,
      `<meta property="og:title" content="${TITLE}" />`,
    )
    .replace(
      /<meta\s+property="og:description"[\s\S]*?\/>/,
      `<meta property="og:description" content="${DESCRIPTION}" />`,
    )
    .replace(
      /<meta\s+property="og:url"[\s\S]*?\/>/,
      `<meta property="og:url" content="${request.url}" />`,
    );

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
