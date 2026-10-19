# Image Processing Service

A Cloudinary-style image processing API with a small web UI on top of it, built for the Ours Privacy engineering take-home.

```
GET /process?url=https://example.com/photo.jpg&width=500&height=300&format=webp&quality=80
```

- **API:** TypeScript, Fastify and `sharp` (libvips). It fetches a remote image, resizes / crops / converts it, and returns the bytes with proper cache headers.
- **UI:** a vanilla TypeScript + Vite page (light / dark / system themes) that uses only the public API (`/process`, `/info`), like any other consumer would.
- **Docs:** OpenAPI 3 at `/openapi.json` with interactive docs at `/docs`.
- **Deployable:** one Docker image serves API and UI, with a health check at `/health`.

**Live URL:** not deployed. Deployment was optional, and I spent the time on the safety and quality of the service instead. The [deployment steps](#deployment) are written and the Docker image has been built and run locally.

**Contents:** [Setup and testing](#setup-and-testing-locally) · [API reference](#api-reference) · [Deployment](#deployment) · [Architecture and trade-offs](#architecture-and-key-trade-offs) · [Limits and safeguards](#limits-and-safeguards) · [What I would do next](#what-i-would-do-next) · [Configuration](#configuration)

---

## Setup and testing locally

Requires **Node.js 22** (`.nvmrc`). Everything installs inside the repository (`node_modules/`); nothing global is needed.

```bash
npm ci                 # install API + web dependencies
cp .env.example .env   # optional: every setting has a safe default
```

**Development** (hot reload):

```bash
npm run dev            # then open http://localhost:5173
```

The UI runs on **:5173** and proxies to the API on **:3000**. Port 3000 on its own is the bare API; its `/` page points to the UI and the docs.

**Production-style** (exactly how it is deployed):

```bash
npm run build
npm start              # then open http://localhost:3000 (API + UI together)
```

If a port is busy, set `PORT=3002` (and for `npm run dev` also `API_URL=http://localhost:3002` so the UI proxy follows).

**Docker:**

```bash
docker build -t image-service .
docker run --rm -p 3000:3000 image-service
```

**Code checks:** `npm run check` runs the format check, ESLint and the TypeScript typecheck (the same as CI).

### Testing

I did not include an automated test suite in this submission (see [what I would do next](#what-i-would-do-next)). To check the service by hand, start it (`npm run build && npm start`) and run:

```bash
B=http://localhost:3000
U='https%3A%2F%2Fpicsum.photos%2Fid%2F1015%2F1600%2F1000.jpg'

# Resize + convert; repeat the request and X-Cache flips from MISS to HIT
curl -sD - -o /tmp/out.webp "$B/process?url=$U&width=500&height=300&format=webp" | grep -iE 'HTTP|x-cache|x-image|etag'
curl -sD - -o /dev/null     "$B/process?url=$U&width=500&height=300&format=webp" | grep -i x-cache

# Conditional request -> 304
ETAG=$(curl -sI "$B/process?url=$U&width=500" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$B/process?url=$U&width=500"

# Source details
curl -s "$B/info?url=$U"

# Errors: every one returns the same JSON error shape
curl -s "$B/process?url=http%3A%2F%2F169.254.169.254%2F"   # 400 url_not_allowed (SSRF)
curl -s "$B/process?url=https%3A%2F%2Fexample.com%2F"       # 415 unsupported_media_type
curl -s "$B/process?url=$U&width=0&crop=zoom&foo=1"         # 400 invalid_parameter (3 details)
curl -s "$B/process?url=$U&width=4096&height=99999"         # 400 invalid_parameter
curl -s "$B/nope"                                            # 404 not_found

# Rate limit (default 60 / minute / IP): once spent you get 429 + Retry-After
for i in $(seq 1 61); do curl -s -o /dev/null -w '%{http_code} ' "$B/info"; done; echo
```

In the UI, paste a public image URL, or deliberately a bad one (an HTML page, a missing file, `http://169.254.169.254/`) to see how each error is surfaced. The `/docs` page can also execute requests.

I checked these by hand before submitting: resizing images from redirecting CDNs, JPEG/PNG/WebP conversion, cache hits and `304`s, SSRF rejections, HTML / 404 / DNS-failure sources, the theme switch (including persistence across reloads), the layout at desktop and phone widths in Chrome, and the Docker image (it builds, runs as a non-root user and reports healthy).

> Source URLs must be public, on ports 80/443. `http://localhost:...` or private addresses are refused on purpose; that is the SSRF protection (see below). To test against a locally hosted image, start the API with `ALLOW_PRIVATE_NETWORKS=true ALLOWED_PORTS=80,443,<your port>`.

---

## API reference

Interactive: **`/docs`** (generated from the same Zod schemas that validate requests, so it cannot drift). Machine-readable: **`/openapi.json`**.

### `GET /process`

| Parameter    | Type        | Default      | Description                                                                                             |
| ------------ | ----------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `url`        | string      | **required** | Absolute `http(s)` URL of the source image (URL-encode it).                                             |
| `width`      | int 1–4096  | –            | Target width. If only one dimension is given, the other follows the aspect ratio.                       |
| `height`     | int 1–4096  | –            | Target height.                                                                                          |
| `format`     | enum        | source       | `jpeg` (alias `jpg`), `png`, `webp`, `avif`, or `auto`. GIF sources become PNG when no format is given. |
| `quality`    | int 1–100   | 80 (AVIF 50) | Encoder quality. For PNG it enables lossy palette quantization.                                         |
| `crop`       | enum        | `fill`       | See below. Only matters when both `width` and `height` are given.                                       |
| `background` | hex, no `#` | transparent¹ | Used by `crop=pad` and when flattening transparency for JPEG. ¹ White for JPEG.                         |

**Crop modes** (Cloudinary vocabulary):

| `crop`  | Behaviour                                               | Output size            |
| ------- | ------------------------------------------------------- | ---------------------- |
| `fill`  | Cover the box, crop the overflow (centre)               | exactly `width×height` |
| `fit`   | Scale to fit inside the box, keep aspect ratio          | ≤ box                  |
| `limit` | Like `fit`, but never upscale                           | ≤ box and ≤ source     |
| `scale` | Stretch to the box, ignoring aspect ratio               | exactly `width×height` |
| `pad`   | Fit inside the box, pad the remainder with `background` | exactly `width×height` |

- **`format=auto`** returns WebP when the `Accept` header contains `image/webp`, otherwise a universally supported format (PNG for lossless sources, JPEG otherwise). Responses carry `Vary: Accept`.
- **Unknown parameters are rejected** (`widht=500` is a `400`, not a silently ignored typo).
- EXIF orientation is applied, then all metadata (EXIF, GPS, ICC) is stripped from the output. Animated sources are processed as their first frame.

**Success headers:** `Content-Type`, `Cache-Control: public, max-age=3600`, `ETag` (send `If-None-Match` for a `304`), `X-Cache` (`HIT`/`MISS`), `X-Image-Width`, `X-Image-Height`, `X-Request-Id`.

### `GET /info`

Describes the **source** image without transforming it (the UI uses it for the "original" panel):

```json
{
  "width": 1600,
  "height": 1000,
  "format": "jpeg",
  "bytes": 238114,
  "contentType": "image/jpeg",
  "hasAlpha": false,
  "animated": false
}
```

### `GET /health`

`{"status":"ok","uptimeSeconds":42}`. Liveness/readiness probe; never rate limited.

### Errors

Every failure from every endpoint has the same shape. Clients branch on `error.code`; `message` tells a human what to fix.

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "One or more query parameters are invalid.",
    "status": 400,
    "requestId": "65150602-902e-4702-bc75-fc674ebda6f3",
    "details": [
      { "param": "width", "message": "width must be a whole number between 1 and 4096" },
      { "param": "crop", "message": "crop must be one of: fill, fit, scale, limit, pad" }
    ]
  }
}
```

| Status | `code`                   | When                                                                                     |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| 400    | `invalid_parameter`      | Missing/invalid/unknown query parameter (every offending one is listed)                  |
| 400    | `url_not_allowed`        | Scheme, port, credentials, host or resolved IP is not permitted (SSRF policy)            |
| 404    | `source_not_found`       | The origin answered 404/410                                                              |
| 404    | `not_found`              | Unknown route                                                                            |
| 413    | `source_too_large`       | Source exceeds the byte limit (declared or streamed)                                     |
| 415    | `unsupported_media_type` | Not a JPEG/PNG/WebP/GIF/AVIF (SVG, HTML, PDF… are refused)                               |
| 422    | `invalid_image`          | Corrupt/truncated image, or more than the maximum source pixels                          |
| 422    | `output_too_large`       | Derived output would exceed the max dimension (e.g. `width=4096` on a 1×10000 px source) |
| 429    | `rate_limited`           | Per-client budget exhausted; `Retry-After` is set                                        |
| 502    | `source_unreachable`     | DNS failure, refused/reset connection, TLS error                                         |
| 502    | `source_error`           | Origin 5xx/other non-2xx, or too many redirects                                          |
| 503    | `overloaded`             | Transform queue full; `Retry-After` is set                                               |
| 504    | `source_timeout`         | The origin did not deliver the image within the deadline                                 |
| 500    | `internal_error`         | A bug. Logged with the `requestId`; internals are never leaked                           |

Error responses are `Cache-Control: no-store`.

---

## Deployment

Not deployed at submission time, but it is reproducible from this repository.

### Docker (any host)

```bash
docker build -t image-service .
docker run --rm -p 3000:3000 image-service
curl localhost:3000/health
```

The image is multi-stage (build → production dependencies → runtime), runs as the unprivileged `node` user, serves API **and** UI on one port, and has a `HEALTHCHECK` on `/health`. I built it and ran it locally: the UI and API respond, SSRF blocking works, and Docker reports it healthy.

### Render (free tier, via `render.yaml`)

1. Push the repository to GitHub or GitLab.
2. Render dashboard → **New → Blueprint** → select the repo. It reads `render.yaml`, builds the `Dockerfile` and uses `/health` as the health check.
3. Configuration is all environment variables declared in `render.yaml`: `TRUST_PROXY=1` (Render adds one proxy hop) and smaller caches for the 512 MB plan. **No secrets are needed.** If one is added later, declare it `sync: false` and set the value in the dashboard, never in the repository.
4. Free instances **sleep when idle**, so expect a slow first request (cold start) after a pause.

Any container host (Fly.io, Railway, Cloud Run…) works the same way: build the Dockerfile, set `PORT` if required, point the health check at `/health`, and set `TRUST_PROXY` to the number of proxies in front of the service.

### Vercel (free Hobby plan, no card)

`vercel.json` and `api/index.js` run the same app as a Vercel serverless function, with the UI served as static files from the CDN. Import the repository in Vercel (or deploy with the Vercel CLI); no settings are needed, because the build, output directory and URL rewrites are in `vercel.json`.

Serverless changes a few behaviours, so I treated them as deliberate trade-offs:

- **Response size cap:** Vercel rejects function responses over 4.5 MB. The adapter sets `MAX_OUTPUT_BYTES=4000000`, so an oversized result returns a clear `422 output_too_large` ("the processed image is 22.3 MB, but this deployment returns at most 3.8 MB…") instead of an opaque platform error. Large lossless PNGs are the usual trigger; JPEG/WebP/AVIF at normal quality are fine.
- **Caches are per warm instance:** the in-memory result/source caches only live as long as a function instance stays warm, so they help less than on a long-running container. HTTP caching (`Cache-Control`, `ETag`) still works and is the main win here; Redis would be the fix at scale.
- **Rate limiting is per instance:** counts are not shared across concurrent instances, so the limit is softer than on a single container.
- **Time limit:** the function is capped at 30 s and the source fetch deadline is lowered to 8 s.

For a stricter, long-running deployment use Docker/Render above.

### CI

`.github/workflows/ci.yml` runs the format check, lint, typecheck and build on every push and pull request, then builds the Docker image and smoke-tests `/health` inside the container.

---

## Architecture and key trade-offs

```
apps/
├── api/                      Fastify service (TypeScript, ESM)
│   └── src/
│       ├── main.ts           entrypoint: config, listen, graceful shutdown
│       ├── app.ts            builds the Fastify instance (plugins, routes, hooks)
│       ├── container.ts      composition root: the only place that wires concrete classes
│       ├── config/           env → typed, validated, immutable config (fails fast)
│       ├── errors/           AppError + the error-code vocabulary (the public contract)
│       ├── http/             transport layer: routes, schemas, validation, error handler, OpenAPI, UI hosting
│       ├── modules/
│       │   ├── image/        ImageService: orchestration (application layer)
│       │   ├── source/       URL policy, IP policy, guarded DNS, SafeFetcher, sniffing, SourceLoader
│       │   ├── transform/    query schema, output-size geometry, sharp pipeline
│       │   └── cache/        byte-bounded LRU, single-flight (request coalescing)
│       └── lib/              Semaphore (concurrency limiter)
└── web/                      Vite + vanilla TypeScript UI
    └── src/
        ├── api/              typed API client (DOM-free: the seed of an SDK) + option lists
        └── ui/               form, views, theme, DOM helper
```

**Layering.** `http/` knows about Fastify and nothing about pixels; `modules/` know nothing about HTTP. Dependencies point inward and are injected as small interfaces (`Pick<SafeFetcher,'fetch'>`, `Cache<V>`), so each piece can be tested with fakes. The Zod query schema is the single source of truth: it validates requests, types the handler and generates the OpenAPI document.

**Request flow for `GET /process`:**

```
validate query (Zod) ─▶ rate limit (shared per-IP budget)
   └▶ ImageService.process
        1. result cache lookup ............ HIT → respond (ETag / 304 / headers)
        2. single-flight on the cache key . identical concurrent requests share one computation
        3. SourceLoader.load
             source cache lookup ........... many transforms of one source = one download
             SafeFetcher.fetch ............. URL policy → guarded DNS → bounded download → redirects re-validated
             magic-byte sniff .............. only JPEG/PNG/WebP/GIF/AVIF ever reach the decoder
        4. inspect (header only) .......... pixel-count limit, predicted output-size limit
        5. Semaphore (bounded CPU) ........ queue full → 503
        6. sharp: orient → resize → flatten/pad → encode (metadata stripped)
        7. store in result cache
```

### Key trade-offs

| Decision                                               | Alternative                             | Why this way                                                                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In-memory caches and rate limiter**                  | Redis                                   | Zero infrastructure, one container, fits a free tier. Cost: each instance has its own cache/budget and a restart empties them. `Cache<V>` is an interface so Redis is a drop-in. |
| **Default `crop=fill` when both dimensions are given** | `scale` (Cloudinary's default) or `fit` | "Resize to specified dimensions" implies you get that exact size; `fill` delivers it without distortion. The other modes are one parameter away.                                 |
| **Reject unknown query parameters**                    | Ignore them                             | A silently ignored typo is the worst kind of API bug. Cost: callers can't append arbitrary extra params (e.g. for cache busting).                                                |
| **Magic-byte validation, no SVG**                      | Trust `Content-Type`, accept SVG        | A smaller decoder attack surface for an internet-facing service. Cost: no vector sources.                                                                                        |
| **Strip all metadata**                                 | Preserve it                             | EXIF/GPS leaks location and device data. Orientation is baked in first so images don't rotate.                                                                                   |
| **First frame of animated GIF/WebP**                   | Animated output                         | Animated encoding is far more expensive and out of scope for "a couple of hours". `/info` reports `animated: true`.                                                              |
| **`/info` as an extra public endpoint**                | Hot-link the original / guess           | The UI must show the original's dimensions, format and size using only public endpoints. A documented, cacheable `/info` also serves SDK users.                                  |
| **One shared rate-limit budget**                       | Per-route budgets                       | Per-route budgets let one client multiply their quota by the number of endpoints.                                                                                                |
| **Vanilla TypeScript UI**                              | React                                   | It is small (three views); a framework would add more tooling than it removes. The logic is split into a DOM-free client, a form module and views.                               |
| **Option lists duplicated in the UI**                  | Shared package / generated from OpenAPI | Avoids a build-order dependency between workspaces. Generating them from `/openapi.json` is on the next-steps list.                                                              |

---

## Limits and safeguards

Every value is an environment variable (see [Configuration](#configuration)); below are the defaults and **why** I chose them.

### Untrusted input (SSRF)

The service fetches URLs chosen by strangers, so without defences it is a ready-made SSRF proxy. I layered the controls:

| Control                          | Detail                                                                                                                                                                                               | Why                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheme allow-list**            | `http`/`https` only; `file:`, `ftp:`, `gopher:`, `data:` … refused                                                                                                                                   | Prevents local-file access and protocol smuggling                                                                                                                                                                          |
| **Port allow-list**              | `80, 443` by default (`ALLOWED_PORTS`)                                                                                                                                                               | Stops probing internal-style services on public hosts (Redis, SMTP, SSH…)                                                                                                                                                  |
| **No embedded credentials**      | `https://user:pass@host` refused                                                                                                                                                                     | Avoids credential smuggling and confusing-URL tricks                                                                                                                                                                       |
| **Literal-IP + hostname checks** | Loopback, RFC 1918, link-local (cloud metadata `169.254.169.254`), CGNAT, multicast, reserved, documentation, IPv4-mapped / NAT64 / 6to4 / Teredo IPv6 forms; `localhost`, `*.local`, `*.internal` … | Early, readable errors. The URL parser also normalises `2130706433`, `0x7f.1`, `127.1` to `127.0.0.1` before we look at them                                                                                               |
| **Guarded DNS lookup**           | The socket's own `lookup` rejects the connection if _any_ resolved address is non-public                                                                                                             | A public hostname can resolve to `127.0.0.1`, and records can change between check and connect (DNS rebinding). Validating inside the lookup the socket uses makes "the IP we checked" and "the IP we connect to" the same |
| **Manual redirects**             | At most 3 hops, **every hop re-validated** by the same policy                                                                                                                                        | An open redirect on a public host must not become a path to `http://169.254.169.254/`                                                                                                                                      |
| **Optional host allow-list**     | `ALLOWED_HOSTS=images.example.com` (matches subdomains)                                                                                                                                              | Lock the service to your own origins when it isn't meant to be a public proxy                                                                                                                                              |
| **Magic-byte sniffing**          | `Content-Type` is only a hint; the bytes must be JPEG/PNG/WebP/GIF/AVIF                                                                                                                              | Never hand SVG/PDF/TIFF/HTML to the decoder (smaller attack surface; SVG can reference external resources)                                                                                                                 |
| **Output hardening**             | `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` on image responses                                                                                      | Defence in depth if an image URL is opened directly                                                                                                                                                                        |

### Resource limits

| Limit             | Default                                                                        | Why                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Fetch deadline    | 10 s total (connect + headers + every redirect + body)                         | One slow origin must not hold a worker; a single deadline also defeats slow-loris-style drip feeds                              |
| Max source size   | 10 MB, checked on `Content-Length` **and** while streaming                     | Origins can lie or omit the header; the stream is aborted as soon as the cap is crossed                                         |
| Max source pixels | 40 MP                                                                          | A tiny PNG can decode to gigabytes (decompression bomb). Checked from the header before decoding, and enforced again by libvips |
| Max output size   | 4096 px per side, **also on derived dimensions**                               | `width=4096` on a 1×10000 source implies a 40-million-pixel-tall image, so the output size is computed before decoding          |
| Concurrency       | 4 concurrent transforms (≤ CPU count), queue of 16, then `503` + `Retry-After` | Encoding is CPU- and memory-heavy. Shedding load fast beats an unbounded backlog and an out-of-memory crash                     |
| Supported inputs  | JPEG, PNG, WebP, GIF, AVIF                                                     | SVG deliberately excluded (see above); TIFF/HEIC omitted to keep the decoder surface small                                      |
| Redirects         | 3                                                                              | Enough for CDNs; low enough to bound work                                                                                       |
| URL length        | 2048 characters                                                                | Sanity bound                                                                                                                    |

### Abuse

- **Rate limit:** 60 requests per 60 s per client IP, **one shared budget** across `/process` and `/info` (otherwise a client simply gets twice the quota). Over-limit requests get `429` with `Retry-After`. `/health`, `/docs` and static assets are exempt.
- **Client IP honesty:** the limiter keys on the request IP. Behind a proxy, set `TRUST_PROXY=<hops>` so it reads the real client address. It trusts exactly that many right-most forwarding entries and ignores anything further left (client-controlled), so `X-Forwarded-For` spoofing can't bypass the limit. The default (`0`) ignores forwarding headers completely.
- **Budgeting by construction:** cache hits are cheap and identical concurrent requests are coalesced, so a thundering herd on one URL costs one fetch and one transform.

### Caching

1. **HTTP:** `Cache-Control: public, max-age=3600`, a strong `ETag`, `If-None-Match` → `304`, and `Vary: Accept` only for `format=auto`. A CDN in front of the service makes repeated requests free.
2. **Processed-result cache:** in-memory LRU bounded by **bytes** (128 MB) with a TTL, keyed by a hash of _(source URL, normalised parameters)_. `jpg` ≡ `jpeg`; parameter order and URL fragments don't fragment it. The lookup happens _before_ the source is touched, so a warm result outlives its source entry.
3. **Source cache:** 64 MB / 5 min, so changing `width` on the same image doesn't re-download it.
4. **Single-flight:** concurrent identical work shares one promise. Failures are never cached.

### Observability (basics)

Structured JSON logs (pino) with a request id on every line, echoed in `X-Request-Id` and in every error body. A caller-supplied `X-Request-Id` is reused only if it is short and header-safe. `X-Cache` exposes hit/miss per response.

---

## What I would do next

I kept the scope near "a couple of hours" of core work, plus the safety work the brief asked to see.

**Bonuses I picked:** the OpenAPI spec with interactive docs, and a CI pipeline (plus `format=auto` and request-id/structured-logging basics, which come almost free). **Left out:** the video thumbnail endpoint (needs ffmpeg in the image and a second, riskier fetch-and-decode surface), the typed SDK, and metrics.

In rough priority order:

1. **An automated test suite.** Unit tests for the URL/IP policies and output geometry; integration tests against a fake origin server (redirects, oversized and hanging bodies, corrupt images); SSRF regression tests; browser tests for the UI. The layering and constructor injection were chosen to make this straightforward.
2. **Shared cache and rate limiting (Redis)** so multiple instances behave as one, plus a CDN in front keyed on the full URL (`Vary: Accept` is already correct).
3. **Signed URLs / API keys** with per-key quotas instead of an open proxy, and `ALLOWED_HOSTS` as the default for any non-demo deployment.
4. **Metrics:** a Prometheus `/metrics` endpoint for latency, cache hit rate, error rate by `code` and queue depth.
5. **Typed SDK** generated from `/openapi.json` (URL builder plus error classes keyed by `error.code`). The UI's `api/client.ts` is already DOM-free and is the seed; its option lists should be generated from the same document.
6. **More transforms:** rotate, blur, grayscale, smart crop (gravity), DPR; animated output; HEIC/TIFF input behind an explicit flag.
7. **Egress isolation:** run the fetcher behind a network namespace or egress proxy that physically cannot reach internal ranges, the strongest SSRF defence beyond application checks.
8. **Conditional revalidation of sources** (`If-None-Match`/`Last-Modified` upstream) instead of fixed TTLs, and `stale-while-revalidate`.
9. **Deploy it** and keep it running as the brief describes, with the cold-start note above.

---

## Configuration

Every setting is an environment variable with a safe default (`.env.example` lists them all). Invalid values fail at startup with a readable message.

| Variable                                              | Default                   | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `PORT` / `HOST`                                       | `3000` / `0.0.0.0`        | Listen address                                                                 |
| `LOG_LEVEL`                                           | `info`                    | pino log level                                                                 |
| `TRUST_PROXY`                                         | `0`                       | Number of trusted reverse-proxy hops                                           |
| `FETCH_TIMEOUT_MS`                                    | `10000`                   | Total deadline for fetching a source                                           |
| `MAX_SOURCE_BYTES`                                    | `10485760`                | Max source download size                                                       |
| `MAX_SOURCE_PIXELS`                                   | `40000000`                | Max decoded source pixels                                                      |
| `MAX_REDIRECTS`                                       | `3`                       | Redirect hop cap                                                               |
| `ALLOWED_PORTS`                                       | `80,443`                  | Permitted source ports                                                         |
| `ALLOWED_HOSTS`                                       | _(any public host)_       | Optional allow-list (matches subdomains)                                       |
| `ALLOW_PRIVATE_NETWORKS`                              | `false`                   | **Development only.** Disables the SSRF address checks                         |
| `MAX_OUTPUT_DIMENSION`                                | `4096`                    | Max output width/height                                                        |
| `MAX_OUTPUT_BYTES`                                    | `0` (unlimited)           | Max response size in bytes; set where the host caps responses (Vercel: 4 MB)   |
| `MAX_CONCURRENT_TRANSFORMS` / `MAX_QUEUED_TRANSFORMS` | `min(CPUs,4)` / `16`      | Transform concurrency and queue depth                                          |
| `CACHE_TTL_SECONDS`                                   | `3600`                    | Result-cache TTL and `Cache-Control` max-age                                   |
| `RESULT_CACHE_MB` / `SOURCE_CACHE_MB`                 | `128` / `64`              | Cache byte budgets                                                             |
| `SOURCE_CACHE_TTL_SECONDS`                            | `300`                     | Source-cache TTL                                                               |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS`        | `60` / `60`               | Per-client budget                                                              |
| `WEB_DIST_DIR`                                        | _(auto: `apps/web/dist`)_ | Directory of the built UI to serve at `/` (set explicitly in the Docker image) |
