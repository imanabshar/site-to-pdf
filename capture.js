const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = {
        url: null,
        output: 'capture.pdf',
        width: 1440,
        height: 900,
        scale: 1,
        fullPage: true,
        timeout: 30000,
        wait: 500,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--url':
                args.url = argv[++i];
                break;
            case '--output':
            case '-o':
                args.output = argv[++i];
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
capture.js takes a screenshot of a page and turns it into a pdf, no weird print css issues

usage:
  node capture.js --url <URL> [options]

options:
  --url <url>          page you wanna capture (required). must start with http:// or https://
  --output <path>       where to save the pdf (default: capture.pdf)
  --width <px>          viewport width (default: 1440)
  --height <px>         viewport height (default: 900)
  --scale <n>           device scale factor, use 2 for retina (default: 1)
  --full-page           capture the whole scrollable page (default: on)
  --no-full-page        capture only what's visible on screen
  --timeout <ms>        how long to wait for the page to load (default: 30000)
  --wait <ms>           extra time to let fonts/animations settle (default: 500)
  --help                shows this

examples:
  node capture.js --url https://youtube.com
  node capture.js --url https://youtube.com --output site.pdf --scale 2
  node capture.js --url http://localhost:3000 --no-full-page
`);
}

function validateArgs(args) {
    const errors = [];

    if (!args.url) {
        errors.push('Missing required flag: --url <address>');
    } else if (!/^https?:\/\//i.test(args.url)) {
        errors.push(`--url must start with http:// or https:// (got "${args.url}")`);
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

async function capture(args) {
    let browser;

    try {
        browser = await puppeteer.launch();
    } catch (err) {
        throw new Error(
            `Couldn't launch the browser. Is Puppeteer installed correctly? (${err.message})`
        );
    }

    try {
        const page = await browser.newPage();

        await page.setViewport({
            width: args.width,
            height: args.height,
            deviceScaleFactor: args.scale,
        });

        try {
            await page.goto(args.url, {
                waitUntil: 'networkidle0',
                timeout: args.timeout,
            });
        } catch (err) {
            if (err.name === 'TimeoutError') {
                throw new Error(
                    `The page took too long to load (over ${args.timeout}ms). ` +
                    `Try increasing --timeout, or check that ${args.url} is reachable.`
                );
            }
            throw new Error(`Couldn't open ${args.url} — ${err.message}`);
        }

        await page.evaluate(() => document.fonts.ready).catch(() => {
            // non-fatal, some pages just don't give us document.fonts properly
        });

        if (args.wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, args.wait));
        }

        const outputDir = path.dirname(args.output) || '.';
        const outputBase = path.basename(args.output, path.extname(args.output));
        const screenshotPath = path.join(outputDir, `${outputBase}.png`);

        await page.screenshot({ path: screenshotPath, fullPage: args.fullPage });

        return screenshotPath;
    } finally {
        await browser.close();
    }
}

async function screenshotToPdf(screenshotPath, outputPath) {
    let imageBytes;

    try {
        imageBytes = fs.readFileSync(screenshotPath);
    } catch (err) {
        throw new Error(`Couldn't read the screenshot file at ${screenshotPath}: ${err.message}`);
    }

    try {
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
    } catch (err) {
        throw new Error(`Couldn't build the PDF: ${err.message}`);
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

    console.log(`Capturing ${args.url} at ${args.width}x${args.height} (scale ${args.scale})...`);

    try {
        const screenshotPath = await capture(args);
        console.log('Screenshot taken, building PDF...');

        const { width, height } = await screenshotToPdf(screenshotPath, args.output);

        console.log(`Done. Saved ${screenshotPath} and ${args.output} (${width}x${height}px)`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main();