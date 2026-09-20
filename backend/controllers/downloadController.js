const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const NodeCache = require("node-cache");
const { spawn } = require("child_process");

const ytDlpWrap = require("../utils/ytdlp");
const cleanupFile = require("../utils/cleanup");

const TEMP_DIR = path.join(__dirname, "../temp");

// ==========================================
// CREATE TEMP DIRECTORY
// ==========================================
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, {
        recursive: true
    });
}

// ==========================================
// SEARCH CACHE
// ==========================================
const searchCache = new NodeCache({
    stdTTL: 1800,
    checkperiod: 120
});


// ==========================================
// YOUTUBE SEARCH
// ==========================================
exports.getVideoInfo = async (req, res) => {

    try {

        const { query } = req.body;

        if (!query || !query.trim()) {

            return res.status(400).json({
                success: false,
                message: "Search query required"
            });
        }

        // ==========================================
        // DIRECT YOUTUBE URL
        // ==========================================
        if (isYoutubeUrl(query.trim())) {

            try {

                const videoId =
                    extractVideoId(query.trim());

                if (!videoId) {

                    return res.status(400).json({
                        success: false,
                        message: "Invalid YouTube URL"
                    });
                }

                const oembedResponse =
                    await axios.get(
                        "https://www.youtube.com/oembed",
                        {
                            params: {
                                url:
                                    `https://www.youtube.com/watch?v=${videoId}`,
                                format: "json"
                            },
                            timeout: 10000
                        }
                    );

                const video = {

                    id: videoId,

                    title:
                        oembedResponse.data.title,

                    thumbnail:
                        oembedResponse.data.thumbnail_url,

                    duration: "N/A",

                    url:
                        `https://www.youtube.com/watch?v=${videoId}`
                };

                return res.json({

                    success: true,

                    data: [
                        video
                    ]
                });

            } catch (linkError) {

                console.error(
                    "Direct Link Error:",
                    linkError.response?.data ||
                    linkError.message
                );

                return res.status(500).json({

                    success: false,

                    message:
                        "Could not fetch video from link"
                });
            }
        }

        // ==========================================
        // CACHE
        // ==========================================
        const cacheKey =
            query.toLowerCase().trim();

        if (searchCache.has(cacheKey)) {

            return res.json(
                searchCache.get(cacheKey)
            );
        }

        // ==========================================
        // YOUTUBE API SEARCH
        // ==========================================
        const response =
            await axios.get(
                "https://www.googleapis.com/youtube/v3/search",
                {
                    params: {

                        part: "snippet",

                        q: query,

                        type: "video",

                        maxResults: 10,

                        key:
                            process.env.YOUTUBE_API_KEY
                    },

                    timeout: 10000
                }
            );

        // ==========================================
        // FORMAT RESULTS
        // ==========================================
        const videos =
            response.data.items.map(
                item => ({

                    id:
                        item.id.videoId,

                    title:
                        item.snippet.title,

                    thumbnail:
                        item.snippet.thumbnails.high?.url ||
                        item.snippet.thumbnails.medium?.url ||
                        item.snippet.thumbnails.default?.url,

                    duration:
                        "N/A",

                    url:
                        `https://www.youtube.com/watch?v=${item.id.videoId}`
                })
            );

        const result = {

            success: true,

            data:
                videos
        };

        // ==========================================
        // SAVE CACHE
        // ==========================================
        searchCache.set(
            cacheKey,
            result
        );

        return res.json(
            result
        );

    } catch (error) {

        console.error(
            "Search Error:",
            error.response?.data ||
            error.message
        );

        return res.status(500).json({

            success: false,

            message:
                "Search failed"
        });
    }
};


// ==========================================
// SEARCH SUGGESTIONS
// ==========================================
exports.getSuggestions = async (req, res) => {

    try {

        const { query } =
            req.query;

        if (!query || !query.trim()) {

            return res.json({

                success: true,

                data: []
            });
        }

        const cacheKey =
            `suggestions_${query.toLowerCase().trim()}`;

        // ==========================================
        // CACHE
        // ==========================================
        if (searchCache.has(cacheKey)) {

            return res.json({

                success: true,

                data:
                    searchCache.get(cacheKey)
            });
        }

        // ==========================================
        // GOOGLE SUGGESTIONS
        // ==========================================
        try {

            const response =
                await axios.get(
                    "https://suggestqueries.google.com/complete/search",
                    {
                        params: {

                            client: "firefox",

                            ds: "yt",

                            q: query
                        },

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        },

                        timeout: 3000
                    }
                );

            const suggestions =
                Array.isArray(
                    response.data[1]
                )
                    ? response.data[1]
                    : [];

            if (
                suggestions.length > 0
            ) {

                searchCache.set(
                    cacheKey,
                    suggestions
                );

                return res.json({

                    success: true,

                    data:
                        suggestions
                });
            }

        } catch (googleError) {

            console.warn(
                "Google Suggestions failed, using fallback"
            );
        }

        // ==========================================
        // LOCAL FALLBACK
        // ==========================================
        const fallbackSuggestions =
            generateLocalSuggestions(
                query
            );

        searchCache.set(
            cacheKey,
            fallbackSuggestions
        );

        return res.json({

            success: true,

            data:
                fallbackSuggestions
        });

    } catch (error) {

        console.error(
            "Suggestions Error:",
            error.message
        );

        return res.json({

            success: true,

            data: []
        });
    }
};


// ==========================================
// LOCAL FALLBACK SUGGESTIONS
// ==========================================
function generateLocalSuggestions(query) {

    const q =
        query.toLowerCase().trim();

    const suggestions = [

        `${q} full video`,

        `${q} tutorial`,

        `${q} best`,

        `${q} 2026`,

        `${q} official`,

        `${q} hd`,

        `${q} full movie`
    ];

    return suggestions.slice(
        0,
        5
    );
}


// ==========================================
// DOWNLOAD VIDEO 
// ==========================================
exports.downloadVideo = async (req, res) => {

    let filePath = null;
    let childProcess = null;
    let responseFinished = false;
    let processTimeout = null;

    try {

        const { url } = req.query;
        const isStream = req.query.stream === "true";

        // ==========================================
        // URL CHECK
        // ==========================================
        if (!url) {

            return res.status(400).json({
                success: false,
                message: "URL is required"
            });
        }

        // ==========================================
        // YOUTUBE URL CHECK
        // ==========================================
        if (!isYoutubeUrl(url)) {

            return res.status(400).json({
                success: false,
                message: "Invalid YouTube URL"
            });
        }

        // ==========================================
        // UNIQUE FILE
        // ==========================================
        const uniqueId = uuidv4();
        const outputTemplate = path.join(TEMP_DIR, `${uniqueId}.%(ext)s`);

        console.log("=================================");
        console.log(isStream ? "VIDEO PLAY / STREAM" : "VIDEO DOWNLOAD");
        console.log("URL:", url);
        console.log("=================================");

        // ==========================================
        // YT-DLP (FIXED - Use spawn instead of exec)
        // ==========================================
        childProcess = spawn("yt-dlp", [
            url,
            "-f", "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=360]",
            "--merge-output-format", "mp4",
            "--no-playlist",
            "--no-warnings",
            "--restrict-filenames",
            "-q",
            "-o", outputTemplate
        ]);

        // ==========================================
        // CLIENT ABORT (FIXED)
        // ==========================================
        req.on("aborted", () => {
            console.warn("Client aborted — killing yt-dlp.");
            
            if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
                try {
                    childProcess.kill("SIGKILL");
                } catch (e) {
                    console.error("Error killing process:", e.message);
                }
            }
            
            if (processTimeout) clearTimeout(processTimeout);
        });

        // ==========================================
        // STDERR
        // ==========================================
        let stderr = "";

        if (childProcess.stderr) {
            childProcess.stderr.on("data", data => {
                stderr += data.toString();
                console.error("[yt-dlp]", data.toString());
            });
        }

        // ==========================================
        // STDOUT
        // ==========================================
        if (childProcess.stdout) {
            childProcess.stdout.on("data", data => {
                console.log("[yt-dlp]", data.toString());
            });
        }

        // ==========================================
        // PROCESS ERROR
        // ==========================================
        childProcess.on("error", error => {
            console.error("yt-dlp PROCESS ERROR:", error);
            
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    message: "yt-dlp process start failed",
                    error: error.message
                });
            }
        });

        // ==========================================
        // PROCESS TIMEOUT (20 seconds max)
        // ==========================================
        processTimeout = setTimeout(() => {
            if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
                console.warn("Process timeout - killing yt-dlp");
                try {
                    childProcess.kill("SIGKILL");
                } catch (e) {
                    console.error("Error killing timed out process:", e.message);
                }
            }
        }, 20000);

        // ==========================================
        // PROCESS COMPLETE
        // ==========================================
        childProcess.on("close", code => {

            if (processTimeout) clearTimeout(processTimeout);

            try {

                // ==========================================
                // FAILED
                // ==========================================
                if (code !== 0 && code !== null) {

                    console.error("Video download failed:", stderr);

                    if (!res.headersSent) {

                        return res.status(500).json({
                            success: false,
                            message: "Video download failed",
                            error: stderr.slice(-2000)
                        });
                    }

                    return;
                }

                // ==========================================
                // FIND FILE
                // ==========================================
                const downloadedFile = fs.readdirSync(TEMP_DIR).find(
                    file => file.startsWith(uniqueId + ".")
                );

                if (!downloadedFile) {

                    if (!res.headersSent) {

                        return res.status(500).json({
                            success: false,
                            message: "Downloaded video file not found"
                        });
                    }

                    return;
                }

                filePath = path.join(TEMP_DIR, downloadedFile);

                console.log("VIDEO FILE:", filePath);

                // ==========================================
                // STREAM / PLAY MODE
                // ==========================================
                if (isStream) {

                    const stat = fs.statSync(filePath);

                    res.statusCode = 200;

                    res.setHeader("Content-Type", "video/mp4");
                    res.setHeader("Content-Length", stat.size);
                    res.setHeader("Accept-Ranges", "bytes");
                    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
                    res.setHeader("Pragma", "no-cache");
                    res.setHeader("Expires", "0");
                    res.setHeader("Connection", "keep-alive");

                    // ==========================================
                    // CREATE VIDEO STREAM
                    // ==========================================
                    const readStream = fs.createReadStream(filePath, {
                        highWaterMark: 64 * 1024 // 64KB chunks for faster streaming
                    });

                    // ==========================================
                    // STREAM ERROR
                    // ==========================================
                    readStream.on("error", error => {

                        console.error("Video stream error:", error);
                        cleanupFile(filePath);

                        if (!res.destroyed) {
                            res.destroy();
                        }
                    });

                    // ==========================================
                    // RESPONSE FINISHED
                    // ==========================================
                    res.on("finish", () => {

                        responseFinished = true;
                        cleanupFile(filePath);
                    });

                    // ==========================================
                    // CONNECTION CLOSED
                    // ==========================================
                    res.on("close", () => {

                        if (!responseFinished) {

                            try {

                                if (!readStream.destroyed) {
                                    readStream.destroy();
                                }

                            } catch {}
                        }

                        cleanupFile(filePath);
                    });

                    // ==========================================
                    // START STREAM
                    // ==========================================
                    readStream.pipe(res);

                    return;
                }

                // ==========================================
                // NORMAL DOWNLOAD
                // ==========================================
                res.download(filePath, `video-${uniqueId}.mp4`, error => {

                    if (error && error.code !== "ECONNABORTED" && !res.destroyed) {
                        console.error("Send video error:", error);
                    }

                    cleanupFile(filePath);
                });

            } catch (error) {

                console.error("Video close error:", error);

                if (!res.headersSent) {

                    return res.status(500).json({
                        success: false,
                        message: "Video processing failed",
                        error: error.message
                    });
                }
            }
        });

    } catch (error) {

        console.error("Video Download Error:", error);

        if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
            try {
                childProcess.kill("SIGKILL");
            } catch (e) {
                console.error("Error killing process in catch:", e.message);
            }
        }

        if (processTimeout) clearTimeout(processTimeout);

        if (!res.headersSent) {

            return res.status(500).json({
                success: false,
                message: "Video download failed",
                error: error.message
            });
        }
    }
};


// ==========================================
// DOWNLOAD AUDIO (FIXED - Similar improvements)
// ==========================================
exports.downloadAudio = async (req, res) => {

    let filePath = null;
    let childProcess = null;
    let processTimeout = null;

    try {

        const { url } = req.query;
        const isStream = req.query.stream === "true";

        // ==========================================
        // URL CHECK
        // ==========================================
        if (!url) {

            return res.status(400).json({
                success: false,
                message: "URL is required"
            });
        }

        // ==========================================
        // YOUTUBE URL CHECK
        // ==========================================
        if (!isYoutubeUrl(url)) {

            return res.status(400).json({
                success: false,
                message: "Invalid YouTube URL"
            });
        }

        // ==========================================
        // UNIQUE FILE
        // ==========================================
        const uniqueId = uuidv4();
        const outputTemplate = path.join(TEMP_DIR, `${uniqueId}.%(ext)s`);

        console.log("=================================");
        console.log("AUDIO DOWNLOAD/STREAM");
        console.log("URL:", url);
        console.log("Mode:", isStream ? "STREAM" : "DOWNLOAD");
        console.log("=================================");

        // ==========================================
        // YT-DLP (FIXED - Use spawn)
        // ==========================================
        childProcess = spawn("yt-dlp", [
            url,
            "-f", "bestaudio[acodec^=mp4a]/bestaudio",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "192",
            "--no-playlist",
            "--no-warnings",
            "--restrict-filenames",
            "-q",
            "-o", outputTemplate
        ]);

        // ==========================================
        // CLIENT ABORT
        // ==========================================
        req.on("aborted", () => {
            console.warn("Client aborted — killing yt-dlp.");
            
            if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
                try {
                    childProcess.kill("SIGKILL");
                } catch (e) {
                    console.error("Error killing process:", e.message);
                }
            }
            
            if (processTimeout) clearTimeout(processTimeout);
        });

        // ==========================================
        // STDERR
        // ==========================================
        let stderr = "";

        if (childProcess.stderr) {
            childProcess.stderr.on("data", data => {
                stderr += data.toString();
                console.error("[yt-dlp]", data.toString());
            });
        }

        // ==========================================
        // STDOUT
        // ==========================================
        if (childProcess.stdout) {
            childProcess.stdout.on("data", data => {
                console.log("[yt-dlp]", data.toString());
            });
        }

        // ==========================================
        // PROCESS ERROR
        // ==========================================
        childProcess.on("error", error => {
            console.error("yt-dlp PROCESS ERROR:", error);

            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    message: "yt-dlp process start failed",
                    error: error.message
                });
            }
        });

        // ==========================================
        // PROCESS TIMEOUT (30 seconds max)
        // ==========================================
        processTimeout = setTimeout(() => {
            if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
                console.warn("Process timeout - killing yt-dlp");
                try {
                    childProcess.kill("SIGKILL");
                } catch (e) {
                    console.error("Error killing timed out process:", e.message);
                }
            }
        }, 30000);

        // ==========================================
        // PROCESS COMPLETE
        // ==========================================
        childProcess.on("close", code => {

            if (processTimeout) clearTimeout(processTimeout);

            try {

                // ==========================================
                // FAILED
                // ==========================================
                if (code !== 0 && code !== null) {

                    console.error("Audio download failed:", stderr);

                    if (!res.headersSent) {

                        return res.status(500).json({
                            success: false,
                            message: "Audio download failed",
                            error: stderr.slice(-2000)
                        });
                    }

                    return;
                }

                // ==========================================
                // FIND FILE
                // ==========================================
                const downloadedFile = fs.readdirSync(TEMP_DIR).find(
                    file => file.startsWith(uniqueId + ".")
                );

                if (!downloadedFile) {

                    if (!res.headersSent) {

                        return res.status(500).json({
                            success: false,
                            message: "Downloaded audio file not found"
                        });
                    }

                    return;
                }

                filePath = path.join(TEMP_DIR, downloadedFile);

                console.log("AUDIO FILE:", filePath);

                // ==========================================
                // AUDIO STREAM
                // ==========================================
                if (isStream) {

                    const stat = fs.statSync(filePath);

                    res.setHeader("Content-Type", "audio/mpeg");
                    res.setHeader("Content-Length", stat.size);
                    res.setHeader("Accept-Ranges", "bytes");
                    res.setHeader("Cache-Control", "no-cache");

                    const readStream = fs.createReadStream(filePath, {
                        highWaterMark: 64 * 1024
                    });

                    readStream.on("error", error => {

                        console.error("Audio stream error:", error);

                        if (!res.destroyed) {
                            res.destroy();
                        }

                        cleanupFile(filePath);
                    });

                    res.on("finish", () => {
                        cleanupFile(filePath);
                    });

                    res.on("close", () => {

                        if (!readStream.destroyed) {
                            readStream.destroy();
                        }

                        cleanupFile(filePath);
                    });

                    readStream.pipe(res);

                } else {

                    // ==========================================
                    // NORMAL AUDIO DOWNLOAD
                    // ==========================================
                    res.download(filePath, `audio-${uniqueId}.mp3`, error => {

                        if (error && error.code !== "ECONNABORTED" && !res.destroyed) {
                            console.error("Send audio error:", error);
                        }

                        cleanupFile(filePath);
                    });
                }

            } catch (error) {

                console.error("Audio close error:", error);

                if (!res.headersSent) {

                    return res.status(500).json({
                        success: false,
                        message: "Audio processing failed",
                        error: error.message
                    });
                }
            }
        });

    } catch (error) {

        console.error("Audio Download Error:", error);

        if (childProcess && typeof childProcess.kill === 'function' && !childProcess.killed) {
            try {
                childProcess.kill("SIGKILL");
            } catch (e) {
                console.error("Error killing process in catch:", e.message);
            }
        }

        if (processTimeout) clearTimeout(processTimeout);

        if (!res.headersSent) {

            return res.status(500).json({
                success: false,
                message: "Audio download failed",
                error: error.message
            });
        }
    }
};


// ==========================================
// YOUTUBE URL CHECK
// ==========================================
function isYoutubeUrl(url) {

    try {

        const parsed = new URL(url);

        return (
            parsed.hostname === "youtube.com" ||
            parsed.hostname === "www.youtube.com" ||
            parsed.hostname === "m.youtube.com" ||
            parsed.hostname === "youtu.be" ||
            parsed.hostname === "www.youtu.be"
        );

    } catch {

        return false;
    }
}


// ==========================================
// EXTRACT VIDEO ID
// ==========================================
function extractVideoId(url) {

    try {

        const parsed = new URL(url.trim());

        // ==========================================
        // YOUTU.BE
        // ==========================================
        if (
            parsed.hostname === "youtu.be" ||
            parsed.hostname === "www.youtu.be"
        ) {

            return parsed.pathname.split("/")[1] || null;
        }

        // ==========================================
        // YOUTUBE.COM
        // ==========================================
        if (
            parsed.hostname === "youtube.com" ||
            parsed.hostname === "www.youtube.com" ||
            parsed.hostname === "m.youtube.com"
        ) {

            // Normal watch URL
            if (parsed.searchParams.has("v")) {
                return parsed.searchParams.get("v");
            }

            // Shorts
            if (parsed.pathname.startsWith("/shorts/")) {
                return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || null;
            }

            // Embed
            if (parsed.pathname.startsWith("/embed/")) {
                return parsed.pathname.split("/embed/")[1]?.split("/")[0] || null;
            }
        }

        return null;

    } catch {

        return null;
    }
}