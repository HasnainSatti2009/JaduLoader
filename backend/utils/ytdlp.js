const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");

// ==========================================
// FFMPEG (npm: ffmpeg-static)
// ==========================================
let ffmpegStaticPath = null;

try {
    ffmpegStaticPath = require("ffmpeg-static");
} catch {
    console.warn("ffmpeg-static not installed - using system ffmpeg if available");
}

function getFfmpegPath() {
    return ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)
        ? ffmpegStaticPath
        : null;
}

// ==========================================
// YT-DLP STANDALONE BINARY (no python needed)
// ==========================================
function getReleaseFileName() {

    if (process.platform === "win32") return "yt-dlp.exe";

    if (process.platform === "darwin") return "yt-dlp_macos";

    // linux
    return process.arch === "arm64"
        ? "yt-dlp_linux_aarch64"
        : "yt-dlp_linux";
}

const RELEASE_FILE = getReleaseFileName();

const DOWNLOAD_URL =
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${RELEASE_FILE}`;

const LOCAL_NAME =
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

// Try project /bin first, then OS temp dir (in case project folder is read-only)
const CANDIDATE_DIRS = [
    path.join(__dirname, "../bin"),
    path.join(os.tmpdir(), "yt-dlp-bin")
];

async function downloadTo(dir) {

    fs.mkdirSync(dir, { recursive: true });

    const finalPath = path.join(dir, LOCAL_NAME);
    const partPath = finalPath + ".part";

    console.log("Downloading yt-dlp from:", DOWNLOAD_URL);

    const response = await axios.get(DOWNLOAD_URL, {
        responseType: "stream",
        timeout: 120000,
        maxRedirects: 10
    });

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(partPath);
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
    });

    fs.renameSync(partPath, finalPath);

    if (process.platform !== "win32") {
        fs.chmodSync(finalPath, 0o755);
    }

    console.log("yt-dlp ready at:", finalPath);

    return finalPath;
}

let readyPromise = null;

/**
 * Returns the full path of a working yt-dlp binary.
 * Downloads it once if it does not exist yet.
 */
function ensureBinary() {

    if (readyPromise) return readyPromise;

    readyPromise = (async () => {

        // Already downloaded earlier?
        for (const dir of CANDIDATE_DIRS) {
            const existing = path.join(dir, LOCAL_NAME);
            if (fs.existsSync(existing)) {
                if (process.platform !== "win32") {
                    try { fs.chmodSync(existing, 0o755); } catch {}
                }
                return existing;
            }
        }

        // Download (first writable dir wins)
        let lastError = null;

        for (const dir of CANDIDATE_DIRS) {
            try {
                return await downloadTo(dir);
            } catch (error) {
                lastError = error;
                console.error(`yt-dlp download to ${dir} failed:`, error.message);
            }
        }

        throw lastError || new Error("yt-dlp download failed");

    })().catch(error => {
        readyPromise = null; // allow retry on next request
        throw error;
    });

    return readyPromise;
}

module.exports = {
    ensureBinary,
    getFfmpegPath
};