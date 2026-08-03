const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = {
        url: null,
        input: null,
        output: null,
        outputDir: '.',
        width: 1440,
        height: 900,
        scale: 1,
        fullPage: true,
        timeout: 30000,
        wait: 500,
        keepImage: false,
        authPath: null,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--url':
                args.url = argv[++i];
                break;
            case '--input':
                args.input = argv[++i];
                break;
            case '--output':
            case '-o':
                args.output = argv[++i];
                break;
            case '--output-dir':
                args.outputDir = argv[++i];
                break;
            case '--width':
                args.width = parseInt(argv[++i], 10);
                break;
            case '--height':
                args.height = parseInt(argv[++i], 10);
                break;
            case '--scale':
                args.scale = parseFloat(argv[++i]);
                break;
            case '--full-page':
                args.fullPage = true;
                break;
            case '--no-full-page':
                args.fullPage = false;
                break;
            case '--timeout':
                args.timeout = parseInt(argv[++i], 10);
                break;
            case '--wait':
                args.wait = parseInt(argv[++i], 10);
                break;
            case '--keep-image':
                args.keepImage = true;
                break;
            case '--auth':
                args.authPath = argv[++i];
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                console.warn(`Warning: unknown flag "${arg}" - ignoring it.`);
        }
    }

    return args;
}

function printHelp() {
    console.log(`
capture.js, takes a screenshot of a page (or a bunch of pages) and turns it into a pdf, no weird print css issues

usage:
  single page:
    node capture.js --url <URL> [options]

  batch (multiple urls from a file):
    node capture.js --input <file.csv|.md|.txt> [options]

options:
  --url <url>            page you wanna capture, use this for single capture.
  --input <path>          file with one url per line (.csv, .md, or .txt).
                          - csv rows can optionally have a second column for a
                          custom name: url,my-custom-name
                          - markdown links [text](url) and bullet lists work too.
  --output <path>         where to save the pdf (single mode only). if you skip this,
                          the filename gets generated from the url itself.
  --output-dir <dir>      folder to dump pdfs into for batch mode (default: current dir)
  --width <px>            viewport width (default: 1440)
  --height <px>           viewport height (default: 900)
  --scale <n>             device scale factor, use 2 for retina (default: 1)
  --full-page             capture the whole scrollable page (default: on)
  --no-full-page          capture only what's visible on screen
  --timeout <ms>          how long to wait for the page to load (default: 30000)
  --wait <ms>             extra time to let fonts/animations settle (default: 500)
  --keep-image            also keep the png screenshot (default: off, pdf only)
  --auth <path>           JSON file with saved localStorage key/value(s) to inject
                          before capturing, use this for pages that need login.
                          File format: { "entries": [ { "key": "...", "value": "..." } ] }
                          (a single { "key": ..., "value": ... } also works)
  --help                  shows this

examples:
  node capture.js --url https://youtube.com
  node capture.js --url https://youtube.com --output site.pdf --scale 2
  node capture.js --input urls.csv --output-dir ./screenshots --keep-image
  node capture.js --url https://example.com/dashboard --auth auth.json
`);
}

function validateArgs(args) {
    const errors = [];

    if (!args.url && !args.input) {
        errors.push('You must provide either --url <address> or --input <file>.');
    }

    if (args.url && args.input) {
        errors.push('Use either --url or --input, not both.');
    }

    if (args.url && !/^https?:\/\//i.test(args.url)) {
        errors.push(`--url must start with http:// or https:// (got "${args.url}")`);
    }

    if (args.input && !fs.existsSync(args.input)) {
        errors.push(`--input file not found: ${args.input}`);
    }

    if (args.authPath && !fs.existsSync(args.authPath)) {
        errors.push(`--auth file not found: ${args.authPath}`);
    }

    if (!Number.isFinite(args.width) || args.width <= 0) {
        errors.push(`--width must be a positive number (got "${args.width}")`);
    }

    if (!Number.isFinite(args.height) || args.height <= 0) {
        errors.push(`--height must be a positive number (got "${args.height}")`);
    }

    if (!Number.isFinite(args.scale) || args.scale <= 0) {
        errors.push(`--scale must be a positive number (got "${args.scale}")`);
    }

    if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
        errors.push(`--timeout must be a positive number of milliseconds (got "${args.timeout}")`);
    }

    return errors;
}

// reads and validates the --auth file, returns an array of { key, value } entries, or throws
function loadAuthData(authPath) {
    let raw;
    try {
        raw = fs.readFileSync(authPath, 'utf8');
    } catch (err) {
        throw new Error(`Couldn't read --auth file ${authPath}: ${err.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`--auth file ${authPath} isn't valid JSON: ${err.message}`);
    }

    // supports both a single { key, value } entry, and multiple entries
    // via { "entries": [ { key, value }, ... ] }
    let entries;
    if (Array.isArray(parsed.entries)) {
        entries = parsed.entries;
    } else if (parsed.key && typeof parsed.value !== 'undefined') {
        entries = [{ key: parsed.key, value: parsed.value }];
    } else {
        throw new Error(
            `--auth file ${authPath} must contain either a single "key"/"value" pair, ` +
            `or an "entries" array of { "key": ..., "value": ... } objects.`
        );
    }

    for (const entry of entries) {
        if (!entry.key || typeof entry.value === 'undefined') {
            throw new Error(
                `Every entry in --auth file ${authPath} needs a "key" and a "value", ` +
                `e.g. { "key": "authUser", "value": "..." }`
            );
        }
    }

    return entries;
}

// turns a url into a  readable filename.
// e.g: https://example.com/pricing?ref=x -> example-com-pricing
function slugFromUrl(url) {
    try {
        const u = new URL(url);
        const raw = `${u.hostname}${u.pathname}`;
        const slug = raw
            .replace(/^www\./, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return slug.length > 0 ? slug.slice(0, 80) : 'capture';
    } catch {
        return 'capture';
    }
}

// reads a .csv/.md/.txt file and pulls out { url, name } entries
// handles:
//   - plain urls, one per line
//   - markdown bullets ("- https://..." or "* https://...")
//   - markdown links ("[label](https://...)")
//   - csv rows ("https://...,custom-name")
function parseUrlList(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const entries = [];
    const urlPattern = /https?:\/\/[^\s)"'>,]+/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(urlPattern);
        if (!match) continue;

        const url = match[0];

        // anything after the url, past a comma, gets treated as a custom name
        const afterUrl = trimmed.slice(trimmed.indexOf(url) + url.length);
        const commaSplit = afterUrl.split(',');
        let name = null;
        if (commaSplit.length > 1 && commaSplit[1].trim()) {
            name = commaSplit[1].trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
        }

        entries.push({ url, name });
    }

    return entries;
}

// visits the target origin, injects the saved localStorage key/value pairs,
// then reloads so the page picks up the auth state on load
async function applyAuth(page, url, authEntries, timeout) {
    // load the page once first so we're on the right origin, and localStorage is writable
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    await page.evaluate((entries) => {
        for (const { key, value } of entries) {
            window.localStorage.setItem(key, value);
        }
    }, authEntries);

    // reload so the app re-initializes and reads the injected auth state
    await page.reload({ waitUntil: 'networkidle0', timeout });
}

async function capture(browser, url, opts) {
    const page = await browser.newPage();

    try {
        await page.setViewport({
            width: opts.width,
            height: opts.height,
            deviceScaleFactor: opts.scale,
        });

        try {
            if (opts.authData) {
                await applyAuth(page, url, opts.authData, opts.timeout);
            } else {
                await page.goto(url, {
                    waitUntil: 'networkidle0',
                    timeout: opts.timeout,
                });
            }
        } catch (err) {
            if (err.name === 'TimeoutError') {
                throw new Error(
                    `The page took too long to load (over ${opts.timeout}ms). ` +
                    `Try increasing --timeout, or check that ${url} is reachable.`
                );
            }
            throw new Error(`Couldn't open ${url} — ${err.message}`);
        }

        await page.evaluate(() => document.fonts.ready).catch(() => {
            // non-fatal, some pages just don't give us document.fonts properly
        });

        if (opts.wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, opts.wait));
        }

        const screenshotBuffer = await page.screenshot({ fullPage: opts.fullPage });
        return screenshotBuffer;
    } finally {
        await page.close();
    }
}

async function imageBufferToPdf(imageBytes, outputPath) {
    const pdfDoc = await PDFDocument.create();
    const image = await pdfDoc.embedPng(imageBytes);

    // exact 1:1, no scaling or letterboxing
    const pdfPage = pdfDoc.addPage([image.width, image.height]);
    pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    return { width: image.width, height: image.height };
}

// captures one url end-to-end: screenshot -> pdf (+ optional png on disk)
async function captureOne(browser, url, pdfPath, opts) {
    const imageBytes = await capture(browser, url, opts);

    if (opts.keepImage) {
        const imgPath = pdfPath.replace(/\.pdf$/i, '.png');
        fs.writeFileSync(imgPath, imageBytes);
    }

    const { width, height } = await imageBufferToPdf(imageBytes, pdfPath);
    return { width, height };
}

async function runSingle(args) {
    let browser;
    try {
        browser = await puppeteer.launch();
    } catch (err) {
        throw new Error(
            `Couldn't launch the browser. Is Puppeteer installed correctly? (${err.message})`
        );
    }

    try {
        const outputPath = args.output || `${slugFromUrl(args.url)}.pdf`;
        console.log(`Capturing ${args.url} at ${args.width}x${args.height} (scale ${args.scale})...`);
        if (args.authData) {
            const keys = args.authData.map((e) => e.key).join(', ');
            console.log(`Injecting saved auth (keys: ${keys}) before capture...`);
        }

        const { width, height } = await captureOne(browser, args.url, outputPath, args);

        console.log(`Done. Saved ${outputPath} (${width}x${height}px)`);
    } finally {
        await browser.close();
    }
}

async function runBatch(args) {
    const entries = parseUrlList(args.input);

    if (entries.length === 0) {
        throw new Error(`No URLs found in ${args.input}.`);
    }

    if (!fs.existsSync(args.outputDir)) {
        fs.mkdirSync(args.outputDir, { recursive: true });
    }

    let browser;
    try {
        browser = await puppeteer.launch();
    } catch (err) {
        throw new Error(
            `Couldn't launch the browser. Is Puppeteer installed correctly? (${err.message})`
        );
    }

    console.log(`Found ${entries.length} URL(s) in ${args.input}. Capturing each one...\n`);
    if (args.authData) {
        const keys = args.authData.map((e) => e.key).join(', ');
        console.log(`Injecting saved auth (keys: ${keys}) for each page...\n`);
    }

    const results = [];
    const usedNames = new Set();

    try {
        for (const entry of entries) {
            let baseName = entry.name || slugFromUrl(entry.url);
            let finalName = baseName;
            let suffix = 2;
            while (usedNames.has(finalName)) {
                finalName = `${baseName}-${suffix++}`;
            }
            usedNames.add(finalName);

            const pdfPath = path.join(args.outputDir, `${finalName}.pdf`);

            try {
                console.log(`  Capturing ${entry.url} ...`);
                const { width, height } = await captureOne(browser, entry.url, pdfPath, args);
                console.log(`  Saved ${pdfPath} (${width}x${height}px)`);
                results.push({ url: entry.url, ok: true, path: pdfPath });
            } catch (err) {
                console.error(`  Failed on ${entry.url}: ${err.message}`);
                results.push({ url: entry.url, ok: false, error: err.message });
            }
        }
    } finally {
        await browser.close();
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);

    if (failed > 0) {
        console.log('Failed URLs:');
        results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.url}: ${r.error}`));
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    const errors = validateArgs(args);
    if (errors.length > 0) {
        console.error('Error: invalid arguments:\n');
        errors.forEach((e) => console.error(`   - ${e}`));
        console.error('\nRun with --help to see usage.');
        process.exit(1);
    }

    try {
        if (args.authPath) {
            args.authData = loadAuthData(args.authPath);
        }

        if (args.input) {
            await runBatch(args);
        } else {
            await runSingle(args);
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main();