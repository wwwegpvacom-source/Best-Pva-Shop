const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

console.log("Running image optimizer...");
try {
    execSync('node optimize_images.js', { stdio: 'inherit' });
} catch (err) {
    console.error("Image optimizer failed to run, continuing build anyway...", err.message);
}

// --- 1. Load Data ---
console.log("Reading site_data.js...");
const dataJsContent = fs.readFileSync('site_data.js', 'utf8');

// Append assignment to ensure we capture const/let variables which are not automatically attached to sandbox
const scriptContent = dataJsContent + `
;
this.siteConfig = siteConfig;
this.categories = categories;
this.reviewsData = reviewsData;
this.products = products;
this.blogs = blogs || [];
try { this.gradients = gradients; } catch(e) {}
`;

// Use VM to execute the data file safely to extract variables
const sandbox = { 
    console: console, // Allow logging if any
    document: {}, // Mock document if needed to prevent reference errors during parsing
    window: {},
    alert: () => {},
    confirm: () => false
};
vm.createContext(sandbox);

try {
    vm.runInContext(scriptContent, sandbox);
} catch (e) {
    console.error("Error parsing site_data.js:", e);
    process.exit(1);
}

const siteConfig = sandbox.siteConfig;
const categories = sandbox.categories;
const reviewsData = sandbox.reviewsData;
const productsRaw = sandbox.products;
const products = productsRaw ? productsRaw.filter(p => p.active !== false) : [];
const blogs = sandbox.blogs || [];
const gradients = sandbox.gradients || {}; // gradients might be missing or defined elsewhere
const redirects = sandbox.redirects || siteConfig.redirects || []; // For 301 redirects

// --- URL Configuration ---
const baseUrl = siteConfig.baseUrl || 'https://bestpvashop.com/';
const paths = siteConfig.pathConfig || {
    product: 'product',
    category: 'categories',
    blog: 'blog',
    sitemap: 'sitemap.xml'
};

function slugify(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Helper to construct URLs dynamically from site_data.js config
 */
function getDynamicUrl(type, slug = '', isAbsolute = true) {
    const base = paths[type] || type;
    const cleanSlug = slugify(slug);
    
    let urlPath = '';
    if (type === 'home') {
        urlPath = '/';
    } else if (!cleanSlug) {
        urlPath = `/${base}/`;
    } else {
        urlPath = `/${base}/${cleanSlug}/`;
    }

    // Fix double slashes
    urlPath = urlPath.replace(/\/+/g, '/');

    if (isAbsolute) {
        return `${baseUrl.replace(/\/+$/, '')}${urlPath}`;
    }
    return urlPath;
}

if (!products || !siteConfig) {
    console.error("Failed to load data from site_data.js");
    process.exit(1);
}

console.log(`Loaded ${products.length} products and ${blogs.length} blog posts.`);

// --- Load Templates ---
const headerHtml = fs.readFileSync('header_partial.html', 'utf8');

// --- 2. Helper Functions ---

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Recursively deletes a directory and its contents
 * Robust version for Windows
 */
function cleanDirectory(dir) {
    if (fs.existsSync(dir)) {
        console.log(`Cleaning directory: ${dir}`);
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (err) {
            console.warn(`Initial cleaning of ${dir} failed, retrying...`);
            // Small delay and retry for Windows file locks
            try {
                // On Windows, sometimes directories are "busy" for a split second
                // We'll try to delete contents individually if rmSync fails
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const curPath = path.join(dir, file);
                    if (fs.lstatSync(curPath).isDirectory()) {
                        cleanDirectory(curPath);
                    } else {
                        fs.unlinkSync(curPath);
                    }
                }
                fs.rmdirSync(dir);
            } catch (retryErr) {
                console.error(`Failed to clean directory ${dir}:`, retryErr.message);
            }
        }
    }
}

function generateFooter(products, siteConfig) {
    // Group products by category
    const categoriesGrouped = {};
    products.forEach(p => {
        if (!categoriesGrouped[p.category]) categoriesGrouped[p.category] = [];
        categoriesGrouped[p.category].push(p);
    });

    // Link to real category pages
    const categoryLinks = Object.keys(categoriesGrouped).slice(0, 5).map(catName => {
        const catData = categories.find(c => c.name === catName);
        if (!catData || !catData.slug) return '';
        const url = getDynamicUrl('category', catData.slug, false);
        return `<li><a href="${url}" class="text-slate-400 hover:text-cyan-400 transition-colors text-sm">${catName}</a></li>`;
    }).filter(Boolean).join('');

    const popularProducts = products.filter(p => p.is_sale).slice(0, 5).map(p => {
        const url = getDynamicUrl('product', p.slug, false);
        return `<li><a href="${url}" class="text-slate-400 hover:text-cyan-400 transition-colors text-sm">${p.display_title || p.title}</a></li>`;
    }).join('');

    const logoContent = siteConfig.logoUrl 
        ? `<img src="${siteConfig.logoUrl}" alt="${siteConfig.logoText || 'Logo'}" class="h-8 w-auto"><span class="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 font-extrabold text-2xl tracking-tight ml-2">{{LOGO_TEXT}}</span>`
        : `<span class="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 font-extrabold text-2xl tracking-tight">{{LOGO_TEXT}}</span>`;

    const siteDomain = (siteConfig.siteTitle || 'BestPVAShop').toLowerCase().replace(/\s+/g, '') + '.com';

    return `
        <div class="max-w-7xl mx-auto px-4">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                <div class="col-span-1 md:col-span-1">
                    <div class="flex items-center gap-2 mb-4">
                        ${logoContent}
                    </div>
                    <p class="text-slate-500 text-sm leading-relaxed mb-4">
                        {{META_DESCRIPTION}}
                    </p>
                    <div class="flex gap-3">
                        <a href="https://facebook.com/${siteDomain.split('.')[0]}" target="_blank" rel="nofollow" class="text-slate-400 hover:text-white transition-colors" aria-label="Facebook"><i data-lucide="facebook" class="w-5 h-5"></i></a>
                        <a href="https://x.com/${siteDomain.split('.')[0]}" target="_blank" rel="nofollow" class="text-slate-400 hover:text-white transition-colors" aria-label="X (Twitter)"><i data-lucide="twitter" class="w-5 h-5"></i></a>
                        <a href="https://t.me/${(siteConfig.telegram || '').replace('@','')}" target="_blank" rel="nofollow" class="text-slate-400 hover:text-white transition-colors" aria-label="Telegram"><i data-lucide="send" class="w-5 h-5"></i></a>
                        <a href="{{WHATSAPP_LINK}}" target="_blank" rel="nofollow" class="text-slate-400 hover:text-white transition-colors" aria-label="WhatsApp"><i data-lucide="message-circle" class="w-5 h-5"></i></a>
                        <a href="mailto:{{SUPPORT_EMAIL}}" target="_blank" rel="nofollow" class="text-slate-400 hover:text-white transition-colors" aria-label="Email"><i data-lucide="mail" class="w-5 h-5"></i></a>
                    </div>
                </div>
                
                <div>
                    <h4 class="text-white font-bold mb-4">Categories</h4>
                    <ul class="space-y-2">
                        ${categoryLinks}
                    </ul>
                </div>

                <div>
                    <h4 class="text-white font-bold mb-4">Popular Products</h4>
                    <ul class="space-y-2">
                        ${popularProducts}
                    </ul>
                </div>

                <div>
                    <h4 class="text-white font-bold mb-4">Contact Us</h4>
                    <ul class="space-y-2 text-sm text-slate-400">
                        <li class="flex items-center gap-2">
                            <i data-lucide="mail" class="w-4 h-4 text-cyan-500"></i> 
                            <a href="mailto:{{SUPPORT_EMAIL}}" class="hover:text-white transition-colors">{{SUPPORT_EMAIL}}</a>
                        </li>
                        <li class="flex items-center gap-2">
                            <i data-lucide="phone" class="w-4 h-4 text-green-500"></i> 
                            <a href="{{WHATSAPP_LINK}}" target="_blank" rel="nofollow" class="hover:text-white transition-colors">{{WHATSAPP}}</a>
                        </li>
                        <li class="flex items-center gap-2">
                            <i data-lucide="send" class="w-4 h-4 text-blue-500"></i> 
                            <a href="{{TELEGRAM_LINK}}" target="_blank" rel="nofollow" class="hover:text-white transition-colors">@{{TELEGRAM}}</a>
                        </li>
                    </ul>
                </div>
            </div>
            
            <div class="border-t border-white/5 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                <p class="text-slate-500 text-sm">Copyright © ${new Date().getFullYear()} ${siteDomain}. All rights reserved.</p>
                <div class="flex gap-4 text-sm text-slate-500 flex-wrap justify-center">
                    <a href="${getDynamicUrl('about', '', false)}" class="hover:text-white transition-colors">About</a>
                    <a href="${getDynamicUrl('contact', '', false)}" class="hover:text-white transition-colors">Contact</a>
                    <a href="${getDynamicUrl('faq', '', false)}" class="hover:text-white transition-colors">FAQ</a>
                    <a href="${getDynamicUrl('blog', '', false)}" class="hover:text-white transition-colors">Blog</a>
                    <a href="${getDynamicUrl('policies/privacy-policy', '', false)}" class="hover:text-white transition-colors">Privacy Policy</a>
                    <a href="${getDynamicUrl('policies/terms-and-conditions', '', false)}" class="hover:text-white transition-colors">Terms of Service</a>
                    <a href="${getDynamicUrl('policies/refund-policy', '', false)}" class="hover:text-white transition-colors">Refund Policy</a>
                    <a href="${getDynamicUrl('policies/shipping-or-delivery-policy', '', false)}" class="hover:text-white transition-colors">Shipping Policy</a>
                </div>
            </div>
        </div>

        <!-- Floating Live Chat Button -->
        <div id="floating-chat-container">
            <style>
                #floating-chat-container {
                    position: fixed !important;
                    bottom: 24px !important;
                    right: 24px !important;
                    z-index: 99999 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: flex-end !important;
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                }

                #floating-chat-options {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 12px !important;
                    margin-bottom: 16px !important;
                    transform: scale(0) !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transform-origin: bottom right !important;
                    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease !important;
                }

                #floating-chat-options.show {
                    transform: scale(1) !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }

                .floating-chat-option {
                    display: flex !important;
                    align-items: center !important;
                    gap: 12px !important;
                    background-color: #ffffff !important;
                    padding: 10px 14px !important;
                    border-radius: 16px !important;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
                    border: 1px solid #e2e8f0 !important;
                    text-decoration: none !important;
                    transition: all 0.2s ease-in-out !important;
                    width: max-content !important;
                }

                .floating-chat-option:hover {
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.15) !important;
                    transform: translateY(-2px) !important;
                }

                .floating-chat-option-text {
                    color: #1e293b !important;
                    font-weight: 700 !important;
                    font-size: 14px !important;
                }

                .floating-chat-option-icon {
                    width: 38px !important;
                    height: 38px !important;
                    border-radius: 50% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    color: white !important;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1) !important;
                    transition: transform 0.2s ease !important;
                }

                .floating-chat-option:hover .floating-chat-option-icon {
                    transform: scale(1.1) !important;
                }

                .floating-chat-bg-whatsapp {
                    background-color: #25D366 !important;
                }

                .floating-chat-bg-telegram {
                    background-color: #0088cc !important;
                }

                #floating-chat-toggle {
                    position: relative !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 56px !important;
                    height: 56px !important;
                    background: linear-gradient(135deg, #06b6d4 0%, #2563eb 100%) !important;
                    border-radius: 50% !important;
                    box-shadow: 0 0 20px rgba(6, 182, 212, 0.4) !important;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                    border: none !important;
                    cursor: pointer !important;
                    padding: 0 !important;
                    outline: none !important;
                }

                @media (min-width: 768px) {
                    #floating-chat-toggle {
                        width: 64px !important;
                        height: 64px !important;
                    }
                }

                #floating-chat-toggle:hover {
                    box-shadow: 0 0 30px rgba(6, 182, 212, 0.6) !important;
                    transform: scale(1.05) !important;
                }

                .floating-chat-tooltip {
                    position: absolute !important;
                    right: 100% !important;
                    margin-right: 16px !important;
                    background-color: #0f172a !important;
                    color: #ffffff !important;
                    font-size: 12px !important;
                    font-weight: 700 !important;
                    padding: 6px 12px !important;
                    border-radius: 8px !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    white-space: nowrap !important;
                    transition: opacity 0.2s ease !important;
                }

                #floating-chat-toggle:hover .floating-chat-tooltip {
                    opacity: 1 !important;
                }

                .floating-chat-icon-svg {
                    width: 28px !important;
                    height: 28px !important;
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease !important;
                    position: absolute !important;
                }

                #floating-chat-icon-close {
                    opacity: 0 !important;
                    transform: scale(0) rotate(90deg) !important;
                }

                /* Active states */
                #floating-chat-toggle.active #floating-chat-icon-open {
                    opacity: 0 !important;
                    transform: scale(0) rotate(-90deg) !important;
                }

                #floating-chat-toggle.active #floating-chat-icon-close {
                    opacity: 1 !important;
                    transform: scale(1) rotate(0deg) !important;
                }

                @media (max-width: 640px) {
                    .floating-chat-option-text {
                        display: none !important;
                    }
                    .floating-chat-tooltip {
                        display: none !important;
                    }
                    #floating-chat-container {
                        bottom: 16px !important;
                        right: 16px !important;
                    }
                }
            </style>

            <!-- Chat Options (Hidden by default) -->
            <div id="floating-chat-options">
                <!-- WhatsApp Option -->
                <a href="{{WHATSAPP_LINK}}" target="_blank" rel="noopener noreferrer" class="floating-chat-option">
                    <span class="floating-chat-option-text">WhatsApp</span>
                    <div class="floating-chat-option-icon floating-chat-bg-whatsapp">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.503-5.714-1.458L0 24zm6.26-4.086l.373.22c1.561.928 3.51 1.419 5.496 1.42 5.568 0 10.102-4.524 10.105-10.096.002-2.701-1.047-5.24-2.951-7.147-1.905-1.905-4.437-2.954-7.15-2.955-5.579 0-10.115 4.524-10.119 10.103-.002 2.062.539 4.075 1.566 5.85l.25.433-.996 3.635 3.725-.976zm11.233-5.26c-.3-.15-1.774-.875-2.046-.975-.273-.1-.472-.15-.67.15-.2.3-.77.975-.945 1.174-.175.2-.35.225-.65.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.488-1.777-1.663-2.078-.175-.3-.018-.463.13-.61.135-.13.3-.35.45-.525.15-.175.2-.3.3-.5.1-.2.05-.375-.025-.525-.075-.15-.67-1.616-.92-2.2-.24-.58-.485-.5-.67-.51-.173-.008-.371-.01-.57-.01-.2 0-.526.075-.802.375-.276.3-1.05 1.025-1.05 2.5s1.07 2.9 1.218 3.1c.15.2 2.106 3.217 5.1 4.5 1.637.7 2.9.962 3.864.81.99-.15 1.774-.725 2.022-1.39.248-.665.248-1.235.174-1.385-.074-.15-.273-.25-.573-.4z"/></svg>
                    </div>
                </a>
                <!-- Telegram Option -->
                <a href="{{TELEGRAM_LINK}}" target="_blank" rel="noopener noreferrer" class="floating-chat-option">
                    <span class="floating-chat-option-text">Telegram</span>
                    <div class="floating-chat-option-icon floating-chat-bg-telegram">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18.717-.962 4.908-1.362 7.039-.168.905-.5 1.208-.823 1.237-.71.065-1.248-.471-1.936-.921-1.077-.705-1.686-1.144-2.733-1.834-1.21-.797-.425-1.237.264-1.954.18-.188 3.313-3.037 3.374-3.298.008-.032.015-.15-.056-.213-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.479.329-.913.49-1.302.481-.429-.009-1.252-.242-1.865-.44-.753-.244-1.353-.374-1.301-.789.027-.216.325-.437.893-.663 3.507-1.527 5.845-2.535 7.015-3.024 3.343-1.396 4.037-1.638 4.49-1.646.1-.002.325.023.47.14.122.099.156.237.17.339.014.1.033.328.02.487z"/></svg>
                    </div>
                </a>
            </div>

            <!-- Main Toggle Button -->
            <button id="floating-chat-toggle" aria-label="Live Chat">
                <!-- Tooltip -->
                <span class="floating-chat-tooltip">Chat with us</span>
                <!-- Icons -->
                <!-- Open icon -->
                <svg id="floating-chat-icon-open" class="floating-chat-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                <!-- Close icon -->
                <svg id="floating-chat-icon-close" class="floating-chat-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>

        <script>
            (function() {
                const toggleBtn = document.getElementById('floating-chat-toggle');
                const optionsPanel = document.getElementById('floating-chat-options');

                if (toggleBtn && optionsPanel) {
                    try {
                        var waLink = optionsPanel.querySelector('a[href*="wa.me"]');
                        var tgLink = optionsPanel.querySelector('a[href*="t.me"]');
                        
                        var currentUrl = window.location.href;
                        var isProductPage = window.location.pathname.indexOf('/product/') !== -1;
                        
                        var messageText = '';
                        if (isProductPage) {
                            var h1Element = document.querySelector('h1');
                            var productName = h1Element ? h1Element.innerText.trim() : document.title;
                            messageText = 'Hello! I am interested in purchasing: *' + productName + '*\\nProduct Link: ' + currentUrl + '\\n\\nPlease help me with the ordering process.';
                        } else {
                            messageText = 'Hello! I visited your website and would like to learn more about your services.\\nLink: ' + currentUrl;
                        }
                        
                        var encodedMessage = encodeURIComponent(messageText);
                        
                        if (waLink) {
                            var originalHref = waLink.getAttribute('href');
                            var baseWa = originalHref.split('?')[0];
                            waLink.setAttribute('href', baseWa + '?text=' + encodedMessage);
                        }
                        if (tgLink) {
                            var originalHref = tgLink.getAttribute('href');
                            var baseTg = originalHref.split('?')[0];
                            tgLink.setAttribute('href', baseTg + '?text=' + encodedMessage);
                        }
                    } catch (err) {
                        console.error('Failed to pre-fill chat messages:', err);
                    }


                    toggleBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const isOpen = optionsPanel.classList.toggle('show');
                        toggleBtn.classList.toggle('active', isOpen);
                    });

                    document.addEventListener('click', function(event) {
                        if (optionsPanel.classList.contains('show') && !toggleBtn.contains(event.target) && !optionsPanel.contains(event.target)) {
                            optionsPanel.classList.remove('show');
                            toggleBtn.classList.remove('active');
                        }
                    });
                }
            })();
        </script>
    `;
}



function generateLatestArticlesHtml(blogs) {
    if (!blogs || blogs.length === 0) return '';
    const latest = blogs.slice(0, 3);
    const cards = latest.map(b => `
        <div class="group relative flex flex-col items-start bg-[#1E293B]/50 p-6 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all">
            <div class="flex items-center gap-x-4 text-xs mb-3">
                <time datetime="${b.date}" class="text-slate-400">${b.date}</time>
                <span class="relative z-10 rounded-full bg-cyan-400/10 px-3 py-1.5 font-medium text-cyan-400">Article</span>
            </div>
            <h3 class="mt-0 text-lg font-bold leading-6 text-white group-hover:text-cyan-400 transition-colors">
                <a href="${getDynamicUrl('blog', b.slug, false)}">
                    <span class="absolute inset-0"></span>
                    ${b.title}
                </a>
            </h3>
            <p class="mt-2 line-clamp-3 text-sm leading-6 text-slate-400">${b.excerpt}</p>
            <div class="mt-4 flex items-center gap-1 text-cyan-400 text-sm font-bold">
                Read More <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
        </div>
    `).join('');

    return `
    <section class="py-16 bg-[#0B1120] border-t border-white/5">
        <div class="mx-auto max-w-7xl px-4">
            <div class="flex items-center justify-between mb-10">
                <div>
                    <h2 class="text-3xl font-bold tracking-tight text-white sm:text-4xl">Latest <span class="text-cyan-400">Articles</span></h2>
                    <p class="mt-2 text-lg leading-8 text-slate-400">Expert tips and guides for your digital growth.</p>
                </div>
                <a href="${getDynamicUrl('blog', '', false)}" class="hidden sm:flex items-center gap-1 text-cyan-400 font-bold hover:text-cyan-300 transition-colors">View All <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                ${cards}
            </div>
            <div class="mt-8 text-center sm:hidden">
                 <a href="${getDynamicUrl('blog', '', false)}" class="inline-flex items-center gap-1 text-cyan-400 font-bold hover:text-cyan-300 transition-colors">View All Articles <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>
            </div>
        </div>
    </section>
    `;
}

function generateRelatedArticlesHtml(product, blogs) {
    if (!blogs || blogs.length === 0) return '';
    
    // 1. Priority: Explicitly related blogs (via related_ids in blog object)
    let related = blogs.filter(b => b.related_ids && b.related_ids.includes(product.id));

    // 2. Fallback: Contextual matching (Category/Title keywords)
    if (related.length < 3) {
        const productKeywords = product.category.toLowerCase().split(/[\s&]+/);
        const contextual = blogs.filter(b => {
            // Avoid duplicates
            if (related.some(rel => rel.id === b.id)) return false;
            
            const titleLower = b.title.toLowerCase();
            return productKeywords.some(k => titleLower.includes(k));
        });
        
        related = [...related, ...contextual];
    }

    const displayBlogs = related.slice(0, 3);
    
    if (displayBlogs.length === 0) return '';

    const title = 'Related Articles';

    const cards = displayBlogs.map(b => {
        const url = getDynamicUrl('blog', b.slug, false);
        return `
        <div class="group relative flex flex-col items-start bg-[#1E293B] p-6 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all">
            <h3 class="text-lg font-bold leading-6 text-white group-hover:text-cyan-400 transition-colors">
                <a href="${url}">
                    <span class="absolute inset-0"></span>
                    ${b.title}
                </a>
            </h3>
            <p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">${b.excerpt}</p>
             <div class="mt-4 text-cyan-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                Read Article <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
        </div>
    `}).join('');

    return `
    <div class="mt-16 border-t border-white/5 pt-12">
        <div class="flex items-center justify-between mb-8">
            <h2 class="text-2xl font-bold text-white">${title}</h2>
            <a href="${getDynamicUrl('blog', '', false)}" class="text-cyan-400 text-sm font-bold hover:underline">View Blog</a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            ${cards}
        </div>
    </div>
    `;
}

function generateSocialShare(product) {
    const url = getDynamicUrl('product', product.slug, true);
    const title = encodeURIComponent(product.title);
    
    return `
        <a href="https://www.facebook.com/sharer/sharer.php?u=${url}" target="_blank" rel="noopener noreferrer" class="p-2 bg-[#1877F2]/10 hover:bg-[#1877F2]/20 text-[#1877F2] rounded-lg transition-colors flex items-center justify-center" aria-label="Share on Facebook">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
        </a>
        <a href="https://twitter.com/intent/tweet?text=${title}&url=${url}" target="_blank" rel="noopener noreferrer" class="p-2 bg-[#1DA1F2]/10 hover:bg-[#1DA1F2]/20 text-[#1DA1F2] rounded-lg transition-colors flex items-center justify-center" aria-label="Share on Twitter">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg>
        </a>
        <a href="https://wa.me/?text=${title}%20${url}" target="_blank" rel="noopener noreferrer" class="p-2 bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] rounded-lg transition-colors flex items-center justify-center" aria-label="Share on WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        </a>
        <a href="https://t.me/share/url?url=${url}&text=${title}" target="_blank" rel="noopener noreferrer" class="p-2 bg-[#0088cc]/10 hover:bg-[#0088cc]/20 text-[#0088cc] rounded-lg transition-colors flex items-center justify-center" aria-label="Share on Telegram">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </a>
    `;
}

function replaceGlobalPlaceholders(html, siteConfig) {
    let output = html;
    output = output.replace(/{{WHATSAPP}}/g, siteConfig.whatsapp || '');
    output = output.replace(/{{TELEGRAM}}/g, (siteConfig.telegram || '').replace('@', ''));
    output = output.replace(/{{WHATSAPP_LINK}}/g, `https://wa.me/${(siteConfig.whatsapp || '').replace(/[^0-9]/g, '')}`);
    output = output.replace(/{{TELEGRAM_LINK}}/g, `https://t.me/${(siteConfig.telegram || '').replace('@', '')}`);
    output = output.replace(/{{SUPPORT_EMAIL}}/g, siteConfig.supportEmail || '');
    output = output.replace(/{{SITE_TITLE}}/g, siteConfig.siteTitle || 'BestPVAShop');
    output = output.replace(/{{SITE_NAME}}/g, siteConfig.siteTitle || 'BestPVAShop');
    output = output.replace(/{{SITE_DOMAIN}}/g, (siteConfig.siteTitle || 'BestPVAShop').toLowerCase().replace(/\s+/g, '') + '.com');
    output = output.replace(/{{META_DESCRIPTION}}/g, siteConfig.metaDescription || '');
    output = output.replace(/{{LOGO_TEXT}}/g, siteConfig.logoText || 'BestPVAShop');
    output = output.replace(/{{LOGO_BADGE}}/g, siteConfig.logoBadge || '');
    output = output.replace(/{{FAVICON_URL}}/g, siteConfig.faviconUrl || '/favicon.svg');
    output = output.replace(/{{LOGO_URL}}/g, siteConfig.logoUrl || '/favicon.svg');
    output = output.replace(/{{HERO_TITLE}}/g, siteConfig.heroTitle || '');
    output = output.replace(/{{HERO_SUBTITLE}}/g, siteConfig.heroSubtitle || '');
    output = output.replace(/{{HERO_BUTTON_TEXT}}/g, siteConfig.heroButtonText || 'Explore Services');
    output = output.replace(/{{POPUP_TITLE}}/g, siteConfig.popupTitle || 'Contact Support');
    output = output.replace(/{{POPUP_MESSAGE}}/g, siteConfig.popupMessage || "We're here to help! 24/7 Support Available.");
    output = output.replace(/{{BADGE_TEXT}}/g, siteConfig.badgeText || 'Premium Quality PVA Accounts & Reviews');
    
    const analyticsCode = siteConfig.analyticsId ? `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${siteConfig.analyticsId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${siteConfig.analyticsId}');
    </script>
    ` : '';
    output = output.replace(/{{ANALYTICS_CODE}}/g, analyticsCode);

    // Handle Canonical URL dynamically
    output = output.replace(/{{CANONICAL_URL}}/g, getDynamicUrl('home'));
    
    return output;
}

function minifyHTML(html) {
    if (!html) return '';
    return html
        .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
        .replace(/\s+/g, ' ')            // Collapse whitespace
        .replace(/>\s+</g, '><')         // Remove space between tags
        .trim();
}

function minifyCSS(css) {
    if (!css) return '';
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        // Don't strip spaces around >, + or ~ to avoid breaking complex selectors like .prose > ul > li
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

function renderStars(rating = 5, sizeClass = "w-4 h-4") {
    let html = '';
    for (let i = 1; i <= 5; i++) {
        const isFull = i <= rating;
        const color = isFull ? '#facc15' : 'currentColor';
        const fill = isFull ? '#facc15' : 'none';
        const textClass = isFull ? 'text-yellow-400' : 'text-slate-600';
        html += `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star ${sizeClass} ${textClass}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    }
    return html;
}

function getImageUrl(img, basePath = '/') {
    if (!img) return null;
    if (img.startsWith('http') || img.startsWith('data:')) return img;
    
    // Convert extension to webp for local images
    let targetImg = img;
    const extIdx = img.lastIndexOf('.');
    if (extIdx !== -1) {
        const ext = img.substring(extIdx).toLowerCase();
        if (['.png', '.jpg', '.jpeg'].includes(ext)) {
            targetImg = img.substring(0, extIdx) + '.webp';
        }
    }

    // If targetImg starts with /, it's root-relative
    if (targetImg.startsWith('/')) {
        // If basePath is a full URL, we must prepend it to make the image URL absolute for search engines
        if (basePath.startsWith('http')) {
            return `${basePath.replace(/\/+$/, '')}${targetImg}`;
        }
        // Otherwise keep it as root-relative for browser usage
        return targetImg;
    }
    
    // Ensure basePath has a trailing slash for filenames if it's a full URL
    const cleanBase = (basePath.startsWith('http') && !basePath.endsWith('/')) ? basePath + '/' : basePath;
    return `${cleanBase}images/products/${targetImg}`;
}

function getProductSeed(product) {
    const n = Number(product && product.id);
    if (Number.isFinite(n)) return n;
    const str = String((product && (product.slug || product.title)) || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

function hslToHex(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (hp >= 1 && hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hp >= 2 && hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hp >= 3 && hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hp >= 4 && hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const m = light - c / 2;
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function computeProductColor(product) {
    const seed = getProductSeed(product);
    const hue = (seed * 137.508) % 360;
    /* Increased lightness for better vibrancy */
    return hslToHex(hue, 65, 45);
}

function renderProductCard(product, basePath = '/', isPriority = false) {
    const fullImgUrl = getImageUrl(product.image, basePath);
    const loadingAttr = isPriority ? 'fetchpriority="high"' : 'loading="lazy"';
    let imageHtml = '';
    if (fullImgUrl) {
        if (fullImgUrl.startsWith('http') || fullImgUrl.startsWith('data:')) {
             imageHtml = `<img src="${fullImgUrl}" alt="${product.image_title || product.title}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" ${loadingAttr} decoding="async" width="400" height="300">`;
        } else {
             const avifUrl = fullImgUrl.replace(/\.webp$/, '.avif');
             imageHtml = `
             <picture>
                 <source srcset="${avifUrl}" type="image/avif">
                 <source srcset="${fullImgUrl}" type="image/webp">
                 <img src="${fullImgUrl}" alt="${product.image_title || product.title}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" ${loadingAttr} decoding="async" width="400" height="300">
             </picture>`;
        }
    }
    const solidColor = computeProductColor(product);
    const overlayClass = fullImgUrl ? '' : 'bg-black/0 group-hover:bg-black/0';
    const productUrl = getDynamicUrl('product', product.slug, false);
    const overlayTitle = (product.display_title && product.display_title.trim().length > 0)
        ? product.display_title
        : product.title.replace(/^Buy\s+/i, '');

    const overlayLayerHtml = fullImgUrl ? '' : `<div class="absolute inset-0 ${overlayClass} transition-colors duration-300"></div>`;
    const overlayTextHtml = fullImgUrl ? '' : `
            <div class="absolute top-3 left-3 bg-red-500/90 backdrop-blur-md border border-white/20 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 shadow-lg z-10">
                <span class="text-yellow-300 text-sm">Sale!</span> BestPVAShop
            </div>
            
            <h3 class="text-xl font-bold leading-tight text-white mb-4 drop-shadow-lg z-10 relative">${overlayTitle}</h3>
            
            <a href="${productUrl}" class="bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs font-bold px-5 py-2 rounded-full mb-2 cursor-pointer hover:bg-white/20 hover:scale-105 transition-all block text-center no-underline z-10">
                ORDER NOW
            </a>
    `;
    
    return `
    <div class="card-glow product-card bg-[#1E293B] rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 group hover:-translate-y-2" data-category="${product.category}" data-search-title="${product.title.toLowerCase()}" style="content-visibility: auto; contain-intrinsic-size: 0 350px;">
        <div role="img" aria-label="${product.image_title || product.title}" class="relative p-6 h-52 flex flex-col items-center justify-center text-center overflow-hidden" style="background-color: ${solidColor};">
            ${imageHtml}
            ${overlayLayerHtml}
            ${overlayTextHtml}
        </div>
        
        <div class="p-5">
            <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-cyan-400 bg-cyan-400/10 px-2.5 py-1 rounded uppercase tracking-wider">${product.category}</span>
                <div class="flex items-center gap-0.5">
                    ${renderStars(5, "w-3 h-3")}
                </div>
            </div>
            
            <a href="${productUrl}" class="font-bold text-slate-100 mb-3 text-sm hover:text-cyan-400 transition-colors block line-clamp-2 min-h-[40px]">
                ${overlayTitle}
            </a>
            
            <div class="flex items-center justify-between mb-5">
                <p class="text-slate-400 text-xs">Starting from</p>
                <p class="text-white font-extrabold text-lg">
                    $${product.min_price.toFixed(2)}
                </p>
            </div>
            
            <a href="${productUrl}" class="block w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl py-3 text-center text-sm shadow-lg shadow-cyan-500/20 transition-all hover:shadow-cyan-500/40">
                Order Now
            </a>
        </div>
    </div>`;
}

function applyBlogStyleToHtml(html) {
    if (!html) return html;
    // Apply blog-style classes to headings (only if no class already set)
    html = html.replace(/<h1(?![^>]*class=)([^>]*)>/g, '<h1 class="text-3xl md:text-4xl font-bold text-white mb-6 mt-8 leading-tight"$1>');
    html = html.replace(/<h2(?![^>]*class=)([^>]*)>/g, '<h2 class="text-2xl font-bold text-white mb-4 mt-6"$1>');
    html = html.replace(/<h3(?![^>]*class=)([^>]*)>/g, '<h3 class="text-xl font-bold text-cyan-400 mb-2 mt-5"$1>');
    html = html.replace(/<h4(?![^>]*class=)([^>]*)>/g, '<h4 class="text-lg font-bold text-white mb-2 mt-4"$1>');
    // Apply blog-style classes to paragraphs (only if no class already set)
    html = html.replace(/<p(?![^>]*class=)([^>]*)>/g, '<p class="mb-4 text-slate-300 leading-loose"$1>');
    // Apply blog-style classes to lists (only if no class already set)
    html = html.replace(/<ul(?![^>]*class=)([^>]*)>/g, '<ul class="list-disc pl-6 mb-4 space-y-2 text-slate-300"$1>');
    html = html.replace(/<ol(?![^>]*class=)([^>]*)>/g, '<ol class="list-decimal pl-6 mb-4 space-y-2 text-slate-300"$1>');
    html = html.replace(/<li(?![^>]*class=)([^>]*)>/g, '<li class="mb-1 leading-relaxed"$1>');
    return html;
}

function generateRichDescription(product) {
    if (product.long_description) return applyBlogStyleToHtml(product.long_description);
    
    const productName = product.title;
    return `
        <h2 class="text-xl md:text-2xl font-bold text-white mb-4">Why You Need ${productName} for Your Business</h2>
        <p class="mb-4">
            In the modern digital landscape, having a reliable <strong>${productName}</strong> is essential for building trust and scaling operations. 
            Whether you are a startup, an established agency, or an individual marketer, high-quality verified accounts and authentic reviews provide the stability you need. 
            At <strong class="text-cyan-400">BestPVAShop</strong>, we supply premium ${productName} that are fully verified and ready to deploy. 
        </p>

        <h3 class="text-lg font-bold text-white mb-3 mt-8">Core Benefits of ${productName}</h3>
        <p class="mb-4">
            Authenticity and reliability dictate online success. Utilizing ${productName} ensures your business can operate smoothly across platforms without unexpected disruptions.
        </p>
        <ul class="list-disc pl-5 space-y-2 mb-6 text-slate-300">
            <li><strong>Instant Operational Readiness:</strong> Skip the lengthy verification steps and begin immediately.</li>
            <li><strong>Enhanced Trust Signals:</strong> Our ${productName} provides immediate authority to your profile.</li>
            <li><strong>Platform Security:</strong> Created with clean IPs and unique device fingerprints to reduce suspension risks.</li>
        </ul>

        <h3 class="text-lg font-bold text-white mb-3 mt-8">How We Ensure Quality for ${productName}</h3>
        <p class="mb-4">
            Security and longevity are our top priorities. When you buy ${productName} from us, you receive a meticulously crafted asset. 
            We use residential proxies, verified phone numbers, and aged profiles where applicable, making our ${productName} indistinguishable from natural user accounts.
        </p>

        <h3 class="text-lg font-bold text-white mb-3 mt-8">Frequently Asked Questions about ${productName}</h3>
        <div class="space-y-4 mb-6">
            <div class="bg-[#1E293B]/50 p-4 rounded-xl border border-white/5">
                <h4 class="font-bold text-white mb-1">Is ${productName} safe for my main business?</h4>
                <p class="text-slate-400 text-sm">Yes, our ${productName} is generated following strict security protocols to ensure it is completely safe to integrate with your existing workflows.</p>
            </div>
            <div class="bg-[#1E293B]/50 p-4 rounded-xl border border-white/5">
                <h4 class="font-bold text-white mb-1">How quickly will I receive my ${productName}?</h4>
                <p class="text-slate-400 text-sm">Delivery is typically instant or within a few hours depending on the stock and current network conditions.</p>
            </div>
            <div class="bg-[#1E293B]/50 p-4 rounded-xl border border-white/5">
                <h4 class="font-bold text-white mb-1">Do you offer a warranty on ${productName}?</h4>
                <p class="text-slate-400 text-sm">Absolutely. If your ${productName} does not work on the first login as described, we will replace it free of charge.</p>
            </div>
        </div>

        <h3 class="text-lg font-bold text-white mb-3 mt-8">Secure Your ${productName} Today</h3>
        <p class="mb-4">
            Don't let verification hurdles slow down your growth. Buying a ${productName} from BestPVAShop is a strategic investment in your digital infrastructure. 
            Select your package above and experience seamless delivery and 24/7 dedicated support.
        </p>
    `;
}

function generateFullHeader(unused_basePath, products, categories, siteConfig) {
    let header = fs.readFileSync('header_partial.html', 'utf8');
    
    // 1. Populate Desktop Nav
    let desktopNavHtml = `<a href="/" class="text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm font-medium px-4 py-2">Shop</a>`;
    
    categories.filter(cat => !cat.hidden).forEach(cat => {
        const catItemsHtml = cat.items.map(item => {
            const p = products.find(prod => prod.slug === item || prod.title === item || prod.image_title === item || prod.display_title === item);
            const url = p ? getDynamicUrl('product', p.slug, false) : '#';
            const displayText = p ? (p.display_title || p.title) : item;
            return `<a href="${url}" class="block px-4 py-2.5 text-sm text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-colors">${displayText}</a>`;
        }).join('');

        desktopNavHtml += `
            <div class="relative group px-3 py-2">
                <button class="text-slate-300 group-hover:text-cyan-400 text-sm font-medium flex items-center gap-1 transition-colors">
                    ${cat.name} <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div class="absolute left-0 mt-2 w-56 bg-[#0F172A] border border-white/10 rounded-xl shadow-2xl py-2 hidden group-hover:block z-50 backdrop-blur-xl max-h-96 overflow-y-auto">
                    ${catItemsHtml}
                </div>
            </div>
        `;
    });

    desktopNavHtml += `
        <a href="${getDynamicUrl('blog', '', false)}" class="text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors text-sm font-medium px-4 py-2">Blog</a>
    `;

    // 2. Populate Mobile Nav
    let mobileNavHtml = `
        <a href="${getDynamicUrl('blog', '', false)}" class="block px-4 py-3 text-white font-bold bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/30 rounded-xl mb-4 hover:bg-white/5 transition-all">
            <span class="flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-cyan-400"><path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-4-4H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 4-4h6z"/></svg> Blog</span>
        </a>
    `;

    categories.filter(cat => !cat.hidden).forEach(cat => {
        if (!cat.slug) return;
        const catSlug = cat.slug;
        const catItemsHtml = cat.items.map(item => {
            const p = products.find(prod => prod.slug === item || prod.title === item || prod.image_title === item || prod.display_title === item);
            const url = p ? getDynamicUrl('product', p.slug, false) : '#';
            const displayText = p ? (p.display_title || p.title) : item;
            return `<a href="${url}" class="block px-4 py-2 text-slate-400 hover:text-cyan-400 hover:bg-white/5 rounded-lg transition-colors text-sm">${displayText}</a>`;
        }).join('');

        mobileNavHtml += `
            <div class="mb-2">
                <button class="mobile-cat-toggle w-full flex items-center justify-between px-4 py-3 text-slate-300 hover:text-cyan-400 hover:bg-white/5 rounded-xl transition-all" data-cat="${catSlug}">
                    <span class="font-bold text-sm tracking-wide uppercase">${cat.name}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 transition-transform duration-200"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div id="mobile-items-${catSlug}" class="space-y-1 mt-1 ml-4 border-l border-white/10 pl-2" style="display:none;">
                    <a href="${getDynamicUrl('category', catSlug, false)}" class="block px-4 py-2 text-xs font-bold text-cyan-500 hover:text-cyan-400 uppercase tracking-widest">View All ${cat.name}</a>
                    ${catItemsHtml}
                </div>
            </div>
        `;
    });

    header = header.replace(/<nav[^>]*id="desktop-nav">[\s\S]*?<\/nav>/, `<nav class="desktop-nav-container items-center gap-1" id="desktop-nav">${desktopNavHtml}</nav>`);
    header = header.replace(/<div[^>]*id="mobile-nav-items">[\s\S]*?<\/div>/, `<div class="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide" id="mobile-nav-items">${mobileNavHtml}</div>`);
    
    // Replace site config placeholders
    header = header.replace(/{{LOGO_TEXT}}/g, siteConfig.logoText);
    
    return header;
}

console.log("Reading output.css for shared CSS generation...");
let cssContent = fs.readFileSync('output.css', 'utf8');

// --- Fix CSS Linter Warnings in inlined CSS ---
// 0. Strip CSS comments to avoid regex issues
cssContent = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');

// 1. Fix line-clamp compatibility
cssContent = cssContent.replace(/-webkit-line-clamp:\s*(\d+)/g, '-webkit-line-clamp: $1; line-clamp: $1');
// 2. Fix appearance compatibility (ensuring standard property is present)
cssContent = cssContent.replace(/(-webkit-appearance|-moz-appearance):\s*([^;! }]+)/g, (match, p1, p2) => {
    return `${p1}: ${p2}; appearance: ${p2}`;
});
// Remove any resulting duplicates like "appearance: none; appearance: none"
cssContent = cssContent.replace(/(appearance:\s*[^;! }]+);\s*appearance:\s*\1/g, '$1');

// 3. Fix "vertical-align ignored" warning in Tailwind reset
cssContent = cssContent.replace(/(canvas|audio|iframe|embed|object)[^{]*\{[^}]*display:\s*block;?[^}]*vertical-align:\s*middle;?[^}]*\}/g, (match) => {
    return match.replace(/vertical-align:\s*middle;?/g, '');
});

const sharedCssFile = 'output.min.css';
const sharedCssHref = `/${sharedCssFile}`;
const sharedCssTags = `<link rel="stylesheet" href="${sharedCssHref}">`;
fs.writeFileSync(sharedCssFile, minifyCSS(cssContent));

console.log("Reading header_partial.html...");
// We will generate the header dynamically for each page using generateFullHeader()

// --- 3. Build Homepage ---
console.log("Building Homepage...");
const indexTemplateRaw = fs.readFileSync('site_template.html', 'utf8'); // Keep master template in memory

// Pre-fill Latest Products globally for all pages using site_template.html
const latestProductsHtml = [...products]
    .sort((a, b) => (b.id || 0) - (a.id || 0))
    .slice(0, 4)
    .map(p => renderProductCard(p, '', true))
    .join('\n');
const indexTemplate = indexTemplateRaw.replace('{{LATEST_PRODUCTS_GRID}}', `
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        ${latestProductsHtml}
    </div>
`);

let indexHtml = indexTemplate;

// Inject Header
indexHtml = indexHtml.replace('{{HEADER}}', generateFullHeader('./', products, categories, siteConfig));

// Generate Category Options for Homepage Search
const categoryOptions = `
    <option value="All Categories">All Categories</option>
    ${categories.filter(c => !c.hidden).map(c => `<option value="${c.name}">${c.name}</option>`).join('\n    ')}
`;
indexHtml = indexHtml.replace('{{CATEGORY_OPTIONS}}', categoryOptions);

// Generate Product Grid
const productGridHtml = products.map((p, idx) => {
    let card = renderProductCard(p, '');
    if (idx >= 8) {
        card = card.replace('style="', 'style="display: none; ');
    }
    return card;
}).join('\n');
indexHtml = indexHtml.replace('{{PRODUCT_GRID}}', `
    <div id="product-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        ${productGridHtml}
    </div>
    <div class="text-center mt-12" id="view-all-container" style="display: none;">
        <button id="btn-view-all" class="px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 hover:shadow-cyan-500/30">
            View All Products
        </button>
    </div>
`);

// {{LATEST_PRODUCTS_GRID}} is already replaced globally in indexTemplate

// Generate Footer
let footerHtml = generateFooter(products, siteConfig);
indexHtml = indexHtml.replace('{{FOOTER}}', footerHtml);

// Generate Latest Articles
indexHtml = indexHtml.replace('{{LATEST_ARTICLES}}', generateLatestArticlesHtml(blogs));

// Link cacheable shared CSS
indexHtml = indexHtml.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);

indexHtml = indexHtml.replace('{{PRODUCT_IMAGE_PRELOAD}}', '');

// Global Placeholders
indexHtml = indexHtml.replace(/{{CANONICAL_URL}}/g, 'https://bestpvashop.com/');
indexHtml = indexHtml.replace(/{{ROBOTS_META}}/g, '<meta name="robots" content="index, follow" />');
indexHtml = indexHtml.replace(/{{REL_PATH}}/g, './');
indexHtml = replaceGlobalPlaceholders(indexHtml, siteConfig);

// Save Homepage
fs.writeFileSync('index.html', minifyHTML(indexHtml));
console.log("Homepage built.");

// --- 3.1 Build Category Pages ---
console.log("Building Category Pages...");
cleanDirectory(paths.category);
const uniqueCategories = [...new Set(products.map(p => p.category))];
let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';

// Skip old escapeXml definition


let rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(siteConfig.siteTitle || 'BestPVAShop')}</title>
  <link>${escapeXml(getDynamicUrl('home'))}</link>
  <description>${escapeXml('Buy verified accounts and digital services')}</description>
  <language>en-us</language>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${escapeXml(getDynamicUrl('home'))}feed.xml" rel="self" type="application/rss+xml" />
`;

// Add Homepage to Sitemap
sitemap += '  <url>\n';
sitemap += `    <loc>${escapeXml(getDynamicUrl('home'))}</loc>\n`;
sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
sitemap += '    <priority>1.0</priority>\n';
sitemap += '  </url>\n';

uniqueCategories.forEach(cat => {
        const catData = categories.find(c => c.name === cat);
        if (!catData || !catData.slug) {
            console.warn(`Category "${cat}" has no slug defined in site_data.js. Skipping page generation.`);
            return;
        }
        const slug = slugify(catData.slug);
        const dir = path.join(paths.category, slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Find category data from site_data (now we have rich content there)
    const categoryData = categories.find(c => c.name === cat) || {};
    const richContent = categoryData.content || '';
    const catDescription = categoryData.description || `Buy verified ${cat} accounts and reviews. Secure, fast, and trusted services for ${cat} marketing.`;

    let catHtml = indexTemplate;
    // Inject Header for Category Pages
    catHtml = catHtml.replace('{{HEADER}}', generateFullHeader('../../', products, categories, siteConfig));
    
    // SEO & Hero
    const catTitle = `${cat} Accounts & Reviews | BestPVAShop`;
    
    // Replace Category Options
    catHtml = catHtml.replace('{{CATEGORY_OPTIONS}}', categoryOptions);

    // Replace Hero with Category Title
    catHtml = catHtml.replace('{{HERO_TITLE}}', `<span class="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">${cat}</span> Services`);
    catHtml = catHtml.replace('{{HERO_SUBTITLE}}', catDescription);
    
    // Override Global SEO for Category
    catHtml = catHtml.replace(/{{SITE_TITLE}}/g, catTitle);
    catHtml = catHtml.replace(/{{META_DESCRIPTION}}/g, catDescription);

    // SEO URL Fixes
    const catUrl = getDynamicUrl('category', slug);
    catHtml = catHtml.replace(/{{CANONICAL_URL}}/g, catUrl);
    
    // Filter Products
    const catProducts = products.filter(p => p.category === cat);
    const catGrid = catProducts.map((p) => {
        const card = renderProductCard(p, '../../');
        return card;
    }).join('\n');
    
    const contentAndGrid = `
        <div class="max-w-7xl mx-auto px-4 mb-16 prose prose-sm md:prose-base lg:prose-xl prose-invert max-w-none prose-headings:text-white prose-a:text-cyan-400 prose-strong:text-white leading-loose tracking-wide">
            ${richContent}
        </div>
        <div class="max-w-7xl mx-auto px-4 mb-8">
            <h3 class="text-2xl font-bold text-white border-l-4 border-cyan-500 pl-4">Available Packages</h3>
        </div>
        <div id="product-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            ${catGrid}
        </div>
    `;

    catHtml = catHtml.replace('{{PRODUCT_GRID}}', contentAndGrid);
    
    // Latest Articles
    catHtml = catHtml.replace('{{LATEST_ARTICLES}}', generateLatestArticlesHtml(blogs));
    
    // Footer
    catHtml = catHtml.replace('{{FOOTER}}', generateFooter(products, siteConfig));

    // CSS
    catHtml = catHtml.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);
    
    catHtml = catHtml.replace('{{PRODUCT_IMAGE_PRELOAD}}', '');

    catHtml = catHtml.replace(/{{ROBOTS_META}}/g, '<meta name="robots" content="noindex, nofollow" />');
    catHtml = catHtml.replace(/{{REL_PATH}}/g, '../../');
    catHtml = replaceGlobalPlaceholders(catHtml, siteConfig);

    fs.writeFileSync(path.join(dir, 'index.html'), minifyHTML(catHtml));

    // Sitemap
    sitemap += '  <url>\n';
    sitemap += `    <loc>${escapeXml(getDynamicUrl('category', slug))}</loc>\n`;
    sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
    sitemap += '    <priority>0.9</priority>\n';
    sitemap += '  </url>\n';
});

// --- 3.2 Build Blog Listing & Posts ---
console.log("Building Blog Pages...");
cleanDirectory(paths.blog);
const blogDir = paths.blog;
if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir);

// Pagination Settings
const postsPerPage = 6;
const totalPages = Math.ceil(blogs.length / postsPerPage);

// Helper: Generate Sidebar
function generateSidebar(products, blogs) {
    const popularBlogs = blogs.slice(0, 3).map(b => `
        <li class="flex gap-3 items-start">
             <div class="w-16 h-16 bg-slate-700 rounded-lg overflow-hidden shrink-0">
                <img src="${b.image}" alt="${b.title}" class="w-full h-full object-cover opacity-80 hover:opacity-100 transition">
             </div>
             <div>
                 <a href="${getDynamicUrl('blog', b.slug, false)}" class="text-sm font-bold text-slate-200 hover:text-cyan-400 leading-tight block mb-1">${b.title}</a>
                 <span class="text-xs text-slate-500">${b.date}</span>
             </div>
        </li>
    `).join('');

    const bestSellers = products.filter(p => p.is_sale).slice(0, 3).map(p => `
        <li class="flex items-center gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
             <div class="w-10 h-10 bg-gradient-to-br ${gradients[p.badge_color] || gradients.blue} rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0">
                ${p.category.substring(0,2).toUpperCase()}
             </div>
             <div>
                 <a href="${getDynamicUrl('product', p.slug, false)}" class="text-sm font-bold text-slate-200 hover:text-cyan-400 block">${p.title}</a>
                 <span class="text-xs font-bold text-cyan-500">$${p.min_price}</span>
             </div>
        </li>
    `).join('');

    return `
        <!-- Popular Guides -->
        <div class="bg-[#1E293B] p-6 rounded-xl border border-white/5">
            <h3 class="font-bold text-white mb-4 border-b border-white/10 pb-2">Popular Guides</h3>
            <ul class="space-y-4">
               ${popularBlogs}
            </ul>
        </div>

        <!-- Trusted Products -->
        <div class="bg-[#1E293B] p-6 rounded-xl border border-white/5">
             <h3 class="font-bold text-white mb-4 border-b border-white/10 pb-2">Best Sellers</h3>
             <ul class="space-y-3">
                 ${bestSellers}
             </ul>
        </div>

        <!-- CTA Box -->
        <div class="bg-gradient-to-br from-cyan-600 to-blue-700 p-6 rounded-xl text-center shadow-lg shadow-cyan-500/20">
            <h3 class="font-bold text-white mb-2 text-lg">Need Verified Accounts?</h3>
            <p class="text-white/90 text-sm mb-6">Get premium, phone-verified accounts for Google, Facebook, and more instantly.</p>
            <a href="/" class="block bg-white text-blue-700 font-bold py-3 rounded-lg hover:bg-slate-100 transition-colors shadow-md">
                View All Products
            </a>
        </div>
    `;
}

// Helper: Inject CTA (Replaces [[CTA1]] and [[CTA2]])
function injectCTA(content, post) {
    const generateHTML = (text, link) => `
        <div class="my-10 bg-gradient-to-r from-slate-800 to-slate-900 border-l-4 border-cyan-500 p-6 rounded-r-xl shadow-lg">
            <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div class="text-center sm:text-left">
                    <h4 class="text-lg font-bold text-white mb-1">Looking for verified accounts?</h4>
                    <p class="text-slate-400 text-sm">${text || "Get Verified PVA Accounts Now"}</p>
                </div>
                <a href="${link || "/"}" class="shrink-0 bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-lg shadow-cyan-500/20 whitespace-nowrap">
                    Check Availability &rarr;
                </a>
            </div>
        </div>
    `;

    let newContent = content;
    let hasReplacement = false;

    if (newContent.includes('[[CTA1]]')) {
        newContent = newContent.replace('[[CTA1]]', generateHTML(post.cta_1_text, post.cta_1_link));
        hasReplacement = true;
    }

    if (newContent.includes('[[CTA2]]')) {
        newContent = newContent.replace('[[CTA2]]', generateHTML(post.cta_2_text, post.cta_2_link));
        hasReplacement = true;
    }

    // Fallback for older posts without placeholders: Insert after 2nd paragraph
    if (!hasReplacement && !newContent.includes('[[CTA')) {
         const parts = newContent.split('</p>');
         if (parts.length > 2) {
             const ctaHtml = generateHTML("Get Verified PVA Accounts Now", `/${paths.category}/accounts/`);
             const firstPart = parts.slice(0, 2).join('</p>') + '</p>';
             const restPart = parts.slice(2).join('</p>');
             return firstPart + ctaHtml + restPart;
         }
    }

    return newContent;
}

// Helper: Internal link 41 products across 5 blogs
function distributeProductsToBlog(content, products, blogIndex, totalBlogs) {
    // 1. Auto-link product titles found in text
    let processedContent = content;
    const sortedProducts = [...products].sort((a, b) => b.title.length - a.title.length);
    
    sortedProducts.forEach(product => {
        const escapedTitle = product.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Improved Regex: Avoids linking inside existing <a> tags or HTML attributes (like alt, title, src)
        // Matches the title only if it's not preceded by = " or ' (attributes) or inside <a> tags
        const regex = new RegExp(`(?<![="'>])\\b(${escapedTitle})\\b(?![^<]*>|[^<]*<\\/a>)`, 'gi');
        const url = getDynamicUrl('product', product.slug, false);
        processedContent = processedContent.replace(regex, `<a href="${url}" class="text-cyan-400 font-bold hover:underline">$1</a>`);
    });

    // 2. Append assigned subset of products at the bottom
    const productsPerBlog = Math.ceil(products.length / totalBlogs);
    const start = blogIndex * productsPerBlog;
    const end = Math.min(start + productsPerBlog, products.length);
    const assignedProducts = products.slice(start, end);
    
    if (assignedProducts.length > 0) {
        let productsHtml = `
            <div class="mt-16 p-8 bg-gradient-to-br from-[#1E293B] to-[#0F172A] rounded-2xl border border-white/10 shadow-2xl relative overflow-hidden">
                <div class="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl"></div>
                <h3 class="text-2xl font-black text-white mb-8 flex items-center gap-3">
                    <span class="w-8 h-8 rounded-lg bg-cyan-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                        <i data-lucide="shopping-bag" class="w-4 h-4 text-white"></i>
                    </span>
                    Our <span class="text-cyan-400">Featured Services</span>
                </h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        `;
        
        assignedProducts.forEach(p => {
            const url = getDynamicUrl('product', p.slug, false);
            productsHtml += `
                <a href="${url}" class="flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 group hover:border-cyan-500/30">
                    <div class="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-all duration-300">
                        <i data-lucide="star" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-slate-200 group-hover:text-cyan-400 transition-colors leading-tight">${p.title}</p>
                        <p class="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-semibold">Available Now</p>
                    </div>
                </a>
            `;
        });
        
        productsHtml += `
                </div>
                <div class="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p class="text-slate-400 text-sm italic">Trusted by 5,000+ happy customers worldwide.</p>
                    <a href="/" class="group px-6 py-2.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-white font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20">
                        Explore All ${products.length} Services <i data-lucide="arrow-right" class="w-4 h-4 group-hover:translate-x-1 transition-transform"></i>
                    </a>
                </div>
            </div>
        `;
        processedContent += productsHtml;
    }
    
    return processedContent;
}

// Build Pagination Pages
for (let i = 1; i <= totalPages; i++) {
    const start = (i - 1) * postsPerPage;
    const end = start + postsPerPage;
    const pageBlogs = blogs.slice(start, end);
    
    // Create Page Directory: /blog/page/2/ etc.
    let pageDir = blogDir;
    let pageRelPath = '../'; // Default for /blog/index.html
    
    if (i > 1) {
        pageDir = path.join(blogDir, 'page', i.toString());
        if (!fs.existsSync(pageDir)) fs.mkdirSync(pageDir, { recursive: true });
        pageRelPath = '../../../'; // For /blog/page/2/index.html
    }

    let blogListHtml = indexTemplate;
    blogListHtml = blogListHtml.replace('{{HEADER}}', generateFullHeader(pageRelPath, products, categories, siteConfig));
    
    // Replace Category Options
    blogListHtml = blogListHtml.replace('{{CATEGORY_OPTIONS}}', categoryOptions);

    const pageTitleSuffix = i > 1 ? ` - Page ${i}` : '';
    const blogTitle = `BestPVAShop Blog – Digital Marketing Tips${pageTitleSuffix}`;
    const blogDesc = 'Unlock the secrets of digital marketing. Expert strategies, safety tips, and growth hacks for your business.';

    // Enhanced Hero for Blog
    blogListHtml = blogListHtml.replace('{{HERO_TITLE}}', `
        <span class="block text-cyan-400 text-lg font-bold tracking-widest uppercase mb-4">Our Blog</span>
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-blue-200 drop-shadow-sm">Latest Insights & Guides</span>${pageTitleSuffix}
    `);
    blogListHtml = blogListHtml.replace('{{HERO_SUBTITLE}}', blogDesc);
    
    // Override Global SEO for Blog
    blogListHtml = blogListHtml.replace(/{{SITE_TITLE}}/g, blogTitle);
    blogListHtml = blogListHtml.replace(/{{META_DESCRIPTION}}/g, blogDesc);

    // SEO URL Fixes
    const canonicalUrl = i === 1 ? getDynamicUrl('blog') : `${getDynamicUrl('blog')}page/${i}/`;
    blogListHtml = blogListHtml.replace(/{{CANONICAL_URL}}/g, canonicalUrl);
    
    // Redesigned Eye-Catching Grid Layout
    const blogGrid = pageBlogs.map((b, idx) => `
        <article class="group relative flex flex-col bg-[#0F172A] rounded-3xl border border-white/5 overflow-hidden transition-all duration-500 hover:border-cyan-500/50 hover:shadow-[0_0_50px_-12px_rgba(6,182,212,0.25)] hover:-translate-y-2 h-full">
            <a href="${getDynamicUrl('blog', b.slug).replace(baseUrl, '/')}" class="h-64 overflow-hidden relative block">
                <picture>
                    <source srcset="${(b.image || '').replace(/\.(jpg|jpeg|png)$/i, '.avif')}" type="image/avif">
                    <source srcset="${(b.image || '').replace(/\.(jpg|jpeg|png)$/i, '.webp')}" type="image/webp">
                    <img src="${b.image || 'https://via.placeholder.com/600x400?text=No+Image'}" alt="${b.title}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" decoding="async" width="600" height="400">
                </picture>
                <div class="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-transparent to-transparent opacity-80"></div>
                
                <!-- Floating Date Badge -->
                <div class="absolute top-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-xs font-bold text-white flex items-center gap-2">
                    <i data-lucide="calendar" class="w-3 h-3 text-cyan-400"></i> ${b.date}
                </div>
            </a>
            
            <div class="p-8 flex-1 flex flex-col relative">
                <!-- Decorative Glow -->
                <div class="absolute top-0 right-0 -mt-10 -mr-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-cyan-500/20 transition-all"></div>

                <div class="mb-4">
                    <span class="text-xs font-bold text-cyan-400 tracking-widest uppercase border border-cyan-500/20 px-2 py-1 rounded">Article</span>
                </div>

                <h3 class="text-2xl font-bold text-white mb-4 leading-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-cyan-400 group-hover:to-blue-400 transition-all">
                    <a href="${getDynamicUrl('blog', b.slug).replace(baseUrl, '/')}">
                        <span class="absolute inset-0"></span>
                        ${b.title}
                    </a>
                </h3>
                
                <p class="text-slate-400 text-sm mb-8 line-clamp-3 leading-relaxed flex-1 group-hover:text-slate-300 transition-colors">${b.excerpt}</p>
                
                <div class="flex items-center justify-between mt-auto pt-6 border-t border-white/5 group-hover:border-cyan-500/20 transition-colors">
                    <span class="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">Read Article</span>
                    <div class="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-cyan-500 group-hover:text-white transition-all duration-300 group-hover:scale-110">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </div>
                </div>
            </div>
        </article>
    `).join('\n');

    // Pagination Controls
    let paginationHtml = '<div class="flex justify-center items-center gap-2 mt-12">';
    if (i > 1) {
        const prevLink = i === 2 ? `/${paths.blog}/` : `/${paths.blog}/page/${i-1}/`;
        paginationHtml += `<a href="${prevLink}" class="px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-cyan-600 transition font-bold text-sm">Previous</a>`;
    }
    for (let p = 1; p <= totalPages; p++) {
        const activeClass = p === i ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700';
        const link = p === 1 ? `/${paths.blog}/` : `/${paths.blog}/page/${p}/`;
        paginationHtml += `<a href="${link}" class="w-10 h-10 flex items-center justify-center rounded-lg ${activeClass} font-bold text-sm transition">${p}</a>`;
    }
    if (i < totalPages) {
        paginationHtml += `<a href="/${paths.blog}/page/${i+1}/" class="px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-cyan-600 transition font-bold text-sm">Next</a>`;
    }
    paginationHtml += '</div>';

    blogListHtml = blogListHtml.replace('{{PRODUCT_GRID}}', `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            ${blogGrid}
        </div>
        ${paginationHtml}
    `);
    blogListHtml = blogListHtml.replace('{{LATEST_ARTICLES}}', ''); 
    blogListHtml = blogListHtml.replace('{{PRODUCT_IMAGE_PRELOAD}}', '');

    // Footer & Links
    blogListHtml = blogListHtml.replace('{{FOOTER}}', generateFooter(products, siteConfig));
    blogListHtml = blogListHtml.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);
    
    // Global Placeholders
    blogListHtml = blogListHtml.replace(/{{ROBOTS_META}}/g, '<meta name="robots" content="index, follow" />');
    blogListHtml = blogListHtml.replace(/{{REL_PATH}}/g, pageRelPath);
    blogListHtml = replaceGlobalPlaceholders(blogListHtml, siteConfig);

    fs.writeFileSync(path.join(pageDir, 'index.html'), minifyHTML(blogListHtml));
}

// Sitemap Entry for Blog
sitemap += '  <url>\n';
sitemap += `    <loc>${escapeXml(getDynamicUrl('blog'))}</loc>\n`;
sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
sitemap += '    <priority>0.8</priority>\n';
sitemap += '  </url>\n';

// Single Blog Posts
blogs.forEach((post, index) => {
    const slug = slugify(post.slug);
    const dir = path.join(paths.blog, slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const sidebarHtml = generateSidebar(products, blogs);
    // Modified to pass full post object for double CTA replacement
    let contentWithCta = injectCTA(post.content, post);
    
    // Internal link products (distribute 41 products across 5 blogs)
    contentWithCta = distributeProductsToBlog(contentWithCta, products, index, blogs.length);
    
    // Related Articles (Trust Section)
    const relatedHtml = generateRelatedArticlesHtml({ id: -1, category: 'General' }, blogs.filter(b => b.id !== post.id)); // Fallback related

    // Article JSON-LD schema for E-E-A-T and rich results
    const articleJsonLd = JSON.stringify([
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": post.title,
            "description": post.excerpt,
            "datePublished": post.date,
            "dateModified": post.date,
            "author": { "@type": "Person", "name": "BestPVAShop Editorial Team", "url": getDynamicUrl('home') + 'about/' },
            "publisher": { "@type": "Organization", "name": "BestPVAShop", "url": getDynamicUrl('home'), "logo": { "@type": "ImageObject", "url": getDynamicUrl('home') + 'favicon.svg' } },
            "mainEntityOfPage": { "@type": "WebPage", "@id": getDynamicUrl('blog', post.slug) }
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": getDynamicUrl('home') },
                { "@type": "ListItem", "position": 2, "name": "Blog", "item": getDynamicUrl('blog') },
                { "@type": "ListItem", "position": 3, "name": post.title, "item": getDynamicUrl('blog', post.slug) }
            ]
        }
    ]);

    const blogPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="{{FAVICON_URL}}" sizes="any">
    <script type="application/ld+json">${articleJsonLd}<\/script>
    <title>${post.seo_title || post.title + ' - BestPVAShop'}</title>
    <meta name="description" content="${post.excerpt}">
    ${post.seo_tags && post.seo_tags.trim() !== '' ? `<meta name="keywords" content="${post.seo_tags}">` : ''}
    <link rel="canonical" href="${getDynamicUrl('blog', post.slug)}" />
    <meta name="robots" content="index, follow" />
    <link rel="preload" href="${sharedCssHref}" as="style">
    <link rel="preload" href="../../ui.js" as="script">
    <link rel="stylesheet" href="${sharedCssHref}">
    <style>
        /* Robust Navigation Visibility */
        .desktop-nav-container { display: none !important; }
        .mobile-menu-btn-container { display: block !important; }

        @media (min-width: 768px) {
            .desktop-nav-container { display: flex !important; }
            .mobile-menu-btn-container { display: none !important; }
            #mobile-menu, #mobile-menu-backdrop { display: none !important; }
        }
        
        /* Fallback for H1, H2, H3 just in case typography plugin misses anything */
        .prose h1, .prose h2, .prose h3 {
            display: block !important;
        }
        .prose h1 { font-size: 2.25rem !important; line-height: 2.5rem !important; margin-bottom: 1.5rem !important; margin-top: 2rem !important; font-weight: 800 !important; }
        .prose h2 { font-size: 1.875rem !important; line-height: 2.25rem !important; margin-bottom: 1.25rem !important; margin-top: 1.75rem !important; font-weight: 700 !important; }
        .prose h3 { font-size: 1.5rem !important; line-height: 2rem !important; margin-bottom: 1rem !important; margin-top: 1.5rem !important; font-weight: 600 !important; }
        .prose p { margin-bottom: 1.25rem !important; }
        .prose ul { list-style-type: disc !important; padding-left: 1.5rem !important; margin-bottom: 1.25rem !important; }
        .prose ol { list-style-type: decimal !important; padding-left: 1.5rem !important; margin-bottom: 1.25rem !important; }
        .prose li { margin-bottom: 0.5rem !important; }
    </style>
</head>
<body class="bg-[#0B1120] text-slate-200 font-sans antialiased">
    ${generateFullHeader('../../', products, categories, siteConfig)}

    <!-- Header Spacing -->
    <div class="h-24"></div>

    <main class="max-w-7xl mx-auto px-4 py-8">
        <!-- Breadcrumb -->
        <nav class="flex items-center gap-2 text-sm text-slate-400 mb-8 overflow-x-auto whitespace-nowrap">
            <a href="/" class="hover:text-white transition-colors">Home</a>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 opacity-50"><path d="m9 18 6-6-6-6"/></svg>
            <a href="/${paths.blog}/" class="hover:text-white transition-colors">Blog</a>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 opacity-50"><path d="m9 18 6-6-6-6"/></svg>
            <span class="text-cyan-400 truncate">${post.title}</span>
        </nav>

        <div class="flex flex-col lg:flex-row gap-12">
            <!-- Main Content (70%) -->
            <article class="lg:w-[70%]">
                <header class="mb-8">
                    <span class="text-cyan-400 font-bold tracking-wider text-sm uppercase mb-3 block">${post.date}</span>
                    <h1 class="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white mb-6 leading-tight">${post.title}</h1>
                    <p class="text-xl text-slate-300 leading-relaxed border-l-4 border-cyan-500 pl-4 italic">
                        ${post.excerpt}
                    </p>
                </header>

                ${post.image ? `
                <picture>
                    <source srcset="${post.image.replace(/\.(jpg|jpeg|png)$/i, '.avif')}" type="image/avif">
                    <source srcset="${post.image.replace(/\.(jpg|jpeg|png)$/i, '.webp')}" type="image/webp">
                    <img src="${post.image}" alt="${post.title}" class="w-full rounded-2xl mb-10 shadow-2xl border border-white/5" loading="eager" fetchpriority="high" decoding="async" width="1200" height="630">
                </picture>` : ''}

                <div class="prose prose-sm md:prose-base lg:prose-xl prose-invert max-w-none prose-headings:text-white prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-white leading-loose tracking-wide">
                    ${contentWithCta}
                </div>

                <!-- Author / E-E-A-T Block -->
                <div class="mt-12 bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row items-start gap-5">
                    <div class="w-14 h-14 shrink-0 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-black text-xl border-2 border-white/10">BP</div>
                    <div>
                        <p class="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-1">Written by</p>
                        <h4 class="text-white font-bold text-lg mb-1">BestPVAShop Editorial Team</h4>
                        <p class="text-slate-400 text-sm leading-relaxed">Our editorial team specializes in verified digital accounts, PVA account strategies, and online marketing. With 5+ years of hands-on experience in the PVA niche, we provide accurate, actionable guides to help businesses scale safely.</p>
                        <div class="flex flex-wrap gap-3 mt-3">
                            <span class="text-xs px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded-full border border-cyan-500/20">PVA Accounts</span>
                            <span class="text-xs px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full border border-blue-500/20">Digital Marketing</span>
                            <span class="text-xs px-3 py-1 bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20">Account Safety</span>
                        </div>
                    </div>
                </div>

                <!-- Trust Section / Related -->
                ${relatedHtml}

                <div class="mt-12 pt-8 border-t border-white/10 flex justify-between items-center">
                    <a href="/${paths.blog}/" class="font-bold text-slate-400 hover:text-white flex items-center gap-2 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> Back to Blog
                    </a>
                </div>
            </article>

            <!-- Sidebar (30%) -->
            <aside class="lg:w-[30%] space-y-8">
                ${sidebarHtml}
            </aside>
        </div>
    </main>

    <footer class="bg-[#0F172A] border-t border-white/5 py-12 mt-12">
        ${generateFooter(products, siteConfig)}
    </footer>

    <!-- Scripts -->
    <script src="../../ui.js" defer></script>
    <script src="https://unpkg.com/lucide@latest" defer onload="lucide.createIcons(); if(window.initUI) window.initUI()"></script>
</body>
</html>`;

    let finalBlogPageHtml = blogPageHtml;
    
    // Global Placeholders
    finalBlogPageHtml = replaceGlobalPlaceholders(finalBlogPageHtml, siteConfig);

    fs.writeFileSync(path.join(dir, 'index.html'), minifyHTML(finalBlogPageHtml));

    sitemap += '  <url>\n';
    sitemap += `    <loc>${escapeXml(getDynamicUrl('blog', post.slug))}</loc>\n`;
    sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
    sitemap += '    <priority>0.7</priority>\n';
    if (post.image) {
        sitemap += `    <image:image>\n      <image:loc>${escapeXml(getImageUrl(post.image, baseUrl))}</image:loc>\n    </image:image>\n`;
    }
    sitemap += '  </url>\n';

    rssFeed += `
  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${escapeXml(getDynamicUrl('blog', post.slug))}</link>
    <description>${escapeXml(post.excerpt)}</description>
    <pubDate>${new Date(post.date).toUTCString() !== 'Invalid Date' ? new Date(post.date).toUTCString() : new Date().toUTCString()}</pubDate>
  </item>
`;
});

console.log("Building Product Pages...");
cleanDirectory(paths.product);
const productTemplate = fs.readFileSync('product_template.html', 'utf8');

products.forEach(product => {
    if (!product.slug) return;
    const relPath = '../../';

    // --- Sitemap ---
    sitemap += '  <url>\n';
    sitemap += `    <loc>${escapeXml(getDynamicUrl('product', product.slug))}</loc>\n`;
    sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
    sitemap += '    <priority>0.8</priority>\n';
    if (product.image) {
        sitemap += `    <image:image>\n      <image:loc>${escapeXml(getImageUrl(product.image, baseUrl))}</image:loc>\n      <image:title>${escapeXml(product.image_title || product.title)}</image:title>\n    </image:image>\n`;
    }
    sitemap += '  </url>\n';

    // --- Prepare Data ---
    const slug = slugify(product.slug);    const solidColor = computeProductColor(product);
    const featuresList = product.features.map(f => 
        `<li class="flex items-start gap-2 text-slate-300 text-sm"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-cyan-400 mt-0.5 shrink-0"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg> ${f}</li>`
    ).join('');
    const bottomFeaturesList = product.features.map(f => 
        `<li class="flex items-start gap-2 text-slate-400 text-sm"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-cyan-500 mt-0.5 shrink-0"><path d="M20 6 9 17l-5-5"/></svg> ${f}</li>`
    ).join('');
    
    let pricingOptions = '<option selected disabled>Choose an option</option>';
    if (product.pricing) {
        pricingOptions += product.pricing.map(p => `<option value="${p}">${p}</option>`).join('');
    }

    // Related Products
    let related = [];
    if (product.related_ids && product.related_ids.length > 0) {
        related = products.filter(p => product.related_ids.includes(p.id));
    }
    if (related.length === 0) {
        related = products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
    }
    const relatedHtml = related.map(p => {
        const relColor = computeProductColor(p);
        const relSlug = p.slug.replace(/^\/+|\/+$/g, '');
        const relUrl = getDynamicUrl('product', relSlug, false);
        const relImgUrl = getImageUrl(p.image, '../../');
        const relImgHtml = relImgUrl 
            ? `<img src="${relImgUrl}" alt="${p.image_title || p.title}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" loading="lazy" decoding="async" width="400" height="300">`
            : '';
        const relOverlayClass = relImgUrl ? '' : 'bg-black/0 group-hover:bg-black/0';
        const relOverlayLayerHtml = relImgUrl ? '' : `<div class="absolute inset-0 ${relOverlayClass} transition-colors duration-300"></div>`;
        const relOverlayTextHtml = relImgUrl ? '' : `
                    <div class="absolute top-2 left-2 bg-red-500/90 backdrop-blur-md border border-white/10 text-xs font-bold px-3 py-1 rounded flex gap-1 z-10">
                        <span class="text-yellow-300 text-sm">Sale!</span> BestPVAShop
                    </div>
                    <h3 class="font-bold text-lg leading-tight mb-2 px-2 drop-shadow-md z-10 relative">${p.display_title || p.title.replace(/^Buy\s+/i, '')}</h3>
                    <div class="bg-white/10 hover:bg-white/20 text-xs font-bold px-4 py-1.5 rounded-full cursor-pointer transition-colors border border-white/20 z-10">ORDER NOW</div>
        `;

        return `
            <div class="card-glow bg-[#1E293B] rounded-xl border border-white/5 overflow-hidden transition-all duration-300 group hover:-translate-y-2" style="content-visibility: auto; contain-intrinsic-size: 0 350px;">
                <div role="img" aria-label="${p.image_title || p.title}" class="p-4 h-44 relative flex flex-col items-center justify-center text-center text-white group-hover:scale-105 transition-transform duration-500" style="background-color: ${relColor};">
                    ${relImgHtml}
                    ${relOverlayLayerHtml}
                    ${relOverlayTextHtml}
                </div>
                <div class="p-4">
                    <p class="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-1">${p.category}</p>
                    <a href="${relUrl}" class="font-bold text-slate-100 text-sm mb-2 block hover:text-cyan-400 transition-colors truncate">${p.title}</a>
                    <div class="flex gap-0.5 mb-3">
                        ${renderStars(5, "w-3 h-3")} 
                    </div>
                    <div class="text-white text-sm mb-4 font-extrabold">$${p.min_price.toFixed(2)} - $${p.max_price.toFixed(2)}</div>
                    <a href="${relUrl}" class="block w-full bg-white/5 hover:bg-cyan-600 text-white text-center py-3.5 rounded-lg text-sm font-bold transition-all border border-white/10 hover:border-cyan-500">Order Now</a>
                </div>
            </div>`;
    }).join('');

    // Reviews
    const pReviews = reviewsData ? reviewsData.filter(r => r.productId === product.id) : [];
    let reviewsHtml = '';
    if (pReviews.length === 0) {
        reviewsHtml = '<div class="text-center py-10 bg-[#0F172A] rounded-xl border border-white/5"><p class="text-slate-400 mb-2">No reviews yet.</p><p class="text-sm text-slate-500">Be the first to write a review!</p></div>';
    } else {
        reviewsHtml = pReviews.map(r => `
            <div class="bg-[#0F172A] p-6 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all duration-300 hover:shadow-2xl hover:shadow-cyan-500/5 group">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center text-white font-black text-lg border-2 border-white/10 shadow-lg group-hover:scale-110 transition-transform duration-300">
                            ${r.avatar || (r.user ? r.user.charAt(0).toUpperCase() : 'U')}
                        </div>
                        <div>
                            <h4 class="font-bold text-white text-base mb-0.5">${r.user}</h4>
                            <div class="flex items-center gap-2 text-xs font-medium text-slate-500">
                                <span>${r.date}</span>
                                ${r.verified !== false ? `
                                <span class="text-cyan-400 flex items-center gap-1 bg-cyan-400/10 px-2 py-0.5 rounded-full text-[10px] border border-cyan-400/20">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-badge-check w-3 h-3"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.78 4.78 4 4 0 0 1-6.74 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.74Z"/><path d="m9 12 2 2 4-4"/></svg> Verified Buyer
                                </span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-0.5 bg-white/5 p-1.5 rounded-lg">
                        ${renderStars(r.rating, "w-3 h-3")}
                    </div>
                </div>
                ${r.title ? `<h5 class="text-white font-bold text-base mb-2 group-hover:text-cyan-400 transition-colors">${r.title}</h5>` : ''}
                <p class="text-slate-400 text-sm leading-relaxed opacity-90 group-hover:opacity-100 transition-opacity">${r.text}</p>
            </div>
        `).join('');
    }

    // JSON-LD
    const jsonLd = [
        {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product.title,
            "description": product.meta_description || product.short_description,
            "sku": String(product.id),
            "brand": { "@type": "Brand", "name": "BestPVAShop" },
            "offers": {
                "@type": "AggregateOffer",
                "priceCurrency": "USD",
                "lowPrice": product.min_price,
                "highPrice": product.max_price,
                "offerCount": product.pricing ? product.pricing.length : 1,
                "availability": "https://schema.org/InStock"
            },
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": "5.0",
                "reviewCount": pReviews.length > 0 ? pReviews.length : 1
            }
        },
        {
            "@context": "https://schema.org/",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": getDynamicUrl('home') },
                { "@type": "ListItem", "position": 2, "name": "Categories", "item": getDynamicUrl('home') + "categories/" },
                { "@type": "ListItem", "position": 3, "name": product.category, "item": getDynamicUrl('category', product.category.toLowerCase().replace(/ /g, '-').replace(/[^\\w-]+/g, '')) },
                { "@type": "ListItem", "position": 4, "name": product.title, "item": getDynamicUrl('product', slug) }
            ]
        },
        {
            "@context": "https://schema.org/",
            "@type": "Organization",
            "name": "BestPVAShop",
            "url": getDynamicUrl('home'),
            "logo": siteConfig.logoUrl || getDynamicUrl('home') + "favicon.svg"
        }
    ];

    // --- Replace Placeholders ---
    let html = productTemplate;
    // Inject Header for Product Pages
    html = html.replace('{{HEADER}}', generateFullHeader('../../', products, categories, siteConfig));

    // SEO
    const seoTitle = product.seo_title || `${product.title} – Verified & Fast | BestPVAShop`;
    let seoDesc = product.meta_description || product.short_description || `Buy ${product.title} instantly.`;
    
    // Ensure Description Length (120-160 chars)
    if (seoDesc.length < 120) {
        seoDesc += " Get high-quality verified accounts instantly at BestPVAShop. Secure, fast, and reliable service with 24/7 support.";
    }
    if (seoDesc.length > 160) {
        seoDesc = seoDesc.substring(0, 157) + "...";
    }

    html = html.replace(/{{SEO_TITLE}}/g, seoTitle);
    html = html.replace(/{{SEO_DESCRIPTION}}/g, seoDesc);
    
    let seoTagsHtml = `
        <link rel="canonical" href="${getDynamicUrl('product', slug)}" />
        <meta name="robots" content="index, follow" />
        <meta property="og:title" content="${seoTitle}" />
        <meta property="og:description" content="${seoDesc}" />
        <meta property="og:url" content="${getDynamicUrl('product', slug)}" />
        <meta property="og:type" content="product" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${seoTitle}" />
        <meta name="twitter:description" content="${seoDesc}" />
    `;
    
    if (product.seo_tags && product.seo_tags.trim() !== '') {
        seoTagsHtml += `\n        <meta name="keywords" content="${product.seo_tags}" />`;
    }

    html = html.replace('{{SEO_TAGS}}', seoTagsHtml);
    html = html.replace('{{JSON_LD}}', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);

    // Content
    const fullImgUrl = getImageUrl(product.image, '../../');
    const preloadHtml = fullImgUrl ? `<link rel="preload" href="${fullImgUrl}" as="image" fetchpriority="high">` : '';
    html = html.replace('{{PRODUCT_IMAGE_PRELOAD}}', preloadHtml);

    const productImageHtml = fullImgUrl 
        ? `<img src="${fullImgUrl}" alt="${product.image_title || product.title}" class="absolute inset-0 w-full h-full object-cover z-0" loading="eager" fetchpriority="high" decoding="async" width="800" height="600">`
        : '';
    html = html.replace('{{PRODUCT_IMAGE_HTML}}', productImageHtml);
    html = html.replace('{{PRODUCT_BG_CLASS}}', fullImgUrl ? 'hidden' : '');
    html = html.replace(/{{SOLID_COLOR}}/g, solidColor);
    html = html.replace(/rgb\(1,\s*2,\s*3\)/g, solidColor);
    html = html.replace('{{HERO_STARS}}', renderStars(5, "w-5 h-5"));
    
    // Category & Slug
    const catData = categories.find(c => c.name === product.category);
    const catSlug = catData ? catData.slug : product.category.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
    html = html.replace(/{{CATEGORY}}/g, product.category);
    html = html.replace(/{{CATEGORY_SLUG}}/g, catSlug);
    
    html = html.replace(/{{PRODUCT_TITLE}}/g, product.title);
    html = html.replace(/{{DISPLAY_TITLE}}/g, product.display_title || product.title.replace(/^Buy\s+/i, ''));
    html = html.replace(/{{IMAGE_TITLE}}/g, product.image_title || product.title);
    html = html.replace('{{DETAIL_STARS}}', renderStars(5, "w-4 h-4"));
    html = html.replace('{{REVIEW_COUNT_TEXT}}', `(${pReviews.length} Customer Reviews)`);
    html = html.replace(/{{REVIEW_COUNT}}/g, String(pReviews.length));
    html = html.replace('{{PRICE_TEXT}}', `$${product.min_price.toFixed(2)} - $${product.max_price.toFixed(2)}`);
    html = html.replace(/{{SHORT_DESC}}/g, product.short_description || product.description || '');
    html = html.replace('{{FEATURES_LIST}}', featuresList);
    html = html.replace('{{PRICING_OPTIONS}}', pricingOptions);
    html = html.replace('{{LONG_DESC}}', generateRichDescription(product));
    html = html.replace('{{BOTTOM_FEATURES_LIST}}', bottomFeaturesList);
    html = html.replace('{{SUMMARY_STARS}}', renderStars(5, "w-5 h-5"));
    html = html.replace('{{REVIEWS_LIST}}', reviewsHtml);
    html = html.replace('{{RELATED_PRODUCTS}}', relatedHtml);
    html = html.replace('{{RELATED_ARTICLES}}', generateRelatedArticlesHtml(product, blogs));
    html = html.replace('{{SOCIAL_SHARE}}', generateSocialShare(product));
    
    // Link cacheable shared CSS
    html = html.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);

    // Footer
    html = html.replace('{{FOOTER}}', generateFooter(products, siteConfig));

    html = html.replace('{{SITE_CONFIG_JS}}', ''); // Remove placeholder, siteConfig is in site_data.js

    // Global Placeholders (Must be after Footer to catch placeholders in it)
    html = html.replace(/{{REL_PATH}}/g, relPath);
    html = replaceGlobalPlaceholders(html, siteConfig);

    // Write File
    const dir = path.join(paths.product, slug);
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'index.html'), minifyHTML(html));
});
console.log("Product pages built.");

// --- 4. Build Static Pages ---
console.log("Building Static Pages...");
function buildStaticPage(pagePath, title, description, content, jsonLd, robotsMeta) {
    const dir = path.join(pagePath);
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    
    let html = indexTemplate;
    
    const depth = pagePath.split('/').filter(Boolean).length;
    const relPath = '../'.repeat(depth) || './';
    
    html = html.replace('{{HEADER}}', generateFullHeader(relPath, products, categories, siteConfig));
    html = html.replace('{{CATEGORY_OPTIONS}}', categoryOptions);
    
    html = html.replace('{{HERO_TITLE}}', `<span class="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">${title}</span>`);
    html = html.replace('{{HERO_SUBTITLE}}', description);
    
    const pageUrl = getDynamicUrl('home') + pagePath + '/';
    html = html.replace(/{{CANONICAL_URL}}/g, pageUrl);
    html = html.replace(/{{SITE_TITLE}}/g, `${title} | BestPVAShop`);
    html = html.replace(/{{META_DESCRIPTION}}/g, description);
    
    // Inject JSON-LD Schema if provided (for SEO Rich Results)
    if (jsonLd) {
        const schemaTag = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
        html = html.replace('</head>', schemaTag + '\n</head>');
    }
    
    html = html.replace('{{PRODUCT_GRID}}', `
        <div class="max-w-6xl mx-auto px-4 py-12 min-h-[40vh]">
            ${content}
        </div>
    `);
    
    html = html.replace('{{LATEST_ARTICLES}}', '');
    html = html.replace('{{FOOTER}}', generateFooter(products, siteConfig));
    html = html.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);
    html = html.replace('{{PRODUCT_IMAGE_PRELOAD}}', '');
    
    const finalRobots = robotsMeta || 'noindex, nofollow';
    html = html.replace(/{{ROBOTS_META}}/g, `<meta name="robots" content="${finalRobots}" />`);
    html = html.replace(/{{REL_PATH}}/g, relPath);
    html = replaceGlobalPlaceholders(html, siteConfig);
    fs.writeFileSync(path.join(dir, 'index.html'), minifyHTML(html));
    
    sitemap += '  <url>\n';
    sitemap += `    <loc>${escapeXml(pageUrl)}</loc>\n`;
    sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
    sitemap += '    <priority>0.6</priority>\n';
    sitemap += '  </url>\n';
}

buildStaticPage('about', 'About Us', 'Learn about BestPVAShop – your trusted source for verified PVA accounts, authentic reviews, and premium digital services since 2020.', `
    <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Who We <span class="text-cyan-400">Are</span></h2>
        <p class="text-slate-400 max-w-3xl mx-auto text-lg leading-relaxed">BestPVAShop is a leading provider of premium, phone-verified accounts (PVA) and authentic digital services. Since 2020, we have been helping businesses, marketers, and entrepreneurs scale their online presence with high-quality, reliable accounts.</p>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 text-center hover:border-cyan-500/30 transition-all">
            <div class="text-4xl font-black text-cyan-400 mb-2">5K+</div>
            <p class="text-slate-400 text-sm font-medium">Happy Customers</p>
        </div>
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 text-center hover:border-cyan-500/30 transition-all">
            <div class="text-4xl font-black text-green-400 mb-2">100%</div>
            <p class="text-slate-400 text-sm font-medium">Verified Accounts</p>
        </div>
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 text-center hover:border-cyan-500/30 transition-all">
            <div class="text-4xl font-black text-purple-400 mb-2">24/7</div>
            <p class="text-slate-400 text-sm font-medium">Customer Support</p>
        </div>
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 text-center hover:border-cyan-500/30 transition-all">
            <div class="text-4xl font-black text-yellow-400 mb-2">40+</div>
            <p class="text-slate-400 text-sm font-medium">Services Available</p>
        </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
        <div class="bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-8 hover:border-cyan-500/30 transition-all group">
            <div class="w-14 h-14 bg-cyan-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-cyan-500/20 transition-colors"><i data-lucide="shield-check" class="w-7 h-7 text-cyan-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-3">Secure & Verified</h3>
            <p class="text-slate-400 text-sm leading-relaxed">Every account undergoes rigorous verification using unique IPs and real device fingerprints, ensuring authenticity and longevity.</p>
        </div>
        <div class="bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-8 hover:border-purple-500/30 transition-all group">
            <div class="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-500/20 transition-colors"><i data-lucide="zap" class="w-7 h-7 text-purple-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-3">Instant Delivery</h3>
            <p class="text-slate-400 text-sm leading-relaxed">Receive your account credentials within minutes of purchase. Our automated systems ensure lightning-fast delivery around the clock.</p>
        </div>
        <div class="bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-8 hover:border-green-500/30 transition-all group">
            <div class="w-14 h-14 bg-green-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-green-500/20 transition-colors"><i data-lucide="refresh-cw" class="w-7 h-7 text-green-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-3">Replacement Guarantee</h3>
            <p class="text-slate-400 text-sm leading-relaxed">If any account doesn't work upon delivery, we provide a free replacement within 24 hours. Your satisfaction is our priority.</p>
        </div>
    </div>
    <div class="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/20 rounded-2xl p-8 md:p-12 text-center">
        <h3 class="text-2xl font-bold text-white mb-4">Ready to Get Started?</h3>
        <p class="text-slate-300 mb-8 max-w-2xl mx-auto">Browse our extensive catalog of verified accounts and digital services. Join thousands of satisfied customers today.</p>
        <a href="/" class="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:scale-105 transition-transform">Explore All Services <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
    </div>
`);
buildStaticPage('contact', 'Contact Us', 'Get in touch with BestPVAShop for 24/7 support via WhatsApp, Telegram, or Email. We respond within minutes.', `
    <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Get In <span class="text-cyan-400">Touch</span></h2>
        <p class="text-slate-400 max-w-2xl mx-auto">Have questions? Need help? Our support team is available 24/7 and typically responds within minutes.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <a href="https://wa.me/${(siteConfig.whatsapp || '').replace(/[^0-9]/g, '')}" target="_blank" rel="noopener" class="group bg-[#1E293B]/60 border border-white/5 rounded-2xl p-8 text-center hover:border-green-500/40 hover:-translate-y-2 transition-all">
            <div class="w-16 h-16 mx-auto bg-green-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-green-500/20 transition-colors"><i data-lucide="phone" class="w-8 h-8 text-green-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-2">WhatsApp</h3>
            <p class="text-slate-400 text-sm mb-4">Fastest response time</p>
            <span class="text-green-400 font-bold text-sm">${siteConfig.whatsapp || ''}</span>
        </a>
        <a href="https://t.me/${(siteConfig.telegram || '').replace('@', '')}" target="_blank" rel="noopener" class="group bg-[#1E293B]/60 border border-white/5 rounded-2xl p-8 text-center hover:border-blue-500/40 hover:-translate-y-2 transition-all">
            <div class="w-16 h-16 mx-auto bg-blue-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-blue-500/20 transition-colors"><i data-lucide="send" class="w-8 h-8 text-blue-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-2">Telegram</h3>
            <p class="text-slate-400 text-sm mb-4">Chat with our team</p>
            <span class="text-blue-400 font-bold text-sm">${siteConfig.telegram || ''}</span>
        </a>
        <a href="mailto:${siteConfig.supportEmail}" class="group bg-[#1E293B]/60 border border-white/5 rounded-2xl p-8 text-center hover:border-red-500/40 hover:-translate-y-2 transition-all">
            <div class="w-16 h-16 mx-auto bg-red-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-red-500/20 transition-colors"><i data-lucide="mail" class="w-8 h-8 text-red-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-2">Email</h3>
            <p class="text-slate-400 text-sm mb-4">For detailed inquiries</p>
            <span class="text-red-400 font-bold text-sm">${siteConfig.supportEmail}</span>
        </a>
    </div>
    <div class="bg-[#1E293B]/40 border border-white/5 rounded-2xl p-8 md:p-12">
        <h3 class="text-2xl font-bold text-white mb-8 text-center">Send Us a <span class="text-cyan-400">Message</span></h3>
        <form action="mailto:${siteConfig.supportEmail}" method="POST" enctype="text/plain" class="max-w-2xl mx-auto space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <input type="text" placeholder="Your Name" class="w-full px-5 py-4 bg-[#0F172A] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors">
                <input type="email" placeholder="Your Email" class="w-full px-5 py-4 bg-[#0F172A] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors">
            </div>
            <input type="text" placeholder="Subject" class="w-full px-5 py-4 bg-[#0F172A] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors">
            <textarea rows="5" placeholder="Your Message..." class="w-full px-5 py-4 bg-[#0F172A] border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors resize-none"></textarea>
            <button type="submit" class="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:scale-[1.02] transition-transform">Send Message</button>
        </form>
    </div>
`);

const faqItems = [
    { q: 'What is a PVA account?', a: 'PVA stands for Phone Verified Account. It is a digital account on platforms like Google, Gmail, Facebook, or Twitter that has been registered and authenticated using a unique, real phone number. Phone verification signals to the platform that a real human created the account — resulting in higher trust, fewer security challenges, and longer account lifespan.' },
    { q: 'How long does delivery take?', a: 'Most orders are delivered instantly after payment confirmation. Some specialized services may take up to 24 hours. You will receive your credentials via email.' },
    { q: 'Are the accounts phone-verified (PVA)?', a: 'Yes, all our accounts are 100% phone-verified using unique phone numbers. We use real device fingerprints and unique IPs to ensure maximum account quality and longevity.' },
    { q: 'What is the difference between a new PVA and an aged PVA account?', a: 'A new PVA account is freshly created and phone-verified. An aged PVA account was created months or years ago and has an established activity history. Aged accounts carry significantly more platform trust — they are less likely to be flagged, have higher sending limits, and integrate more smoothly with third-party tools.' },
    { q: 'What payment methods do you accept?', a: 'We accept multiple secure payment methods including Cryptocurrency (Bitcoin, USDT, Ethereum), PayPal, and other digital payment platforms for your convenience.' },
    { q: 'Do you offer a refund or replacement?', a: 'Yes! We offer a replacement guarantee for any account that does not work upon delivery. Please contact our support team within 24 hours of purchase if you encounter any issues.' },
    { q: 'Can I use these accounts for business purposes?', a: 'Our accounts are designed for legitimate business use including marketing, advertising, social media management, and research purposes. Please use them responsibly and in compliance with platform terms.' },
    { q: 'How do I use PVA accounts safely to avoid bans?', a: 'Always access your PVA accounts through a residential proxy that matches the account\'s country of origin. Use an anti-detect browser (like GoLogin or Multilogin) with a unique profile per account. During the first week, warm up the account gradually — browse normally, do not immediately start aggressive marketing activities.' },
    { q: 'How do I contact support?', a: 'You can reach our 24/7 support team via WhatsApp, Telegram, or Email. We typically respond within minutes during business hours.' },
    { q: 'Are bulk orders available?', a: 'Yes, we offer bulk pricing for large orders. Contact our support team for custom quotes and enterprise solutions tailored to your needs.' },
    { q: 'What are Google Reviews PVA accounts used for?', a: 'Google Reviews PVA accounts are used by businesses and agencies to post positive reviews on Google Business Profiles and Google Maps listings. They are created from verified, unique phone numbers and residential IPs to ensure reviews appear natural and remain posted without being removed.' },
    { q: 'Why should I buy aged Gmail accounts instead of creating new ones?', a: 'Aged Gmail accounts have established trust history with Google. New accounts face frequent security checkpoints, daily sending limits, and are much more likely to be suspended when used for outreach or marketing. Aged accounts bypass these restrictions, giving you immediate operational capability.' },
    { q: 'Is my personal information safe?', a: 'Absolutely. We follow strict privacy policies and never share your personal information with third parties. All transactions are encrypted and securely processed.' },
    { q: 'What is your replacement guarantee policy?', a: 'If any account fails to work within 24 hours of delivery, we provide a free replacement at no extra cost. Our replacement process is fast — typically completed within 1–6 hours of your support request. We stand behind every order we fulfill.' }
];
const faqJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": faqItems.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } })) };
const faqHtml = faqItems.map(f => `
    <details class="group bg-[#1E293B]/60 border border-white/5 rounded-2xl overflow-hidden hover:border-cyan-500/30 transition-all">
        <summary class="flex items-center justify-between cursor-pointer p-6 md:p-8 text-white font-bold text-lg select-none list-none">
            <span>${f.q}</span>
            <i data-lucide="chevron-down" class="w-5 h-5 text-cyan-400 shrink-0 ml-4 group-open:rotate-180 transition-transform"></i>
        </summary>
        <div class="px-6 pb-6 md:px-8 md:pb-8 text-slate-400 leading-relaxed border-t border-white/5 pt-4">${f.a}</div>
    </details>
`).join('\n');
buildStaticPage('faq', 'Frequently Asked Questions', 'Find answers to common questions about PVA accounts, delivery, payments, refunds, and more at BestPVAShop.', `
    <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Common <span class="text-cyan-400">Questions</span></h2>
        <p class="text-slate-400 max-w-2xl mx-auto">Everything you need to know about our services. Can't find what you're looking for? Contact our 24/7 support team.</p>
    </div>
    <div class="max-w-4xl mx-auto space-y-4 mb-16">${faqHtml}</div>
    <div class="text-center bg-[#1E293B]/40 border border-white/5 rounded-2xl p-8">
        <h3 class="text-xl font-bold text-white mb-3">Still Have Questions?</h3>
        <p class="text-slate-400 mb-6">Our support team is available 24/7 to help you.</p>
        <a href="/contact/" class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl hover:scale-105 transition-transform">Contact Support <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
    </div>
`, faqJsonLd);

buildStaticPage('guides', 'Guides & Resources', 'Expert guides, tutorials, and resources for digital marketing, PVA accounts, and growing your online business.', `
    <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Learn & <span class="text-cyan-400">Grow</span></h2>
        <p class="text-slate-400 max-w-2xl mx-auto">Explore our knowledge base packed with expert insights, how-to guides, and industry best practices.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
        <a href="/blog/" class="group bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-8 hover:border-cyan-500/30 transition-all hover:-translate-y-2">
            <div class="w-14 h-14 bg-cyan-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-cyan-500/20 transition-colors"><i data-lucide="book-open" class="w-7 h-7 text-cyan-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-3 group-hover:text-cyan-400 transition-colors">Blog Articles</h3>
            <p class="text-slate-400 text-sm leading-relaxed">In-depth articles on PVA accounts, digital marketing strategies, and industry trends.</p>
        </a>
        <a href="/faq/" class="group bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-white/5 rounded-2xl p-8 hover:border-purple-500/30 transition-all hover:-translate-y-2">
            <div class="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-500/20 transition-colors"><i data-lucide="help-circle" class="w-7 h-7 text-purple-400"></i></div>
            <h3 class="text-xl font-bold text-white mb-3 group-hover:text-purple-400 transition-colors">FAQ</h3>
            <p class="text-slate-400 text-sm leading-relaxed">Quick answers to the most common questions about our services and policies.</p>
        </a>
    </div>
    <div class="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/20 rounded-2xl p-8 text-center">
        <h3 class="text-xl font-bold text-white mb-3">Need Personalized Help?</h3>
        <p class="text-slate-400 mb-6">Our experts can guide you to the perfect solution for your business.</p>
        <a href="/contact/" class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl hover:scale-105 transition-transform">Talk to an Expert <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
    </div>
`);

const serviceCategories = categories.map(cat => {
    const catProds = products.filter(p => p.category === cat.name).slice(0, 4);
    const prodLinks = catProds.map(p => `<li><a href="/product/${p.slug}/" class="text-slate-400 hover:text-cyan-400 transition-colors text-sm">${p.display_title || p.title}</a></li>`).join('');
    return `
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-8 hover:border-cyan-500/30 transition-all group">
            <h3 class="text-xl font-bold text-white mb-4 group-hover:text-cyan-400 transition-colors">${cat.name}</h3>
            <ul class="space-y-3 mb-6">${prodLinks}</ul>
            <a href="/categories/${cat.slug}/" class="text-cyan-400 font-bold text-sm hover:underline">View All →</a>
        </div>
    `;
}).join('');
buildStaticPage('services', 'Our Services', 'Explore 40+ premium digital services including verified PVA accounts, Google Reviews, Facebook accounts, and crypto exchange accounts.', `
    <div class="text-center mb-16">
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-4">Our <span class="text-cyan-400">Services</span></h2>
        <p class="text-slate-400 max-w-2xl mx-auto">We offer a wide range of premium digital services across multiple platforms. All accounts are verified, secure, and delivered instantly.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">${serviceCategories}</div>
    <div class="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/20 rounded-2xl p-8 md:p-12 text-center">
        <h3 class="text-2xl font-bold text-white mb-4">Can't Find What You Need?</h3>
        <p class="text-slate-300 mb-8">Contact us for custom orders and bulk pricing. We can source almost any verified account.</p>
        <a href="/contact/" class="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:scale-105 transition-transform">Request Custom Order <i data-lucide="arrow-right" class="w-5 h-5"></i></a>
    </div>
`);

// --- Definitional Page: What is a PVA Account? ---
const pvaDefinitionJsonLd = [
    {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "What is a PVA Account? Complete Definitional Guide",
        "description": "PVA stands for Phone Verified Account — a digital account authenticated with a unique phone number for enhanced platform trust, higher limits, and reduced suspension risk.",
        "author": { "@type": "Organization", "name": "BestPVAShop" },
        "publisher": { "@type": "Organization", "name": "BestPVAShop", "url": "https://www.bestpvashop.com" }
    },
    {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            { "@type": "Question", "name": "What does PVA stand for?", "acceptedAnswer": { "@type": "Answer", "text": "PVA stands for Phone Verified Account. It refers to any online account — on platforms like Google, Facebook, Instagram, or Twitter — that has been authenticated using a unique, real phone number during the registration process." } },
            { "@type": "Question", "name": "What is the difference between a PVA account and a regular account?", "acceptedAnswer": { "@type": "Answer", "text": "A regular account may be created without phone verification, making it easier for platforms to flag as a bot or spam account. A PVA account has passed a phone verification step, which signals to the platform that a real human created it — resulting in higher trust scores, fewer security challenges, and greater longevity." } },
            { "@type": "Question", "name": "What is an aged PVA account?", "acceptedAnswer": { "@type": "Answer", "text": "An aged PVA account is a phone-verified account that was created months or years ago and has maintained consistent activity. Age adds another layer of trust beyond verification — platforms treat older accounts with established history as significantly more credible than newly created ones." } },
            { "@type": "Question", "name": "Who uses PVA accounts?", "acceptedAnswer": { "@type": "Answer", "text": "PVA accounts are used by digital marketers for email outreach and ad campaigns, developers for API testing and integrations, agencies managing multiple client profiles, and businesses building social proof through verified reviews. Any professional who needs reliable, platform-trusted accounts at scale uses PVAs." } },
            { "@type": "Question", "name": "Where can I buy PVA accounts?", "acceptedAnswer": { "@type": "Answer", "text": "BestPVAShop is a trusted provider of phone-verified accounts across Google, Gmail, Facebook, Twitter, and more. Every account is verified, created on a unique IP, and backed by a replacement guarantee. Visit bestpvashop.com to browse packages." } }
        ]
    }
];
buildStaticPage('what-is-pva-account', 'What is a PVA Account?', 'PVA stands for Phone Verified Account — a digital profile authenticated with a unique phone number, giving it higher platform trust, better deliverability, and longer lifespan than unverified accounts.', `
    <!-- Definitional Hero -->
    <div class="max-w-4xl mx-auto">
        <div class="mb-12">
            <div class="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm font-medium mb-6">
                <i data-lucide="book-open" class="w-4 h-4"></i> Complete Definition & Guide
            </div>
            <h2 class="text-3xl md:text-4xl font-bold text-white mb-6">What is a <span class="text-cyan-400">PVA Account</span>?</h2>
            <div class="bg-gradient-to-br from-[#1E293B] to-[#0F172A] border border-cyan-500/20 rounded-2xl p-8 mb-8">
                <p class="text-xl text-slate-200 leading-relaxed"><strong class="text-cyan-400">PVA</strong> stands for <strong class="text-white">Phone Verified Account</strong>. A PVA account is any online user profile — on platforms such as Google, Gmail, Facebook, Instagram, Twitter, or LinkedIn — that has been authenticated using a <strong class="text-white">unique, real phone number</strong> during registration. The phone verification step signals to the platform that a real human created the account, not an automated bot.</p>
            </div>
        </div>

        <!-- Key Facts Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 hover:border-cyan-500/30 transition-all">
                <div class="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center mb-4"><i data-lucide="phone" class="w-6 h-6 text-cyan-400"></i></div>
                <h3 class="text-lg font-bold text-white mb-2">Phone Verified</h3>
                <p class="text-slate-400 text-sm">Created with a unique, real phone number — one number per account, never recycled or shared.</p>
            </div>
            <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 hover:border-green-500/30 transition-all">
                <div class="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center mb-4"><i data-lucide="shield-check" class="w-6 h-6 text-green-400"></i></div>
                <h3 class="text-lg font-bold text-white mb-2">Platform Trusted</h3>
                <p class="text-slate-400 text-sm">Treated by algorithms as a legitimate human identity — fewer security challenges, lower suspension risk.</p>
            </div>
            <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 hover:border-purple-500/30 transition-all">
                <div class="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mb-4"><i data-lucide="clock" class="w-6 h-6 text-purple-400"></i></div>
                <h3 class="text-lg font-bold text-white mb-2">Aged = More Trusted</h3>
                <p class="text-slate-400 text-sm">PVA accounts with months or years of history carry even greater platform credibility than newly created ones.</p>
            </div>
        </div>

        <!-- PVA vs Regular -->
        <div class="mb-12">
            <h3 class="text-2xl font-bold text-white mb-6">PVA Account vs. Regular Account</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead><tr class="border-b border-slate-700">
                        <th class="py-3 px-4 text-slate-400 font-medium">Feature</th>
                        <th class="py-3 px-4 text-slate-400 font-medium">Regular Account</th>
                        <th class="py-3 px-4 text-cyan-400 font-bold">PVA Account</th>
                    </tr></thead>
                    <tbody class="text-sm">
                        <tr class="border-b border-slate-800/60"><td class="py-3 px-4 text-slate-300">Phone Verification</td><td class="py-3 px-4 text-slate-400">❌ Not required</td><td class="py-3 px-4 text-green-400 font-medium">✅ Completed</td></tr>
                        <tr class="border-b border-slate-800/60"><td class="py-3 px-4 text-slate-300">Platform Trust Level</td><td class="py-3 px-4 text-slate-400">Low — flagged easily</td><td class="py-3 px-4 text-green-400 font-medium">High — treated as human</td></tr>
                        <tr class="border-b border-slate-800/60"><td class="py-3 px-4 text-slate-300">Security Challenges</td><td class="py-3 px-4 text-slate-400">Frequent</td><td class="py-3 px-4 text-green-400 font-medium">Rare</td></tr>
                        <tr class="border-b border-slate-800/60"><td class="py-3 px-4 text-slate-300">Sending / API Limits</td><td class="py-3 px-4 text-slate-400">Restricted</td><td class="py-3 px-4 text-green-400 font-medium">Higher limits</td></tr>
                        <tr class="border-b border-slate-800/60"><td class="py-3 px-4 text-slate-300">Suspension Risk</td><td class="py-3 px-4 text-slate-400">High</td><td class="py-3 px-4 text-green-400 font-medium">Low</td></tr>
                        <tr><td class="py-3 px-4 text-slate-300">Recovery Options</td><td class="py-3 px-4 text-slate-400">Limited</td><td class="py-3 px-4 text-green-400 font-medium">Full (phone + email)</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Types of PVA -->
        <div class="mb-12">
            <h3 class="text-2xl font-bold text-white mb-6">Types of PVA Accounts</h3>
            <div class="space-y-4">
                <div class="bg-[#1E293B]/60 border border-white/5 rounded-xl p-6 hover:border-cyan-500/20 transition-all">
                    <h4 class="text-lg font-bold text-cyan-400 mb-2">New PVA Accounts</h4>
                    <p class="text-slate-400 text-sm">Freshly created accounts verified with a unique phone number. Best for testing, bulk sign-ups, and lower-trust use cases where account age is not critical.</p>
                </div>
                <div class="bg-[#1E293B]/60 border border-white/5 rounded-xl p-6 hover:border-green-500/20 transition-all">
                    <h4 class="text-lg font-bold text-green-400 mb-2">Aged PVA Accounts</h4>
                    <p class="text-slate-400 text-sm">Phone-verified accounts created months or years ago with real activity history. These carry significantly higher trust — ideal for email marketing, Google Ads, social media management, and API integrations where established account history matters.</p>
                </div>
                <div class="bg-[#1E293B]/60 border border-white/5 rounded-xl p-6 hover:border-purple-500/20 transition-all">
                    <h4 class="text-lg font-bold text-purple-400 mb-2">USA PVA Accounts</h4>
                    <p class="text-slate-400 text-sm">PVA accounts created using US residential IP addresses and +1 US phone numbers. Required for US-targeted advertising, Google Voice, and platforms that restrict access by geography.</p>
                </div>
            </div>
        </div>

        <!-- Who uses PVA -->
        <div class="mb-12">
            <h3 class="text-2xl font-bold text-white mb-6">Who Uses PVA Accounts?</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex items-start gap-3 p-4 bg-[#1E293B]/40 rounded-xl border border-white/5">
                    <i data-lucide="megaphone" class="w-5 h-5 text-cyan-400 shrink-0 mt-0.5"></i>
                    <div><p class="text-white font-medium text-sm">Digital Marketers</p><p class="text-slate-400 text-xs mt-1">Run email outreach and ad campaigns at scale across multiple verified accounts without platform disruptions.</p></div>
                </div>
                <div class="flex items-start gap-3 p-4 bg-[#1E293B]/40 rounded-xl border border-white/5">
                    <i data-lucide="code-2" class="w-5 h-5 text-green-400 shrink-0 mt-0.5"></i>
                    <div><p class="text-white font-medium text-sm">Developers & QA Teams</p><p class="text-slate-400 text-xs mt-1">Test API integrations, OAuth flows, and application behavior with stable, realistic account environments.</p></div>
                </div>
                <div class="flex items-start gap-3 p-4 bg-[#1E293B]/40 rounded-xl border border-white/5">
                    <i data-lucide="briefcase" class="w-5 h-5 text-purple-400 shrink-0 mt-0.5"></i>
                    <div><p class="text-white font-medium text-sm">Agencies</p><p class="text-slate-400 text-xs mt-1">Manage multiple client accounts, ad profiles, and social media presences from separate verified identities.</p></div>
                </div>
                <div class="flex items-start gap-3 p-4 bg-[#1E293B]/40 rounded-xl border border-white/5">
                    <i data-lucide="star" class="w-5 h-5 text-yellow-400 shrink-0 mt-0.5"></i>
                    <div><p class="text-white font-medium text-sm">Reputation Managers</p><p class="text-slate-400 text-xs mt-1">Post authentic-looking reviews from aged, verified accounts that platforms recognize as real user activity.</p></div>
                </div>
            </div>
        </div>

        <!-- FAQ -->
        <div class="mb-12">
            <h3 class="text-2xl font-bold text-white mb-6">Frequently Asked Questions</h3>
            <div class="space-y-3">
                <details class="group bg-[#1E293B]/60 border border-white/5 rounded-xl overflow-hidden hover:border-cyan-500/20 transition-all">
                    <summary class="flex items-center justify-between cursor-pointer p-5 text-white font-semibold select-none list-none"><span>What does PVA stand for?</span><i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 shrink-0 group-open:rotate-180 transition-transform"></i></summary>
                    <div class="px-5 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/5 pt-4">PVA stands for <strong>Phone Verified Account</strong>. It is any digital account that has been registered and authenticated using a real, unique phone number — distinguishing it from bot-created or unverified accounts.</div>
                </details>
                <details class="group bg-[#1E293B]/60 border border-white/5 rounded-xl overflow-hidden hover:border-cyan-500/20 transition-all">
                    <summary class="flex items-center justify-between cursor-pointer p-5 text-white font-semibold select-none list-none"><span>What is the difference between a PVA and an aged account?</span><i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 shrink-0 group-open:rotate-180 transition-transform"></i></summary>
                    <div class="px-5 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/5 pt-4">A PVA account is verified by phone. An aged account has been active for a significant period of time. An <strong>aged PVA account</strong> combines both — phone-verified AND with months or years of activity history, making it the highest-trust category of account available.</div>
                </details>
                <details class="group bg-[#1E293B]/60 border border-white/5 rounded-xl overflow-hidden hover:border-cyan-500/20 transition-all">
                    <summary class="flex items-center justify-between cursor-pointer p-5 text-white font-semibold select-none list-none"><span>Are PVA accounts legal to buy?</span><i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 shrink-0 group-open:rotate-180 transition-transform"></i></summary>
                    <div class="px-5 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/5 pt-4">Purchasing PVA accounts exists in a gray area relative to platform Terms of Service, but is widely practiced for legitimate business purposes including marketing, development testing, and research. The key is using accounts responsibly for lawful activities only.</div>
                </details>
                <details class="group bg-[#1E293B]/60 border border-white/5 rounded-xl overflow-hidden hover:border-cyan-500/20 transition-all">
                    <summary class="flex items-center justify-between cursor-pointer p-5 text-white font-semibold select-none list-none"><span>Which platforms use PVA accounts?</span><i data-lucide="chevron-down" class="w-4 h-4 text-cyan-400 shrink-0 group-open:rotate-180 transition-transform"></i></summary>
                    <div class="px-5 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/5 pt-4">PVA accounts exist across virtually all major platforms — Google (Gmail, Google Ads, Google Voice), Facebook, Instagram, Twitter/X, LinkedIn, GitHub, Tinder, and more. Any platform that requires phone verification during signup produces PVA accounts.</div>
                </details>
            </div>
        </div>

        <!-- CTA -->
        <div class="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/20 rounded-2xl p-8 text-center">
            <h3 class="text-2xl font-bold text-white mb-3">Ready to Buy Verified PVA Accounts?</h3>
            <p class="text-slate-300 mb-6 max-w-xl mx-auto">BestPVAShop delivers phone-verified accounts across Google, Facebook, Twitter, and more — with instant delivery and a replacement guarantee on every order.</p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <a href="/" class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl hover:scale-105 transition-transform">Browse All PVA Accounts <i data-lucide="arrow-right" class="w-4 h-4"></i></a>
                <a href="/blog/what-is-pva-account-beginner-guide/" class="inline-flex items-center gap-2 px-6 py-3 bg-[#1E293B] border border-white/10 text-slate-300 font-medium rounded-xl hover:border-cyan-500/40 transition-colors">Read Full Beginner Guide <i data-lucide="book-open" class="w-4 h-4"></i></a>
            </div>
        </div>
    </div>
`, pvaDefinitionJsonLd, 'index, follow');

const policySidebar = `
    <div class="md:col-span-1">
        <div class="bg-[#1E293B]/60 border border-white/5 rounded-2xl p-6 sticky top-24">
            <h3 class="text-white font-bold mb-4 text-lg">Legal Pages</h3>
            <nav class="space-y-2">
                <a href="/policies/privacy-policy/" class="block px-4 py-2.5 rounded-xl text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all text-sm font-medium">Privacy Policy</a>
                <a href="/policies/terms-and-conditions/" class="block px-4 py-2.5 rounded-xl text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all text-sm font-medium">Terms & Conditions</a>
                <a href="/policies/refund-policy/" class="block px-4 py-2.5 rounded-xl text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all text-sm font-medium">Refund Policy</a>
                <a href="/policies/shipping-or-delivery-policy/" class="block px-4 py-2.5 rounded-xl text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all text-sm font-medium">Delivery Policy</a>
            </nav>
            <div class="mt-6 pt-6 border-t border-white/5">
                <p class="text-slate-500 text-xs">Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
        </div>
    </div>
`;
function buildPolicyPage(pagePath, title, desc, sections) {
    const sectionsHtml = sections.map(s => `
        <div class="mb-10">
            <h2 class="text-xl font-bold text-white mb-4 flex items-center gap-3"><span class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0"><i data-lucide="file-text" class="w-4 h-4 text-cyan-400"></i></span>${s.title}</h2>
            <div class="text-slate-400 leading-relaxed space-y-3 text-sm">${s.body}</div>
        </div>
    `).join('');
    buildStaticPage(pagePath, title, desc, `
        <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
            ${policySidebar}
            <div class="md:col-span-3 bg-[#1E293B]/40 border border-white/5 rounded-2xl p-8 md:p-10">${sectionsHtml}</div>
        </div>
    `);
}

buildPolicyPage('policies/privacy-policy', 'Privacy Policy', 'Read the BestPVAShop privacy policy. Learn how we collect, use, and protect your personal information.', [
    { title: 'Information We Collect', body: '<p>We collect information you provide directly, such as your name, email address, and payment details when placing an order. We also automatically collect certain technical data including your IP address, browser type, and device information to improve our services.</p>' },
    { title: 'How We Use Your Information', body: '<p>Your information is used to:</p><ul class="list-disc pl-5 space-y-1"><li>Process and deliver your orders</li><li>Communicate order updates and support responses</li><li>Improve our website and services</li><li>Prevent fraud and ensure security</li></ul>' },
    { title: 'Data Protection', body: '<p>We implement industry-standard security measures including SSL encryption and secure payment processing. Your payment information is never stored on our servers and is processed through trusted third-party payment providers.</p>' },
    { title: 'Third-Party Sharing', body: '<p>We do not sell, trade, or share your personal information with third parties for marketing purposes. Information may only be shared with payment processors and delivery partners as necessary to fulfill your order.</p>' },
    { title: 'Cookies', body: '<p>Our website uses essential cookies to ensure proper functionality. These cookies do not track personal information and are necessary for the site to operate correctly.</p>' },
    { title: 'Your Rights', body: '<p>You have the right to request access to, correction of, or deletion of your personal data at any time. To exercise these rights, please contact our support team via email at <a href="mailto:' + siteConfig.supportEmail + '" class="text-cyan-400 hover:underline">' + siteConfig.supportEmail + '</a>.</p>' },
    { title: 'Contact Us', body: '<p>If you have questions about this privacy policy, please contact us at <a href="mailto:' + siteConfig.supportEmail + '" class="text-cyan-400 hover:underline">' + siteConfig.supportEmail + '</a>.</p>' }
]);

buildPolicyPage('policies/terms-and-conditions', 'Terms and Conditions', 'Read the BestPVAShop terms and conditions. Understand the rules and guidelines for using our services.', [
    { title: 'Acceptance of Terms', body: '<p>By accessing and using BestPVAShop (bestpvashop.com), you agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, please do not use our services.</p>' },
    { title: 'Services Description', body: '<p>BestPVAShop provides digital services including phone-verified accounts (PVA), review management packages, and related digital products. All services are intended for legitimate business, marketing, and research purposes only.</p>' },
    { title: 'User Responsibilities', body: '<ul class="list-disc pl-5 space-y-1"><li>You must be at least 18 years old to use our services</li><li>You are responsible for maintaining the confidentiality of your account credentials</li><li>You agree to use purchased accounts in compliance with applicable laws and platform terms of service</li><li>You must not use our services for any illegal or unauthorized purpose</li></ul>' },
    { title: 'Payment Terms', body: '<p>All prices are listed in USD. Payment is required before delivery of any service. We accept cryptocurrency and other secure digital payment methods. All sales are final unless covered by our replacement guarantee.</p>' },
    { title: 'Intellectual Property', body: '<p>All content on this website, including text, graphics, logos, and images, is the property of BestPVAShop and is protected by applicable intellectual property laws. Unauthorized reproduction is prohibited.</p>' },
    { title: 'Limitation of Liability', body: '<p>BestPVAShop shall not be liable for any indirect, incidental, or consequential damages arising from the use of our services. Our total liability shall not exceed the amount paid for the specific service in question.</p>' },
    { title: 'Changes to Terms', body: '<p>We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting to this page. Continued use of our services constitutes acceptance of the updated terms.</p>' }
]);

buildPolicyPage('policies/refund-policy', 'Refund Policy', 'Read the BestPVAShop refund and replacement policy. Learn about our 24-hour replacement guarantee.', [
    { title: 'Replacement Guarantee', body: '<p>We stand behind the quality of our products. If any account or service does not work as described upon delivery, we will provide a <strong class="text-white">free replacement</strong> within 24 hours of your purchase.</p>' },
    { title: 'How to Request a Replacement', body: '<ol class="list-decimal pl-5 space-y-2"><li>Contact our support team within <strong class="text-white">24 hours</strong> of receiving your order</li><li>Provide your order details and a clear description of the issue</li><li>Our team will verify the issue and process your replacement promptly</li></ol>' },
    { title: 'Eligibility Conditions', body: '<ul class="list-disc pl-5 space-y-1"><li>Replacement requests must be submitted within 24 hours of delivery</li><li>The account must not have been modified, had its password changed, or had recovery information altered</li><li>You must provide evidence of the issue (screenshots if applicable)</li></ul>' },
    { title: 'Non-Refundable Cases', body: '<ul class="list-disc pl-5 space-y-1"><li>Accounts that were working at delivery but were later suspended due to user actions</li><li>Requests made after the 24-hour replacement window</li><li>Services that have been fully delivered and used as intended</li></ul>' },
    { title: 'Contact for Refund Requests', body: '<p>For all replacement and refund inquiries, please contact our support team via <a href="https://wa.me/' + (siteConfig.whatsapp || '').replace(/[^0-9]/g, '') + '" class="text-green-400 hover:underline">WhatsApp</a> or <a href="mailto:' + siteConfig.supportEmail + '" class="text-cyan-400 hover:underline">Email</a>. We aim to resolve all issues within 12 hours.</p>' }
]);

buildPolicyPage('policies/shipping-or-delivery-policy', 'Shipping and Delivery Policy', 'Read the BestPVAShop delivery policy. All digital products are delivered instantly via email after payment.', [
    { title: 'Digital Delivery', body: '<p>All our products and services are <strong class="text-white">100% digital</strong>. There is no physical shipping involved. You will receive your account credentials, login details, or service confirmation directly via email after payment.</p>' },
    { title: 'Delivery Timeframe', body: '<ul class="list-disc pl-5 space-y-1"><li><strong class="text-white">Instant Delivery:</strong> Most orders are delivered automatically within minutes of payment confirmation</li><li><strong class="text-white">Standard Delivery:</strong> Some specialized or bulk orders may take up to 24 hours</li><li><strong class="text-white">Custom Orders:</strong> Large or custom orders will have delivery timelines communicated individually</li></ul>' },
    { title: 'Delivery Method', body: '<p>Order details are delivered to the email address provided during checkout. Please ensure your email address is correct and check your spam/junk folder if you do not receive your order within the expected timeframe.</p>' },
    { title: 'Order Confirmation', body: '<p>You will receive an order confirmation immediately after payment. If you do not receive a confirmation, please contact our support team with your payment details for verification.</p>' },
    { title: 'Delivery Issues', body: '<p>If you experience any issues with delivery, please contact our 24/7 support team immediately via <a href="https://wa.me/' + (siteConfig.whatsapp || '').replace(/[^0-9]/g, '') + '" class="text-green-400 hover:underline">WhatsApp</a>, <a href="https://t.me/' + (siteConfig.telegram || '').replace('@', '') + '" class="text-blue-400 hover:underline">Telegram</a>, or <a href="mailto:' + siteConfig.supportEmail + '" class="text-cyan-400 hover:underline">Email</a>.</p>' }
]);

// --- 5. Generate Robots & Sitemap ---
console.log("Building Visual Sitemap Page...");
let sitemapHtmlContent = `
    <div class="max-w-7xl mx-auto px-4 py-12">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <!-- Main Pages -->
            <div class="bg-[#1E293B]/50 backdrop-blur-sm border border-white/5 rounded-2xl p-8 shadow-xl hover:border-cyan-500/30 transition-all group">
                <h2 class="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                    <div class="p-2 bg-cyan-500/10 rounded-lg group-hover:bg-cyan-500/20 transition-colors">
                        <i data-lucide="home" class="w-6 h-6 text-cyan-400"></i>
                    </div>
                    Main Pages
                </h2>
                <div class="flex flex-col gap-4">
                    <a href="/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2 group/link">
                        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 group-hover/link:text-cyan-400 transition-colors"></i> 
                        <span class="font-medium">Home Page</span>
                    </a>
                    <a href="/${paths.blog}/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2 group/link">
                        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 group-hover/link:text-cyan-400 transition-colors"></i> 
                        <span class="font-medium">Our Blog</span>
                    </a>
                </div>
            </div>

            <!-- Categories -->
            <div class="bg-[#1E293B]/50 backdrop-blur-sm border border-white/5 rounded-2xl p-8 shadow-xl hover:border-cyan-500/30 transition-all group">
                <h2 class="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                    <div class="p-2 bg-purple-500/10 rounded-lg group-hover:bg-purple-500/20 transition-colors">
                        <i data-lucide="layers" class="w-6 h-6 text-purple-400"></i>
                    </div>
                    Categories
                </h2>
                <div class="flex flex-col gap-4">
                    ${categories.map(cat => {
                        if (!cat.slug) return '';
                        const slug = cat.slug;
                        return `
                        <a href="/${paths.category}/${slug}/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2 group/link">
                            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 group-hover/link:text-purple-400 transition-colors"></i> 
                            <span class="font-medium">${cat.name}</span>
                        </a>`;
                    }).join('')}
                </div>
            </div>

            <!-- Blog Posts -->
            <div class="bg-[#1E293B]/50 backdrop-blur-sm border border-white/5 rounded-2xl p-8 shadow-xl hover:border-cyan-500/30 transition-all group">
                <h2 class="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                    <div class="p-2 bg-pink-500/10 rounded-lg group-hover:bg-pink-500/20 transition-colors">
                        <i data-lucide="book-open" class="w-6 h-6 text-pink-400"></i>
                    </div>
                    Blog Articles
                </h2>
                <div class="flex flex-col gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                    ${blogs.map(post => `
                        <a href="/${paths.blog}/${post.slug}/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2 group/link">
                            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 group-hover/link:text-pink-400 transition-colors"></i> 
                            <span class="text-sm font-medium line-clamp-1">${post.title}</span>
                        </a>
                    `).join('')}
                </div>
            </div>

            <!-- Product Pages Grouped by Category -->
            ${categories.map(cat => {
                const catProducts = products.filter(p => p.category === cat.name);
                if (catProducts.length === 0) return '';
                const seed = getProductSeed({slug: cat.name});
                const hue = (seed * 137.508) % 360;
                const color = `hsl(${hue}, 70%, 60%)`;
                
                return `
                    <div class="bg-[#1E293B]/50 backdrop-blur-sm border border-white/5 rounded-2xl p-8 shadow-xl hover:border-cyan-500/30 transition-all group">
                        <h2 class="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                            <div class="p-2 rounded-lg group-hover:opacity-80 transition-opacity" style="background-color: ${color}20">
                                <i data-lucide="shopping-cart" class="w-6 h-6" style="color: ${color}"></i>
                            </div>
                            ${cat.name}
                        </h2>
                        <div class="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                              ${catProducts.map(p => `
                                  <a href="/${paths.product}/${p.slug}/" class="text-slate-400 hover:text-white transition-colors flex items-center gap-2 group/link">
                                      <i data-lucide="chevron-right" class="w-4 h-4 text-slate-600 transition-colors"></i>
                                      <span class="text-sm font-medium line-clamp-1">${p.display_title || p.title}</span>
                                  </a>
                              `).join('')}
                          </div>
                    </div>
                `;
            }).join('')}
        </div>
    </div>
`;

let sitemapPageHtml = indexTemplate;
sitemapPageHtml = sitemapPageHtml.replace('{{HEADER}}', generateFullHeader('./', products, categories, siteConfig));
sitemapPageHtml = sitemapPageHtml.replace('{{HERO_TITLE}}', 'Site <span class="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">Map</span>');
sitemapPageHtml = sitemapPageHtml.replace('{{HERO_SUBTITLE}}', 'Explore our complete directory of high-quality PVA accounts and digital services.');
sitemapPageHtml = sitemapPageHtml.replace('{{PRODUCT_IMAGE_PRELOAD}}', '');
sitemapPageHtml = sitemapPageHtml.replace('{{PRODUCT_GRID}}', sitemapHtmlContent);
sitemapPageHtml = sitemapPageHtml.replace('{{LATEST_ARTICLES}}', ''); // Clear latest articles section
sitemapPageHtml = sitemapPageHtml.replace('{{FOOTER}}', generateFooter(products, siteConfig));
sitemapPageHtml = sitemapPageHtml.replace(/{{CRITICAL_CSS}}/g, sharedCssTags);
sitemapPageHtml = sitemapPageHtml.replace(/Best PVA Shop – Buy Verified Accounts & Reviews Instantly/g, 'Sitemap | BestPVAShop');
sitemapPageHtml = sitemapPageHtml.replace(/{{ROBOTS_META}}/g, '<meta name="robots" content="noindex, nofollow" />');

// Important: Replace all global placeholders in sitemap page too
sitemapPageHtml = replaceGlobalPlaceholders(sitemapPageHtml, siteConfig);

fs.writeFileSync('sitemap.html', minifyHTML(sitemapPageHtml));

sitemap += '  <url>\n';
sitemap += `    <loc>${getDynamicUrl('home')}sitemap.html</loc>\n`;
sitemap += '    <lastmod>' + new Date().toISOString().split('T')[0] + '</lastmod>\n';
sitemap += '    <priority>0.5</priority>\n';
sitemap += '  </url>\n';
sitemap += '</urlset>';
fs.writeFileSync('sitemap.xml', sitemap);
console.log("sitemap.xml and sitemap.html created.");

// Generate RSS Feed for Top 10 Newest Products
products.slice(-10).forEach(product => {
    rssFeed += `
  <item>
    <title>${escapeXml(product.title)}</title>
    <link>${getDynamicUrl('product', product.slug)}</link>
    <description>${escapeXml(product.short_description || product.description || product.title)}</description>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
`;
});

rssFeed += '</channel>\n</rss>';
fs.writeFileSync('feed.xml', rssFeed);
console.log("feed.xml created.");

// Generate 301 Redirects in .htaccess
console.log("Updating .htaccess with 301 redirects...");
try {
    let htaccessContent = fs.readFileSync('.htaccess', 'utf8');
    const redirectSectionStart = '# --- CMS GENERATED REDIRECTS START ---';
    const redirectSectionEnd = '# --- CMS GENERATED REDIRECTS END ---';
    
    let redirectRules = redirects.map(r => `Redirect 301 ${r.old} ${r.new}`).join('\n');
    let redirectBlock = `\n${redirectSectionStart}\n${redirectRules}\n${redirectSectionEnd}\n`;
    
    if (htaccessContent.includes(redirectSectionStart)) {
        const regex = new RegExp(`${redirectSectionStart}[\\s\\S]*?${redirectSectionEnd}`, 'g');
        htaccessContent = htaccessContent.replace(regex, redirectBlock.trim());
    } else {
        htaccessContent += redirectBlock;
    }
    
    fs.writeFileSync('.htaccess', htaccessContent);
    console.log(".htaccess updated with redirects.");
} catch (err) {
    console.warn("Failed to update .htaccess:", err.message);
}
console.log("feed.xml created.");

const robots = `User-agent: *
Disallow: /admin.html
Allow: /$
Allow: /blog/
Allow: /product/
Allow: /categories/
Allow: /about/
Allow: /contact/
Allow: /faq/
Allow: /guides/
Allow: /services/
Allow: /policies/
Allow: /sitemap.xml
Allow: /sitemap.html
Allow: /images/
Allow: /*.css$
Allow: /*.js$
Allow: /favicon.svg
Sitemap: ${getDynamicUrl('home')}${paths.sitemap}`;
fs.writeFileSync('robots.txt', robots);
console.log("robots.txt created.");



console.log("Build Finished Successfully!");
