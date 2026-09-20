const fetchBtn = document.getElementById("fetchBtn");
const urlInput = document.getElementById("url");
const loader = document.getElementById("loader");
const results = document.getElementById("results");
const suggestBox = document.getElementById("suggestBox");

// ==========================================
// MODAL FUNCTIONS
// ==========================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById("modalBackdrop");

    if (modal && backdrop) {
        modal.classList.remove("hidden");
        backdrop.classList.remove("hidden");
        document.body.style.overflow = "hidden";
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById("modalBackdrop");

    if (modal) {
        modal.classList.add("hidden");
    }

    const openModals = document.querySelectorAll(".modal:not(.hidden)");

    if (openModals.length === 0 && backdrop) {
        backdrop.classList.add("hidden");
        document.body.style.overflow = "auto";
    }
}

function closeAllModals() {
    const modals = document.querySelectorAll(".modal");
    const backdrop = document.getElementById("modalBackdrop");

    modals.forEach(modal => {
        modal.classList.add("hidden");
    });

    if (backdrop) {
        backdrop.classList.add("hidden");
        document.body.style.overflow = "auto";
    }
}

// Close modal on ESC key
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeAllModals();
    }
});

function handleContactSubmit(event) {
    event.preventDefault();

    const name = document.getElementById("contactName").value;
    const email = document.getElementById("contactEmail").value;
    const message = document.getElementById("contactMessage").value;

    showToast("شکریہ! آپ کا پیغام بھیج دیا گیا ہے۔ ہم جلد رابطہ کریں گے۔");

    document.getElementById("contactForm").reset();

    closeModal("contactModal");

    console.log("Contact submission:", {
        name,
        email,
        message
    });
}

// ==========================================
// SEARCH
// ==========================================
fetchBtn.addEventListener("click", async () => {
    const query = urlInput.value.trim();

    if (!query) {
        alert("Please enter a search song name");
        return;
    }

    hideSuggestions();

    loader.classList.remove("hidden");
    results.innerHTML = "";

    try {
        const response = await fetch("/api/info", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                query
            })
        });

        const data = await response.json();

        loader.classList.add("hidden");

        if (!response.ok || !data.success) {
            alert(data.message || "Search failed");
            return;
        }

        if (!Array.isArray(data.data) || data.data.length === 0) {
            results.innerHTML = `
                <p class="no-results">
                    No videos found.
                </p>
            `;
            return;
        }

        data.data.forEach(video => {
            createVideoCard(video);
        });

    } catch (error) {
        console.error("Search Error:", error);

        loader.classList.add("hidden");

        alert("Something went wrong while searching.");
    }
});

// ==========================================
// SEARCH SUGGESTIONS
// ==========================================
let suggestTimer = null;

urlInput.addEventListener("input", () => {
    const query = urlInput.value.trim();

    clearTimeout(suggestTimer);

    if (!query) {
        hideSuggestions();
        return;
    }

    suggestTimer = setTimeout(() => {
        fetchSuggestions(query);
    }, 300);
});

urlInput.addEventListener("blur", () => {
    setTimeout(() => {
        hideSuggestions();
    }, 150);
});

async function fetchSuggestions(query) {
    try {
        const response = await fetch(
            `/api/suggest?query=${encodeURIComponent(query)}`
        );

        const data = await response.json();

        console.log("Suggestions response:", data);

        if (
            !data.success ||
            !Array.isArray(data.data) ||
            data.data.length === 0
        ) {
            hideSuggestions();
            return;
        }

        renderSuggestions(data.data);

    } catch (error) {
        console.error("Suggestion Fetch Error:", error);
        hideSuggestions();
    }
}

function renderSuggestions(items) {
    suggestBox.innerHTML = "";

    items.forEach(text => {
        const item = document.createElement("div");

        item.className = "suggest-item";
        item.innerText = text;

        item.addEventListener("mousedown", () => {
            urlInput.value = text;
            hideSuggestions();
            fetchBtn.click();
        });

        suggestBox.appendChild(item);
    });

    suggestBox.classList.remove("hidden");
}

function hideSuggestions() {
    suggestBox.classList.add("hidden");
    suggestBox.innerHTML = "";
}

// ==========================================
// GLOBAL PLAYER INSTANCE
// ==========================================
let currentPlayerInstance = null;

// ==========================================
// CREATE VIDEO CARD
// ==========================================
function createVideoCard(video) {
    const card = document.createElement("div");

    card.className = "card";

    const videoId = uuidv4(); // Generate unique ID for this video player
    const playerId = `player-${videoId}`;

    card.innerHTML = `
        <div class="content">
            <h3>
                ${escapeHtml(video.title || "Unknown title")}
            </h3>

            <div class="meta">
                ${escapeHtml(video.duration || "Unknown")}
            </div>

            <!-- ==========================================
                 PREMIER VIDEO PLAYER (YouTube-like)
                 ========================================== -->
            <div class="premier-player-container" id="premier-${videoId}">
                <!-- Thumbnail with Play Button Overlay -->
                <div class="premier-player-thumbnail" id="premier-thumb-${videoId}">
                    <img
                        class="premier-thumb"
                        src="${escapeHtml(video.thumbnail || "")}"
                        alt="thumbnail"
                    >
                    <div class="premier-play-overlay">
                        <button class="premier-play-button playBtn" data-video-id="${videoId}">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Actual Video Player (Hidden Initially) -->
                <div class="player-wrapper hidden" id="player-wrapper-${videoId}">
                    <video
                        id="${playerId}"
                        class="plyr-player"
                        controls
                        playsinline
                        preload="metadata"
                    >
                        <source src="" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                </div>
            </div>

            <center>
                <div class="buttons">
                    <button class="mp3Btn">
                         MP3
                    </button>

                    <button class="mp4Btn">
                         MP4
                    </button>
                </div>
            </center>

        </div>
    `;

    results.appendChild(card);

    const mp3Btn = card.querySelector(".mp3Btn");
    const mp4Btn = card.querySelector(".mp4Btn");
    const playBtn = card.querySelector(`.playBtn[data-video-id="${videoId}"]`);
    const premierThumb = card.querySelector(`#premier-thumb-${videoId}`);
    const playerWrapper = card.querySelector(`#player-wrapper-${videoId}`);
    const videoElement = card.querySelector(`#${playerId}`);

    let playerInstance = null;
    let currentVideoUrl = null;

    // ==========================================
    // MP3 DOWNLOAD
    // ==========================================
    mp3Btn.addEventListener("click", async () => {

        if (!video.url) {
            alert("Video URL missing");
            return;
        }

        showToast("Download will start, please wait");

        mp3Btn.disabled = true;
        mp3Btn.innerText = "Processing...";

        try {

            const params = new URLSearchParams({
                url: video.url
            });
            const downloadUrl = `/api/download/audio?${params.toString()}`;

            console.log("Fetching audio from:", downloadUrl);

            const response = await fetch(downloadUrl);

            if (!response.ok) {

                let errorMessage = "Audio download failed";

                try {
                    const data = await response.json();

                    if (data.message) {
                        errorMessage = data.message;
                    }

                } catch {}

                throw new Error(errorMessage);
            }

            const blob = await response.blob();

            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement("a");

            a.href = blobUrl;

            a.download =
                `${cleanFileName(video.title)}.mp3`;

            document.body.appendChild(a);

            a.click();

            a.remove();

            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, 1000);

        } catch (error) {

            console.error("MP3 Error:", error);

            alert(
                error.message ||
                "MP3 download failed"
            );

        } finally {

            mp3Btn.disabled = false;
            mp3Btn.innerText = "MP3";
        }
    });

    // ==========================================
    // MP4 DOWNLOAD
    // ==========================================
    mp4Btn.addEventListener("click", async () => {

        if (!video.url) {
            alert("Video URL missing");
            return;
        }

        showToast("Download will start, please wait");

        mp4Btn.disabled = true;
        mp4Btn.innerText = "Downloading...";

        try {

            const params = new URLSearchParams({
                url: video.url
            });
            const downloadUrl = `/api/download/video?${params.toString()}`;

            console.log("Fetching video from:", downloadUrl);

            const response = await fetch(downloadUrl);

            if (!response.ok) {

                let errorMessage =
                    "Video download failed";

                try {

                    const data =
                        await response.json();

                    if (data.message) {
                        errorMessage = data.message;
                    }

                } catch {}

                throw new Error(errorMessage);
            }

            const blob =
                await response.blob();

            const blobUrl =
                URL.createObjectURL(blob);

            const a =
                document.createElement("a");

            a.href = blobUrl;

            a.download =
                `${cleanFileName(video.title)}.mp4`;

            document.body.appendChild(a);

            a.click();

            a.remove();

            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
            }, 1000);

        } catch (error) {

            console.error("MP4 Error:", error);

            alert(
                error.message ||
                "MP4 download failed"
            );

        } finally {

            mp4Btn.disabled = false;
            mp4Btn.innerText = "MP4";
        }
    });

    // ==========================================
    // PLAY VIDEO (YouTube-like Player)
    // ==========================================
    playBtn.addEventListener("click", async () => {

        if (!video.url) {
            alert("Video URL missing");
            return;
        }

        try {

            playBtn.disabled = true;
            playBtn.innerText = "Loading...";

            // ==========================================
            // BUILD VIDEO URL
            // ==========================================
            const params = new URLSearchParams({
                url: video.url,
                stream: 'true'
            });
            const videoStreamUrl = `/api/download/video?${params.toString()}`;

            // ==========================================
            // SHOW PLAYER & LOAD VIDEO
            // ==========================================
            // Hide thumbnail and show video player
            premierThumb.classList.add("hidden");
            playerWrapper.classList.remove("hidden");

            // If video already loaded, just play it
            if (currentVideoUrl === video.url && videoElement.src) {
                
                if (playerInstance) {
                    playerInstance.play();
                } else {
                    videoElement.play();
                }

                playBtn.innerText = "⏸ Pause";
                return;
            }

            // Set new video source
            videoElement.src = videoStreamUrl;
            currentVideoUrl = video.url;

            // ==========================================
            // INITIALIZE PLYR PLAYER (YouTube-like)
            // ==========================================
            if (!playerInstance) {
                playerInstance = new Plyr(videoElement, {
                    controls: [
                        'play-large',
                        'play',
                        'progress',
                        'current-time',
                        'duration',
                        'mute',
                        'volume',
                        'captions',
                        'settings',
                        'fullscreen'
                    ],
                    settings: ['captions', 'quality', 'speed'],
                    quality: { default: 720, options: [360, 720] },
                    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
                    tooltips: { controls: true, seek: true },
                    keyboard: { focused: true, global: true }
                });

                // Store current player instance
                currentPlayerInstance = playerInstance;

                // ==========================================
                // PLAYER EVENTS
                // ==========================================
                playerInstance.on('play', () => {
                    playBtn.innerText = "⏸ Pause";
                });

                playerInstance.on('pause', () => {
                    playBtn.innerText = "▶ Play";
                });

                playerInstance.on('ended', () => {
                    playBtn.innerText = "▶ Play";
                });

                playerInstance.on('error', () => {
                    showToast("Video failed to load");
                    playBtn.innerText = "▶ Play";
                });
            }

            // Load and play
            videoElement.load();
            await videoElement.play();

            playBtn.innerText = "⏸ Pause";

        } catch (error) {

            console.error("Video Play Error:", error);

            playBtn.innerText = "▶ Play";

            showToast("Video Loading");

        } finally {

            playBtn.disabled = false;
        }
    });
}

// ==========================================
// UTILITY: UUID GENERATOR
// ==========================================
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ==========================================
// MODERN TOAST NOTIFICATION
// ==========================================
function showToast(
    message,
    duration = 2500
) {

    let toast =
        document.getElementById(
            "customToast"
        );

    if (!toast) {

        toast =
            document.createElement("div");

        toast.id =
            "customToast";

        toast.className =
            "toast";

        document.body.appendChild(toast);
    }

    toast.innerHTML = `
        <div class="toast-spinner"></div>
        <span>${escapeHtml(message)}</span>
    `;

    toast.classList.add("show");

    clearTimeout(
        toast._timer
    );

    toast._timer =
        setTimeout(() => {

            toast.classList.remove(
                "show"
            );

        }, duration);
}

// ==========================================
// CLEAN FILE NAME
// ==========================================
function cleanFileName(name) {

    return (name || "download")
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim()
        .substring(
            0,
            100
        );
}

// ==========================================
// ESCAPE HTML
// ==========================================
function escapeHtml(value) {

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}