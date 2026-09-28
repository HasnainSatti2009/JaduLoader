const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const NodeCache = require("node-cache");
const { spawn } = require("child_process");

const {
    ensureBinary,
    getFfmpegPath
} = require("../utils/ytdlp");

const cleanupFile =
    require("../utils/cleanup");


// ============================================================
// CONFIG
// ============================================================

const TEMP_DIR =
    path.join(__dirname, "../temp");

// ============================================================
// YOUTUBE API KEY
// ============================================================
// API KEY YAHIN RAKH SAKTE HO
// Apni NEW YouTube Data API key yahan paste karo.
// ============================================================

const YOUTUBE_API_KEY =
    "AIzaSyDzNxVLJpR77W4NnFEXABLKPuydKdth53c";


// ============================================================
// SETTINGS
// ============================================================

const VIDEO_TIMEOUT =
    120000; // 120 seconds

const AUDIO_TIMEOUT =
    120000; // 120 seconds

const MAX_SEARCH_RESULTS =
    10;


// ============================================================
// CREATE TEMP DIRECTORY
// ============================================================

if (!fs.existsSync(TEMP_DIR)) {

    fs.mkdirSync(
        TEMP_DIR,
        {
            recursive: true
        }
    );

}


// ============================================================
// CACHE
// ============================================================

const searchCache =
    new NodeCache({

        stdTTL: 1800,

        checkperiod: 120

    });


// ============================================================
// START YT-DLP SETUP
// ============================================================

ensureBinary()
    .then(path => {

        console.log(
            "yt-dlp ready:",
            path
        );

    })
    .catch(error => {

        console.error(
            "yt-dlp setup failed:",
            error.message
        );

    });


// ============================================================
// GET VIDEO INFO / SEARCH
// ============================================================

exports.getVideoInfo =
async (req, res) => {

    try {

        const query =
            String(
                req.body?.query || ""
            ).trim();


        // ----------------------------------------------------
        // QUERY CHECK
        // ----------------------------------------------------

        if (!query) {

            return res.status(400).json({

                success: false,

                message:
                    "Search query required"

            });

        }


        // ====================================================
        // DIRECT YOUTUBE URL
        // ====================================================

        if (isYoutubeUrl(query)) {

            const videoId =
                extractVideoId(query);


            if (!videoId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid YouTube URL"

                });

            }


            // ------------------------------------------------
            // FIRST TRY YT-DLP
            // ------------------------------------------------

            try {

                const info =
                    await getYoutubeInfo(query);


                return res.json({

                    success: true,

                    data: [

                        {

                            id:
                                videoId,

                            title:
                                info.title ||
                                "YouTube Video",

                            thumbnail:
                                info.thumbnail ||
                                `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,

                            duration:
                                formatDuration(
                                    info.duration
                                ),

                            url:
                                `https://www.youtube.com/watch?v=${videoId}`

                        }

                    ]

                });

            } catch (ytError) {

                console.warn(
                    "yt-dlp info failed:",
                    ytError.message
                );

            }


            // ------------------------------------------------
            // OEMBED FALLBACK
            // ------------------------------------------------

            try {

                const response =
                    await axios.get(

                        "https://www.youtube.com/oembed",

                        {

                            params: {

                                url:
                                    `https://www.youtube.com/watch?v=${videoId}`,

                                format:
                                    "json"

                            },

                            timeout:
                                10000

                        }

                    );


                return res.json({

                    success: true,

                    data: [

                        {

                            id:
                                videoId,

                            title:
                                response.data.title,

                            thumbnail:
                                response.data.thumbnail_url,

                            duration:
                                "N/A",

                            url:
                                `https://www.youtube.com/watch?v=${videoId}`

                        }

                    ]

                });

            } catch (error) {

                return res.status(502).json({

                    success: false,

                    message:
                        "Could not fetch YouTube video information"

                });

            }

        }


        // ====================================================
        // CACHE
        // ====================================================

        const cacheKey =
            query
                .toLowerCase()
                .trim();


        if (
            searchCache.has(
                cacheKey
            )
        ) {

            return res.json(
                searchCache.get(
                    cacheKey
                )
            );

        }


        // ====================================================
        // YOUTUBE API SEARCH
        // ====================================================

        if (
            YOUTUBE_API_KEY &&
            YOUTUBE_API_KEY !==
                "YOUR_YOUTUBE_API_KEY_HERE"
        ) {

            try {

                const response =
                    await axios.get(

                        "https://www.googleapis.com/youtube/v3/search",

                        {

                            params: {

                                part:
                                    "snippet",

                                q:
                                    query,

                                type:
                                    "video",

                                maxResults:
                                    MAX_SEARCH_RESULTS,

                                key:
                                    YOUTUBE_API_KEY

                            },

                            timeout:
                                10000

                        }

                    );


                const videos =
                    (
                        response.data.items ||
                        []
                    )

                        .filter(
                            item =>
                                item.id &&
                                item.id.videoId
                        )

                        .map(
                            item => ({

                                id:
                                    item.id.videoId,

                                title:
                                    item.snippet?.title ||
                                    "Untitled",

                                thumbnail:

                                    item.snippet?.thumbnails?.high?.url ||

                                    item.snippet?.thumbnails?.medium?.url ||

                                    item.snippet?.thumbnails?.default?.url ||

                                    `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,

                                duration:
                                    "N/A",

                                url:
                                    `https://www.youtube.com/watch?v=${item.id.videoId}`

                            })
                        );


                const result = {

                    success:
                        true,

                    data:
                        videos

                };


                searchCache.set(
                    cacheKey,
                    result
                );


                return res.json(
                    result
                );


            } catch (apiError) {

                console.error(
                    "YouTube API search failed:",

                    apiError.response?.data ||
                    apiError.message
                );

            }

        }


        // ====================================================
        // YT-DLP SEARCH FALLBACK
        // ====================================================

        try {

            const videos =
                await searchWithYtDlp(
                    query
                );


            const result = {

                success:
                    true,

                data:
                    videos

            };


            searchCache.set(
                cacheKey,
                result
            );


            return res.json(
                result
            );


        } catch (error) {

            console.error(
                "yt-dlp search failed:",
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Search failed",

                error:
                    error.message

            });

        }


    } catch (error) {

        console.error(
            "Search Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Search failed",

            error:
                error.message

        });

    }

};


// ============================================================
// SUGGESTIONS
// ============================================================

exports.getSuggestions =
async (req, res) => {

    try {

        const query =
            String(
                req.query?.query || ""
            ).trim();


        if (!query) {

            return res.json({

                success:
                    true,

                data:
                    []

            });

        }


        const cacheKey =
            `suggestions_${query.toLowerCase()}`;


        if (
            searchCache.has(
                cacheKey
            )
        ) {

            return res.json({

                success:
                    true,

                data:
                    searchCache.get(
                        cacheKey
                    )

            });

        }


        // ====================================================
        // GOOGLE / YOUTUBE SUGGESTIONS
        // ====================================================

        try {

            const response =
                await axios.get(

                    "https://suggestqueries.google.com/complete/search",

                    {

                        params: {

                            client:
                                "firefox",

                            ds:
                                "yt",

                            q:
                                query

                        },

                        headers: {

                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"

                        },

                        timeout:
                            5000

                    }

                );


            const suggestions =
                Array.isArray(
                    response.data?.[1]
                )

                    ? response.data[1].slice(
                        0,
                        5
                    )

                    : [];


            if (
                suggestions.length
            ) {

                searchCache.set(
                    cacheKey,
                    suggestions
                );


                return res.json({

                    success:
                        true,

                    data:
                        suggestions

                });

            }

        } catch (error) {

            console.warn(
                "Suggestions API failed:",
                error.message
            );

        }


        // ====================================================
        // LOCAL FALLBACK
        // ====================================================

        const fallback =
            generateLocalSuggestions(
                query
            );


        searchCache.set(
            cacheKey,
            fallback
        );


        return res.json({

            success:
                true,

            data:
                fallback

        });


    } catch (error) {

        console.error(
            "Suggestions Error:",
            error.message
        );


        return res.json({

            success:
                true,

            data:
                []

        });

    }

};


// ============================================================
// LOCAL SUGGESTIONS
// ============================================================

function generateLocalSuggestions(
    query
) {

    const q =
        query
            .toLowerCase()
            .trim();


    return [

        `${q} full video`,

        `${q} tutorial`,

        `${q} best`,

        `${q} 2026`,

        `${q} official`,

        `${q} hd`,

        `${q} full movie`

    ].slice(
        0,
        5
    );

}


// ============================================================
// VIDEO DOWNLOAD
// ============================================================

exports.downloadVideo =
async (req, res) => {

    const url =
        String(
            req.query?.url || ""
        ).trim();


    const isStream =
        req.query?.stream === "true";


    // --------------------------------------------------------
    // URL CHECK
    // --------------------------------------------------------

    if (!url) {

        return res.status(400).json({

            success:
                false,

            message:
                "URL is required"

        });

    }


    if (
        !isYoutubeUrl(url)
    ) {

        return res.status(400).json({

            success:
                false,

            message:
                "Invalid YouTube URL"

        });

    }


    return downloadWithYtDlp({

        req,

        res,

        url,

        type:
            "video",

        isStream,

        timeout:
            VIDEO_TIMEOUT

    });

};


// ============================================================
// AUDIO DOWNLOAD
// ============================================================

exports.downloadAudio =
async (req, res) => {

    const url =
        String(
            req.query?.url || ""
        ).trim();


    const isStream =
        req.query?.stream === "true";


    // --------------------------------------------------------
    // URL CHECK
    // --------------------------------------------------------

    if (!url) {

        return res.status(400).json({

            success:
                false,

            message:
                "URL is required"

        });

    }


    if (
        !isYoutubeUrl(url)
    ) {

        return res.status(400).json({

            success:
                false,

            message:
                "Invalid YouTube URL"

        });

    }


    return downloadWithYtDlp({

        req,

        res,

        url,

        type:
            "audio",

        isStream,

        timeout:
            AUDIO_TIMEOUT

    });

};


// ============================================================
// COMMON DOWNLOAD FUNCTION
// ============================================================

async function downloadWithYtDlp({

    req,

    res,

    url,

    type,

    isStream,

    timeout

}) {

    let childProcess =
        null;

    let filePath =
        null;

    let processTimeout =
        null;

    let responseFinished =
        false;


    try {

        // ----------------------------------------------------
        // UNIQUE FILE
        // ----------------------------------------------------

        const uniqueId =
            uuidv4();


        const outputTemplate =
            path.join(
                TEMP_DIR,
                `${uniqueId}.%(ext)s`
            );


        console.log(
            "======================================"
        );


        console.log(
            type === "audio"
                ? "AUDIO DOWNLOAD"
                : "VIDEO DOWNLOAD"
        );


        console.log(
            "URL:",
            url
        );


        console.log(
            "STREAM:",
            isStream
        );


        console.log(
            "======================================"
        );


        // ----------------------------------------------------
        // BINARIES
        // ----------------------------------------------------

        const ytDlpPath =
            await ensureBinary();


        const ffmpegPath =
            getFfmpegPath();


        let args = [];


        // ====================================================
        // VIDEO
        // ====================================================

        if (
            type === "video"
        ) {

            args = [

                url,


                ...(ffmpegPath
                    ? [
                        "--ffmpeg-location",
                        ffmpegPath
                    ]
                    : []),


                // --------------------------------------------
                // IMPORTANT FORMAT FIX
                // --------------------------------------------
                // Old:
                // bestvideo[height<=360][vcodec^=avc1]
                //
                // New:
                // automatic available format
                // --------------------------------------------

                "-f",

                "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",


                "--merge-output-format",

                "mp4",


                "--no-playlist",

                "--no-warnings",

                "--restrict-filenames",


                // Retry

                "--retries",
                "3",

                "--fragment-retries",
                "3",

                "--extractor-retries",
                "3",


                // Network

                "--socket-timeout",
                "30",

                "--force-ipv4",


                "-q",


                "-o",

                outputTemplate

            ];

        }


        // ====================================================
        // AUDIO
        // ====================================================

        else {

            args = [

                url,


                ...(ffmpegPath
                    ? [
                        "--ffmpeg-location",
                        ffmpegPath
                    ]
                    : []),


                // Automatic audio format

                "-f",

                "bestaudio/best",


                "-x",


                "--audio-format",

                "mp3",


                "--audio-quality",

                "192K",


                "--no-playlist",

                "--no-warnings",

                "--restrict-filenames",


                // Retry

                "--retries",
                "3",

                "--fragment-retries",
                "3",

                "--extractor-retries",
                "3",


                // Network

                "--socket-timeout",
                "30",

                "--force-ipv4",


                "-q",


                "-o",

                outputTemplate

            ];

        }


        // ====================================================
        // START PROCESS
        // ====================================================

        childProcess =
            spawn(

                ytDlpPath,

                args,

                {

                    windowsHide:
                        true,

                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]

                }

            );


        let stderr =
            "";


        let stdout =
            "";


        // ====================================================
        // STDERR
        // ====================================================

        if (
            childProcess.stderr
        ) {

            childProcess.stderr.on(
                "data",
                data => {

                    const text =
                        data.toString();


                    stderr +=
                        text;


                    console.error(
                        "[yt-dlp]",
                        text.trim()
                    );


                    // Keep memory controlled

                    if (
                        stderr.length >
                        30000
                    ) {

                        stderr =
                            stderr.slice(
                                -30000
                            );

                    }

                }
            );

        }


        // ====================================================
        // STDOUT
        // ====================================================

        if (
            childProcess.stdout
        ) {

            childProcess.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();


                    if (
                        stdout.length >
                        10000
                    ) {

                        stdout =
                            stdout.slice(
                                -10000
                            );

                    }

                }
            );

        }


        // ====================================================
        // PROCESS ERROR
        // ====================================================

        childProcess.on(
            "error",
            error => {

                console.error(
                    "yt-dlp process error:",
                    error
                );


                if (
                    processTimeout
                ) {

                    clearTimeout(
                        processTimeout
                    );

                }


                if (
                    !res.headersSent
                ) {

                    res.status(500).json({

                        success:
                            false,

                        message:
                            "yt-dlp process failed",

                        error:
                            error.message

                    });

                }

            }
        );


        // ====================================================
        // CLIENT ABORT
        // ====================================================

        req.on(
            "aborted",
            () => {

                console.warn(
                    "Client aborted. Killing yt-dlp."
                );


                killProcess(
                    childProcess
                );


                if (
                    processTimeout
                ) {

                    clearTimeout(
                        processTimeout
                    );

                }

            }
        );


        // ====================================================
        // TIMEOUT
        // ====================================================

        processTimeout =
            setTimeout(
                () => {

                    if (
                        childProcess &&
                        !childProcess.killed
                    ) {

                        console.warn(
                            "yt-dlp timeout - killing process"
                        );


                        killProcess(
                            childProcess
                        );

                    }


                    if (
                        !res.headersSent
                    ) {

                        res.status(504).json({

                            success:
                                false,

                            message:
                                "Video download timed out",

                            error:
                                stderr.slice(
                                    -3000
                                )

                        });

                    }

                },

                timeout
            );


        // ====================================================
        // PROCESS CLOSE
        // ====================================================

        childProcess.on(
            "close",
            code => {

                if (
                    processTimeout
                ) {

                    clearTimeout(
                        processTimeout
                    );

                    processTimeout =
                        null;

                }


                // ------------------------------------------------
                // FAILED
                // ------------------------------------------------

                if (
                    code !== 0
                ) {

                    console.error(
                        "yt-dlp exit code:",
                        code
                    );


                    console.error(
                        stderr
                    );


                    if (
                        !res.headersSent
                    ) {

                        return res.status(502).json({

                            success:
                                false,

                            message:
                                getDownloadError(
                                    stderr
                                ),

                            error:
                                stderr.slice(
                                    -4000
                                )

                        });

                    }


                    return;

                }


                // ------------------------------------------------
                // FIND FILE
                // ------------------------------------------------

                const downloadedFile =
                    findDownloadedFile(
                        uniqueId
                    );


                if (
                    !downloadedFile
                ) {

                    if (
                        !res.headersSent
                    ) {

                        return res.status(502).json({

                            success:
                                false,

                            message:
                                "yt-dlp finished but downloaded file was not found",

                            error:
                                stderr.slice(
                                    -3000
                                )

                        });

                    }


                    return;

                }


                filePath =
                    path.join(
                        TEMP_DIR,
                        downloadedFile
                    );


                console.log(
                    "Downloaded file:",
                    filePath
                );


                // ------------------------------------------------
                // FILE STAT
                // ------------------------------------------------

                let stat;

                try {

                    stat =
                        fs.statSync(
                            filePath
                        );

                } catch (error) {

                    return res.status(500).json({

                        success:
                            false,

                        message:
                            "Could not read downloaded file",

                        error:
                            error.message

                    });

                }


                if (
                    !stat.size
                ) {

                    cleanupFile(
                        filePath
                    );


                    return res.status(500).json({

                        success:
                            false,

                        message:
                            "Downloaded file is empty"

                    });

                }


                // =================================================
                // STREAM
                // =================================================

                if (
                    isStream
                ) {

                    return streamMediaFile(

                        req,

                        res,

                        filePath,

                        type,

                        stat.size

                    );

                }


                // =================================================
                // NORMAL DOWNLOAD
                // =================================================

                const extension =
                    type === "audio"
                        ? ".mp3"
                        : ".mp4";


                const filename =
                    `${type}-${uniqueId}${extension}`;


                res.download(

                    filePath,

                    filename,

                    error => {

                        if (
                            error &&
                            error.code !==
                                "ECONNABORTED" &&
                            !res.destroyed
                        ) {

                            console.error(
                                "File send error:",
                                error.message
                            );

                        }


                        cleanupFile(
                            filePath
                        );

                    }

                );


            }
        );


    } catch (error) {

        console.error(
            "Download Error:",
            error
        );


        if (
            childProcess
        ) {

            killProcess(
                childProcess
            );

        }


        if (
            processTimeout
        ) {

            clearTimeout(
                processTimeout
            );

        }


        if (
            filePath
        ) {

            cleanupFile(
                filePath
            );

        }


        if (
            !res.headersSent
        ) {

            return res.status(500).json({

                success:
                    false,

                message:
                    "Download failed",

                error:
                    error.message

            });

        }

    }

};


// ============================================================
// STREAM MEDIA FILE
// ============================================================

function streamMediaFile(

    req,

    res,

    filePath,

    type,

    fileSize

) {

    const contentType =
        type === "audio"
            ? "audio/mpeg"
            : "video/mp4";


    const range =
        req.headers.range;


    // ========================================================
    // NO RANGE
    // ========================================================

    if (!range) {

        res.statusCode =
            200;


        res.setHeader(
            "Content-Type",
            contentType
        );


        res.setHeader(
            "Content-Length",
            fileSize
        );


        res.setHeader(
            "Accept-Ranges",
            "bytes"
        );


        const stream =
            fs.createReadStream(
                filePath
            );


        stream.on(
            "error",
            error => {

                console.error(
                    "Stream error:",
                    error.message
                );


                cleanupFile(
                    filePath
                );


                if (
                    !res.destroyed
                ) {

                    res.destroy();

                }

            }
        );


        res.on(
            "finish",
            () => {

                cleanupFile(
                    filePath
                );

            }
        );


        res.on(
            "close",
            () => {

                if (
                    !stream.destroyed
                ) {

                    stream.destroy();

                }


                cleanupFile(
                    filePath
                );

            }
        );


        return stream.pipe(
            res
        );

    }


    // ========================================================
    // RANGE PARSE
    // ========================================================

    const match =
        /^bytes=(\d*)-(\d*)$/
            .exec(range);


    if (!match) {

        res.status(416);

        res.setHeader(
            "Content-Range",
            `bytes */${fileSize}`
        );


        cleanupFile(
            filePath
        );


        return res.end();

    }


    let start =
        match[1]
            ? Number(match[1])
            : 0;


    let end =
        match[2]
            ? Number(match[2])
            : fileSize - 1;


    // Suffix range

    if (
        !match[1] &&
        match[2]
    ) {

        const length =
            Number(match[2]);


        start =
            Math.max(
                fileSize - length,
                0
            );


        end =
            fileSize - 1;

    }


    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= fileSize ||
        end < start
    ) {

        res.status(416);

        res.setHeader(
            "Content-Range",
            `bytes */${fileSize}`
        );


        cleanupFile(
            filePath
        );


        return res.end();

    }


    end =
        Math.min(
            end,
            fileSize - 1
        );


    const chunkSize =
        end - start + 1;


    // ========================================================
    // RANGE RESPONSE
    // ========================================================

    res.statusCode =
        206;


    res.setHeader(
        "Content-Type",
        contentType
    );


    res.setHeader(
        "Content-Length",
        chunkSize
    );


    res.setHeader(
        "Content-Range",
        `bytes ${start}-${end}/${fileSize}`
    );


    res.setHeader(
        "Accept-Ranges",
        "bytes"
    );


    const stream =
        fs.createReadStream(

            filePath,

            {

                start,
                end

            }

        );


    stream.on(
        "error",
        error => {

            console.error(
                "Range stream error:",
                error.message
            );


            cleanupFile(
                filePath
            );


            if (
                !res.destroyed
            ) {

                res.destroy();

            }

        }
    );


    res.on(
        "finish",
        () => {

            cleanupFile(
                filePath
            );

        }
    );


    res.on(
        "close",
        () => {

            if (
                !stream.destroyed
            ) {

                stream.destroy();

            }


            cleanupFile(
                filePath
            );

        }
    );


    stream.pipe(
        res
    );

}


// ============================================================
// SEARCH WITH YT-DLP
// ============================================================

async function searchWithYtDlp(
    query
) {

    const ytDlpPath =
        await ensureBinary();


    const args = [

        `ytsearch${MAX_SEARCH_RESULTS}:${query}`,

        "--flat-playlist",

        "--dump-single-json",

        "--skip-download",

        "--no-warnings",

        "--ignore-errors",

        "--socket-timeout",
        "30",

        "--force-ipv4"

    ];


    const result =
        await spawnCapture(

            ytDlpPath,

            args,

            30000

        );


    if (
        result.code !== 0
    ) {

        throw new Error(

            result.stderr.slice(
                -3000
            ) ||
            "yt-dlp search failed"

        );

    }


    const json =
        parseJson(
            result.stdout
        );


    const entries =
        Array.isArray(
            json?.entries
        )
            ? json.entries
            : [];


    return entries

        .filter(
            item =>
                item &&
                item.id
        )

        .map(
            item => ({

                id:
                    item.id,

                title:
                    item.title ||
                    "Untitled",

                thumbnail:

                    item.thumbnail ||

                    `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,

                duration:
                    formatDuration(
                        item.duration
                    ),

                url:
                    `https://www.youtube.com/watch?v=${item.id}`

            })
        );

}


// ============================================================
// GET YOUTUBE INFO
// ============================================================

async function getYoutubeInfo(
    url
) {

    const ytDlpPath =
        await ensureBinary();


    const args = [

        url,

        "--dump-single-json",

        "--skip-download",

        "--no-playlist",

        "--no-warnings",

        "--socket-timeout",
        "30",

        "--force-ipv4"

    ];


    const result =
        await spawnCapture(

            ytDlpPath,

            args,

            30000

        );


    if (
        result.code !== 0
    ) {

        throw new Error(

            result.stderr.slice(
                -3000
            ) ||
            "Could not get YouTube info"

        );

    }


    return parseJson(
        result.stdout
    );

}


// ============================================================
// SPAWN CAPTURE
// ============================================================

function spawnCapture(
    command,
    args,
    timeoutMs
) {

    return new Promise(
        (resolve, reject) => {

            let child;

            try {

                child =
                    spawn(

                        command,

                        args,

                        {

                            windowsHide:
                                true,

                            stdio: [
                                "ignore",
                                "pipe",
                                "pipe"
                            ]

                        }

                    );

            } catch (error) {

                return reject(
                    error
                );

            }


            let stdout =
                "";

            let stderr =
                "";


            const timer =
                setTimeout(
                    () => {

                        killProcess(
                            child
                        );


                        reject(
                            new Error(
                                "yt-dlp timed out"
                            )
                        );

                    },

                    timeoutMs

                );


            child.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();

                }
            );


            child.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

                }
            );


            child.on(
                "error",
                error => {

                    clearTimeout(
                        timer
                    );


                    reject(
                        error
                    );

                }
            );


            child.on(
                "close",
                code => {

                    clearTimeout(
                        timer
                    );


                    resolve({

                        code,

                        stdout,

                        stderr

                    });

                }
            );

        }
    );

}


// ============================================================
// PARSE JSON
// ============================================================

function parseJson(
    text
) {

    const lines =
        String(text || "")
            .split(/\r?\n/)
            .map(
                line =>
                    line.trim()
            )
            .filter(
                Boolean
            );


    for (
        let i =
            lines.length - 1;

        i >= 0;

        i--
    ) {

        try {

            return JSON.parse(
                lines[i]
            );

        } catch {

            // Continue

        }

    }


    throw new Error(
        "Invalid JSON returned by yt-dlp"
    );

}


// ============================================================
// FIND DOWNLOADED FILE
// ============================================================

function findDownloadedFile(
    uniqueId
) {

    const files =
        fs.readdirSync(
            TEMP_DIR
        );


    const matches =
        files.filter(
            file =>
                file.startsWith(
                    `${uniqueId}.`
                )
        );


    if (
        !matches.length
    ) {

        return null;

    }


    const media =
        matches.find(
            file =>
                /\.(mp4|m4a|mp3|webm|mkv|mov|aac|opus)$/i
                    .test(file)
        );


    return media ||
        matches[0];

}


// ============================================================
// KILL PROCESS
// ============================================================

function killProcess(
    childProcess
) {

    if (
        !childProcess ||
        childProcess.killed
    ) {

        return;

    }


    try {

        childProcess.kill(
            "SIGKILL"
        );

    } catch (error) {

        console.error(
            "Could not kill yt-dlp:",
            error.message
        );

    }

}


// ============================================================
// DOWNLOAD ERROR
// ============================================================

function getDownloadError(
    stderr
) {

    const error =
        String(
            stderr || ""
        ).toLowerCase();


    if (

        error.includes(
            "sign in to confirm"
        ) ||

        error.includes(
            "confirm you're not a bot"
        ) ||

        error.includes(
            "http error 403"
        ) ||

        error.includes(
            "http error 429"
        )

    ) {

        return (

            "YouTube rejected the download request. " +

            "Please update yt-dlp and try again."

        );

    }


    if (

        error.includes(
            "requested format is not available"
        ) ||

        error.includes(
            "format is not available"
        )

    ) {

        return (

            "The requested video format is unavailable. " +

            "Automatic format selection failed."

        );

    }


    if (
        error.includes(
            "ffmpeg"
        )
    ) {

        return (

            "FFmpeg is missing or could not be started."

        );

    }


    return (
        "Video download failed."
    );

}


// ============================================================
// FORMAT DURATION
// ============================================================

function formatDuration(
    seconds
) {

    if (
        seconds === undefined ||
        seconds === null
    ) {

        return "N/A";

    }


    const value =
        Number(seconds);


    if (
        !Number.isFinite(
            value
        )
    ) {

        return "N/A";

    }


    const total =
        Math.max(
            0,
            Math.floor(value)
        );


    const hours =
        Math.floor(
            total / 3600
        );


    const minutes =
        Math.floor(
            (total % 3600) / 60
        );


    const secs =
        total % 60;


    if (
        hours > 0
    ) {

        return (

            `${hours}:` +

            `${String(minutes).padStart(2, "0")}:` +

            `${String(secs).padStart(2, "0")}`

        );

    }


    return (

        `${minutes}:` +

        `${String(secs).padStart(2, "0")}`

    );

}


// ============================================================
// YOUTUBE URL CHECK
// ============================================================

function isYoutubeUrl(
    url
) {

    try {

        const parsed =
            new URL(url);


        const hostname =
            parsed.hostname.toLowerCase();


        return (

            hostname ===
                "youtube.com" ||

            hostname ===
                "www.youtube.com" ||

            hostname ===
                "m.youtube.com" ||

            hostname ===
                "youtu.be" ||

            hostname ===
                "www.youtu.be"

        );

    } catch {

        return false;

    }

}


// ============================================================
// EXTRACT VIDEO ID
// ============================================================

function extractVideoId(
    url
) {

    try {

        const parsed =
            new URL(
                url.trim()
            );


        const hostname =
            parsed.hostname.toLowerCase();


        // ----------------------------------------------------
        // YOUTU.BE
        // ----------------------------------------------------

        if (

            hostname ===
                "youtu.be" ||

            hostname ===
                "www.youtu.be"

        ) {

            return (

                parsed.pathname
                    .split("/")
                    .filter(Boolean)[0] ||
                null

            );

        }


        // ----------------------------------------------------
        // YOUTUBE.COM
        // ----------------------------------------------------

        if (

            hostname ===
                "youtube.com" ||

            hostname ===
                "www.youtube.com" ||

            hostname ===
                "m.youtube.com"

        ) {

            // Normal video

            if (
                parsed.searchParams.has(
                    "v"
                )
            ) {

                return parsed.searchParams.get(
                    "v"
                );

            }


            // Shorts

            if (
                parsed.pathname.startsWith(
                    "/shorts/"
                )
            ) {

                return (

                    parsed.pathname
                        .split(
                            "/shorts/"
                        )[1]
                        ?.split("/")[0] ||
                    null

                );

            }


            // Embed

            if (
                parsed.pathname.startsWith(
                    "/embed/"
                )
            ) {

                return (

                    parsed.pathname
                        .split(
                            "/embed/"
                        )[1]
                        ?.split("/")[0] ||
                    null

                );

            }

        }


        return null;

    } catch {

        return null;

    }

}


// ============================================================
// EXPORTS END
// ============================================================