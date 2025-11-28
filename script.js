// Google Sheets Configuration
const SHEET_ID = '1sIwKBRrCv-MHGjdfkY5cpM4Y7VHKMWu-FbWdsxz1kyw';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

// Cloudflare Worker for YouTube view counts
const VIEWS_WORKER_URL = 'https://youtube-views.leonardthethird.workers.dev';

// Format view count nicely (e.g., 1234 -> "1.2K")
function formatViews(views) {
    if (!views || isNaN(views)) return '0';
    if (views >= 1000000) {
        return (views / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (views >= 1000) {
        return (views / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return views.toString();
}

// Fetch YouTube view count via worker
async function fetchYouTubeViews(videoId) {
    try {
        const response = await fetch(`${VIEWS_WORKER_URL}?v=${videoId}`);
        const data = await response.json();
        return data.views || null;
    } catch (error) {
        console.log('Could not fetch views for', videoId, error);
        return null;
    }
}

// Fallback gradient colors for videos without thumbnails
const FALLBACK_GRADIENTS = [
    ['#ff6b9d', '#c44dff'],
    ['#4de1ff', '#4d7cff'],
    ['#ffeb4d', '#ff9d4d'],
    ['#4dff88', '#4de1ff'],
    ['#ff4d88', '#ff4dcd'],
    ['#c44dff', '#4d88ff'],
];

// Extract YouTube video ID from URL
function getYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    return match ? match[1] : null;
}

// Extract Vimeo video ID from URL
function getVimeoId(url) {
    if (!url) return null;
    const match = url.match(/(?:vimeo\.com\/)(\d+)/);
    return match ? match[1] : null;
}

// Get video platform info
function getVideoPlatform(url) {
    const ytId = getYouTubeId(url);
    if (ytId) return { platform: 'youtube', id: ytId };
    const vimeoId = getVimeoId(url);
    if (vimeoId) return { platform: 'vimeo', id: vimeoId };
    return null;
}

// Get thumbnail URL from video URL
function getThumbnail(videoUrl, customThumbnail) {
    if (customThumbnail) return customThumbnail;
    const ytId = getYouTubeId(videoUrl);
    if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    // Vimeo thumbnails require an API call, so we'll fetch them separately
    return null;
}

// Fetch Vimeo thumbnail
async function fetchVimeoThumbnail(vimeoId) {
    try {
        const response = await fetch(`https://vimeo.com/api/v2/video/${vimeoId}.json`);
        const data = await response.json();
        return data[0]?.thumbnail_large || data[0]?.thumbnail_medium || null;
    } catch (error) {
        console.log('Could not fetch Vimeo thumbnail for', vimeoId, error);
        return null;
    }
}

// Fetch Vimeo video info (including dimensions)
async function fetchVimeoInfo(vimeoId) {
    try {
        const response = await fetch(`https://vimeo.com/api/v2/video/${vimeoId}.json`);
        const data = await response.json();
        return {
            width: data[0]?.width || 1920,
            height: data[0]?.height || 1080,
            aspectRatio: (data[0]?.width || 1920) / (data[0]?.height || 1080)
        };
    } catch (error) {
        console.log('Could not fetch Vimeo info for', vimeoId, error);
        return { width: 1920, height: 1080, aspectRatio: 16/9 };
    }
}

// Create a video card element
function createVideoCard(video, index) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.tags = video.tags || '';

    // Handle both camelCase and lowercase column names
    const videoUrl = video.videourl || video.videoUrl || '';
    if (videoUrl) card.dataset.videoUrl = videoUrl;

    const platform = getVideoPlatform(videoUrl);
    if (platform) {
        card.dataset.platform = platform.platform;
        card.dataset.videoId = platform.id;
    }

    const thumbnail = getThumbnail(videoUrl, video.thumbnail);
    const gradient = FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length];

    let thumbnailStyle;
    if (thumbnail) {
        thumbnailStyle = `background: url('${thumbnail}') center/cover; position: relative;`;
    } else {
        thumbnailStyle = `background: linear-gradient(135deg, ${gradient[0]}, ${gradient[1]});`;
    }

    // Show "Loading..." initially for YouTube videos, use sheet value for others
    const initialViews = platform?.platform === 'youtube' ? 'Loading...' : (video.views || '0');

    card.innerHTML = `
        <div class="video-thumbnail" style="${thumbnailStyle}">
            <span class="play-btn">▶️</span>
            ${video.icon ? `<span class="video-icon">${video.icon}</span>` : ''}
        </div>
        <div class="video-info">
            <h3>${video.title || 'Untitled'}</h3>
            <p class="view-count">⭐ ${initialViews} views</p>
        </div>
    `;

    // Add click handler
    card.addEventListener('click', () => {
        const platform = getVideoPlatform(videoUrl);
        if (platform) {
            showVideoPlayer(platform.platform, platform.id, video.title);
        } else if (videoUrl) {
            window.open(videoUrl, '_blank');
        } else {
            card.style.animation = 'none';
            card.offsetHeight;
            card.style.animation = 'card-click 0.5s ease';
            showY2KAlert('Video Coming Soon! ✨🎬');
        }
    });

    return card;
}

// Fetch and render videos from Google Sheets
async function loadVideosFromSheet() {
    const grid = document.querySelector('.video-grid');

    try {
        const response = await fetch(SHEET_URL);
        const text = await response.text();

        // Google's response is wrapped in a callback, extract the JSON
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
        if (!jsonMatch) throw new Error('Invalid response format');

        const data = JSON.parse(jsonMatch[1]);
        const rows = data.table.rows;

        // Get column labels - use label if available, otherwise use the column id (A, B, C...)
        // Map common column positions to expected names
        const colMap = ['title', 'tags', 'icon', 'views', 'videourl', 'thumbnail'];
        const cols = data.table.cols.map((c, i) => {
            const label = (c.label || '').toLowerCase().trim();
            return label || colMap[i] || `col${i}`;
        });

        console.log('Columns:', cols);
        console.log('Rows:', rows);

        // Only clear and rebuild if we got data
        if (rows && rows.length > 1) {
            grid.innerHTML = '';

            // Skip first row (header row) and parse remaining rows into video objects
            rows.slice(1).forEach((row, index) => {
                const video = {};
                row.c.forEach((cell, i) => {
                    if (cols[i] && cell) {
                        video[cols[i]] = cell.v !== null && cell.v !== undefined ? cell.v : (cell.f || '');
                    }
                });

                console.log('Video object:', video);

                // Only add if there's at least a title
                if (video.title) {
                    const card = createVideoCard(video, index);
                    grid.appendChild(card);
                }
            });
        }

        // Re-run entrance animation
        animateCardsIn();

        // Fetch real YouTube view counts and Vimeo thumbnails
        updateAllViewCounts();
        updateVimeoThumbnails();

    } catch (error) {
        console.log('Could not load from Google Sheets, using default content:', error);
        // Keep existing HTML content as fallback
        animateCardsIn();
    }
}

// Animate cards entrance
function animateCardsIn() {
    document.querySelectorAll('.video-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';

        setTimeout(() => {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 + (index * 100));
    });
}

// Fetch and update view counts for YouTube videos
async function updateAllViewCounts() {
    const cards = document.querySelectorAll('.video-card[data-platform="youtube"]');

    // Fetch all view counts in parallel
    const fetchPromises = Array.from(cards).map(async (card) => {
        const videoId = card.dataset.videoId;
        const views = await fetchYouTubeViews(videoId);

        if (views !== null) {
            const viewCountEl = card.querySelector('.view-count');
            if (viewCountEl) {
                viewCountEl.textContent = `⭐ ${formatViews(views)} views`;
            }
        }
    });

    await Promise.all(fetchPromises);
}

// Fetch and update thumbnails for Vimeo videos
async function updateVimeoThumbnails() {
    const cards = document.querySelectorAll('.video-card[data-platform="vimeo"]');

    const fetchPromises = Array.from(cards).map(async (card) => {
        const videoId = card.dataset.videoId;
        const thumbnailEl = card.querySelector('.video-thumbnail');

        // Only fetch if no custom thumbnail was set
        if (thumbnailEl && thumbnailEl.style.background.includes('linear-gradient')) {
            const thumbnailUrl = await fetchVimeoThumbnail(videoId);
            if (thumbnailUrl) {
                thumbnailEl.style.background = `url('${thumbnailUrl}') center/cover`;
            }
        }
    });

    await Promise.all(fetchPromises);
}

// Load videos when page loads
document.addEventListener('DOMContentLoaded', loadVideosFromSheet);

// Video Player Modal
async function showVideoPlayer(platform, videoId, title) {
    // Remove existing player if any
    const existing = document.querySelector('.video-player-modal');
    if (existing) existing.remove();

    // Get video aspect ratio (default 16:9 for YouTube, fetch for Vimeo)
    let aspectRatio = 16 / 9;
    let isPortrait = false;

    if (platform === 'vimeo') {
        const info = await fetchVimeoInfo(videoId);
        aspectRatio = info.aspectRatio;
        isPortrait = aspectRatio < 1;
    }

    // Build embed URL based on platform
    let embedUrl;
    if (platform === 'vimeo') {
        embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1`;
    } else {
        // Default to YouTube
        embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
    }

    const modal = document.createElement('div');
    modal.className = 'video-player-modal';
    modal.innerHTML = `
        <div class="video-player-backdrop"></div>
        <div class="video-player-content">
            <button class="video-player-close">✕</button>
            <h2 class="video-player-title">${title || 'Now Playing'}</h2>
            <div class="video-player-wrapper">
                <iframe
                    src="${embedUrl}"
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                ></iframe>
            </div>
        </div>
    `;

    // Add styles
    const modalStyle = modal.style;
    modalStyle.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const backdrop = modal.querySelector('.video-player-backdrop');
    backdrop.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        animation: fade-in 0.3s ease;
    `;

    const content = modal.querySelector('.video-player-content');
    content.style.cssText = `
        position: relative;
        width: 90%;
        max-width: 800px;
        background: linear-gradient(135deg, #c8a2d6, #7b68ee);
        border-radius: 20px;
        padding: 20px;
        border: 4px solid white;
        box-shadow: 0 0 40px rgba(147, 112, 219, 0.8);
        animation: pop-in 0.3s ease;
        transition: all 0.3s ease;
    `;

    const closeBtn = modal.querySelector('.video-player-close');
    closeBtn.style.cssText = `
        position: absolute;
        top: -15px;
        right: -15px;
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #9370db, #6a5acd);
        border: 3px solid white;
        border-radius: 50%;
        color: white;
        font-size: 1.2rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(147, 112, 219, 0.5);
        transition: all 0.2s ease;
    `;

    const titleEl = modal.querySelector('.video-player-title');
    titleEl.style.cssText = `
        color: white;
        font-family: 'Fredoka One', cursive;
        font-size: 1.2rem;
        margin-bottom: 15px;
        text-align: center;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
    `;

    const wrapper = modal.querySelector('.video-player-wrapper');
    // Use padding-bottom trick for aspect ratio (100 / aspectRatio gives percentage)
    const paddingPercent = (1 / aspectRatio) * 100;
    wrapper.style.cssText = `
        position: relative;
        padding-bottom: ${paddingPercent}%;
        height: 0;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    const iframe = modal.querySelector('iframe');
    iframe.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
    `;

    // Handle responsive layout based on aspect ratio
    const updateLayout = () => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const isLandscapeScreen = vw > vh;
        const isMobile = vw < 768 || vh < 500;

        if (isPortrait) {
            // Portrait video - constrain by height
            const maxHeight = vh - 80; // Leave margin for title and padding
            const maxWidth = maxHeight * aspectRatio;
            const padding = 40; // 20px on each side

            content.style.width = Math.min(vw - 40, maxWidth + padding) + 'px';
            content.style.maxWidth = '400px'; // Cap width for portrait videos
            content.style.height = 'auto';
            content.style.maxHeight = (vh - 40) + 'px';
            content.style.padding = '20px';
            content.style.borderRadius = '20px';
            content.style.border = '4px solid white';
            titleEl.style.display = 'block';
            titleEl.style.fontSize = '1rem';
            titleEl.style.marginBottom = '10px';
            closeBtn.style.width = '36px';
            closeBtn.style.height = '36px';
            closeBtn.style.fontSize = '1rem';
            closeBtn.style.top = '-12px';
            closeBtn.style.right = '-12px';
            closeBtn.style.border = '3px solid white';
            wrapper.style.borderRadius = '10px';
        } else if (isLandscapeScreen && isMobile) {
            // Landscape screen with landscape video - fit to viewport
            const padding = 16;
            const availableHeight = vh - 40;
            const maxVideoWidth = (availableHeight - padding) * aspectRatio;

            content.style.width = Math.min(vw - 20, maxVideoWidth + padding) + 'px';
            content.style.maxWidth = 'none';
            content.style.height = 'auto';
            content.style.maxHeight = (vh - 20) + 'px';
            content.style.padding = '8px';
            content.style.borderRadius = '8px';
            content.style.border = '2px solid white';
            titleEl.style.display = 'none';
            closeBtn.style.width = '24px';
            closeBtn.style.height = '24px';
            closeBtn.style.fontSize = '0.8rem';
            closeBtn.style.top = '-6px';
            closeBtn.style.right = '-6px';
            closeBtn.style.border = '2px solid white';
            wrapper.style.borderRadius = '6px';
        } else {
            // Portrait screen or desktop - normal layout
            content.style.width = '90%';
            content.style.maxWidth = '800px';
            content.style.height = 'auto';
            content.style.maxHeight = 'none';
            content.style.padding = '20px';
            content.style.borderRadius = '20px';
            content.style.border = '4px solid white';
            titleEl.style.display = 'block';
            titleEl.style.fontSize = '1.2rem';
            titleEl.style.marginBottom = '15px';
            closeBtn.style.width = '40px';
            closeBtn.style.height = '40px';
            closeBtn.style.fontSize = '1.2rem';
            closeBtn.style.top = '-15px';
            closeBtn.style.right = '-15px';
            closeBtn.style.border = '3px solid white';
            wrapper.style.borderRadius = '10px';
        }
    };

    // Initial layout check
    updateLayout();

    // Update on orientation change or resize
    window.addEventListener('resize', updateLayout);
    window.addEventListener('orientationchange', updateLayout);

    // Clean up listeners when modal closes
    const originalRemove = modal.remove.bind(modal);
    modal.remove = () => {
        window.removeEventListener('resize', updateLayout);
        window.removeEventListener('orientationchange', updateLayout);
        originalRemove();
    };

    // Close handlers
    closeBtn.addEventListener('click', () => modal.remove());
    closeBtn.addEventListener('mouseover', () => closeBtn.style.transform = 'scale(1.1)');
    closeBtn.addEventListener('mouseout', () => closeBtn.style.transform = 'scale(1)');
    backdrop.addEventListener('click', () => modal.remove());

    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);
}

// Y2K Cursor Trail Effect
document.addEventListener('mousemove', (e) => {
    createTrail(e.clientX, e.clientY);
});

function createTrail(x, y) {
    const trail = document.createElement('div');
    trail.className = 'cursor-trail';

    // Random Y2K icons for the trail
    const icons = ['⭐', '✨', '💖', '🎀', '💎', '✿', '♡', '☆'];
    trail.textContent = icons[Math.floor(Math.random() * icons.length)];

    // Random colors
    const colors = ['#ff69b4', '#00bfff', '#ff1493', '#ba55d3', '#ffff00', '#00ffff'];
    trail.style.color = colors[Math.floor(Math.random() * colors.length)];

    trail.style.left = x + 'px';
    trail.style.top = y + 'px';
    trail.style.filter = `drop-shadow(0 0 10px ${trail.style.color})`;

    document.body.appendChild(trail);

    // Remove after animation
    setTimeout(() => {
        trail.remove();
    }, 1000);
}

// Add sparkle effect on click
document.addEventListener('click', (e) => {
    for (let i = 0; i < 8; i++) {
        setTimeout(() => {
            createSparkle(e.clientX, e.clientY);
        }, i * 50);
    }
});

function createSparkle(x, y) {
    const sparkle = document.createElement('div');
    sparkle.className = 'cursor-trail';
    sparkle.textContent = '✨';

    // Random offset
    const offsetX = (Math.random() - 0.5) * 100;
    const offsetY = (Math.random() - 0.5) * 100;

    sparkle.style.left = (x + offsetX) + 'px';
    sparkle.style.top = (y + offsetY) + 'px';
    sparkle.style.color = '#ffff00';
    sparkle.style.filter = 'drop-shadow(0 0 15px #ffff00)';
    sparkle.style.fontSize = (1 + Math.random()) + 'rem';

    document.body.appendChild(sparkle);

    setTimeout(() => {
        sparkle.remove();
    }, 1000);
}

// Tag filtering
document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active button
        document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tag = btn.dataset.tag;
        const cards = document.querySelectorAll('.video-card');

        cards.forEach(card => {
            if (tag === 'all') {
                card.classList.remove('hidden');
            } else {
                const cardTags = card.dataset.tags || '';
                if (cardTags.includes(tag)) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            }
        });
    });
});

// Y2K style alert box
function showY2KAlert(message) {
    // Remove existing alert if any
    const existing = document.querySelector('.y2k-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.className = 'y2k-alert';
    alert.innerHTML = `
        <div class="y2k-alert-content">
            <span class="alert-stars">⭐✨⭐</span>
            <p>${message}</p>
            <span class="alert-stars">⭐✨⭐</span>
            <button onclick="this.parentElement.parentElement.remove()">OK!</button>
        </div>
    `;

    // Add styles dynamically
    alert.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fade-in 0.3s ease;
    `;

    const content = alert.querySelector('.y2k-alert-content');
    content.style.cssText = `
        background: linear-gradient(135deg, #c8a2d6, #7b68ee);
        padding: 30px 40px;
        border-radius: 20px;
        text-align: center;
        color: white;
        font-family: 'Fredoka One', cursive;
        box-shadow: 0 0 30px rgba(147, 112, 219, 0.8),
                    0 0 60px rgba(123, 104, 238, 0.5);
        border: 4px solid white;
        animation: pop-in 0.3s ease;
    `;

    const button = alert.querySelector('button');
    button.style.cssText = `
        margin-top: 15px;
        padding: 10px 30px;
        font-family: 'Fredoka One', cursive;
        font-size: 1rem;
        background: linear-gradient(135deg, #9370db, #6a5acd);
        border: 3px solid white;
        border-radius: 25px;
        color: white;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(147, 112, 219, 0.5);
        transition: all 0.3s ease;
    `;

    button.addEventListener('mouseover', () => {
        button.style.transform = 'scale(1.1)';
        button.style.boxShadow = '0 6px 25px rgba(147, 112, 219, 0.8)';
    });

    button.addEventListener('mouseout', () => {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 4px 15px rgba(147, 112, 219, 0.5)';
    });

    document.body.appendChild(alert);
}

// Add CSS animations dynamically
const style = document.createElement('style');
style.textContent = `
    @keyframes card-click {
        0% { transform: scale(1); }
        50% { transform: scale(0.95); }
        100% { transform: scale(1); }
    }

    @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes pop-in {
        0% { transform: scale(0) rotate(-10deg); }
        70% { transform: scale(1.1) rotate(5deg); }
        100% { transform: scale(1) rotate(0deg); }
    }
`;
document.head.appendChild(style);

// Fun console message
console.log('%c✨ Welcome to Vivis Vlog! ✨',
    'font-size: 24px; color: #9370db; font-family: Comic Sans MS; text-shadow: 2px 2px #c8a2d6;');
console.log('%c🎀 Made with love! 🎀',
    'font-size: 16px; color: #7b68ee;');

