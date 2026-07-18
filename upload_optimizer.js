const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function optimizeUploadedImage() {
    try {
        const filePath = process.argv[2];
        if (!filePath) {
            console.error("Error: No file path provided.");
            process.exit(1);
        }

        if (!fs.existsSync(filePath)) {
            console.error(`Error: File not found at ${filePath}`);
            process.exit(1);
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
            // Not a supported image format for optimization, just return the original name
            console.log(path.basename(filePath));
            return;
        }

        const dir = path.dirname(filePath);
        const name = path.basename(filePath, ext);
        const webpPath = path.join(dir, `${name}.webp`);
        const avifPath = path.join(dir, `${name}.avif`);

        const pipeline = sharp(filePath);
        const metadata = await pipeline.metadata();

        let resizeWidth = metadata.width;
        if (metadata.width > 800) {
            resizeWidth = 800;
        }

        // Generate WebP
        await pipeline.clone()
            .resize({ width: resizeWidth })
            .webp({ quality: 80 })
            .toFile(webpPath);

        // Generate AVIF
        await pipeline.clone()
            .resize({ width: resizeWidth })
            .avif({ quality: 65 })
            .toFile(avifPath);

        // Delete original file to save space
        fs.unlinkSync(filePath);

        // Output the new base filename (webp) for the CMS to use.
        // We output the webp name because the CMS still expects a single file extension in site_data.js
        console.log(`${name}.webp`);
    } catch (err) {
        console.error("Error optimizing image:", err);
        process.exit(1);
    }
}

optimizeUploadedImage();
