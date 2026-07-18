const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const directories = [
    path.join(__dirname, 'images', 'products'),
    path.join(__dirname, 'images', 'blog')
];

async function optimizeImages() {
    try {
        for (const imgDir of directories) {
            if (!fs.existsSync(imgDir)) {
                continue;
            }

            const files = fs.readdirSync(imgDir);
            const imageFiles = files.filter(f => {
                const ext = path.extname(f).toLowerCase();
                return ['.png', '.jpg', '.jpeg'].includes(ext);
            });

            if (imageFiles.length === 0) continue;

            console.log(`[Optimizer] Found ${imageFiles.length} source images in: ${path.basename(imgDir)}`);

            for (const file of imageFiles) {
                const ext = path.extname(file);
                const name = path.basename(file, ext);
                const srcPath = path.join(imgDir, file);
                const destWebpPath = path.join(imgDir, `${name}.webp`);
                const destAvifPath = path.join(imgDir, `${name}.avif`);

                const srcStats = fs.statSync(srcPath);
                let needsWebp = true;
                let needsAvif = true;

                if (fs.existsSync(destWebpPath)) {
                    const destStats = fs.statSync(destWebpPath);
                    if (srcStats.mtimeMs <= destStats.mtimeMs) {
                        needsWebp = false;
                    }
                }
                if (fs.existsSync(destAvifPath)) {
                    const destStats = fs.statSync(destAvifPath);
                    if (srcStats.mtimeMs <= destStats.mtimeMs) {
                        needsAvif = false;
                    }
                }

                if (needsWebp || needsAvif) {
                    try {
                        const pipeline = sharp(srcPath);
                        const metadata = await pipeline.metadata();

                        let resizeWidth = metadata.width;
                        if (metadata.width > 800) {
                            resizeWidth = 800;
                        }

                        if (needsWebp) {
                            await pipeline.clone()
                                .resize({ width: resizeWidth })
                                .webp({ quality: 80 })
                                .toFile(destWebpPath);
                            const destStats = fs.statSync(destWebpPath);
                            const savings = ((srcStats.size - destStats.size) / srcStats.size * 100).toFixed(1);
                            console.log(`[Optimizer] Saved ${name}.webp: ${(srcStats.size / 1024).toFixed(0)} KB -> ${(destStats.size / 1024).toFixed(0)} KB (${savings}% smaller)`);
                        }
                        
                        if (needsAvif) {
                            await pipeline.clone()
                                .resize({ width: resizeWidth })
                                .avif({ quality: 65 })
                                .toFile(destAvifPath);
                            const destStats = fs.statSync(destAvifPath);
                            const savings = ((srcStats.size - destStats.size) / srcStats.size * 100).toFixed(1);
                            console.log(`[Optimizer] Saved ${name}.avif: ${(srcStats.size / 1024).toFixed(0)} KB -> ${(destStats.size / 1024).toFixed(0)} KB (${savings}% smaller)`);
                        }
                    } catch (err) {
                        console.error(`[Optimizer] Error processing ${file}:`, err.message);
                    }
                }
            }
        }
        console.log('[Optimizer] Image optimization completed.');
    } catch (error) {
        console.error('[Optimizer] Error during image optimization:', error);
    }
}

optimizeImages();
