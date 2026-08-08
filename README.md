# Site to PDF

A tool that takes a screenshot of a webpage (or a batch of them) and turns it into a PDF, with none of the broken layouts you get from browser print-to-PDF.

## Idea Behind the Project

This started from wanting to avoid manually opening each page and taking a screenshot one by one. Instead of doing that by hand, Site to PDF takes a batch of URLs and handles the whole thing on its own: navigate, screenshot, convert, save, for every link in the list.

The reason it works this way instead of using a browser's built-in print-to-PDF: printing a webpage often breaks the layout. CSS grid, flexbox, fixed-position elements, and custom fonts frequently render incorrectly or get cut off, because the browser is trying to reflow the page for print rather than capture it as it actually looks on screen.

Site to PDF sidesteps this entirely. Instead of relying on a browser's print rendering, it takes a full screenshot of the page exactly as rendered, then embeds that image into a PDF at a 1:1 scale. What you see is what you get. No reflowing, no broken layouts, no missing sections.

## How It Works

Site to PDF works in two modes: single capture and batch capture.

* **Single** Provide one URL with `--url`. The tool launches a headless browser, loads the page, waits for fonts and any settle time to finish, takes a full-page screenshot, and embeds it into a PDF sized exactly to the screenshot's dimensions. 

* **Batch** Provide a file of URLs with `--input`. Each URL is captured the same way as single mode, saved into an output directory, and a summary of successes and failures is printed at the end.

## Installation & Usage

Install dependencies first, then capture pages with `--url` (single) or `--input` (batch). Add `--auth` to either mode for pages that need login.

### Setup

Requires Node.js. Install the dependencies:

```bash
npm install
```

### Single Page Capture

Capture one page and save it as a PDF.

- Basic usage, saves to an auto-generated filename based on the URL:
```bash
node capture.js --url https://example.com
```

- With a custom output name and retina-quality scale:
```bash
node capture.js --url https://example.com --output site.pdf --scale 2
```

### Batch Capture

Capture multiple pages from a list of URLs.

```bash
node capture.js --input urls.csv --output-dir ./screenshots --keep-image
```

`urls.csv`, `urls.md`, or `urls.txt` can contain a mix of:
* Plain URLs, one per line
* Markdown bullet lists (`- https://...` or `* https://...`)
* Markdown links (`[label](https://...)`, label ignored)

Each captured file is saved into `--output-dir` and any line can end with `,custom-name` to set that entry's output filename, otherwise it falls back to a slug generated from the URL.

### Authenticated Pages

Add `--auth <path>` to either single or batch capture for pages that need you to be logged in. Since Puppeteer launches a fresh, signed-out browser every run, it has no memory of any login, so pages behind auth would otherwise just show a login screen. This flag injects saved `localStorage` values before capturing to fix that.

```bash
node capture.js --url https://example.com/dashboard --auth auth.json
```

**How to build the `auth.json` file:**
1. Log into the site normally, in your own browser
2. Open DevTools → Application → Local Storage → find the keys the site uses to store your session (commonly something like an access token and a user object)
3. Copy the full, untruncated values
4. Save them into a JSON file:

```json
{
  "entries": [
    { "key": "accessToken", "value": "..." },
    { "key": "authUser", "value": "..." }
  ]
}
```

A single key also works, without the `entries` wrapper:
```json
{ "key": "authUser", "value": "..." }
```

**Note:** most auth tokens expire quickly, if a page stops authenticating correctly, the token in your `auth.json` has likely expired. Just repeat the copy step with a fresh value.

## Options

| Flag | Description | Default |
|---|---|---|
| `--url <url>` | Page to capture (single mode) | |
| `--input <path>` | File of URLs to capture (batch mode) | |
| `--output <path>`, `-o` | Output PDF path (single mode only) | derived from URL |
| `--output-dir <dir>` | Folder to save PDFs into (batch mode) | `.` |
| `--width <px>` | Viewport width | `1440` |
| `--height <px>` | Viewport height | `900` |
| `--scale <n>` | Device scale factor (use `2` for retina quality) | `1` |
| `--full-page` | Capture the entire scrollable page | on |
| `--no-full-page` | Capture only what's visible in the viewport | |
| `--timeout <ms>` | Max time to wait for the page to load | `30000` |
| `--wait <ms>` | Extra settle time for fonts/animations after load | `500` |
| `--keep-image` | Also save the intermediate PNG screenshot | off |
| `--auth <path>` | JSON file with saved `localStorage` key/value(s) to inject before capturing, for pages that need login | |
| `--help`, `-h` | Show usage help | |

## Under the Hood

1. Launches a headless Chromium instance via Puppeteer.
2. Navigates to each URL and waits for the network to go idle (`networkidle0`) and fonts to finish loading.
3. Takes a full resolution screenshot.
4. Embeds that screenshot into a new PDF sized exactly to the image dimensions (no scaling, cropping, or letterboxing).
5. In batch mode, processes each URL in sequence, auto resolving filename collisions (`name-2.pdf`, `name-3.pdf`, and so on), and prints a summary of successes and failures at the end.
6. When no custom filename is given, output names are generated by slugifying the URL. For example, `https://example.com/pricing?ref=x` becomes `example-com-pricing.pdf`.
7. If `--auth` is provided, the target page is visited once, the saved `localStorage` values are injected, and the page is reloaded before the screenshot is taken.

## Notes & Limitations

- Only `http://` and `https://` URLs are currently supported, local files (`file://` or local paths) aren't captured.
- If your target page and your `capture.js` process are running in different environments (e.g. one in WSL, one on Windows), `localhost` may not resolve between them. Use the actual reachable IP address of the environment hosting the page instead.
- In batch mode, one failing URL doesn't stop the run. It's logged and the rest continue.
- Timeouts raise a clear error suggesting you increase `--timeout` or check that the page is reachable.
- Never commit your `auth.json` (or whatever you name it), it contains real login credentials. Add it to `.gitignore`.

## Built With

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
&nbsp;&nbsp;
![Puppeteer](https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white)
&nbsp;&nbsp;
![pdf-lib](https://img.shields.io/badge/pdf--lib-D32F2F?style=for-the-badge)

</div>
